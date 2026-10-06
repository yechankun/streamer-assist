$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetDirectory = Join-Path $assetProject 'build/appx'
[void][IO.Directory]::CreateDirectory($assetDirectory)
function New-AppLogo([int]$width, [int]$height, [string]$file) {
  $bitmap = New-Object Drawing.Bitmap(($width * 4), ($height * 4))
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#111214'))
  $unit = [Math]::Min($width, $height) * 4 / 32
  $left = ($width * 4 - 24 * $unit) / 2
  $top = ($height * 4 - 24 * $unit) / 2
  $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#00e6a2'), ([single]($unit * 1.7)))
  $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $points = [Drawing.PointF[]]@(
    (New-Object Drawing.PointF(($left + 3 * $unit), ($top + 12 * $unit))),
    (New-Object Drawing.PointF(($left + 7 * $unit), ($top + 12 * $unit))),
    (New-Object Drawing.PointF(($left + 10 * $unit), ($top + 4 * $unit))),
    (New-Object Drawing.PointF(($left + 14 * $unit), ($top + 20 * $unit))),
    (New-Object Drawing.PointF(($left + 17 * $unit), ($top + 12 * $unit))),
    (New-Object Drawing.PointF(($left + 21 * $unit), ($top + 12 * $unit)))
  )
  $graphics.DrawLines($pen, $points)
  $small = New-Object Drawing.Bitmap($width, $height)
  $target = [Drawing.Graphics]::FromImage($small)
  $target.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  try { $target.DrawImage($bitmap, 0, 0, $width, $height); $small.Save($file, [Drawing.Imaging.ImageFormat]::Png) }
  finally { $target.Dispose(); $small.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
New-AppLogo 50 50 (Join-Path $assetDirectory 'StoreLogo.png')
New-AppLogo 44 44 (Join-Path $assetDirectory 'Square44x44Logo.png')
New-AppLogo 150 150 (Join-Path $assetDirectory 'Square150x150Logo.png')
New-AppLogo 310 150 (Join-Path $assetDirectory 'Wide310x150Logo.png')
$png = Join-Path $assetDirectory 'AppIcon256.png'
New-AppLogo 256 256 $png
$pngBytes = [IO.File]::ReadAllBytes($png)
$iconFile = Join-Path $assetProject 'build/icon.ico'
$stream = [IO.File]::Create($iconFile)
$writer = New-Object IO.BinaryWriter($stream)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
  $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$pngBytes.Length); $writer.Write([uint32]22)
  $writer.Write($pngBytes)
} finally { $writer.Dispose(); $stream.Dispose() }
$listingAssetDirectory = Join-Path $assetProject 'docs/store-assets'
[void][IO.Directory]::CreateDirectory($listingAssetDirectory)
New-AppLogo 300 300 (Join-Path $listingAssetDirectory 'icon-300.png')
Write-Output 'Generated application and MSIX tile assets.'
