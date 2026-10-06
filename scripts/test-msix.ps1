$ErrorActionPreference = 'Stop'
# Never install a package or trust a test certificate on the developer's PC.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'MSIX installation smoke is restricted to disposable GitHub-hosted runners.' }
$msixProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$metadata = Get-Content -LiteralPath (Join-Path $msixProject 'release/store-package.json') -Raw | ConvertFrom-Json
$packageSource = Join-Path $msixProject ('release/' + [IO.Path]::GetFileName($metadata.file))
if (Get-AppxPackage -Name $metadata.identityName -ErrorAction SilentlyContinue) { throw 'An existing package with this identity must never be replaced by the smoke test.' }
$testDirectory = Join-Path $msixProject ('release/msix-smoke-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testDirectory)
$signedCopy = Join-Path $testDirectory 'test-signed.msix'
Copy-Item -LiteralPath $packageSource -Destination $signedCopy
$kitRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$signingTool = Get-ChildItem -LiteralPath $kitRoot -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$signingTool) { throw 'Windows SDK SignTool is required for the ephemeral package test.' }
$testCertificate = $null
$installedPackage = $null
$trustedCertificatePath = $null
$processBefore = @(Get-Process | Select-Object -ExpandProperty Id)
try {
  $testCertificate = New-SelfSignedCertificate -Type Custom -Subject $metadata.publisher -FriendlyName 'Streamer Assist disposable CI signing' -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -CertStoreLocation 'Cert:/CurrentUser/My' -NotAfter (Get-Date).AddDays(1) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  $certificateFile = Join-Path $testDirectory 'ci.cer'
  Export-Certificate -Cert $testCertificate -FilePath $certificateFile | Out-Null
  Import-Certificate -FilePath $certificateFile -CertStoreLocation 'Cert:/CurrentUser/TrustedPeople' | Out-Null
  $trustedCertificatePath = 'Cert:/CurrentUser/TrustedPeople/' + $testCertificate.Thumbprint
  & $signingTool sign /fd SHA256 /s My /sha1 $testCertificate.Thumbprint $signedCopy
  if ($LASTEXITCODE -ne 0) { throw 'Temporary package signing failed.' }
  Add-AppxPackage -Path $signedCopy
  $installedPackage = Get-AppxPackage -Name $metadata.identityName
  if (!$installedPackage -or $installedPackage.Version.ToString() -ne $metadata.packageVersion) { throw 'Installed package identity mismatch.' }
  $applicationFile = Join-Path $installedPackage.InstallLocation 'app/Streamer Assist.exe'
  $portListener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $portListener.Start(); $debugPort = $portListener.LocalEndpoint.Port; $portListener.Stop()
  $debugArguments = '--remote-debugging-port=' + $debugPort + ' --remote-debugging-address=127.0.0.1'
  Invoke-CommandInDesktopPackage -PackageFamilyName $installedPackage.PackageFamilyName -AppId 'StreamerAssist' -Command $applicationFile -Args $debugArguments -PreventBreakaway
  $env:MSIX_SMOKE_PORT = $debugPort
  & node (Join-Path $msixProject 'tests/msix-runtime.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Installed MSIX runtime validation failed.' }
} finally {
  if ($installedPackage) {
    $applicationFile = Join-Path $installedPackage.InstallLocation 'app/Streamer Assist.exe'
    Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -notin $processBefore -and $_.ExecutablePath -eq $applicationFile } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Remove-AppxPackage -Package $installedPackage.PackageFullName
  }
  if ($testCertificate) {
    if ($trustedCertificatePath -and (Test-Path -LiteralPath $trustedCertificatePath)) { Remove-Item -LiteralPath $trustedCertificatePath }
    $createdCertificatePath = 'Cert:/CurrentUser/My/' + $testCertificate.Thumbprint
    if (Test-Path -LiteralPath $createdCertificatePath) { Remove-Item -LiteralPath $createdCertificatePath }
  }
}
