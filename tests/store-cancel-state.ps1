$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/store-cancel-state.ps1')
function Copy-State($Value){return $Value|ConvertTo-Json -Depth 20|ConvertFrom-Json}
function Reject([scriptblock]$Action){$rejected=$false;try{&$Action}catch{$rejected=$true};if(!$rejected){throw 'Unsafe cancellation was allowed.'}}
$app=[pscustomobject]@{id='9PKRWHZ2CWBG';pendingApplicationSubmission=[pscustomobject]@{id='123'};lastPublishedApplicationSubmission=[pscustomobject]@{id='99'}}
$pending=[pscustomobject]@{id='123';applicationPackages=@([pscustomobject]@{version='1.4.4.0';fileStatus='Uploaded'})}
$published=[pscustomobject]@{id='99';applicationPackages=@([pscustomobject]@{version='1.4.3.0';fileStatus='Uploaded'})}
$status=[pscustomobject]@{status='Certification'};$live=[pscustomobject]@{status='Published'}
foreach($phase in @('CommitStarted','PreProcessing','Certification')){
  $result=Get-StoreCancellationTarget $app $pending ([pscustomobject]@{status=$phase}) $published $live '1.4.4.0'
  if($result.mode -ne 'CancelReview' -or $result.id -ne '123' -or $result.publishedId -ne '99'){throw 'Expected exact pending update.'}
}
foreach($phase in @('Release','Publishing','PendingPublication','Published','CertificationFailed')){Reject {Get-StoreCancellationTarget $app $pending ([pscustomobject]@{status=$phase}) $published $live '1.4.4.0'}}
Reject {Get-StoreCancellationTarget $app $pending $status $published $live '1.4.5.0'}
$bad=Copy-State $app;$bad.id='9OTHERPRODUCT';Reject {Get-StoreCancellationTarget $bad $pending $status $published $live '1.4.4.0'}
$bad=Copy-State $app;$bad.pendingApplicationSubmission.id='99';Reject {Get-StoreCancellationTarget $bad $published $status $published $live '1.4.4.0'}
$bad=Copy-State $app;$bad.pendingApplicationSubmission.id='124';Reject {Get-StoreCancellationTarget $bad $pending $status $published $live '1.4.4.0'}
$bad=Copy-State $published;$bad.applicationPackages[0].version='1.4.4.0';Reject {Get-StoreCancellationTarget $app $pending $status $bad $live '1.4.4.0'}
Reject {Get-StoreCancellationTarget $app $pending $status $published ([pscustomobject]@{status='Certification'}) '1.4.4.0'}
$bad=Copy-State $pending;$bad.applicationPackages[0].fileStatus='PendingUpload';Reject {Get-StoreCancellationTarget $app $bad $status $published $live '1.4.4.0'}
$idle=Copy-State $app;$idle.pendingApplicationSubmission=$null
if((Get-StoreCancellationTarget $idle $null $null $published $live '1.4.4.0').mode -ne 'NoPendingSubmission'){throw 'Already cancelled state was not recognized.'}
if((Get-StoreCancellationTarget $app $pending ([pscustomobject]@{status='PendingCommit'}) $published $live '1.4.4.0').mode -ne 'NoActiveReview'){throw 'Editable draft must be preserved.'}
Write-Output 'PASS: exact-version review cancellation, published-version protection, phase/race guards and idempotence.'
