# License-independent compile check against the installed Unity engine APIs.
# URP-dependent ArenaBridge and the editor build remain validated by Unity itself.
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$editorData = 'C:\Program Files\Unity\Hub\Editor\6000.5.9f1\Editor\Data'
$outputPath = Join-Path $rootPath 'tmp\unity-sports\source-check'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$arguments = @('-nologo','-target:library','-langversion:9','-nostdlib+',('-out:' + (Join-Path $outputPath 'ArenaSourceCheck.dll')))
$references = @(Get-ChildItem -LiteralPath (Join-Path $editorData 'NetStandard\ref\2.1.0') -Filter '*.dll')
$references += @(Get-ChildItem -LiteralPath (Join-Path $editorData 'Managed\UnityEngine') -Filter 'UnityEngine.*Module.dll')
foreach ($reference in $references) { $arguments += ('-r:' + $reference.FullName) }
foreach ($name in @('ArenaState.cs','FootballPresentation.cs','FootballFootPlant.cs','ArenaAthlete.cs','ArenaGeometry.cs','ArenaCricketGeometry.cs','CricketPlayerDetails.cs')) {
    $arguments += Join-Path $rootPath ('artifacts\unity-sports\Assets\Scripts\' + $name)
}
$compiler = Join-Path $editorData 'DotNetSdk\sdk\8.0.318\Roslyn\bincore\csc.dll'
& (Join-Path $editorData 'DotNetSdk\dotnet.exe') $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Unity engine source check failed.' }
Write-Output 'Athlete animation, stadium geometry and football choreography compile against Unity 6000.5 APIs. Full URP build still requires an active Editor license.'
