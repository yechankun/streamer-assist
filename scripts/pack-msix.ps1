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
# Map source files directly into the package. Keep native validation and default
# compression; no staging copy or hard-link directory is needed.
$mapping = Join-Path ([IO.Path]::GetDirectoryName($output)) 'msix-files.map'
$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('[Files]')
foreach ($sourceRoot in @($payload,(Join-Path $msixRoot 'build/appx'))) {
  $prefix = if ($sourceRoot -eq $payload) { 'app' } else { 'assets' }
  if ((Get-Item -LiteralPath $sourceRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source directories are not allowed.' }
  if (Get-ChildItem -LiteralPath $sourceRoot -Recurse -Directory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Linked source directories are not allowed.' }
  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Payload links are not allowed.' }
    $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
    $destination = $prefix + '\' + $relative
    $lines.Add('"' + $_.FullName + '" "' + $destination + '"')
  }
}
$manifest = [IO.Path]::GetFullPath($ManifestPath)
if (!$manifest.StartsWith($msixRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or ((Get-Item -LiteralPath $manifest).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Manifest must stay in the project.' }
$lines.Add('"' + $manifest + '" "AppxManifest.xml"')
[IO.File]::WriteAllLines($mapping,$lines,[Text.UTF8Encoding]::new($false))
& $makeAppx pack /o /f $mapping /p $output
if ($LASTEXITCODE -ne 0) { throw 'Native Windows SDK MSIX validation/packaging failed.' }
