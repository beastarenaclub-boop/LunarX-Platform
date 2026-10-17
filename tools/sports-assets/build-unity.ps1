param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$projectPath = Join-Path $workspacePath 'artifacts\unity-sports'
$unityPath = 'C:\Program Files\Unity\Hub\Editor\6000.5.9f1\Editor\Unity.exe'
$logDirectory = Join-Path $workspacePath 'tmp\unity-sports'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory 'build.log'
if (-not (Test-Path -LiteralPath $unityPath)) { throw 'Unity 6000.5.9f1 is not installed at the configured path.' }
$method = if ($PrepareOnly) { 'ArenaBuild.Prepare' } else { 'ArenaBuild.WebGL' }
$unityArgs = @('-batchmode','-nographics','-quit','-projectPath',('"' + $projectPath + '"'),'-buildTarget','WebGL','-executeMethod',$method,'-logFile',('"' + $logPath + '"'))
$process = Start-Process -FilePath $unityPath -ArgumentList $unityArgs -PassThru -WindowStyle Hidden -Wait
if ($process.ExitCode -ne 0) {
    Get-Content -LiteralPath $logPath -Tail 45
    throw ('Unity exited with code ' + $process.ExitCode + '. Build log: ' + $logPath)
}
if (-not $PrepareOnly) {
    $buildPath = Join-Path $projectPath 'Builds\WebGL'
    $marker = Join-Path $buildPath 'ready.json'
    if (-not (Test-Path -LiteralPath $marker)) { throw 'Unity returned without a completed WebGL build.' }
    $publishPath = Join-Path $workspacePath 'artifacts\3d-game\public\unity-sports'
    New-Item -ItemType Directory -Force -Path $publishPath | Out-Null
    Get-ChildItem -LiteralPath $buildPath | Where-Object Name -ne 'ready.json' | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $publishPath -Recurse -Force
    }
    Copy-Item -LiteralPath $marker -Destination (Join-Path $publishPath 'ready.json') -Force
    Write-Output ('WebGL build ready: ' + $publishPath)
}
