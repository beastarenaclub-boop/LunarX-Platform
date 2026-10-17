$ErrorActionPreference = 'Stop'
$horseWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$horseSource = Join-Path $horseWorkspace 'artifacts\unity-horse'
$horseBuild = Join-Path $horseSource 'Builds\WebGL'
if (-not (Test-Path -LiteralPath (Join-Path $horseBuild 'ready.json'))) { throw 'Complete the Unity WebGL build before packaging.' }
$horseExport = Join-Path $horseWorkspace 'exports\unity-horse-racing-realistic-v2-2026-10-15'
$horseProjectExport = Join-Path $horseExport 'UnityProject'
$horsePlayerExport = Join-Path $horseExport 'WebGL'
New-Item -ItemType Directory -Force -Path $horseProjectExport,$horsePlayerExport | Out-Null
foreach ($horsePart in @('Assets','Packages','ProjectSettings','SETUP.txt','.gitignore')) {
    Copy-Item -LiteralPath (Join-Path $horseSource $horsePart) -Destination $horseProjectExport -Recurse -Force
}
# An explicit runtime allowlist keeps debug output and caches out of the package.
foreach ($horsePart in @('Build','StreamingAssets','TemplateData','index.html','ready.json')) {
    $horsePartPath = Join-Path $horseBuild $horsePart
    if (Test-Path -LiteralPath $horsePartPath) { Copy-Item -LiteralPath $horsePartPath -Destination $horsePlayerExport -Recurse -Force }
}
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'distribution') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $horseExport -Force }
# Package only deliverables, even if this folder's preview server is running
# and has open log files. Logs and caches do not belong in the source archive.
$horsePackageParts = @($horseProjectExport,$horsePlayerExport,(Join-Path $horseExport 'START.cmd'),(Join-Path $horseExport 'server.mjs'),(Join-Path $horseExport 'READ-ME.txt'))
Compress-Archive -LiteralPath $horsePackageParts -DestinationPath ($horseExport + '.zip') -Force
Write-Output ('Unity project and playable WebGL package: ' + $horseExport + '.zip')
