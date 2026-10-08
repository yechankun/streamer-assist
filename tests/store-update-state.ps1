$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/store-update-state.ps1')
function Copy-Fixture($Value) { return $Value | ConvertTo-Json -Depth 50 | ConvertFrom-Json }
function Assert-Rejected([scriptblock]$Action, [string]$Label) {
  $rejected = $false
  try { & $Action } catch { $rejected = $true }
  if (!$rejected) { throw "Expected recovery guard: $Label" }
}
$app = [pscustomobject]@{ id='9PKRWHZ2CWBG'; packageIdentityName='Test.Identity'; publisherName='CN=Test'; primaryName='Test App'; pendingApplicationSubmission=[pscustomobject]@{id='123'}; lastPublishedApplicationSubmission=[pscustomobject]@{id='99'} }
$published = [pscustomobject]@{ id='99'; status='Published'; pricing=[pscustomobject]@{priceId='Free'}; visibility='Public'; applicationCategory='UtilitiesAndTools'; listings=[pscustomobject]@{'en-us'=[pscustomobject]@{baseListing=[pscustomobject]@{description='Published content'}}}; applicationPackages=@([pscustomobject]@{fileName='old.msix';version='1.3.0.0';fileStatus='Uploaded'}); notesForCertification='Publisher notes'; trailers=@(); friendlyName='Published' }
$pending = Copy-Fixture $published; $pending.id='123'; $pending.status='PendingCommit'; $pending.friendlyName='Pending'
$pending | Add-Member -NotePropertyName fileUploadUrl -NotePropertyValue 'https://example.blob.core.windows.net/?sig=private'
$status = [pscustomobject]@{status='PendingCommit'}; $liveStatus = [pscustomobject]@{status='Published'}
$pendingFingerprint = Get-StoreDraftContentFingerprint $pending
$publishedFingerprint = Get-StoreDraftContentFingerprint $published
function Assert-Recovery($CandidateApp, $CandidateDraft, $CandidateStatus, $CandidatePublished, $CandidateLiveStatus) {
  Assert-UnchangedPublishedUpdateDraft -App $CandidateApp -Pending $CandidateDraft -PendingStatus $CandidateStatus -Published $CandidatePublished -PublishedStatus $CandidateLiveStatus -ExpectedApp $app -ExpectedPendingFingerprint $pendingFingerprint -ExpectedPublishedFingerprint $publishedFingerprint
}
Assert-Recovery $app $pending $status $published $liveStatus
$state = Get-StoreUpdateState $app $pending $status $published $liveStatus
if ($state.mode -ne 'ResumeOrRecoverUnchangedDraft' -or !$state.livePublished -or !$state.matchesPublishedContent -or $state.differingFields.Count) { throw 'Identical published copy was not recognized.' }
foreach ($field in @('notesForCertification','listings','applicationPackages','pricing','trailers')) {
  $changed = Copy-Fixture $pending
  if ($field -eq 'notesForCertification') { $changed.$field='Publisher edits' }
  elseif ($field -eq 'listings') { $changed.listings.'en-us'.baseListing.description='Edited listing' }
  elseif ($field -eq 'applicationPackages') { $changed.applicationPackages[0].version='1.4.0.0' }
  elseif ($field -eq 'pricing') { $changed.pricing.priceId='Tier1' }
  else { $changed.trailers=@([pscustomobject]@{fileName='new.mp4'}) }
  Assert-Rejected { Assert-Recovery $app $changed $status $published $liveStatus } $field
  $state = Get-StoreUpdateState $app $changed $status $published $liveStatus
  if ($state.matchesPublishedContent -or $field -notin $state.differingFields) { throw "Changed draft field was not reported: $field" }
}
foreach ($phase in @('CommitStarted','PreProcessing','Certification','Published','CommitFailed','CertificationFailed')) {
  $otherStatus = [pscustomobject]@{status=$phase}
  Assert-Rejected { Assert-Recovery $app $pending $otherStatus $published $liveStatus } $phase
}
$changedApp=Copy-Fixture $app; $changedApp.lastPublishedApplicationSubmission.id='100'
Assert-Rejected { Assert-Recovery $changedApp $pending $status $published $liveStatus } 'published reference changed'
$changedApp=Copy-Fixture $app; $changedApp.pendingApplicationSubmission.id='124'
Assert-Rejected { Assert-Recovery $changedApp $pending $status $published $liveStatus } 'pending reference changed'
$changedApp=Copy-Fixture $app; $changedApp.pendingApplicationSubmission.id='99'
$same=Copy-Fixture $published; $same.status='PendingCommit'
Assert-Rejected { Assert-Recovery $changedApp $same $status $published $liveStatus } 'published resource must never be deleted'
$changedApp=Copy-Fixture $app; $changedApp.lastPublishedApplicationSubmission=$null
Assert-Rejected { Assert-Recovery $changedApp $pending $status $published $liveStatus } 'unpublished app'
$changedPublished=Copy-Fixture $published; $changedPublished.notesForCertification='Concurrent published edit'
Assert-Rejected { Assert-Recovery $app $pending $status $changedPublished $liveStatus } 'published content changed'
Assert-Rejected { Assert-Recovery $app $pending $status $published ([pscustomobject]@{status='Certification'}) } 'published status unconfirmed'
if (!(Test-StorePortalStateConflict 409 @("Cannot update the submission because it is in the state 'None'."))) { throw 'Specific Portal state conflict was not recognized.' }
foreach ($code in @(400,401,403,429,500)) { if (Test-StorePortalStateConflict $code @("Cannot update the submission because it is in the state 'None'.")) { throw 'Unrelated failure triggered recovery.' } }
if (Test-StorePortalStateConflict 409 @('Other conflict')) { throw 'Generic conflict triggered recovery.' }
Write-Output 'PASS: published update state, unique-content protection, race guards and specific Portal-conflict detection.'
