function Get-StoreCancellationTarget {
  param($App, $Pending, $PendingStatus, $Published, $PublishedStatus, [string]$ExpectedVersion)
  if ($App.id -ne '9PKRWHZ2CWBG' -or $ExpectedVersion -notmatch '^\d+\.\d+\.\d+\.0$') { throw 'Unexpected cancellation product or version.' }
  $liveId = [string]$App.lastPublishedApplicationSubmission.id
  if ($liveId -notmatch '^[0-9]+$' -or [string]$Published.id -ne $liveId -or $PublishedStatus.status -ne 'Published') { throw 'The existing published baseline is not confirmed.' }
  if (@($Published.applicationPackages | Where-Object { $_.version -eq $ExpectedVersion -and $_.fileStatus -eq 'Uploaded' }).Count) { throw 'The target version is already published; certification cancellation cannot roll it back.' }
  $pendingId = [string]$App.pendingApplicationSubmission.id
  if ([string]::IsNullOrWhiteSpace($pendingId)) { return [pscustomobject]@{ mode='NoPendingSubmission'; id=$null; publishedId=$liveId } }
  if ($pendingId -notmatch '^[0-9]+$' -or $pendingId -eq $liveId -or [string]$Pending.id -ne $pendingId) { throw 'The pending submission reference is unsafe or changed.' }
  if (!@($Pending.applicationPackages | Where-Object { $_.version -eq $ExpectedVersion -and $_.fileStatus -eq 'Uploaded' }).Count) { throw 'The pending submission does not contain the requested package version.' }
  if ($PendingStatus.status -eq 'PendingCommit') { return [pscustomobject]@{ mode='NoActiveReview'; id=$pendingId; publishedId=$liveId } }
  if ($PendingStatus.status -notin @('CommitStarted','PreProcessing','Certification')) { throw 'The submission is not in a cancellable review phase.' }
  return [pscustomobject]@{ mode='CancelReview'; id=$pendingId; publishedId=$liveId }
}
