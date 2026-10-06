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
