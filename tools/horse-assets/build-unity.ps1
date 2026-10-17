param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$horseWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$horseProject = Join-Path $horseWorkspace 'artifacts\unity-horse'
$horseUnity = 'C:\Program Files\Unity\Hub\Editor\6000.5.9f1\Editor\Unity.exe'
$horseLogDirectory = Join-Path $horseWorkspace 'tmp\unity-horse'
New-Item -ItemType Directory -Force -Path $horseLogDirectory | Out-Null
$horseLog = Join-Path $horseLogDirectory 'build.log'
$horseMethod = if ($PrepareOnly) { 'HorseBuild.Prepare' } else { 'HorseBuild.WebGL' }
$horseArguments = @('-batchmode','-nographics','-quit','-projectPath',('"'+$horseProject+'"'),'-buildTarget','WebGL','-executeMethod',$horseMethod,'-logFile',('"'+$horseLog+'"'))
$horseProcess = Start-Process -FilePath $horseUnity -ArgumentList $horseArguments -PassThru -WindowStyle Hidden -Wait
if ($horseProcess.ExitCode -ne 0) { Get-Content -LiteralPath $horseLog -Tail 55; throw ('Unity horse build failed: '+$horseProcess.ExitCode) }
if (-not $PrepareOnly) {
    $horseBuild = Join-Path $horseProject 'Builds\WebGL'
    if (-not (Test-Path -LiteralPath (Join-Path $horseBuild 'ready.json'))) { throw 'Unity did not complete the horse WebGL build.' }
    $horsePublic = Join-Path $horseWorkspace 'artifacts\3d-game\public\unity-horse'
    New-Item -ItemType Directory -Force -Path $horsePublic | Out-Null
    Get-ChildItem -LiteralPath $horseBuild | Where-Object { $_.Name -in @('Build','StreamingAssets','TemplateData','index.html') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $horsePublic -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $horseBuild 'ready.json') -Destination $horsePublic -Force
    Write-Output ('Unity horse racing ready: '+$horsePublic)
}
