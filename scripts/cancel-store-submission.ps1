param([Parameter(Mandatory)][string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Store cancellation runs only on a disposable GitHub-hosted runner.' }
if ($env:MSSTORE_PRODUCT_ID -ne '9PKRWHZ2CWBG') { throw 'Unexpected Store product.' }
. (Join-Path $PSScriptRoot 'store-cancel-state.ps1')
. (Join-Path $PSScriptRoot 'store-draft-backup.ps1')
$reportDirectory = Join-Path $PSScriptRoot '../release'
[void][IO.Directory]::CreateDirectory($reportDirectory)
$report = [ordered]@{ productId=$env:MSSTORE_PRODUCT_ID; expectedVersion=$ExpectedVersion; cancellationRequested=$false; cancellationVerified=$false; publishedPreserved=$false }
$storeHeaders=$null; $tokenResponse=$null; $tokenBody=$null
try {
  $tokenBody=@{grant_type='client_credentials';client_id=$env:MSSTORE_CLIENT_ID;client_secret=$env:MSSTORE_CLIENT_SECRET;resource='https://manage.devcenter.microsoft.com'}
  try { $tokenResponse=Invoke-RestMethod -Method Post -Uri ('https://login.microsoftonline.com/'+$env:MSSTORE_TENANT_ID+'/oauth2/token') -ContentType 'application/x-www-form-urlencoded' -Body $tokenBody -TimeoutSec 30 }
  catch { throw 'Store authentication failed. Private responses were withheld.' }
  $storeHeaders=@{Authorization='Bearer '+$tokenResponse.access_token}
  function Invoke-CancelStoreRequest([string]$Method,[string]$Uri) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $storeHeaders -TimeoutSec 45 }
    catch { $code=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0};throw "Store cancellation request failed (HTTP $code). Private responses were withheld." }
  }
  $appUrl='https://manage.devcenter.microsoft.com/v1.0/my/applications/'+$env:MSSTORE_PRODUCT_ID
  function Get-CancellationSnapshot {
    $app=Invoke-CancelStoreRequest Get $appUrl
    $liveId=[string]$app.lastPublishedApplicationSubmission.id; $pendingId=[string]$app.pendingApplicationSubmission.id
    if($liveId -notmatch '^[0-9]+$'){throw 'A published baseline is required.'}
    $liveUrl=$appUrl+'/submissions/'+$liveId
    $published=Invoke-CancelStoreRequest Get $liveUrl; $liveStatus=Invoke-CancelStoreRequest Get ($liveUrl+'/status')
    $pending=$null;$pendingStatus=$null
    if($pendingId -match '^[0-9]+$'){
      $pendingUrl=$appUrl+'/submissions/'+$pendingId
      $pending=Invoke-CancelStoreRequest Get $pendingUrl;$pendingStatus=Invoke-CancelStoreRequest Get ($pendingUrl+'/status')
    }
    $target=Get-StoreCancellationTarget $app $pending $pendingStatus $published $liveStatus $ExpectedVersion
    return [pscustomobject]@{app=$app;pending=$pending;pendingStatus=$pendingStatus;published=$published;target=$target}
  }
  $snapshot=Get-CancellationSnapshot
  $report.beforeStatus=if($snapshot.pendingStatus){[string]$snapshot.pendingStatus.status}else{'NoPendingSubmission'}
  $report.publishedVersions=@($snapshot.published.applicationPackages | Where-Object fileStatus -eq Uploaded | ForEach-Object version)
  if($snapshot.target.mode -ne 'CancelReview'){
    $report.result=$snapshot.target.mode;$report.cancellationVerified=$true;$report.publishedPreserved=$true
    Write-Output ('No active target review: '+$report.result);return
  }
  $targetId=$snapshot.target.id;$publishedId=$snapshot.target.publishedId
  Save-SafeStoreDraftBackup -App $snapshot.app -Submission $snapshot.pending -Path (Join-Path $reportDirectory 'store-cancel-public-settings-backup.json')
  $report.submissionFingerprint=Get-StoreDraftFingerprint $targetId
  # Recheck both references and the target package immediately before cancelling.
  $fresh=Get-CancellationSnapshot
  if($fresh.target.mode -ne 'CancelReview' -or $fresh.target.id -ne $targetId -or $fresh.target.publishedId -ne $publishedId){throw 'Submission references changed; nothing was cancelled.'}
  [void](Invoke-CancelStoreRequest Delete ($appUrl+'/submissions/'+$targetId))
  $report.cancellationRequested=$true
  for($attempt=0;$attempt -lt 8;$attempt++){
    try { $after=Get-CancellationSnapshot }
    catch { if($attempt -eq 7){throw}; Start-Sleep -Seconds 5; continue }
    if($after.target.publishedId -ne $publishedId){throw 'The published reference changed during cancellation.'}
    if($after.target.mode -eq 'NoPendingSubmission' -or ($after.target.mode -eq 'NoActiveReview' -and $after.target.id -eq $targetId)){
      $report.result=$after.target.mode;$report.cancellationVerified=$true;$report.publishedPreserved=$true
      Write-Output ('Review cancellation verified; existing publication preserved. State: '+$report.result)
      return
    }
    if($after.target.id -ne $targetId){throw 'An unexpected new pending submission appeared.'}
    Start-Sleep -Seconds 5
  }
  throw 'Cancellation was requested but could not yet be verified.'
} finally {
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDirectory 'store-cancel-report.json') -Encoding utf8
  $storeHeaders=$null;$tokenResponse=$null;$tokenBody=$null
}
