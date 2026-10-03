$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/electron/dist/electron.exe'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
npm run dev
exit $LASTEXITCODE
