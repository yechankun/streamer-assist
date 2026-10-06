param([switch]$RequirePublished)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
# This keeps the CLI's credential store on a disposable runner, not on the developer PC.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Store credential checks must run on a disposable GitHub-hosted runner.'
}
foreach ($credentialName in @('MSSTORE_TENANT_ID', 'MSSTORE_CLIENT_ID', 'MSSTORE_CLIENT_SECRET', 'MSSTORE_SELLER_ID')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($credentialName))) {
    throw "Missing Actions secret: $credentialName"
  }
}
foreach ($credentialName in @('MSSTORE_TENANT_ID', 'MSSTORE_CLIENT_ID')) {
  $parsedCredential = [Guid]::Empty
  if (![Guid]::TryParse([Environment]::GetEnvironmentVariable($credentialName), [ref]$parsedCredential) -or $parsedCredential -eq [Guid]::Empty) {
    throw "$credentialName must be the corresponding Microsoft Entra GUID."
  }
}
$parsedSeller = 0
if (![int]::TryParse($env:MSSTORE_SELLER_ID, [ref]$parsedSeller) -or $parsedSeller -le 0) {
  throw 'MSSTORE_SELLER_ID must be the numeric Seller ID from Partner Center, not a Publisher GUID, CN or Store product ID.'
}
if ($env:MSSTORE_PRODUCT_ID -notmatch '^9[A-Za-z0-9]{11}$' -or
    [string]::IsNullOrWhiteSpace($env:MSIX_IDENTITY_NAME) -or
    [string]::IsNullOrWhiteSpace($env:MSIX_PUBLISHER)) {
  throw 'The Store product ID, MSIX identity name and publisher variables are required.'
}
function Invoke-StoreCli {
  param([string[]]$CliArguments, [string]$Stage)
  # Capture all output; never print raw credentials, tokens or private Store metadata.
  $captured = @(& msstore @CliArguments 2>&1)
  $exitCode = $LASTEXITCODE
  $outputText = ($captured | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  if ($exitCode -ne 0) {
    if ($Stage -eq 'CLI setup') {
      throw "Store CLI setup failed (exit $exitCode). No authentication was attempted. Check the CLI runtime and settings command."
    }
    $aadCode = [regex]::Match($outputText, 'AADSTS[0-9]+').Value
    $httpCode = [regex]::Match($outputText, '(?i)(?:HTTP[^0-9]*|status(?: code)?[^0-9]*)(401|403|404)\b').Groups[1].Value
    $safeDetail = if ($aadCode) { " ($aadCode)" } elseif ($httpCode) { " (HTTP $httpCode)" } else { '' }
    throw "$Stage failed$safeDetail. Check the secret Value, tenant/client IDs, Partner Center association, Manager(Windows) role and product ID. Raw CLI output was withheld."
  }
  return $outputText
}
# Query the MSIX token endpoint first so credential errors remain actionable even
# when the CLI suppresses its underlying authentication exception.
$credentialProbeBody = @{
  grant_type = 'client_credentials'
  client_id = $env:MSSTORE_CLIENT_ID
  client_secret = $env:MSSTORE_CLIENT_SECRET
  resource = 'https://manage.devcenter.microsoft.com'
}
$credentialProbeResult = $null
try {
  $credentialProbeResult = Invoke-RestMethod -Method Post -Uri ("https://login.microsoftonline.com/" + $env:MSSTORE_TENANT_ID + "/oauth2/token") -ContentType 'application/x-www-form-urlencoded' -Body $credentialProbeBody -TimeoutSec 30
  if ([string]::IsNullOrWhiteSpace($credentialProbeResult.access_token)) { throw 'No access token returned.' }
  Write-Output 'PASS: Microsoft Entra accepted the credentials for the MSIX API.'
} catch {
  $probeCode = [regex]::Match([string]$_.ErrorDetails.Message, 'AADSTS[0-9]+').Value
  $probeHint = switch ($probeCode) {
    'AADSTS7000215' { 'MSSTORE_CLIENT_SECRET must contain the secret Value, not Secret ID, and must belong to the registered client.' }
    'AADSTS7000222' { 'The client secret expired. Create a new secret and update MSSTORE_CLIENT_SECRET.' }
    'AADSTS700016' { 'MSSTORE_CLIENT_ID is not registered in MSSTORE_TENANT_ID. Check the Application (client) ID and its tenant.' }
    'AADSTS90002' { 'MSSTORE_TENANT_ID does not identify an available tenant.' }
    default { 'Check the Entra app credentials and the directory associated with Partner Center.' }
  }
  if (!$probeCode) { $probeCode = 'no AADSTS code returned' }
  throw "Microsoft Entra credential check failed ($probeCode). $probeHint Raw responses and tokens were withheld."
} finally {
  $credentialProbeBody = $null
}
try {
  $directApp = Invoke-RestMethod -Method Get -Uri ("https://manage.devcenter.microsoft.com/v1.0/my/applications/" + $env:MSSTORE_PRODUCT_ID) -Headers @{ Authorization = "Bearer " + $credentialProbeResult.access_token } -TimeoutSec 30
  if ($directApp.id -ne $env:MSSTORE_PRODUCT_ID) { throw 'Unexpected app identity.' }
  Write-Output 'PASS: The registered Entra application can read the target Store app.'
} catch {
  $statusNumber = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  $lookupHint = switch ($statusNumber) {
    403 { 'Credentials are valid, but Store app access is forbidden. Check the Partner Center tenant association and Manager(Windows) role of the Entra APPLICATION.' }
    404 { 'The product was not found for this Store account. Check the product ID and whether the first app submission exists in Partner Center.' }
    401 { 'Store rejected the API token. Check the Entra application association with the Store developer account.' }
    default { 'Check Store app access and service availability.' }
  }
  throw "Read-only Store app lookup failed (HTTP $statusNumber). $lookupHint Raw metadata and tokens were withheld."
} finally {
  $credentialProbeResult = $null
  $directApp = $null
}
$storeAuthArguments = @('reconfigure', '--tenantId', $env:MSSTORE_TENANT_ID, '--sellerId', $env:MSSTORE_SELLER_ID,
  '--clientId', $env:MSSTORE_CLIENT_ID, '--clientSecret', $env:MSSTORE_CLIENT_SECRET)
$applicationText = $null
try {
  $null = Invoke-StoreCli -CliArguments $storeAuthArguments -Stage 'Store authentication'
  $null = Invoke-StoreCli -CliArguments @('settings', '--enableTelemetry', 'false') -Stage 'CLI setup'
  $applicationText = Invoke-StoreCli -CliArguments @('apps', 'get', $env:MSSTORE_PRODUCT_ID) -Stage 'Store app lookup'
  # Spectre may emit a status line before the JSON payload.
  $jsonStart = $applicationText.IndexOf('{')
  $jsonEnd = $applicationText.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -le $jsonStart) { throw 'Store app lookup did not return a JSON app resource.' }
  try {
    $application = $applicationText.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
  } catch { throw 'Store app lookup returned an unreadable JSON resource. Raw metadata was withheld.' }
  if ($application.id -ne $env:MSSTORE_PRODUCT_ID -or
      $application.packageIdentityName -ne $env:MSIX_IDENTITY_NAME -or
      $application.publisherName -ne $env:MSIX_PUBLISHER) {
    throw 'The authenticated Store app does not match the configured product, MSIX identity or publisher.'
  }
  $hasPublished = ![string]::IsNullOrWhiteSpace($application.lastPublishedApplicationSubmission.id)
  $hasPending = ![string]::IsNullOrWhiteSpace($application.pendingApplicationSubmission.id)
  $report = [ordered]@{
    productId = $env:MSSTORE_PRODUCT_ID
    authenticated = $true
    identityMatches = $true
    hasPublishedSubmission = $hasPublished
    hasPendingSubmission = $hasPending
    automaticUpdatesReady = $hasPublished
    noSubmissionPerformed = $true
  }
  $reportDirectory = Join-Path $PSScriptRoot '../release'
  [void][IO.Directory]::CreateDirectory($reportDirectory)
  $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDirectory 'store-access.json') -Encoding utf8
  $status = if ($hasPublished) { 'A published submission exists. Tagged Store updates can be enabled.' } else {
    'No published submission exists. Complete the first submission in Partner Center before enabling automatic updates.'
  }
  Write-Output 'PASS: Store authentication, app lookup and package identity match. No submission was created or changed.'
  Write-Output $status
  if ($env:GITHUB_STEP_SUMMARY) {
    @('## Microsoft Store access check', '', 'Authentication and target app identity verified.', '', $status, '',
      'This workflow only queried app data. Credentials, tokens and raw Store metadata are not in this report.') |
      Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding utf8
  }
  if ($RequirePublished -and !$hasPublished) { throw 'The first Store publication must be completed before automated update submission.' }
} finally {
  $applicationText = $null
  $storeAuthArguments = $null
  # This clears local CLI configuration only; it does not revoke or mutate the Entra application.
  $null = & msstore reconfigure --reset 2>&1
}
