$ErrorActionPreference = 'Stop'
$base = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.dev'))
$fixture = Join-Path $base ('store-package-test-' + [Guid]::NewGuid().ToString('N'))
$original = @{}
foreach ($name in @('GITHUB_ACTIONS','RUNNER_ENVIRONMENT','MSSTORE_PRODUCT_ID','MSIX_IDENTITY_NAME','MSIX_PUBLISHER','MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET')) { $original[$name] = [Environment]::GetEnvironmentVariable($name) }
function New-Draft {
  return [pscustomobject]@{ id = '123'; status = 'PendingCommit'; applicationCategory = 'UtilitiesAndTools'; visibility = 'Public'; targetPublishMode = 'Manual'; pricing = [pscustomobject]@{ priceId = 'Free'; isAdvancedPricingModel = $true }; listings = [pscustomobject]@{ 'ko-kr' = [pscustomobject]@{ baseListing = [pscustomobject]@{ title = 'Saved title'; description = 'Saved description'; images = @([pscustomobject]@{ fileName = 'original.png'; fileStatus = 'Uploaded' }) } } }; notesForCertification = 'User-saved runFullTrust notes'; automaticBackupEnabled = $false; allowTargetFutureDeviceFamilies = [pscustomobject]@{ Desktop = $true; Mobile = $false; Xbox = $false; Holographic = $false }; applicationPackages = @([pscustomobject]@{ fileName = 'Streamer-Assist-0.1.0-x64.msix'; fileStatus = 'Uploaded' }, [pscustomobject]@{ fileName = 'unrelated-arm64.msix'; fileStatus = 'Uploaded' }) }
}
function Invoke-RestMethod {
  param([string]$Method, [uri]$Uri, $Headers, $Body, [string]$ContentType, [int]$TimeoutSec)
  $state = $global:StorePackageUploadTest
  if ($Uri.AbsoluteUri -like 'https://login.microsoftonline.com/*/oauth2/token') { return [pscustomobject]@{ access_token = 'synthetic-token' } }
  $root = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/9PKRWHZ2CWBG'
  if ($Method -eq 'Get' -and $Uri.AbsoluteUri -eq $root) { return [pscustomobject]@{ id = '9PKRWHZ2CWBG'; packageIdentityName = 'Test.Identity'; publisherName = 'CN=Test'; primaryName = 'Test App'; pendingApplicationSubmission = [pscustomobject]@{ id = '123' } } }
  if ($Method -eq 'Get' -and $Uri.AbsoluteUri.EndsWith('/status')) { return [pscustomobject]@{ status = 'PendingCommit' } }
  if ($Method -eq 'Get' -and $Uri.AbsoluteUri -eq ($root + '/submissions/123')) {
    $state.reads++
    if ($state.changed -and $state.reads -eq 2) { $state.draft.notesForCertification = 'Concurrent user edit' }
    return $state.draft | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  }
  if ($Method -eq 'Put' -and $Uri.AbsoluteUri -eq ($root + '/submissions/123')) {
    $payload = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    if ($payload.listings.'ko-kr'.baseListing.description -ne 'Saved description' -or $payload.notesForCertification -ne 'User-saved runFullTrust notes' -or $payload.targetPublishMode -ne 'Manual' -or $payload.automaticBackupEnabled) { throw 'Non-package user settings changed.' }
    if ($payload.PSObject.Properties['id'] -or $payload.PSObject.Properties['status'] -or $payload.pricing.PSObject.Properties['isAdvancedPricingModel']) { throw 'Read-only fields included in update.' }
    if (@($payload.applicationPackages).Count -ne 3 -or @($payload.applicationPackages | Where-Object { $_.fileName -eq 'Streamer-Assist-0.1.0-x64.msix' -and $_.fileStatus -eq 'PendingDelete' }).Count -ne 1 -or @($payload.applicationPackages | Where-Object { $_.fileName -eq 'unrelated-arm64.msix' -and $_.fileStatus -eq 'Uploaded' }).Count -ne 1) { throw 'Package replacement did not preserve unrelated architecture.' }
    $state.updated = $true; $state.draft = $payload
    $state.draft | Add-Member -NotePropertyName status -NotePropertyValue 'PendingCommit'
    return [pscustomobject]@{ fileUploadUrl = 'https://test.blob.core.windows.net/upload?sig=private'; status = 'PendingCommit' }
  }
  throw 'Unexpected network or certification operation.'
}
function Invoke-WebRequest {
  param([string]$Method, [uri]$Uri, [string]$InFile, [string]$ContentType, $Headers, [int]$TimeoutSec)
  if ($Method -ne 'Put' -or $Uri.Host -ne 'test.blob.core.windows.net' -or !$global:StorePackageUploadTest.updated) { throw 'Unexpected upload.' }
  $archive = [IO.Compression.ZipFile]::OpenRead($InFile)
  try { if ($archive.Entries.Count -ne 1 -or !$archive.GetEntry('Streamer-Assist-0.3.0-x64.msix')) { throw 'Package-only archive contained other files.' } } finally { $archive.Dispose() }
  $global:StorePackageUploadTest.uploaded = $true
}
try {
  foreach ($folder in @('scripts','release')) { [void][IO.Directory]::CreateDirectory((Join-Path $fixture $folder)) }
  foreach ($file in @('upload-store-package.ps1','store-response-report.ps1','store-draft-backup.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../scripts/' + $file)) -Destination (Join-Path $fixture ('scripts/' + $file)) }
  [pscustomobject]@{ storeReady = $true; developmentIdentity = $false; googleConfigured = $true; productId = '9PKRWHZ2CWBG'; identityName = 'Test.Identity'; publisher = 'CN=Test'; displayName = 'Test App'; file = 'Streamer-Assist-0.3.0-x64.msix'; packageVersion = '1.3.0.0' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'release/store-package.json') -Encoding utf8
  Set-Content -LiteralPath (Join-Path $fixture 'release/Streamer-Assist-0.3.0-x64.msix') -Value 'synthetic package'
  $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:MSSTORE_PRODUCT_ID = '9PKRWHZ2CWBG'; $env:MSIX_IDENTITY_NAME = 'Test.Identity'; $env:MSIX_PUBLISHER = 'CN=Test'; $env:MSSTORE_TENANT_ID = 'test'; $env:MSSTORE_CLIENT_ID = 'test'; $env:MSSTORE_CLIENT_SECRET = 'synthetic-secret'
  $global:StorePackageUploadTest = @{ draft = New-Draft; reads = 0; updated = $false; uploaded = $false; changed = $false }
  & (Join-Path $fixture 'scripts/upload-store-package.ps1')
  $report = Get-Content -LiteralPath (Join-Path $fixture 'release/store-submission-action.json') -Raw | ConvertFrom-Json
  if (!$report.filesUploaded -or !$report.settingsPreserved -or $report.oldDraftDeleted -or $report.newDraftCreated -or $report.commitRequested) { throw 'Package upload exceeded its authorized scope.' }
  $global:StorePackageUploadTest = @{ draft = New-Draft; reads = 0; updated = $false; uploaded = $false; changed = $true }
  $blocked = $false
  try { & (Join-Path $fixture 'scripts/upload-store-package.ps1') } catch { $blocked = $_.Exception.Message -like 'The draft changed during preparation*' }
  if (!$blocked -or $global:StorePackageUploadTest.updated -or $global:StorePackageUploadTest.uploaded) { throw 'Concurrent portal edits were not protected.' }
} finally {
  foreach ($name in $original.Keys) { [Environment]::SetEnvironmentVariable($name, $original[$name]) }
  Remove-Variable -Name StorePackageUploadTest -Scope Global -ErrorAction SilentlyContinue
  $resolved = [IO.Path]::GetFullPath($fixture)
  if (!$resolved.StartsWith($base + [IO.Path]::DirectorySeparatorChar + 'store-package-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output 'PASS: package-only replacement, preserved user fields and architecture, no commit/delete/create, concurrent-edit guard.'
