$ErrorActionPreference = 'Stop'
$storeProjectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$metadataFile = Join-Path $storeProjectDirectory 'release/store-package.json'
$metadata = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
if (!$metadata.storeReady -or $metadata.developmentIdentity -or !$metadata.googleConfigured) { throw 'Store identity and production Google Desktop config must be ready before submission.' }
foreach ($credentialName in @('MSSTORE_TENANT_ID','MSSTORE_CLIENT_ID','MSSTORE_CLIENT_SECRET','MSSTORE_SELLER_ID')) {
  if (![Environment]::GetEnvironmentVariable($credentialName)) { throw "Missing required Actions secret: $credentialName" }
}
if (!$metadata.productId -or $metadata.productId -ne $env:MSSTORE_PRODUCT_ID) { throw 'Store product identity mismatch.' }
$packageFile = [IO.Path]::GetFullPath((Join-Path $storeProjectDirectory ('release/' + $metadata.file)))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $storeProjectDirectory 'release')) + [IO.Path]::DirectorySeparatorChar
if (!$packageFile.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $packageFile)) { throw 'Invalid Store package path.' }
$storeAuthArguments = @('reconfigure','--tenantId',$env:MSSTORE_TENANT_ID,'--sellerId',$env:MSSTORE_SELLER_ID,'--clientId',$env:MSSTORE_CLIENT_ID,'--clientSecret',$env:MSSTORE_CLIENT_SECRET)
& msstore @storeAuthArguments
if ($LASTEXITCODE -ne 0) { throw 'Store CLI authentication failed.' }
& msstore settings --enableTelemetry false
if ($LASTEXITCODE -ne 0) { throw 'Store CLI settings failed.' }
& msstore publish $storeProjectDirectory --inputFile $packageFile --appId $metadata.productId
if ($LASTEXITCODE -ne 0) { throw 'Store submission failed. Check Partner Center status before retrying.' }
Write-Output 'Store submission committed. Public availability follows Microsoft certification.'
