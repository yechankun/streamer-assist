param([string]$PackagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$verifyProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$PackagePath) {
  $metadataPath = Join-Path $verifyProject 'release/store-package.json'
  if (Test-Path -LiteralPath $metadataPath) {
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    $PackagePath = Join-Path $verifyProject ('release/' + [IO.Path]::GetFileName($metadata.file))
  }
  $packageFiles = @(Get-ChildItem -LiteralPath (Join-Path $verifyProject 'release') -Filter '*.msix' -File)
  if (!$PackagePath -and $packageFiles.Count -ne 1) { throw 'Specify the MSIX file to validate when there is not exactly one package.' }
  if (!$PackagePath) { $PackagePath = $packageFiles[0].FullName }
}
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedPackage)
try {
  $entries = @{}
  foreach ($entry in $archive.Entries) { $entries[[Uri]::UnescapeDataString($entry.FullName.Replace('\', '/'))] = $entry }
  foreach ($required in @('AppxManifest.xml','AppxBlockMap.xml','[Content_Types].xml','app/Streamer Assist.exe','app/resources/app.asar','app/resources/app-icon.png','app/resources/oauth-client.json','assets/StoreLogo.png','assets/Square44x44Logo.png','assets/Square150x150Logo.png','assets/Wide310x150Logo.png')) {
    if (!$entries.ContainsKey($required)) { throw "Missing package file: $required" }
  }
  if ($entries.Keys | Where-Object { $_ -match '(^|/)(\.env(?:\..*)?|accounts\.enc|records\.enc|sessions\.json|channels\.json)$' -or $_ -match '(^|/)(\.dev|tests)(/|$)' }) { throw 'Private/development data appeared in the package.' }
  $manifestReader = New-Object IO.StreamReader($entries['AppxManifest.xml'].Open())
  try { [xml]$manifestXml = $manifestReader.ReadToEnd() } finally { $manifestReader.Dispose() }
  $identityNode = $manifestXml.SelectSingleNode('/*[local-name()="Package"]/*[local-name()="Identity"]')
  $versionFields = $identityNode.Version.Split('.')
  if ($versionFields.Count -ne 4 -or [int]$versionFields[0] -lt 1 -or [int]$versionFields[3] -ne 0 -or $identityNode.ProcessorArchitecture -ne 'x64') { throw 'Invalid Store package version or architecture.' }
  $applicationNode = $manifestXml.SelectSingleNode('//*[local-name()="Application"]')
  if ($applicationNode.EntryPoint -ne 'Windows.FullTrustApplication' -or $applicationNode.Id -ne 'StreamerAssist') { throw 'Invalid desktop application declaration.' }
  $packageDisplayNode = $manifestXml.SelectSingleNode('/*[local-name()="Package"]/*[local-name()="Properties"]/*[local-name()="DisplayName"]')
  $visualNode = $manifestXml.SelectSingleNode('//*[local-name()="VisualElements"]')
  if ($metadata.displayName -and ($packageDisplayNode.InnerText -cne $metadata.displayName -or $visualNode.DisplayName -cne $metadata.displayName)) {
    throw 'MSIX display names do not match the reserved name in package metadata.'
  }
  $startupNode = $manifestXml.SelectSingleNode('//*[local-name()="StartupTask"]')
  if ($metadata.displayName -and $startupNode.DisplayName -cne $metadata.displayName) { throw 'Startup display name mismatch.' }
  if ($startupNode.TaskId -ne 'StreamerAssistStartup' -or $startupNode.Enabled -ne 'false') { throw 'Startup must be explicitly opt-in.' }
  $capabilities = @($manifestXml.SelectNodes('//*[local-name()="Capabilities"]/*') | ForEach-Object { $_.Name })
  if ($capabilities.Count -ne 2 -or 'internetClient' -notin $capabilities -or 'runFullTrust' -notin $capabilities) { throw 'Unexpected package capabilities.' }
  $configReader = New-Object IO.StreamReader($entries['app/resources/oauth-client.json'].Open())
  try { $clientConfiguration = $configReader.ReadToEnd() | ConvertFrom-Json } finally { $configReader.Dispose() }
  if (@($clientConfiguration.PSObject.Properties.Name | Where-Object { $_ -notin @('youtubeClientId','youtubeClientSecret') }).Count -ne 0) { throw 'Unexpected OAuth resource fields.' }
  [pscustomobject]@{ Package = [IO.Path]::GetFileName($resolvedPackage); Identity = $identityNode.Name; Version = $identityNode.Version; Entries = $archive.Entries.Count; Startup = 'opt-in'; Signature = $(if ($entries.ContainsKey('AppxSignature.p7x')) { 'present' } else { 'unsigned Store upload' }) } | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
# Read the packaged ASAR index too; no private profile or source-only tooling may be embedded.
$scriptFile = Join-Path $verifyProject 'scripts/verify-asar.cjs'
& node $scriptFile $resolvedPackage
if ($LASTEXITCODE -ne 0) { throw 'ASAR privacy/content check failed.' }
