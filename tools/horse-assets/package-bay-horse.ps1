$ErrorActionPreference='Stop'
$horseRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$horseSource=Join-Path $horseRoot 'artifacts/unity-horse/Assets/Resources/Horse'
$horseDestination=Join-Path $horseRoot 'exports/royal-park-bay-horse-v4'
New-Item -ItemType Directory -Force -Path (Join-Path $horseDestination 'Textures') | Out-Null
foreach($horseFile in @('Thoroughbred.fbx','BAY-HORSE-LICENSE.txt','HORSE-ANIMATIONS-LICENSE.md','BAY-HORSE-PROVENANCE.json')){
  Copy-Item -LiteralPath (Join-Path $horseSource $horseFile) -Destination $horseDestination -Force
}
foreach($horseFile in @('BayHorse-albedo.png','BayHorse-normal.png','BayHorse-roughness.png')){
  Copy-Item -LiteralPath (Join-Path $horseSource ('Textures/'+$horseFile)) -Destination (Join-Path $horseDestination 'Textures') -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'distribution/BAY-HORSE.txt') -Destination (Join-Path $horseDestination 'README.txt') -Force
Copy-Item -LiteralPath (Join-Path $horseRoot '.cache/horse-v4/textured-Idle-1.png') -Destination (Join-Path $horseDestination 'preview.png') -Force
Compress-Archive -Path (Join-Path $horseDestination '*') -DestinationPath ($horseDestination+'.zip') -Force
Write-Output ($horseDestination+'.zip')
