function Assert-EmptyInitialStoreDraft {
  param($App, $Submission, $Status, [string]$ExpectedSubmissionId)
  if ($ExpectedSubmissionId -notmatch '^[0-9]+$' -or
      [string]$App.pendingApplicationSubmission.id -ne $ExpectedSubmissionId -or
      [string]$Submission.id -ne $ExpectedSubmissionId) {
    throw 'The pending draft changed. No submission was deleted.'
  }
  if (![string]::IsNullOrWhiteSpace($App.lastPublishedApplicationSubmission.id) -or
      $Status.status -ne 'PendingCommit' -or $Submission.status -ne 'PendingCommit') {
    throw 'Recreation is limited to an empty, uncommitted first submission.'
  }
  if (@($Submission.listings.PSObject.Properties).Count -gt 0 -or
      @($Submission.applicationPackages | Where-Object { $_ }).Count -gt 0 -or
      @($Submission.trailers | Where-Object { $_ }).Count -gt 0 -or
      ![string]::IsNullOrWhiteSpace($Submission.notesForCertification)) {
    throw 'The draft contains registration content. It was not deleted.'
  }
}
function Get-StoreDraftFingerprint {
  param([string]$SubmissionId)
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($SubmissionId)))
}
function Save-SafeStoreDraftBackup {
  param($App, $Submission, [string]$Path)
  # Whitelist public registration settings. Never serialize a raw Store response.
  if ($App.id -notmatch '^[A-Z0-9]{12}$' -or $Submission.applicationCategory -notmatch '^[A-Za-z]+(?:_[A-Za-z]+)?$' -or
      $Submission.pricing.priceId -ne 'Free' -or $Submission.visibility -ne 'Public' -or
      $Submission.targetPublishMode -notin @('Immediate', 'Manual', 'SpecificDate')) {
    throw 'Unexpected registration settings; no backup was exported.'
  }
  $settings = [ordered]@{
    applicationCategory = $Submission.applicationCategory
    priceTier = 'Free'
    visibility = 'Public'
    targetPublishMode = $Submission.targetPublishMode
  }
  foreach ($field in @('automaticBackupEnabled', 'canInstallOnRemovableMedia', 'isGameDvrEnabled',
      'hasExternalInAppProducts', 'meetAccessibilityGuidelines', 'allowMicrosoftDecideAppAvailabilityToFutureDeviceFamilies')) {
    if ($Submission.PSObject.Properties[$field]) {
      if ($Submission.$field -isnot [bool]) { throw 'Unexpected declaration value; no backup was exported.' }
      $settings[$field] = $Submission.$field
    }
  }
  [ordered]@{
    format = 'streamer-assist-public-draft-settings-v1'
    productId = $App.id
    pendingDraftFingerprint = Get-StoreDraftFingerprint -SubmissionId ([string]$Submission.id)
    settings = $settings
    excludes = @('credentials', 'upload URLs', 'account information', 'raw responses', 'age questionnaire')
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
}
function Read-SafeStoreDraftBackup {
  param([string]$Path)
  $backup = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($backup.format -ne 'streamer-assist-public-draft-settings-v1') { throw 'Unsupported Store settings backup.' }
  return $backup
}

function Assert-OwnedNameFailureDraft {
  param($App, $Submission, $Status, [string]$ExpectedSubmissionId, $ListingData, [string]$PackageName, [string]$ReviewNotes)
  if ($ExpectedSubmissionId -notmatch '^[0-9]+$' -or [string]$App.pendingApplicationSubmission.id -ne $ExpectedSubmissionId -or
      [string]$Submission.id -ne $ExpectedSubmissionId -or ![string]::IsNullOrWhiteSpace($App.lastPublishedApplicationSubmission.id) -or
      $Status.status -ne 'CommitFailed' -or $Submission.status -ne 'CommitFailed') {
    throw 'Only the failed first API draft can be replaced.'
  }
  $errors = @($Status.statusDetails.errors)
  if ($errors.Count -ne 1 -or $errors[0].code -ne 'InvalidParameterValue' -or
      $errors[0].details -notlike 'This package uses a display name that you have not reserved:*') {
    throw 'The failed draft has a different validation issue. It was not deleted.'
  }
  if (@($Submission.applicationPackages).Count -ne 1 -or $Submission.applicationPackages[0].fileName -ne $PackageName -or
      @($Submission.trailers | Where-Object { $_ }).Count -gt 0 -or ([string]$Submission.notesForCertification).Trim() -cne $ReviewNotes.Trim()) {
    throw 'The failed draft contains unrecognized packages or review material. It was not deleted.'
  }
  if (@($Submission.listings.PSObject.Properties).Count -ne @($ListingData.PSObject.Properties).Count) {
    throw 'The failed draft contains unrecognized listing languages. It was not deleted.'
  }
  $expectedImages = @(@('home-dark','home-light','timeline','viewer-raffle','live-poll','donation-vote','roulette','settings') |
    ForEach-Object { 'Images/' + $_ + '.png' }) + @('Images/icon-300.png')
  foreach ($locale in $ListingData.PSObject.Properties) {
    $listing = $Submission.listings.PSObject.Properties[$locale.Name].Value
    if (!$listing -or $listing.baseListing.title -cne $App.primaryName -or
        ([string]$listing.baseListing.description).Trim() -cne ([string]$locale.Value.description).Trim() -or
        @($listing.platformOverrides.PSObject.Properties | Where-Object { $_ }).Count -gt 0 -or
        @($listing.baseListing.images).Count -ne $expectedImages.Count -or
        @($expectedImages | Where-Object { $_ -notin @($listing.baseListing.images.fileName) }).Count -gt 0) {
      throw 'The failed draft contains unrecognized listing content. It was not deleted.'
    }
  }
}


function ConvertTo-CanonicalStoreValue {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $ordered = [ordered]@{}
    foreach ($key in ($Value.Keys | Sort-Object)) { $ordered[$key] = ConvertTo-CanonicalStoreValue -Value $Value[$key] }
    return ,$ordered
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    $items = [object[]]@($Value | ForEach-Object { ConvertTo-CanonicalStoreValue -Value $_ })
    return ,$items
  }
  return $Value
}
function Get-StoreDraftContentFingerprint {
  param($Submission)
  $snapshot = $Submission | ConvertTo-Json -Depth 100 -Compress | ConvertFrom-Json -AsHashtable
  foreach ($field in @('id','status','statusDetails','fileUploadUrl','friendlyName')) { [void]$snapshot.Remove($field) }
  if ($snapshot.pricing) { [void]$snapshot.pricing.Remove('isAdvancedPricingModel') }
  $json = ConvertTo-Json -InputObject (ConvertTo-CanonicalStoreValue -Value $snapshot) -Depth 100 -Compress
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json)))
}
