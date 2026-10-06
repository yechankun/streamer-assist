param([switch]$Commit, [switch]$RecreateEmptyDraft, [switch]$BackupOnly)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Store submission changes must run on a disposable GitHub-hosted runner.'
}
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'store-draft-backup.ps1')
$backupPath = Join-Path $projectRoot 'release/store-draft-backup.json'
if ($BackupOnly -and (!$RecreateEmptyDraft -or $Commit)) { throw 'BackupOnly requires RecreateEmptyDraft without Commit.' }
$reportPath = Join-Path $projectRoot 'release/store-submission-action.json'
$storeHeaders = $null
$tokenResult = $null
$report = [ordered]@{ productId = $env:MSSTORE_PRODUCT_ID; settingsBackedUp = $false; oldDraftDeleted = $false; newDraftCreated = $false; metadataUpdated = $false; filesUploaded = $false; commitRequested = $false; status = 'Preparing'; errorCodes = @() }
function Save-SubmissionReport {
  [void][IO.Directory]::CreateDirectory((Split-Path $reportPath))
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
function Invoke-StoreRequest {
  param([string]$Method, [string]$Url, [object]$Payload, [string]$Stage)
  try {
    if ($null -eq $Payload) {
      return Invoke-RestMethod -Method $Method -Uri $Url -Headers $storeHeaders -ContentType 'application/json' -TimeoutSec 60
    }
    $json = $Payload | ConvertTo-Json -Depth 100 -Compress
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $storeHeaders -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
  } catch {
    $httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    # Only server error codes are exposed. SAS URLs, tokens, account and rating data stay private.
    $codes = @()
    $messages = @()
    try {
      $errorResource = [string]$_.ErrorDetails.Message | ConvertFrom-Json
      $codes = @($errorResource.errors | ForEach-Object { $_.code })
      if (!$codes.Count -and $errorResource.code) { $codes = @($errorResource.code) }
      $messages = @($errorResource.errors | ForEach-Object { $_.details }) + @($errorResource.message)
    } catch {}
    $safeMessages = @($messages | Where-Object { $_ } | ForEach-Object {
      $text = [string]$_
      foreach ($secretName in @('MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET')) {
        $secretValue = [Environment]::GetEnvironmentVariable($secretName)
        if ($secretValue) { $text = $text.Replace($secretValue, '[redacted]') }
      }
      if ($tokenResult.access_token) { $text = $text.Replace($tokenResult.access_token, '[token]') }
      $text = [regex]::Replace($text, 'https?://\S+', '[URL]')
      $text = [regex]::Replace($text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]')
      $text = [regex]::Replace($text, '\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b|\b[0-9]{10,}\b', '[ID]')
      if ($text.Length -gt 600) { $text = $text.Substring(0,600) }
      $text
    })
    $report.errorMessages = $safeMessages
    $report.status = 'RequestFailed'
    $report.errorCodes = $codes
    $report.httpStatus = $httpStatus
    Save-SubmissionReport
    throw "$Stage failed (HTTP $httpStatus). Error codes: $($codes -join ', '). Raw private responses were withheld."
  }
}
try {
  $metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'release/store-package.json') -Raw | ConvertFrom-Json
  if (!$metadata.storeReady -or $metadata.developmentIdentity -or !$metadata.googleConfigured -or
      $metadata.productId -ne $env:MSSTORE_PRODUCT_ID -or $metadata.identityName -ne $env:MSIX_IDENTITY_NAME -or
      $metadata.publisher -ne $env:MSIX_PUBLISHER) { throw 'The validated package identity/configuration does not match this Store product.' }
  $packageName = [IO.Path]::GetFileName($metadata.file)
  if ($packageName -ne $metadata.file) { throw 'The package filename must be a simple filename.' }
  $packagePath = Join-Path $projectRoot ('release/' + $packageName)
  if (!(Test-Path -LiteralPath $packagePath)) { throw 'Validated MSIX package missing.' }
  $tokenBody = @{ grant_type = 'client_credentials'; client_id = $env:MSSTORE_CLIENT_ID; client_secret = $env:MSSTORE_CLIENT_SECRET; resource = 'https://manage.devcenter.microsoft.com' }
  try {
    $tokenResult = Invoke-RestMethod -Method Post -Uri ("https://login.microsoftonline.com/" + $env:MSSTORE_TENANT_ID + "/oauth2/token") -Body $tokenBody -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
  } catch { throw 'Store authentication failed. The response was withheld.' }
  $storeHeaders = @{ Authorization = 'Bearer ' + $tokenResult.access_token }
  $appUrl = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/' + $env:MSSTORE_PRODUCT_ID
  $app = Invoke-StoreRequest -Method Get -Url $appUrl -Payload $null -Stage 'App lookup'
  if ($app.id -ne $metadata.productId -or $app.packageIdentityName -ne $metadata.identityName -or $app.publisherName -ne $metadata.publisher) { throw 'Store app identity mismatch.' }
  $submissionId = [string]$app.pendingApplicationSubmission.id
  if ($submissionId -notmatch '^[0-9]+$') { throw 'A first pending submission must already exist in Partner Center.' }
  $submissionUrl = $appUrl + '/submissions/' + $submissionId
  $submission = Invoke-StoreRequest -Method Get -Url $submissionUrl -Payload $null -Stage 'Get existing submission'
  $status = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Get submission status'
  if ($status.status -notin @('PendingCommit', 'CommitFailed', 'PreProcessingFailed')) {
    throw 'The existing submission is not an editable draft. It was not replaced or canceled.'
  }
  if ($submission.pricing.priceId -ne 'Free' -or $submission.visibility -ne 'Public') {
    throw 'This initial submission requires the existing Free/Public settings; pricing and visibility were not changed.'
  }
  if ($RecreateEmptyDraft) {
    Assert-EmptyInitialStoreDraft -App $app -Submission $submission -Status $status -ExpectedSubmissionId $submissionId
    if ($BackupOnly) {
      [void][IO.Directory]::CreateDirectory((Split-Path $backupPath))
      Save-SafeStoreDraftBackup -App $app -Submission $submission -Path $backupPath
    }
    # Verify the exported public settings belong to the current draft.
    $backup = Read-SafeStoreDraftBackup -Path $backupPath
    if ($backup.productId -ne $app.id -or $backup.pendingDraftFingerprint -ne (Get-StoreDraftFingerprint -SubmissionId $submissionId)) {
      throw 'The settings backup does not match the pending draft.'
    }
    $report.settingsBackedUp = $true
    $backup = $null
    Save-SubmissionReport
    if ($BackupOnly) {
      $report.status = 'BackupReady'
      Write-Output 'Public draft settings backed up. No submission changed.'
      return
    }
  }
  $originalDraftJson = $submission | ConvertTo-Json -Depth 100 -Compress
  $listingData = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/store-listing.json') -Raw | ConvertFrom-Json
  if (!$submission.listings) { $submission.listings = [pscustomobject]@{} }
  $screenNames = @('home-dark', 'home-light', 'timeline', 'viewer-raffle', 'live-poll', 'donation-vote', 'roulette', 'settings')
  $archiveDirectory = Join-Path $projectRoot ('release/store-upload-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory((Join-Path $archiveDirectory 'Images'))
  Copy-Item -LiteralPath $packagePath -Destination (Join-Path $archiveDirectory $packageName)
  foreach ($screen in $screenNames) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ('docs/store-assets/screenshots/' + $screen + '.png')) -Destination (Join-Path $archiveDirectory ('Images/' + $screen + '.png'))
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/store-assets/icon-300.png') -Destination (Join-Path $archiveDirectory 'Images/icon-300.png')
  foreach ($locale in $listingData.PSObject.Properties) {
    $language = $locale.Name
    $existing = $submission.listings.PSObject.Properties[$language]
    if (!$existing) {
      $submission.listings | Add-Member -NotePropertyName $language -NotePropertyValue ([pscustomobject]@{ baseListing = [pscustomobject]@{}; platformOverrides = [pscustomobject]@{} })
    }
    $baseListing = $submission.listings.PSObject.Properties[$language].Value.baseListing
    $values = [ordered]@{
      title = $app.primaryName
      description = $locale.Value.description
      features = @($locale.Value.features)
      keywords = @($locale.Value.keywords)
      releaseNotes = $locale.Value.releaseNotes
      privacyPolicy = 'https://yechankun.github.io/streamer-assist/privacy.html'
      supportContact = 'https://github.com/yechankun/streamer-assist/issues'
      websiteUrl = 'https://github.com/yechankun/streamer-assist'
      copyrightAndTrademarkInfo = 'Independent project, not affiliated with NAVER/CHZZK or YouTube. Third-party marks belong to their owners.'
      licenseTerms = 'MIT License. https://github.com/yechankun/streamer-assist/blob/main/LICENSE'
    }
    foreach ($property in $values.GetEnumerator()) { $baseListing | Add-Member -NotePropertyName $property.Key -NotePropertyValue $property.Value -Force }
    $managedImageNames = @($screenNames | ForEach-Object { 'Images/' + $_ + '.png' }) + @('Images/icon-300.png')
    $existingImages = @($baseListing.images | Where-Object { $_ -and $_.fileName -notin $managedImageNames })
    $newImages = @($screenNames | ForEach-Object {
      [pscustomobject]@{ fileName = 'Images/' + $_ + '.png'; fileStatus = 'PendingUpload'; imageType = 'Screenshot'; description = if ($language -eq 'ko-kr') { 'Streamer Assist 실제 화면 · 테스트 데이터' } else { 'Streamer Assist app interface with generated sample data (Korean UI)' } }
    }) + @([pscustomobject]@{ fileName = 'Images/icon-300.png'; fileStatus = 'PendingUpload'; imageType = 'Icon'; description = 'Streamer Assist' })
    $baseListing | Add-Member -NotePropertyName images -NotePropertyValue @($existingImages + $newImages) -Force
  }
  # Preserve unrelated packages; only replace the intended filename from this validated build.
  $otherPackages = @($submission.applicationPackages | Where-Object { $_ -and $_.fileName -ne $packageName })
  $submission.applicationPackages = @($otherPackages + @([pscustomobject]@{
    fileName = $packageName; fileStatus = 'PendingUpload'; minimumDirectXVersion = 'None'; minimumSystemRam = 'None'
  }))
  $reviewNotes = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/certification.en.md') -Raw
  if (![string]::IsNullOrWhiteSpace($submission.notesForCertification)) { $reviewNotes = $submission.notesForCertification + [Environment]::NewLine + [Environment]::NewLine + $reviewNotes }
  $submission.notesForCertification = $reviewNotes
  # Keep current pricing, ratings, availability and declaration values from the existing resource.
  $mutableSubmission = [ordered]@{}
  foreach ($field in @('applicationCategory','pricing','visibility','targetPublishMode','targetPublishDate','listings',
    'hardwarePreferences','automaticBackupEnabled','canInstallOnRemovableMedia','isGameDvrEnabled','gamingOptions',
    'hasExternalInAppProducts','meetAccessibilityGuidelines','notesForCertification','applicationPackages',
    'packageDeliveryOptions','enterpriseLicensing','allowMicrosoftDecideAppAvailabilityToFutureDeviceFamilies',
    'allowTargetFutureDeviceFamilies','trailers')) {
    if ($submission.PSObject.Properties[$field]) { $mutableSubmission[$field] = $submission.$field }
  }
  if ($mutableSubmission.pricing.PSObject.Properties['isAdvancedPricingModel']) {
    $mutableSubmission.pricing.PSObject.Properties.Remove('isAdvancedPricingModel')
  }
  # Finish the local upload archive before the authorized draft replacement.
  $zipPath = $archiveDirectory + '.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($archiveDirectory, $zipPath, [IO.Compression.CompressionLevel]::NoCompression, $false)
  if ($RecreateEmptyDraft) {
    # A fresh read prevents deleting a newly submitted or edited Portal draft.
    $freshApp = Invoke-StoreRequest -Method Get -Url $appUrl -Payload $null -Stage 'Recheck app before draft replacement'
    $freshSubmission = Invoke-StoreRequest -Method Get -Url $submissionUrl -Payload $null -Stage 'Recheck draft before replacement'
    $freshStatus = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Recheck draft status'
    if ($freshApp.id -ne $app.id -or $freshApp.packageIdentityName -ne $metadata.identityName -or $freshApp.publisherName -ne $metadata.publisher -or
        ($freshSubmission | ConvertTo-Json -Depth 100 -Compress) -ne $originalDraftJson) {
      throw 'The Store app or draft settings changed during preparation. No submission was deleted.'
    }
    Assert-EmptyInitialStoreDraft -App $freshApp -Submission $freshSubmission -Status $freshStatus -ExpectedSubmissionId $submissionId
    Invoke-StoreRequest -Method Delete -Url $submissionUrl -Payload $null -Stage 'Delete approved empty draft' | Out-Null
    $report.oldDraftDeleted = $true
    $report.status = 'DraftDeleted'
    Save-SubmissionReport
    $created = Invoke-StoreRequest -Method Post -Url ($appUrl + '/submissions') -Payload $null -Stage 'Create replacement API draft'
    $newSubmissionId = [string]$created.id
    if ($newSubmissionId -notmatch '^[0-9]+$' -or $newSubmissionId -eq $submissionId) { throw 'Store did not return a new draft ID.' }
    $submissionId = $newSubmissionId
    $submissionUrl = $appUrl + '/submissions/' + $submissionId
    $report.newDraftCreated = $true
    $report.status = [string]$created.status
    Save-SubmissionReport
    Write-Output 'Approved empty draft replaced. Existing registration settings are included in the update.'
  }
  $updated = Invoke-StoreRequest -Method Put -Url $submissionUrl -Payload $mutableSubmission -Stage 'Prepare submission'
  $report.metadataUpdated = $true
  $report.status = [string]$updated.status
  Save-SubmissionReport
  if ([string]::IsNullOrWhiteSpace($updated.fileUploadUrl)) { throw 'Store did not return an upload URL for this draft. Use Partner Center to complete the first submission.' }
  $uploadUri = [Uri]$updated.fileUploadUrl
  if ($uploadUri.Scheme -ne 'https' -or $uploadUri.Host -notlike '*.blob.core.windows.net') { throw 'Unexpected Store upload endpoint.' }
  try {
    Invoke-WebRequest -Method Put -Uri $uploadUri -InFile $zipPath -ContentType 'application/zip' -Headers @{ 'x-ms-blob-type' = 'BlockBlob' } -TimeoutSec 300 | Out-Null
  } catch { throw 'Store ZIP upload failed. The private upload URL and response were withheld.' }
  $report.filesUploaded = $true
  $report.packageVersion = $metadata.packageVersion
  $report.languages = @($listingData.PSObject.Properties.Name)
  Save-SubmissionReport
  Write-Output 'Draft metadata and package/image upload prepared.'
  if ($Commit) {
    $commitResult = Invoke-StoreRequest -Method Post -Url ($submissionUrl + '/commit') -Payload $null -Stage 'Commit submission'
    $report.commitRequested = $true
    $report.status = [string]$commitResult.status
    Save-SubmissionReport
    Write-Output ('Store commit accepted: ' + $report.status)
    for ($pollAttempt = 0; $pollAttempt -lt 6; $pollAttempt++) {
      Start-Sleep -Seconds 10
      $poll = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Poll submission'
      $report.status = [string]$poll.status
      $report.errorCodes = @($poll.statusDetails.errors | ForEach-Object { $_.code })
      Save-SubmissionReport
      if ($poll.status -in @('CommitFailed', 'PreProcessingFailed', 'CertificationFailed', 'PublishFailed', 'ReleaseFailed')) {
        throw ('Store submission failed: ' + $poll.status + '; error codes: ' + ($report.errorCodes -join ', '))
      }
      if ($poll.status -ne 'CommitStarted') { break }
    }
  }
} finally {
  Save-SubmissionReport
  $storeHeaders = $null
  $tokenResult = $null
  $tokenBody = $null
  $submission = $null
}
