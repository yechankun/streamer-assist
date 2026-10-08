$ErrorActionPreference = 'Stop'
$testBase = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.dev'))
$testRoot = Join-Path $testBase ('store-status-test-' + [Guid]::NewGuid().ToString('N'))
$oldEnvironment = @{}
foreach ($name in @('GITHUB_ACTIONS','RUNNER_ENVIRONMENT','MSSTORE_PRODUCT_ID','MSIX_IDENTITY_NAME','MSIX_PUBLISHER','MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET')) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
function Start-Sleep { param([int]$Seconds) }
function Invoke-RestMethod {
  param([string]$Method, [uri]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec)
  if ($Method -ne 'Get' -and $Uri.AbsoluteUri -notlike 'https://login.microsoftonline.com/*/oauth2/token') { throw 'Inspection attempted to modify Store data.' }
  if ($Uri.AbsoluteUri -like 'https://login.microsoftonline.com/*/oauth2/token') { return [pscustomobject]@{ access_token = 'fixture-token' } }
  if ($Uri.AbsoluteUri.EndsWith('/applications/9PKRWHZ2CWBG')) {
    $app = [pscustomobject]@{ id = '9PKRWHZ2CWBG'; packageIdentityName = 'Test.Identity'; publisherName = 'CN=Test'; primaryName = 'Test App' }
    if ($global:StoreStatusFixture.pending) { $app | Add-Member -NotePropertyName pendingApplicationSubmission -NotePropertyValue ([pscustomobject]@{ id = '123' }) }
    if ($global:StoreStatusFixture.published) { $app | Add-Member -NotePropertyName lastPublishedApplicationSubmission -NotePropertyValue ([pscustomobject]@{ id = '456' }) }
    return $app
  }
  if ($Uri.AbsoluteUri.EndsWith('/status')) {
    if ($global:StoreStatusFixture.pending -and $global:StoreStatusFixture.published -and $Uri.AbsoluteUri.EndsWith('/456/status')) { return [pscustomobject]@{ status = 'Published'; statusDetails = [pscustomobject]@{ errors = @(); warnings = @() } } }
    $index = [Math]::Min($global:StoreStatusFixture.reads, $global:StoreStatusFixture.statuses.Count - 1)
    $status = $global:StoreStatusFixture.statuses[$index]; $global:StoreStatusFixture.reads++
    $errors = if ($status -eq 'CommitFailed') { @([pscustomobject]@{ code = 'InvalidState'; details = 'Private fixture-secret fixture-token person@example.test https://example.test/?sig=hidden 12345678901234' }) } else { @() }
    return [pscustomobject]@{ status = $status; statusDetails = [pscustomobject]@{ errors = $errors; warnings = @() } }
  }
  return [pscustomobject]@{ id = ($Uri.AbsolutePath -split '/')[-1]; status = 'CommitStarted'; listings = [pscustomobject]@{}; applicationPackages = @(); pricing = [pscustomobject]@{ priceId = 'Free' }; applicationCategory = 'UtilitiesAndTools'; visibility = 'Public'; targetPublishMode = 'Immediate' }
}
try {
  [void][IO.Directory]::CreateDirectory((Join-Path $testRoot 'scripts'))
  foreach ($file in @('inspect-store-submission.ps1','store-response-report.ps1','store-update-state.ps1','store-draft-backup.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../scripts/' + $file)) -Destination (Join-Path $testRoot ('scripts/' + $file)) }
  $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'
  $env:MSSTORE_PRODUCT_ID = '9PKRWHZ2CWBG'; $env:MSIX_IDENTITY_NAME = 'Test.Identity'; $env:MSIX_PUBLISHER = 'CN=Test'
  $env:MSSTORE_TENANT_ID = 'fixture-tenant'; $env:MSSTORE_CLIENT_ID = 'fixture-client'; $env:MSSTORE_CLIENT_SECRET = 'fixture-secret'
  $inspector = Join-Path $testRoot 'scripts/inspect-store-submission.ps1'
  $global:StoreStatusFixture = @{ pending = $true; published = $false; statuses = @('CommitStarted','CommitFailed'); reads = 0 }
  $failed = $false
  try { & $inspector -FailOnError -CommitWaitSeconds 10 } catch { if ($_.Exception.Message -notlike 'Store publication failed:*') { throw }; $failed = $true }
  $report = Get-Content -LiteralPath (Join-Path $testRoot 'release/store-submission-report.json') -Raw | ConvertFrom-Json
  if (!$failed -or $report.status -ne 'CommitFailed' -or $report.published -or !$report.noSubmissionChanged) { throw 'Late commit failure was not detected.' }
  $messages = $report.errorMessages -join ' '
  foreach ($private in @('fixture-secret','fixture-token','person@example.test','https://example.test','12345678901234')) { if ($messages.Contains($private)) { throw 'Status report exposed private metadata.' } }
  $global:StoreStatusFixture = @{ pending = $true; published = $false; statuses = @('Certification'); reads = 0 }
  & $inspector -FailOnError
  $report = Get-Content -LiteralPath (Join-Path $testRoot 'release/store-submission-report.json') -Raw | ConvertFrom-Json
  if ($report.published -or $report.status -ne 'Certification') { throw 'Certification was mistaken for publication.' }
  $global:StoreStatusFixture = @{ pending = $false; published = $true; statuses = @('Published'); reads = 0 }
  & $inspector -FailOnError
  $report = Get-Content -LiteralPath (Join-Path $testRoot 'release/store-submission-report.json') -Raw | ConvertFrom-Json
  if (!$report.published -or $report.submissionSource -ne 'published') { throw 'A published app without a draft was not detected.' }
  if (!$report.livePublished -or $report.updateState.mode -ne 'CreateUpdate') { throw 'Published baseline did not permit a new API update.' }
  $global:StoreStatusFixture = @{ pending = $true; published = $true; statuses = @('Certification'); reads = 0 }
  & $inspector -FailOnError
  $report = Get-Content -LiteralPath (Join-Path $testRoot 'release/store-submission-report.json') -Raw | ConvertFrom-Json
  if ($report.published -or !$report.livePublished -or $report.updateState.mode -ne 'WaitForSubmission') { throw 'Existing live publication and pending certification were conflated.' }
} finally {
  Remove-Variable -Name StoreStatusFixture -Scope Global -ErrorAction SilentlyContinue
  foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name]) }
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (!$resolved.StartsWith($testBase + [IO.Path]::DirectorySeparatorChar + 'store-status-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output 'PASS: delayed Store failure, sanitization, certification and published-without-draft inspection.'
