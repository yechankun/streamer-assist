. (Join-Path $PSScriptRoot 'store-draft-backup.ps1')

function Get-StoreUpdateState {
  param($App, $Pending, $PendingStatus, $Published, $PublishedStatus)
  $publishedId = [string]$App.lastPublishedApplicationSubmission.id
  $pendingId = [string]$App.pendingApplicationSubmission.id
  $live = $publishedId -match '^[0-9]+$' -and [string]$Published.id -eq $publishedId -and $PublishedStatus.status -eq 'Published'
  $sameReference = $pendingId -match '^[0-9]+$' -and $pendingId -eq $publishedId
  $differentFields = @()
  if ($Pending -and $Published) {
    $ignored = @('id','status','statusDetails','fileUploadUrl','friendlyName')
    $names = @(@($Pending.PSObject.Properties.Name) + @($Published.PSObject.Properties.Name) | Sort-Object -Unique)
    foreach ($name in ($names | Where-Object { $_ -notin $ignored })) {
      $first = [pscustomobject]@{ $name = $Pending.PSObject.Properties[$name].Value }
      $second = [pscustomobject]@{ $name = $Published.PSObject.Properties[$name].Value }
      if ((Get-StoreDraftContentFingerprint $first) -ne (Get-StoreDraftContentFingerprint $second)) { $differentFields += $name }
    }
  }
  $sameContent = $null -ne $Pending -and $null -ne $Published -and (Get-StoreDraftContentFingerprint $Pending) -eq (Get-StoreDraftContentFingerprint $Published)
  $mode = if (!$live) { 'FirstPublicationRequired' }
    elseif ($sameReference) { 'PublishedReferenceConflict' }
    elseif ($pendingId -notmatch '^[0-9]+$') { 'CreateUpdate' }
    elseif ([string]$Pending.id -ne $pendingId) { 'DraftChanged' }
    elseif ($PendingStatus.status -notin @('PendingCommit','CommitFailed','PreProcessingFailed')) { 'WaitForSubmission' }
    elseif ($sameContent -and $PendingStatus.status -eq 'PendingCommit' -and $Pending.status -eq 'PendingCommit') { 'ResumeOrRecoverUnchangedDraft' }
    else { 'ResumeDraftWithoutDeletion' }
  return [pscustomobject]@{
    mode = $mode; livePublished = [bool]$live; pendingStatus = [string]$PendingStatus.status
    sameSubmissionReference = $sameReference; matchesPublishedContent = [bool]$sameContent
    differingFields = @($differentFields); hasUploadUrl = ![string]::IsNullOrWhiteSpace($Pending.fileUploadUrl)
  }
}

function Assert-UnchangedPublishedUpdateDraft {
  param($App, $Pending, $PendingStatus, $Published, $PublishedStatus, $ExpectedApp,
    [string]$ExpectedPendingFingerprint, [string]$ExpectedPublishedFingerprint)
  if ($App.id -cne $ExpectedApp.id -or $App.packageIdentityName -cne $ExpectedApp.packageIdentityName -or
      $App.publisherName -cne $ExpectedApp.publisherName -or $App.primaryName -cne $ExpectedApp.primaryName -or
      [string]$App.pendingApplicationSubmission.id -ne [string]$ExpectedApp.pendingApplicationSubmission.id -or
      [string]$App.lastPublishedApplicationSubmission.id -ne [string]$ExpectedApp.lastPublishedApplicationSubmission.id) {
    throw 'The Store app or submission references changed. No draft was deleted.'
  }
  $state = Get-StoreUpdateState -App $App -Pending $Pending -PendingStatus $PendingStatus -Published $Published -PublishedStatus $PublishedStatus
  if ($state.mode -ne 'ResumeOrRecoverUnchangedDraft' -or
      (Get-StoreDraftContentFingerprint $Pending) -ne $ExpectedPendingFingerprint -or
      (Get-StoreDraftContentFingerprint $Published) -ne $ExpectedPublishedFingerprint) {
    throw 'Recovery requires an unchanged PendingCommit copy of the confirmed published submission. No draft was deleted.'
  }
}

function Test-StorePortalStateConflict {
  param([int]$HttpStatus, [object[]]$Messages)
  return $HttpStatus -eq 409 -and ($Messages -join ' ') -match "Cannot update the submission because it is in the state 'None'"
}
