param([Parameter(Mandatory)][string]$Archive,[Parameter(Mandatory)][string]$Target)
$ErrorActionPreference='Stop'
$targetRoot=[IO.Path]::GetFullPath($Target)
$unpacked=Join-Path $targetRoot 'unpacked'
[void][IO.Directory]::CreateDirectory($unpacked)
& tar.exe -xf ([IO.Path]::GetFullPath($Archive)) -C $unpacked 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe' 'ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe' 'ffmpeg-9.0.2-essentials_build/LICENSE'
if($LASTEXITCODE -ne 0) { throw 'Unable to extract the verified FFmpeg archive.' }
foreach($name in @('ffmpeg.exe','ffprobe.exe','LICENSE')) {
  $source=Join-Path $unpacked ('ffmpeg-9.0.2-essentials_build/'+$(if($name.EndsWith('.exe')) {'bin/'} else {''})+$name)
  Copy-Item -LiteralPath $source -Destination (Join-Path $targetRoot $name)
}
