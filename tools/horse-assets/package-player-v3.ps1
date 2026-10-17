$ErrorActionPreference='Stop'
$horseRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$horseBuild=Join-Path $horseRoot 'artifacts/unity-horse/Builds/WebGL'
$horseExport=Join-Path $horseRoot 'exports/unity-horse-player-v3'
$horseReady=Get-Content -LiteralPath (Join-Path $horseBuild 'ready.json') -Raw | ConvertFrom-Json
if($horseReady.visualRevision -ne 3){throw 'Build visual revision 3 first.'}
$horseWeb=Join-Path $horseExport 'WebGL'
New-Item -ItemType Directory -Force -Path $horseWeb | Out-Null
foreach($horsePart in @('Build','StreamingAssets','TemplateData','index.html','ready.json')){
  $horsePath=Join-Path $horseBuild $horsePart
  if(Test-Path -LiteralPath $horsePath){Copy-Item -LiteralPath $horsePath -Destination $horseWeb -Recurse -Force}
}
foreach($horsePart in @('START.cmd','server.mjs')){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('distribution/'+$horsePart)) -Destination $horseExport -Force
}
$horseServer=Join-Path $horseExport 'server.mjs'
[IO.File]::WriteAllText($horseServer,([IO.File]::ReadAllText($horseServer).Replace('5291','5292')))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'distribution/PLAYER-V3.txt') -Destination (Join-Path $horseExport 'READ-ME.txt') -Force
Copy-Item -LiteralPath (Join-Path $horseRoot 'artifacts/unity-horse/ASSET-LICENSES.md') -Destination $horseExport -Force
Compress-Archive -LiteralPath $horseWeb,(Join-Path $horseExport 'START.cmd'),(Join-Path $horseExport 'server.mjs'),(Join-Path $horseExport 'READ-ME.txt'),(Join-Path $horseExport 'ASSET-LICENSES.md') -DestinationPath ($horseExport+'.zip') -Force
Write-Output ($horseExport+'.zip')
