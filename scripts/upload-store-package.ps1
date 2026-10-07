$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Store uploads run only on a disposable GitHub-hosted runner.' }
. (Join-Path $PSScriptRoot 'store-response-report.ps1')
. (Join-Path $PSScriptRoot 'store-draft-backup.ps1')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportPath = Join-Path $projectRoot 'release/store-submission-action.json'
$report = [ordered]@{ productId = $env:MSSTORE_PRODUCT_ID; packageOnly = $true; oldDraftDeleted = $false; newDraftCreated = $false; commitRequested = $false; metadataUpdated = $false; filesUploaded = $false; settingsPreserved = $false; status = 'Preparing'; errorCodes = @() }
$token = $null; $headers = $null; $body = $null
function Save-UploadReport {
  [void][IO.Directory]::CreateDirectory((Split-Path $reportPath))
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
function Request-Store {
  param([string]$Method, [string]$Url, $Payload, [string]$Stage)
  try {
    if ($null -eq $Payload) { return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType 'application/json' -TimeoutSec 60 }
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 100 -Compress))) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
  } catch {
    $report.status = 'RequestFailed'
    $report.httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    try {
      $errorBody = [string]$_.ErrorDetails.Message | ConvertFrom-Json
      $report.errorCodes = @($errorBody.errors | ForEach-Object { $_.code })
      $report.errorMessages = @(ConvertTo-SafeStoreMessages -Messages (@($errorBody.message) + @($errorBody.errors | ForEach-Object { $_.details })) -AccessToken $token.access_token)
    } catch {}
    Save-UploadReport
    throw "$Stage failed (HTTP $($report.httpStatus)). Raw metadata and upload URLs were withheld."
  }
}
function Get-MutableSubmission {
  param($Submission)
  $result = [ordered]@{}
  foreach ($name in @('applicationCategory','pricing','visibility','targetPublishMode','targetPublishDate','listings','hardwarePreferences','automaticBackupEnabled','canInstallOnRemovableMedia','isGameDvrEnabled','gamingOptions','hasExternalInAppProducts','meetAccessibilityGuidelines','notesForCertification','applicationPackages','packageDeliveryOptions','enterpriseLicensing','allowMicrosoftDecideAppAvailabilityToFutureDeviceFamilies','allowTargetFutureDeviceFamilies','trailers')) {
    if ($Submission.PSObject.Properties[$name]) { $result[$name] = $Submission.$name }
  }
  $clone = $result | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  if ($clone.pricing.PSObject.Properties['isAdvancedPricingModel']) { $clone.pricing.PSObject.Properties.Remove('isAdvancedPricingModel') }
  return $clone
}
function Get-SettingsFingerprint {
  param($Submission)
  $settings = Get-MutableSubmission -Submission $Submission
  $settings.applicationPackages = @()
  return Get-StoreDraftContentFingerprint -Submission $settings
}
try {
  $metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'release/store-package.json') -Raw | ConvertFrom-Json
  if (!$metadata.storeReady -or $metadata.developmentIdentity -or !$metadata.googleConfigured -or $metadata.productId -ne $env:MSSTORE_PRODUCT_ID -or $metadata.identityName -ne $env:MSIX_IDENTITY_NAME -or $metadata.publisher -ne $env:MSIX_PUBLISHER) { throw 'The validated package does not match the configured Store app.' }
  $packageName = [IO.Path]::GetFileName($metadata.file)
  if ($packageName -cne $metadata.file -or $packageName -notmatch '^Streamer-Assist-[0-9]+\.[0-9]+\.[0-9]+-x64\.msix$') { throw 'Unexpected package filename.' }
  $packagePath = Join-Path $projectRoot ('release/' + $packageName)
  if (!(Test-Path -LiteralPath $packagePath)) { throw 'Verified package file is missing.' }
  $report.packageName = $packageName; $report.packageVersion = $metadata.packageVersion
  $body = @{ grant_type = 'client_credentials'; client_id = $env:MSSTORE_CLIENT_ID; client_secret = $env:MSSTORE_CLIENT_SECRET; resource = 'https://manage.devcenter.microsoft.com' }
  try { $token = Invoke-RestMethod -Method Post -Uri ('https://login.microsoftonline.com/' + $env:MSSTORE_TENANT_ID + '/oauth2/token') -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 30 }
  catch { throw 'Store authentication failed. Token responses were withheld.' }
  $headers = @{ Authorization = 'Bearer ' + $token.access_token }
  $appUrl = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/' + $metadata.productId
  $app = Request-Store -Method Get -Url $appUrl -Stage 'App lookup'
  if ($app.id -ne $metadata.productId -or $app.packageIdentityName -ne $metadata.identityName -or $app.publisherName -ne $metadata.publisher -or $app.primaryName -cne $metadata.displayName) { throw 'Store product identity mismatch.' }
  $draftId = [string]$app.pendingApplicationSubmission.id
  if ($draftId -notmatch '^[0-9]+$') { throw 'An existing editable draft is required. No draft was created.' }
  $draftUrl = $appUrl + '/submissions/' + $draftId
  $draft = Request-Store -Method Get -Url $draftUrl -Stage 'Read draft'
  $status = Request-Store -Method Get -Url ($draftUrl + '/status') -Stage 'Read status'
  if ($status.status -notin @('PendingCommit','CommitFailed','PreProcessingFailed')) { throw 'The submission is not an editable draft. It was not canceled or replaced.' }
  $fingerprint = Get-StoreDraftContentFingerprint -Submission $draft
  $settingsFingerprint = Get-SettingsFingerprint -Submission $draft
  $payload = Get-MutableSubmission -Submission $draft
  $packages = @(); $replaced = @()
  foreach ($package in @($draft.applicationPackages)) {
    if (!$package) { continue }
    if ($package.fileName -ceq $packageName) { continue }
    $owned = $package.fileName -match '^Streamer-Assist-[0-9]+\.[0-9]+\.[0-9]+-x64\.msix$'
    if ($owned) { $replaced += $package.fileName }
    $packages += [pscustomobject]@{ fileName = $package.fileName; fileStatus = if ($owned) { 'PendingDelete' } else { $package.fileStatus }; minimumDirectXVersion = if ($package.minimumDirectXVersion) { $package.minimumDirectXVersion } else { 'None' }; minimumSystemRam = if ($package.minimumSystemRam) { $package.minimumSystemRam } else { 'None' } }
  }
  $payload.applicationPackages = @($packages + [pscustomobject]@{ fileName = $packageName; fileStatus = 'PendingUpload'; minimumDirectXVersion = 'None'; minimumSystemRam = 'None' })
  $report.replacedPackages = $replaced
  $directory = Join-Path $projectRoot ('release/package-upload-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($directory)
  Copy-Item -LiteralPath $packagePath -Destination (Join-Path $directory $packageName)
  $archive = $directory + '.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($directory, $archive, [IO.Compression.CompressionLevel]::NoCompression, $false)
  $freshApp = Request-Store -Method Get -Url $appUrl -Stage 'Recheck app'
  $freshDraft = Request-Store -Method Get -Url $draftUrl -Stage 'Recheck draft'
  $freshStatus = Request-Store -Method Get -Url ($draftUrl + '/status') -Stage 'Recheck status'
  if ($freshApp.pendingApplicationSubmission.id -ne $draftId -or (Get-StoreDraftContentFingerprint -Submission $freshDraft) -ne $fingerprint -or $freshStatus.status -notin @('PendingCommit','CommitFailed','PreProcessingFailed')) { throw 'The draft changed during preparation. No update was sent.' }
  $updated = Request-Store -Method Put -Url $draftUrl -Payload $payload -Stage 'Update package metadata'
  $report.metadataUpdated = $true
  $uri = [Uri]$updated.fileUploadUrl
  if ($uri.Scheme -ne 'https' -or $uri.Host -notlike '*.blob.core.windows.net') { throw 'Store did not supply a valid upload endpoint.' }
  try { Invoke-WebRequest -Method Put -Uri $uri -InFile $archive -ContentType 'application/zip' -Headers @{ 'x-ms-blob-type' = 'BlockBlob' } -TimeoutSec 300 | Out-Null }
  catch { $report.status = 'UploadFailed'; throw 'Store package upload failed. The private upload URL was withheld.' }
  $report.filesUploaded = $true
  $after = Request-Store -Method Get -Url $draftUrl -Stage 'Verify uploaded draft'
  if ((Get-SettingsFingerprint -Submission $after) -ne $settingsFingerprint) { throw 'Store returned different non-package settings; inspect the draft before further changes.' }
  $report.settingsPreserved = $true
  $report.status = [string]$after.status
  $report.packages = @($after.applicationPackages | ForEach-Object { [ordered]@{ fileName = $_.fileName; version = $_.version; fileStatus = $_.fileStatus } })
  if ($packageName -notin $after.applicationPackages.fileName) { throw 'The uploaded draft did not contain the requested package.' }
  Write-Output ('Uploaded ' + $packageName + '. Existing draft and non-package settings were preserved. No certification submission was requested.')
} finally { Save-UploadReport; $headers = $null; $token = $null; $body = $null; $draft = $null; $payload = $null }
