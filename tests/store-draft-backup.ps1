$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/store-draft-backup.ps1')
function Assert-Throws {
  param([scriptblock]$Action, [string]$Label)
  $thrown = $false
  try { & $Action } catch { $thrown = $true }
  if (!$thrown) { throw ('Expected rejection: ' + $Label) }
}
$baseApp = '{"id":"9PKRWHZ2CWBG","pendingApplicationSubmission":{"id":"123"},"lastPublishedApplicationSubmission":null}'
$baseDraft = '{"id":"123","status":"PendingCommit","listings":{},"applicationPackages":[],"trailers":[],"notesForCertification":""}'
$status = [pscustomobject]@{ status = 'PendingCommit' }
$app = $baseApp | ConvertFrom-Json
$draft = $baseDraft | ConvertFrom-Json
Assert-EmptyInitialStoreDraft -App $app -Submission $draft -Status $status -ExpectedSubmissionId '123'
Assert-Throws { Assert-EmptyInitialStoreDraft -App $app -Submission $draft -Status $status -ExpectedSubmissionId '456' } 'changed draft'
$app.lastPublishedApplicationSubmission = [pscustomobject]@{ id = '789' }
Assert-Throws { Assert-EmptyInitialStoreDraft -App $app -Submission $draft -Status $status -ExpectedSubmissionId '123' } 'published app'
$app = $baseApp | ConvertFrom-Json
foreach ($case in @('listings', 'applicationPackages', 'trailers', 'notesForCertification', 'status')) {
  $draft = $baseDraft | ConvertFrom-Json
  switch ($case) {
    'listings' { $draft.listings = [pscustomobject]@{ 'en-us' = [pscustomobject]@{} } }
    'applicationPackages' { $draft.applicationPackages = @([pscustomobject]@{ fileName = 'real.msix' }) }
    'trailers' { $draft.trailers = @([pscustomobject]@{ title = 'real trailer' }) }
    'notesForCertification' { $draft.notesForCertification = 'Private review notes' }
    'status' { $draft.status = 'Certification' }
  }
  Assert-Throws { Assert-EmptyInitialStoreDraft -App $app -Submission $draft -Status $status -ExpectedSubmissionId '123' } $case
}
$draft = $baseDraft | ConvertFrom-Json
Assert-Throws { Assert-EmptyInitialStoreDraft -App $app -Submission $draft -Status ([pscustomobject]@{ status = 'CommitStarted' }) -ExpectedSubmissionId '123' } 'submitted draft'
$backupPath = Join-Path ([IO.Path]::GetTempPath()) ('store-backup-test-' + [Guid]::NewGuid().ToString('N') + '.json')
try {
  $draft | Add-Member -NotePropertyName applicationCategory -NotePropertyValue 'UtilitiesAndTools'
  $draft | Add-Member -NotePropertyName pricing -NotePropertyValue ([pscustomobject]@{ priceId = 'Free' })
  $draft | Add-Member -NotePropertyName visibility -NotePropertyValue 'Public'
  $draft | Add-Member -NotePropertyName targetPublishMode -NotePropertyValue 'Immediate'
  $draft | Add-Member -NotePropertyName fileUploadUrl -NotePropertyValue 'https://example.invalid/?sig=private-upload-signature'
  $draft | Add-Member -NotePropertyName privateAccount -NotePropertyValue 'private-snapshot-marker'
  $draft | Add-Member -NotePropertyName ageRatings -NotePropertyValue 'private-questionnaire'
  Save-SafeStoreDraftBackup -App $app -Submission $draft -Path $backupPath
  $raw = Get-Content -LiteralPath $backupPath -Raw
  foreach ($marker in @('private-snapshot-marker', 'private-upload-signature', 'private-questionnaire', 'https://example.invalid')) {
    if ($raw.Contains($marker)) { throw 'Settings backup leaked an excluded private value.' }
  }
  $restored = Read-SafeStoreDraftBackup -Path $backupPath
  if ($restored.settings.priceTier -ne 'Free' -or $restored.pendingDraftFingerprint -ne (Get-StoreDraftFingerprint -SubmissionId '123')) { throw 'Settings backup round-trip failed.' }
  $draft.visibility = 'Hidden'
  Assert-Throws { Save-SafeStoreDraftBackup -App $app -Submission $draft -Path $backupPath } 'unexpected settings'
} finally {
  if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath }
}
Write-Output 'Store draft guards and public settings backup checks passed.'
