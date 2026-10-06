$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/store-draft-backup.ps1')
$fixtureBase = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.dev'))
$fixtureRoot = Join-Path $fixtureBase ('store-submission-test-' + [Guid]::NewGuid().ToString('N'))
$originalEnvironment = @{}
foreach ($name in @('GITHUB_ACTIONS','RUNNER_ENVIRONMENT','MSSTORE_PRODUCT_ID','MSIX_IDENTITY_NAME','MSIX_PUBLISHER',
    'MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET')) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}
function New-TestSubmission {
  return [pscustomobject]@{
    id = '123'; status = 'PendingCommit'; applicationCategory = 'NotSet'
    pricing = [pscustomobject]@{ priceId = 'Free'; isAdvancedPricingModel = $true }
    visibility = 'Public'; targetPublishMode = 'Immediate'; targetPublishDate = '1601-01-01T00:00:00Z'
    allowTargetFutureDeviceFamilies = [pscustomobject]@{ Desktop = if ($global:StoreSubmissionTestState.resume) { $false } else { $null }; Mobile = $false }
    listings = [pscustomobject]@{}; applicationPackages = @(); notesForCertification = ''; trailers = @()
  }
}
function Invoke-RestMethod {
  param([string]$Method, [uri]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec)
  $state = $global:StoreSubmissionTestState
  $appUrl = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/9PKRWHZ2CWBG'
  if ($Uri.AbsoluteUri -eq 'https://login.microsoftonline.com/test-tenant/oauth2/token' -and $Method -eq 'Post') {
    return [pscustomobject]@{ access_token = 'synthetic-test-token' }
  }
  if ($Headers.Authorization -ne 'Bearer synthetic-test-token') { throw 'Unexpected mock credentials.' }
  if ($Uri.AbsoluteUri -eq $appUrl -and $Method -eq 'Get') {
    # The API omits pendingApplicationSubmission entirely when there is no draft.
    $app = [pscustomobject]@{ id = '9PKRWHZ2CWBG'; packageIdentityName = 'Test.Identity'; publisherName = 'CN=Test'; primaryName = 'Test App' }
    if ($state.resume) { $app | Add-Member -NotePropertyName pendingApplicationSubmission -NotePropertyValue ([pscustomobject]@{ id = '123' }) }
    return $app
  }
  if ($Uri.AbsoluteUri -eq ($appUrl + '/submissions') -and $Method -eq 'Post') {
    if ($state.resume -or $state.created -or $null -ne $Body -or $ContentType -ne 'application/json') { throw 'Unexpected draft creation.' }
    $state.created = $true
    return New-TestSubmission
  }
  if ($Uri.AbsoluteUri -eq ($appUrl + '/submissions/123') -and $Method -eq 'Get') { return New-TestSubmission }
  if ($Uri.AbsoluteUri -eq ($appUrl + '/submissions/123/status') -and $Method -eq 'Get') {
    return [pscustomobject]@{
      status = if ($state.failCommit -and $state.committed) { 'CommitFailed' } elseif ($state.committed) { 'PreProcessing' } else { 'PendingCommit' }
      statusDetails = [pscustomobject]@{ errors = if ($state.failCommit -and $state.committed) {
        @([pscustomobject]@{ code = 'InvalidParameterValue'; details = 'Synthetic validation error synthetic-secret synthetic-test-token person@example.invalid https://example.invalid/?sig=secret 12345678901234' })
      } else { @() } }
    }
  }
  if ($Uri.AbsoluteUri -eq ($appUrl + '/submissions/123') -and $Method -eq 'Put') {
    $payload = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    if ($payload.applicationCategory -ne 'UtilitiesAndTools' -or $payload.pricing.priceId -ne 'Free' -or $payload.visibility -ne 'Public') { throw 'Original public settings were not restored.' }
    if ($payload.PSObject.Properties['id'] -or $payload.PSObject.Properties['status'] -or $payload.pricing.PSObject.Properties['isAdvancedPricingModel']) { throw 'Read-only data was sent to Store.' }
    if (@($payload.listings.PSObject.Properties).Count -ne 2 -or @($payload.listings.'en-us'.baseListing.images).Count -ne 9 -or @($payload.applicationPackages).Count -ne 1) { throw 'Incomplete listing/package payload.' }
    foreach ($family in @('Desktop', 'Mobile', 'Xbox', 'Holographic')) {
      if ($payload.allowTargetFutureDeviceFamilies.$family -isnot [bool]) { throw 'A required device family flag is uninitialized.' }
    }
    if ($payload.allowTargetFutureDeviceFamilies.Desktop -eq $state.resume -or $payload.allowTargetFutureDeviceFamilies.Mobile) { throw 'Desktop default or existing device flags were not preserved.' }
    $state.updated = $true
    return [pscustomobject]@{ status = 'PendingCommit'; fileUploadUrl = 'https://test.blob.core.windows.net/mock-upload?sig=synthetic' }
  }
  if ($Uri.AbsoluteUri -eq ($appUrl + '/submissions/123/commit') -and $Method -eq 'Post') {
    if (!$state.uploaded -or $null -ne $Body -or $ContentType -ne 'application/json') { throw 'Commit occurred before upload or used an invalid body.' }
    $state.committed = $true
    return [pscustomobject]@{ status = 'CommitStarted' }
  }
  throw 'Unexpected Store request; network calls are prohibited in this test.'
}
function Invoke-WebRequest {
  param([string]$Method, [uri]$Uri, [string]$InFile, [string]$ContentType, $Headers, [int]$TimeoutSec)
  if ($Method -ne 'Put' -or $Uri.Host -ne 'test.blob.core.windows.net' -or $Headers.'x-ms-blob-type' -ne 'BlockBlob' -or !$global:StoreSubmissionTestState.updated) {
    throw 'Unexpected upload; network calls are prohibited in this test.'
  }
  $zip = [IO.Compression.ZipFile]::OpenRead($InFile)
  try {
    if (!$zip.GetEntry('test.msix') -or !$zip.GetEntry('Images/icon-300.png') -or !$zip.GetEntry('Images/home-dark.png')) {
      throw 'Upload archive does not contain the expected package and images.'
    }
  } finally { $zip.Dispose() }
  $global:StoreSubmissionTestState.uploaded = $true
}
function Start-Sleep { param([int]$Seconds) }
try {
  foreach ($directory in @('scripts','docs/store-assets/screenshots','release')) { [void][IO.Directory]::CreateDirectory((Join-Path $fixtureRoot $directory)) }
  foreach ($name in @('prepare-store-submission.ps1','store-draft-backup.ps1','store-response-report.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../scripts/' + $name)) -Destination (Join-Path $fixtureRoot ('scripts/' + $name))
  }
  [ordered]@{ storeReady = $true; developmentIdentity = $false; googleConfigured = $true; productId = '9PKRWHZ2CWBG'; identityName = 'Test.Identity'; displayName = 'Test App'; publisher = 'CN=Test'; file = 'test.msix'; packageVersion = '1.1.0.0' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'release/store-package.json') -Encoding utf8
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'release/test.msix') -Value 'synthetic package only'
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'docs/certification.en.md') -Value 'Synthetic review notes'
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'docs/store-assets/icon-300.png') -Value 'synthetic image only'
  foreach ($screen in @('home-dark','home-light','timeline','viewer-raffle','live-poll','donation-vote','roulette','settings')) {
    Set-Content -LiteralPath (Join-Path $fixtureRoot ('docs/store-assets/screenshots/' + $screen + '.png')) -Value 'synthetic image only'
  }
  $locales = [ordered]@{}
  foreach ($language in @('ko-kr','en-us')) {
    $locales[$language] = [ordered]@{ description = 'Synthetic description'; features = @('Test feature'); keywords = @('test'); releaseNotes = 'Test' }
  }
  $locales | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'docs/store-listing.json') -Encoding utf8
  $draft = New-TestSubmission
  $draft.applicationCategory = 'UtilitiesAndTools'
  Save-SafeStoreDraftBackup -App ([pscustomobject]@{ id = '9PKRWHZ2CWBG' }) -Submission $draft -Path (Join-Path $fixtureRoot 'release/store-draft-backup.json')
  $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'
  $env:MSSTORE_PRODUCT_ID = '9PKRWHZ2CWBG'; $env:MSIX_IDENTITY_NAME = 'Test.Identity'; $env:MSIX_PUBLISHER = 'CN=Test'
  $env:MSSTORE_TENANT_ID = 'test-tenant'; $env:MSSTORE_CLIENT_ID = 'synthetic-client'; $env:MSSTORE_CLIENT_SECRET = 'synthetic-secret'
  foreach ($resume in @($false, $true)) {
    $global:StoreSubmissionTestState = @{ resume = $resume; created = $false; updated = $false; uploaded = $false; committed = $false }
    if ($resume) { & (Join-Path $fixtureRoot 'scripts/prepare-store-submission.ps1') -RestorePublicSettings -Commit }
    else { & (Join-Path $fixtureRoot 'scripts/prepare-store-submission.ps1') -CreateNewDraft -Commit }
    $report = Get-Content -LiteralPath (Join-Path $fixtureRoot 'release/store-submission-action.json') -Raw | ConvertFrom-Json
    if (!$report.metadataUpdated -or !$report.filesUploaded -or !$report.commitRequested -or $report.status -ne 'PreProcessing' -or $report.newDraftCreated -eq $resume) {
      throw 'Create/resume submission did not finish correctly.'
    }
  }
  $fixtureMetadataPath = Join-Path $fixtureRoot 'release/store-package.json'
  $badMetadata = Get-Content -LiteralPath $fixtureMetadataPath -Raw | ConvertFrom-Json
  $badMetadata.displayName = 'Unreserved name'
  $badMetadata | ConvertTo-Json | Set-Content -LiteralPath $fixtureMetadataPath -Encoding utf8
  $global:StoreSubmissionTestState = @{ resume = $false; created = $false; updated = $false; uploaded = $false; committed = $false }
  $nameRejected = $false
  try { & (Join-Path $fixtureRoot 'scripts/prepare-store-submission.ps1') -CreateNewDraft -Commit } catch { $nameRejected = $true }
  if (!$nameRejected -or $global:StoreSubmissionTestState.created -or $global:StoreSubmissionTestState.updated) { throw 'An unreserved name reached draft creation or update.' }
  $badMetadata.displayName = 'Test App'
  $badMetadata | ConvertTo-Json | Set-Content -LiteralPath $fixtureMetadataPath -Encoding utf8
  $global:StoreSubmissionTestState = @{ resume = $true; created = $false; updated = $false; uploaded = $false; committed = $false; failCommit = $true }
  $validationFailed = $false
  try { & (Join-Path $fixtureRoot 'scripts/prepare-store-submission.ps1') -RestorePublicSettings -Commit } catch { $validationFailed = $true }
  $failureReport = Get-Content -LiteralPath (Join-Path $fixtureRoot 'release/store-submission-action.json') -Raw | ConvertFrom-Json
  $safeErrors = $failureReport.errorMessages -join ' '
  if (!$validationFailed -or $failureReport.status -ne 'CommitFailed' -or $safeErrors -notlike '*Synthetic validation error*') { throw 'Commit validation details were not reported.' }
  foreach ($marker in @('synthetic-secret','synthetic-test-token','person@example.invalid','https://example.invalid','12345678901234')) {
    if ($safeErrors.Contains($marker)) { throw 'The validation report leaked a private value.' }
  }
} finally {
  foreach ($name in $originalEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name]) }
  Remove-Variable -Name StoreSubmissionTestState -Scope Global -ErrorAction SilentlyContinue
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  if (!$resolvedFixture.StartsWith($fixtureBase + [IO.Path]::DirectorySeparatorChar + 'store-submission-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
Write-Output 'Store create/resume flow passed with mocked requests and omitted optional API fields.'
