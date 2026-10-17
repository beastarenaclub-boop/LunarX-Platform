$ErrorActionPreference='Stop'
$workspacePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sportsPath=Join-Path $workspacePath 'artifacts\unity-sports\Assets\Resources\Sports'
$archivePath=Join-Path $workspacePath '.cache\football-pro\legacy-unity-resources'
if (-not $sportsPath.StartsWith($workspacePath+[IO.Path]::DirectorySeparatorChar) -or -not $archivePath.StartsWith($workspacePath+[IO.Path]::DirectorySeparatorChar)) { throw 'Resource paths must stay in this workspace.' }
$keepTextures=@('HumanAtlas.png','HumanAtlas_normal.png','daylight.hdr','grass-color.jpg','grass-normal.jpg','football-fans.png')
$keepMaterials=@('HumanSkin.mat','HumanDetail.mat','HumanUniform.mat')
foreach ($folder in @('Textures','Materials')) {
    $destination=Join-Path $archivePath $folder
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $keep=if($folder -eq 'Textures'){$keepTextures}else{$keepMaterials}
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $sportsPath $folder) -File) {
        $assetName=$file.Name -replace '\.meta$',''
        if ($keep -notcontains $assetName) { Move-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) -Force }
    }
}
Write-Output 'Previous generated human textures/materials archived outside Unity Resources; six current textures retained.'
