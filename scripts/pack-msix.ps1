param([Parameter(Mandatory=$true)][string]$PayloadDirectory,[Parameter(Mandatory=$true)][string]$ManifestPath,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
$msixRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowedOutput = [IO.Path]::GetFullPath((Join-Path $msixRoot 'release')) + [IO.Path]::DirectorySeparatorChar
$payload = [IO.Path]::GetFullPath($PayloadDirectory)
$output = [IO.Path]::GetFullPath($OutputFile)
if (!$payload.StartsWith($allowedOutput,[StringComparison]::OrdinalIgnoreCase) -or !$output.StartsWith($allowedOutput,[StringComparison]::OrdinalIgnoreCase)) { throw 'MSIX staging and output must stay in this project release folder.' }
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = Get-ChildItem -LiteralPath $kits -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$makeAppx) { throw 'Install the Windows SDK to create MSIX packages.' }
$staging = Join-Path ([IO.Path]::GetDirectoryName($output)) 'msix-staging'
if (Test-Path -LiteralPath $staging) { throw 'MSIX staging directory must be new.' }
[void][IO.Directory]::CreateDirectory($staging)
Copy-Item -LiteralPath $payload -Destination (Join-Path $staging 'app') -Recurse
Copy-Item -LiteralPath (Join-Path $msixRoot 'build/appx') -Destination (Join-Path $staging 'assets') -Recurse
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $staging 'AppxManifest.xml')
& $makeAppx pack /o /d $staging /p $output
if ($LASTEXITCODE -ne 0) { throw 'Native Windows SDK MSIX validation/packaging failed.' }
