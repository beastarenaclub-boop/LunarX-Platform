param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$FFmpegDirectory,
  [Parameter(Mandatory=$true)][double]$IdleStart,
  [Parameter(Mandatory=$true)][double]$IdleEnd,
  [double]$ActionEnd = 0,
  [string]$Prefix = 'naina-center'
)
$ErrorActionPreference = 'Stop'
if ($Prefix -notmatch '^[a-z0-9-]+$') { throw 'Invalid asset prefix' }
$sourceFile = (Resolve-Path -LiteralPath $Source).Path
$encoder = Join-Path $FFmpegDirectory 'ffmpeg.exe'
$probe = Join-Path $FFmpegDirectory 'ffprobe.exe'
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src/assets/lucky7/cast'))
$metadata = (& $probe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of json $sourceFile) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect source' }
$width = [int]$metadata.streams[0].width
$height = [int]$metadata.streams[0].height
if ($width -lt 2048) { throw "Expected a native 2K source; got $width x $height" }
if ($IdleStart -lt 0 -or $IdleEnd -le $IdleStart -or $IdleEnd -gt [double]$metadata.format.duration) { throw 'Invalid forward idle interval' }
if ($ActionEnd -lt 0 -or $ActionEnd -gt [double]$metadata.format.duration) { throw 'Invalid action interval' }
$fpsParts = $metadata.streams[0].r_frame_rate.Split('/')
$fps = [Math]::Min(30, [double]$fpsParts[0] / [double]$fpsParts[1])
$fpsText = $fps.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
$idleFrom = $IdleStart.ToString([Globalization.CultureInfo]::InvariantCulture)
$idleUntil = $IdleEnd.ToString([Globalization.CultureInfo]::InvariantCulture)
$shared = @('-hide_banner','-loglevel','error','-y')
$h264 = @('-an','-c:v','libx264','-profile:v','high','-preset','fast','-tune','fastdecode','-crf','18','-pix_fmt','yuv420p','-g',([int][Math]::Round($fps)).ToString(),'-movflags','+faststart','-threads','2')
$masterFile = Join-Path $assetDirectory "$Prefix-master-2k.mp4"
if ($sourceFile -ne $masterFile) { Copy-Item -LiteralPath $sourceFile -Destination $masterFile }
foreach ($kind in @('action','idle')) {
  $trim = if ($kind -eq 'idle') { "trim=start=${idleFrom}:end=${idleUntil},setpts=PTS-STARTPTS," } else { '' }
  $native = Join-Path $assetDirectory "$Prefix-$kind-2k.mp4"
  if ($kind -eq 'action' -and $ActionEnd -eq 0) {
    # Preserve the generated 2K picture exactly; only remove its audio track.
    & $encoder @shared -i $sourceFile -map 0:v:0 -an -c:v copy -movflags +faststart $native
  } else {
    if ($kind -eq 'action') {
      $actionUntil = $ActionEnd.ToString([Globalization.CultureInfo]::InvariantCulture)
      $trim = "trim=end=${actionUntil},setpts=PTS-STARTPTS,"
    }
    & $encoder @shared -i $sourceFile -vf "${trim}fps=$fpsText,setsar=1" @h264 $native
  }
  if ($LASTEXITCODE -ne 0) { throw "Native encode failed: $kind" }
  $mobile = Join-Path $assetDirectory "$Prefix-$kind-1080p.mp4"
  & $encoder @shared -i $native -vf 'scale=1920:1080:flags=lanczos,setsar=1' @h264 $mobile
  if ($LASTEXITCODE -ne 0) { throw "Mobile encode failed: $kind" }
  & $encoder @shared -i $native -vf 'scale=1280:720:flags=lanczos,setsar=1' -an -c:v libvpx -b:v 0 -crf 18 -deadline realtime -cpu-used 4 -threads 2 (Join-Path $assetDirectory "$Prefix-$kind-720p.webm")
  if ($LASTEXITCODE -ne 0) { throw "Fallback encode failed: $kind" }
}
& $encoder @shared -i (Join-Path $assetDirectory "$Prefix-idle-2k.mp4") -frames:v 1 -q:v 2 (Join-Path $assetDirectory "$Prefix-poster.jpg")
if ($LASTEXITCODE -ne 0) { throw 'Poster extraction failed' }
@{ width=$width; height=$height; fps=$fps; actionEnd=$ActionEnd; idleStart=$IdleStart; idleEnd=$IdleEnd; playbackRate=1; interpolation=$false } | ConvertTo-Json
