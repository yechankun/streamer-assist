param([switch]$CreateApiDraft)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Store submission inspection runs only on a disposable GitHub-hosted runner.'
}
. (Join-Path $PSScriptRoot 'store-response-report.ps1')
$tokenResponse = $null
$storeHeaders = $null
try {
  $tokenBody = @{
    grant_type = 'client_credentials'
    client_id = $env:MSSTORE_CLIENT_ID
    client_secret = $env:MSSTORE_CLIENT_SECRET
    resource = 'https://manage.devcenter.microsoft.com'
  }
  try {
    $tokenResponse = Invoke-RestMethod -Method Post -Uri ("https://login.microsoftonline.com/" + $env:MSSTORE_TENANT_ID + "/oauth2/token") -ContentType 'application/x-www-form-urlencoded' -Body $tokenBody -TimeoutSec 30
  } catch { throw 'Store authentication failed. Token responses were withheld.' }
  $storeHeaders = @{ Authorization = 'Bearer ' + $tokenResponse.access_token }
  $appUrl = 'https://manage.devcenter.microsoft.com/v1.0/my/applications/' + $env:MSSTORE_PRODUCT_ID
  try { $app = Invoke-RestMethod -Method Get -Uri $appUrl -Headers $storeHeaders -TimeoutSec 30 }
  catch { throw 'Store app inspection failed. Private responses were withheld.' }
  if ($app.id -ne $env:MSSTORE_PRODUCT_ID -or $app.packageIdentityName -ne $env:MSIX_IDENTITY_NAME -or $app.publisherName -ne $env:MSIX_PUBLISHER) {
    throw 'The Store app identity does not match the configured package.'
  }
  if ($CreateApiDraft) {
    $creationReport = [ordered]@{ productId = $app.id; creationAttempted = $true; created = $false; noExistingDraftDeleted = $true }
    $creationReportDirectory = Join-Path $PSScriptRoot '../release'
    [void][IO.Directory]::CreateDirectory($creationReportDirectory)
    try {
      # Do not delete an existing submission. The API decides whether a new draft is allowed.
      $createdSubmission = Invoke-RestMethod -Method Post -Uri ($appUrl + '/submissions') -Headers $storeHeaders -ContentType 'application/json' -TimeoutSec 60
      $creationReport.created = ![string]::IsNullOrWhiteSpace($createdSubmission.id)
      $creationReport.status = [string]$createdSubmission.status
      $creationReport.hasUploadUrl = ![string]::IsNullOrWhiteSpace($createdSubmission.fileUploadUrl)
    } catch {
      $creationReport.httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
      $safeMessage = ''
      try {
        $errorData = [string]$_.ErrorDetails.Message | ConvertFrom-Json
        $safeMessage = [string]$errorData.message
        foreach ($secretName in @('MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET')) {
          $secretValue = [Environment]::GetEnvironmentVariable($secretName)
          if ($secretValue) { $safeMessage = $safeMessage.Replace($secretValue, '[redacted]') }
        }
        $safeMessage = [regex]::Replace($safeMessage, 'https?://\S+|\b[0-9]{10,}\b', '[reference]')
        if ($safeMessage.Length -gt 600) { $safeMessage = $safeMessage.Substring(0,600) }
      } catch {}
      $creationReport.message = $safeMessage
      throw 'The Store API did not allow a new draft. Existing submissions were not deleted.'
    } finally {
      $creationReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $creationReportDirectory 'store-submission-creation.json') -Encoding utf8
      $createdSubmission = $null
    }
    Write-Output 'New API draft created without deleting an existing submission.'
    return
  }
  $pendingId = [string]$app.pendingApplicationSubmission.id
  if ($pendingId -notmatch '^[0-9]+$') { throw 'There is no existing pending submission to inspect.' }
  $submissionUrl = $appUrl + '/submissions/' + $pendingId
  try {
    $submission = Invoke-RestMethod -Method Get -Uri $submissionUrl -Headers $storeHeaders -TimeoutSec 30
    $submissionStatus = Invoke-RestMethod -Method Get -Uri ($submissionUrl + '/status') -Headers $storeHeaders -TimeoutSec 30
  } catch {
    $statusNumber = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "Existing submission inspection failed (HTTP $statusNumber). Raw metadata was withheld."
  }
  $listings = @($submission.listings.PSObject.Properties | ForEach-Object {
    $listing = $_.Value.baseListing
    [ordered]@{
      language = $_.Name
      titlePresent = ![string]::IsNullOrWhiteSpace($listing.title)
      descriptionCharacters = ([string]$listing.description).Length
      privacyPolicyPresent = ![string]::IsNullOrWhiteSpace($listing.privacyPolicy)
      supportContactPresent = ![string]::IsNullOrWhiteSpace($listing.supportContact)
      screenshots = @($listing.images | Where-Object { $_.imageType -eq 'Screenshot' -and $_.fileStatus -ne 'PendingDelete' }).Count
      uploadedScreenshots = @($listing.images | Where-Object { $_.imageType -eq 'Screenshot' -and $_.fileStatus -eq 'Uploaded' }).Count
    }
  })
  $packages = @($submission.applicationPackages | ForEach-Object {
    [ordered]@{ fileName = $_.fileName; version = $_.version; fileStatus = $_.fileStatus; architecture = $_.architecture }
  })
  $report = [ordered]@{
    productId = $app.id
    reservedName = [string]$app.primaryName
    hasPublishedSubmission = ![string]::IsNullOrWhiteSpace($app.lastPublishedApplicationSubmission.id)
    status = $submissionStatus.status
    resourceStatus = $submission.status
    category = $submission.applicationCategory
    priceTier = $submission.pricing.priceId
    visibility = $submission.visibility
    publishMode = $submission.targetPublishMode
    hasUploadUrl = ![string]::IsNullOrWhiteSpace($submission.fileUploadUrl)
    hasCertificationNotes = ![string]::IsNullOrWhiteSpace($submission.notesForCertification)
    listings = $listings
    packages = $packages
    errorCodes = @($submissionStatus.statusDetails.errors | ForEach-Object { $_.code })
    errorMessages = @(ConvertTo-SafeStoreMessages -Messages @($submissionStatus.statusDetails.errors | ForEach-Object { $_.details }) -AccessToken $tokenResponse.access_token)
    warningCodes = @($submissionStatus.statusDetails.warnings | ForEach-Object { $_.code })
    resourceFields = @($submission.PSObject.Properties.Name)
    noSubmissionChanged = $true
  }
  $reportDirectory = Join-Path $PSScriptRoot '../release'
  [void][IO.Directory]::CreateDirectory($reportDirectory)
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $reportDirectory 'store-submission-report.json') -Encoding utf8
  Write-Output ("Existing submission status: " + $submissionStatus.status)
  Write-Output ("Packages: " + $packages.Count + "; listing languages: " + $listings.Count)
  if ($env:GITHUB_STEP_SUMMARY) {
    @('## Existing Store submission', '', 'Status: ' + $submissionStatus.status, '',
      'Inspection only. Existing metadata, prices, ratings and submission were preserved.') |
      Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding utf8
  }
} finally {
  $storeHeaders = $null
  $tokenResponse = $null
  $tokenBody = $null
  $submission = $null
  $app = $null
}
