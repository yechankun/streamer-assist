param([switch]$Commit, [switch]$RecreateEmptyDraft, [switch]$BackupOnly, [switch]$CreateNewDraft, [switch]$RestorePublicSettings, [switch]$ReplaceNameFailureDraft, [switch]$UpdatePublished, [switch]$RecoverUnchangedDraft)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Store submission changes must run on a disposable GitHub-hosted runner.'
}
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($UpdatePublished -and ($RecreateEmptyDraft -or $BackupOnly -or $CreateNewDraft -or $RestorePublicSettings -or $ReplaceNameFailureDraft)) { throw 'Published updates cannot replace or restore first-submission drafts.' }
. (Join-Path $PSScriptRoot 'store-draft-backup.ps1')
. (Join-Path $PSScriptRoot 'store-response-report.ps1')
. (Join-Path $PSScriptRoot 'store-update-state.ps1')
if ($RecoverUnchangedDraft -and !$UpdatePublished) { throw 'Published-draft recovery requires UpdatePublished.' }
$backupPath = Join-Path $projectRoot 'release/store-draft-backup.json'
if ($ReplaceNameFailureDraft -and ($CreateNewDraft -or $RecreateEmptyDraft -or $BackupOnly)) { throw 'Name failure replacement cannot use other draft creation modes.' }
if (($CreateNewDraft -or $RestorePublicSettings) -and ($RecreateEmptyDraft -or $BackupOnly)) { throw 'CreateNewDraft cannot replace an existing draft.' }
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
    $safeMessages = @(ConvertTo-SafeStoreMessages -Messages $messages -AccessToken $tokenResult.access_token)
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
  # Validate all local submission assets before creating or deleting a Store draft.
  $preflightListing = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/store-listing.json') -Raw | ConvertFrom-Json
  if (!$preflightListing.PSObject.Properties['ko-kr'] -or !$preflightListing.PSObject.Properties['en-us']) { throw 'Both Store locales are required.' }
  foreach ($relativePath in @('docs/certification.en.md', 'docs/store-review-notes.txt', 'docs/store-assets/icon-300.png') + @(
    @('home-dark', 'home-light', 'timeline', 'viewer-raffle', 'live-poll', 'donation-vote', 'roulette', 'settings') |
      ForEach-Object { 'docs/store-assets/screenshots/' + $_ + '.png' })) {
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot $relativePath))) { throw 'A required Store submission asset is missing.' }
  }
  $tokenBody = @{ grant_type = 'client_credentials'; client_id = $env:MSSTORE_CLIENT_ID; client_secret = $env:MSSTORE_CLIENT_SECRET; resource = 'https://manage.devcenter.microsoft.com' }
  try {
    $tokenResult = Invoke-RestMethod -Method Post -Uri ("https://login.microsoftonline.com/" + $env:MSSTORE_TENANT_ID + "/oauth2/token") -Body $tokenBody -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
  } catch { throw 'Store authentication failed. The response was withheld.' }
  $storeHeaders = @{ Authorization = 'Bearer ' + $tokenResult.access_token }
  $appUrl = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/' + $env:MSSTORE_PRODUCT_ID
  $app = Invoke-StoreRequest -Method Get -Url $appUrl -Payload $null -Stage 'App lookup'
  if ($app.id -ne $metadata.productId -or $app.packageIdentityName -ne $metadata.identityName -or $app.publisherName -ne $metadata.publisher) { throw 'Store app identity mismatch.' }
  if ([string]::IsNullOrWhiteSpace($metadata.displayName) -or $metadata.displayName -cne $app.primaryName) { throw 'MSIX display name must match the reserved Store app name. Rebuild with MSIX_DISPLAY_NAME.' }
  $restoredSettings = $null
  if ($UpdatePublished) {
    if ([string]::IsNullOrWhiteSpace($app.lastPublishedApplicationSubmission.id)) { throw 'Complete the first Store publication before submitting an update.' }
    $publishedUrl = $appUrl + '/submissions/' + [string]$app.lastPublishedApplicationSubmission.id
    $publishedSubmission = Invoke-StoreRequest -Method Get -Url $publishedUrl -Payload $null -Stage 'Get published baseline'
    $publishedStatus = Invoke-StoreRequest -Method Get -Url ($publishedUrl + '/status') -Payload $null -Stage 'Verify published baseline'
    if ($publishedStatus.status -ne 'Published') { throw 'The baseline is not confirmed Published. No update draft was changed.' }
    if (@($publishedSubmission.applicationPackages | Where-Object { $_.fileName -eq $packageName -and $_.version -eq $metadata.packageVersion -and $_.fileStatus -eq 'Uploaded' }).Count -gt 0) {
      $report.status = 'Published'; $report.alreadyPublished = $true; $report.packageVersion = $metadata.packageVersion
      Write-Output 'This validated package version is already published. No new submission was created.'
      return
    }
    if ([string]::IsNullOrWhiteSpace($app.pendingApplicationSubmission.id)) {
      $created = Invoke-StoreRequest -Method Post -Url ($appUrl + '/submissions') -Payload $null -Stage 'Create published app update draft'
      if ([string]$created.id -notmatch '^[0-9]+$') { throw 'Store did not return an update draft ID.' }
      $report.newDraftCreated = $true
      $app | Add-Member -NotePropertyName pendingApplicationSubmission -NotePropertyValue ([pscustomobject]@{ id = [string]$created.id }) -Force
      Save-SubmissionReport
    }
  }
  if ($CreateNewDraft -or $RestorePublicSettings) {
    $publicBackup = Read-SafeStoreDraftBackup -Path $backupPath
    if ($publicBackup.productId -ne $app.id -or $publicBackup.settings.priceTier -ne 'Free' -or $publicBackup.settings.visibility -ne 'Public') {
      throw 'The original public settings backup does not match this Store app.'
    }
    $restoredSettings = $publicBackup.settings
    $report.settingsBackedUp = $true
  }
  if ($CreateNewDraft) {
    if (![string]::IsNullOrWhiteSpace($app.pendingApplicationSubmission.id)) {
      throw 'Delete the existing Portal draft in Partner Center before creating a new API draft.'
    }
    if (![string]::IsNullOrWhiteSpace($app.lastPublishedApplicationSubmission.id)) {
      throw 'This creation path is limited to the first Store submission.'
    }
    $created = Invoke-StoreRequest -Method Post -Url ($appUrl + '/submissions') -Payload $null -Stage 'Create first API draft'
    if ([string]$created.id -notmatch '^[0-9]+$') { throw 'Store did not return a draft ID.' }
    $report.newDraftCreated = $true
    $report.status = [string]$created.status
    Save-SubmissionReport
    Write-Output 'First API draft created after Portal draft removal.'
  }
  $submissionId = if ($CreateNewDraft -or ($UpdatePublished -and $created)) { [string]$created.id } else { [string]$app.pendingApplicationSubmission.id }
  if ($submissionId -notmatch '^[0-9]+$') { throw 'A first pending submission must already exist in Partner Center.' }
  $submissionUrl = $appUrl + '/submissions/' + $submissionId
  $submission = Invoke-StoreRequest -Method Get -Url $submissionUrl -Payload $null -Stage 'Get existing submission'
  $status = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Get submission status'
  if ($UpdatePublished) {
    $updateState = Get-StoreUpdateState -App $app -Pending $submission -PendingStatus $status -Published $publishedSubmission -PublishedStatus $publishedStatus
    $report.updateState = $updateState
    Save-SubmissionReport
    if (!$updateState.livePublished -or $updateState.sameSubmissionReference) { throw 'The published baseline or distinct update draft could not be confirmed. No submission was changed.' }
    $publishedFingerprint = Get-StoreDraftContentFingerprint $publishedSubmission
    if ($status.status -in @('CommitStarted','PreProcessing','Certification','Release','Publishing','PendingPublication') -and
        @($submission.applicationPackages | Where-Object { $_.fileName -eq $packageName -and $_.version -eq $metadata.packageVersion -and $_.fileStatus -eq 'Uploaded' }).Count -gt 0) {
      $report.status = [string]$status.status; $report.alreadySubmitted = $true; $report.packageVersion = $metadata.packageVersion
      Write-Output 'This validated package is already submitted. Its in-progress review was preserved.'
      return
    }
  }
  if ($status.status -notin @('PendingCommit', 'CommitFailed', 'PreProcessingFailed')) {
    throw 'The existing submission is not an editable draft. It was not replaced or canceled.'
  }
  if ($restoredSettings) {
    # Restore only the original public settings. Server-only declarations and ratings stay on the new resource.
    foreach ($property in $restoredSettings.PSObject.Properties) {
      if ($property.Name -eq 'priceTier') { continue }
      $submission | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force
    }
    if (!$submission.pricing) { $submission | Add-Member -NotePropertyName pricing -NotePropertyValue ([pscustomobject]@{}) -Force }
    $submission.pricing | Add-Member -NotePropertyName priceId -NotePropertyValue 'Free' -Force
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
  $originalDraftFingerprint = Get-StoreDraftContentFingerprint -Submission $submission
  $ownershipReviewNotes = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/store-review-notes.txt') -Raw
  if ($ReplaceNameFailureDraft) { Assert-OwnedNameFailureDraft -App $app -Submission $submission -Status $status -ExpectedSubmissionId $submissionId -ListingData $preflightListing -PackageName $packageName -ReviewNotes $ownershipReviewNotes }
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
      copyrightAndTrademarkInfo = 'Independent project, not affiliated with NAVER/CHZZK or YouTube. Third-party marks belong to their owners.'
      licenseTerms = 'MIT License. https://github.com/yechankun/streamer-assist/blob/main/LICENSE'
    }
    foreach ($property in $values.GetEnumerator()) { $baseListing | Add-Member -NotePropertyName $property.Key -NotePropertyValue $property.Value -Force }
    # These obsolete API fields are ignored by Microsoft. Their actual values
    # must be saved on the Properties page in Partner Center.
    foreach ($obsolete in @('privacyPolicy','supportContact','websiteUrl')) { $baseListing.PSObject.Properties.Remove($obsolete) }
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
  $reviewNotes = (Get-Content -LiteralPath (Join-Path $projectRoot 'docs/store-review-notes.txt') -Raw).Trim()
  if ($reviewNotes.Length -gt 4000) { throw 'Prepared certification notes exceed the Store limit of 4000 characters.' }
  if (![string]::IsNullOrWhiteSpace($submission.notesForCertification)) {
    if ($UpdatePublished -and $submission.notesForCertification -match '^Streamer-Assist v\d+\.\d+\.\d+ ') {
      # Replace the previous app-authored walkthrough, retaining any appended publisher notes.
      $managedEnd = 'Support: https://github.com/yechankun/streamer-assist/issues'
      $managedEndIndex = $submission.notesForCertification.LastIndexOf($managedEnd, [StringComparison]::Ordinal)
      if ($managedEndIndex -ge 0) { $submission.notesForCertification = $submission.notesForCertification.Substring($managedEndIndex + $managedEnd.Length).Trim() }
    }
    if ($submission.notesForCertification.Contains($reviewNotes.Trim())) { $reviewNotes = $submission.notesForCertification }
    else { $reviewNotes = $submission.notesForCertification + [Environment]::NewLine + [Environment]::NewLine + $reviewNotes }
  }
  if ($reviewNotes.Length -gt 4000) { throw 'Adding review notes would exceed 4000 characters. Existing user notes were preserved; no update was sent.' }
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
  # New API drafts can omit/null these fields, but PUT requires every supported family.
  $existingFamilies = $mutableSubmission.allowTargetFutureDeviceFamilies
  $deviceFamilies = [ordered]@{}
  foreach ($entry in ([ordered]@{ Desktop = $true; Mobile = $false; Xbox = $false; Holographic = $false }).GetEnumerator()) {
    $existingValue = $existingFamilies.PSObject.Properties[$entry.Key].Value
    $deviceFamilies[$entry.Key] = if ($existingValue -is [bool]) { $existingValue } else { $entry.Value }
  }
  if ($existingFamilies.PSObject.Properties['Team'].Value -is [bool]) { $deviceFamilies.Team = $existingFamilies.Team }
  $mutableSubmission.allowTargetFutureDeviceFamilies = $deviceFamilies
  # Finish the local upload archive before the authorized draft replacement.
  $zipPath = $archiveDirectory + '.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($archiveDirectory, $zipPath, [IO.Compression.CompressionLevel]::NoCompression, $false)
  if ($RecreateEmptyDraft -or $ReplaceNameFailureDraft) {
    # A fresh read prevents deleting a newly submitted or edited Portal draft.
    $freshApp = Invoke-StoreRequest -Method Get -Url $appUrl -Payload $null -Stage 'Recheck app before draft replacement'
    $freshSubmission = Invoke-StoreRequest -Method Get -Url $submissionUrl -Payload $null -Stage 'Recheck draft before replacement'
    $freshStatus = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Recheck draft status'
    if ($freshApp.id -ne $app.id -or $freshApp.packageIdentityName -ne $metadata.identityName -or $freshApp.publisherName -ne $metadata.publisher -or
        (Get-StoreDraftContentFingerprint -Submission $freshSubmission) -ne $originalDraftFingerprint) {
      throw 'The Store app or draft settings changed during preparation. No submission was deleted.'
    }
    if ($ReplaceNameFailureDraft) {
      Assert-OwnedNameFailureDraft -App $freshApp -Submission $freshSubmission -Status $freshStatus -ExpectedSubmissionId $submissionId -ListingData $preflightListing -PackageName $packageName -ReviewNotes $ownershipReviewNotes
    } else {
      Assert-EmptyInitialStoreDraft -App $freshApp -Submission $freshSubmission -Status $freshStatus -ExpectedSubmissionId $submissionId
    }
    Invoke-StoreRequest -Method Delete -Url $submissionUrl -Payload $null -Stage 'Delete approved replaceable draft' | Out-Null
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
    Write-Output 'Approved draft replaced. Existing registration settings are included in the update.'
  }
  try {
    $updated = Invoke-StoreRequest -Method Put -Url $submissionUrl -Payload $mutableSubmission -Stage 'Prepare submission'
  } catch {
    if (!$UpdatePublished -or !(Test-StorePortalStateConflict -HttpStatus $report.httpStatus -Messages $report.errorMessages)) { throw }
    $report.status = 'PortalActionRequired'
    $report.nextAction = 'Finish this draft in Partner Center, or remove only the pending draft there and rerun update-submit without creating a new Portal draft.'
    Save-SubmissionReport
    if (!$RecoverUnchangedDraft -or $updateState.mode -ne 'ResumeOrRecoverUnchangedDraft') {
      throw 'Microsoft rejected API edits to this draft (409, internal state None). The report explains the next action; distinct draft content was preserved.'
    }
    # Re-read both resources and references immediately before replacing only an identical copy.
    $freshApp = Invoke-StoreRequest -Method Get -Url $appUrl -Payload $null -Stage 'Recheck app before update recovery'
    $freshDraft = Invoke-StoreRequest -Method Get -Url $submissionUrl -Payload $null -Stage 'Recheck draft before update recovery'
    $freshStatus = Invoke-StoreRequest -Method Get -Url ($submissionUrl + '/status') -Payload $null -Stage 'Recheck draft status before update recovery'
    $freshPublished = Invoke-StoreRequest -Method Get -Url $publishedUrl -Payload $null -Stage 'Recheck published baseline'
    $freshPublishedStatus = Invoke-StoreRequest -Method Get -Url ($publishedUrl + '/status') -Payload $null -Stage 'Recheck published status'
    Assert-UnchangedPublishedUpdateDraft -App $freshApp -Pending $freshDraft -PendingStatus $freshStatus -Published $freshPublished -PublishedStatus $freshPublishedStatus -ExpectedApp $app -ExpectedPendingFingerprint $originalDraftFingerprint -ExpectedPublishedFingerprint $publishedFingerprint
    Save-SafeStoreDraftBackup -App $freshApp -Submission $freshDraft -Path $backupPath
    $report.settingsBackedUp = $true
    $report.recoveryAttempted = $true
    Save-SubmissionReport
    try { Invoke-StoreRequest -Method Delete -Url $submissionUrl -Payload $null -Stage 'Replace unchanged blocked update draft' | Out-Null }
    catch {
      if ($report.httpStatus -in @(400,409)) {
        $report.status = 'PortalActionRequired'
        Save-SubmissionReport
        throw 'Microsoft also rejected API deletion. Remove only the pending update draft in Partner Center, then rerun update-submit. The published product was not deleted.'
      }
      throw
    }
    $report.oldDraftDeleted = $true
    $report.status = 'DraftDeleted'
    Save-SubmissionReport
    $created = Invoke-StoreRequest -Method Post -Url ($appUrl + '/submissions') -Payload $null -Stage 'Create clean API update draft'
    $newId = [string]$created.id
    if ($newId -notmatch '^[0-9]+$' -or $newId -eq $submissionId -or $newId -eq [string]$app.lastPublishedApplicationSubmission.id) { throw 'Store did not return a distinct update draft ID.' }
    $submissionId = $newId
    $submissionUrl = $appUrl + '/submissions/' + $submissionId
    $report.newDraftCreated = $true
    $report.status = [string]$created.status
    Save-SubmissionReport
    if ($created.status -ne 'PendingCommit' -or (Get-StoreDraftContentFingerprint $created) -ne $publishedFingerprint) { throw 'The recreated draft differs from the verified published baseline. Its content was not overwritten.' }
    $updated = Invoke-StoreRequest -Method Put -Url $submissionUrl -Payload $mutableSubmission -Stage 'Prepare recovered update submission'
    $report.Remove('httpStatus'); $report.errorCodes = @(); $report.errorMessages = @(); $report.Remove('nextAction')
  }
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
      $report.errorMessages = @(ConvertTo-SafeStoreMessages -Messages @($poll.statusDetails.errors | ForEach-Object { $_.details }) -AccessToken $tokenResult.access_token)
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
