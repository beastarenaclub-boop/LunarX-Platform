# Lucky 7 — Naina bar dealer

For the current longer take, loop-jump correction and cleaned dice shadows, see [lucky7-natural-motion.md](lucky7-natural-motion.md). The original bar assets below are retained for provenance.

The active dealer wears an opaque fitted black satin evening dress with gold trim. The same continuous shot includes a warm cocktail bar, a bartender and four adult guests at side tables. The dealer keeps her full head and arms in frame, gathers and shakes the dice at the center, and uses restrained expressions. The rectangular foreground table remains fixed.

## Assets and generation

All source and runtime assets are in `artifacts/3d-game/src/assets/lucky7/cast/`:

- `naina-bar-reference.png`: reference edited using **built-in imagegen**.
- `naina-bar-generated-2k.mp4`: original Higgsfield MiniMax H3 video, job `be10f936-5ac4-4ea0-9701-79081b3d13e8`.
- `naina-bar-master-2k.mp4`: processed version with the empty table sides and front held stationary.
- `naina-bar-action-2k.mp4`: silent action using the processed master’s video bitstream.
- `naina-bar-idle-2k.mp4`: forward-only calm tail from 5.666667 to 7.291666 seconds.
- Matching `action/idle-1080p.mp4` phone copies, `action/idle-720p.webm` fallbacks, `naina-bar-poster.jpg` and `naina-bar-felt.png`.
- **`naina-bar-generation.json` contains the exact final reference prompt, video prompt, generation settings and job ID.**

The source is native 2560×1440 at 24 fps, lasting 7.291667 seconds. Desktop selects 2K; phone, low-memory and save-data modes select 1080p. Failed MP4 playback falls back to WebM or the matching full-resolution poster. The clips are downloaded once and cached for repeated rounds. There is no video speed change, reversed playback, frame interpolation, animated video resizing or CSS blur.

The video is generated footage. Its physical hand gesture repeats each round; rendered dice trajectories and orientations have small round-seeded variations. Server dice values, bet settlement, payouts and wallet behavior are unchanged.

## Reproduction

Run from the repository root, substituting the directory containing FFmpeg and FFprobe:

```powershell
$media = 'artifacts/3d-game/src/assets/lucky7/cast'
$ffmpegDirectory = '<ffmpeg-directory>'

node artifacts/3d-game/scripts/lock-lucky7-table.cjs `
  "$media/naina-bar-generated-2k.mp4" "$media/naina-bar-master-2k.mp4" $ffmpegDirectory

./artifacts/3d-game/scripts/prepare-lucky7-2k.ps1 `
  -Source "$media/naina-bar-master-2k.mp4" -Prefix naina-bar `
  -FFmpegDirectory $ffmpegDirectory -IdleStart 5.666667 -IdleEnd 7.291666

node artifacts/3d-game/scripts/prepare-lucky7-hand-occlusion.cjs `
  "$media/naina-bar-generated-2k.mp4" $ffmpegDirectory

& "$ffmpegDirectory/ffmpeg.exe" -hide_banner -loglevel error -y `
  -ss 1.875 -i "$media/naina-bar-master-2k.mp4" `
  -frames:v 1 -vf 'crop=768:280:960:1040' "$media/naina-bar-felt.png"

$env:REQUIRE_FIXED_TABLE = '1'
node artifacts/3d-game/scripts/check-lucky7-table.cjs `
  "$media/naina-bar-master-2k.mp4" $ffmpegDirectory
```

The table pass preserves the original source separately. It holds the unoccupied front edge below y=1322 and outer sides below y=1062, with a 12-pixel join on empty felt. The center corridor, hands, dealer and background retain their original motion. Across all 175 frames, maximum mean pixel deviation in the three tested rail regions was below 0.47 on a 0–255 scale; hand movement remains present. This measures table stability, not device playback FPS.

## Dice and hand integration

`dealerCast.ts` imports the packaged bar assets. `tableDiceMotion.ts` uses measured 24 fps cues: pickup begins at 500 ms, hands cover the dice at 875 ms, release is frame 85 (3541.67 ms), and landing is frame 103 (4291.67 ms). Starting centers are (944,857) and (1003,863) in the 1920×1080 coordinate system. Dice grow from 42 to 64 source pixels as they reach the center landing area.

`dealerDiceFootprints.ts` records native dice bounds. `TableDice.tsx` replaces only those bounds with clean felt, cropped from the processed master at 1.875 seconds: native x=960, y=1040, width=768, height=280; displayed at x=720, y=780, width=576, height=210. `dealerHandOcclusion.ts` contains offline hand contours, excluding the warm ivory dice edges. Both the felt repair and rendered dice respect these contours so real fingers remain visible in front.

The contours are specific to this take; changing footage requires remeasuring timing, dice bounds and hand contours. Runtime updates follow decoded video frames using two small SVG dice, without another decoder, WebGL or React state updates per frame. Existing stalled-decoder, media failure, offline cache, late-join and reduced-motion handling remains active.

## Validation and release

The relevant browser suites are `lucky7-center-throw.spec.ts`, `lucky7-dealer-video.spec.ts`, `lucky7-dice-playback.spec.ts` and `lucky7-responsive.spec.ts`. They cover centered throws, visible hands, all server dice values, repeated rounds, media quality and fallbacks, offline reuse, unavailable audio, winning popups and six responsive viewports. API, WebSocket, authentication and wallet data are mocked; these checks do not place real bets.

Release image: `aviator-game-web:lucky7-bar-2k`. The previous running image is retained as `aviator-game-web:before-bar-dealer`. Deployment replaces only the web container at `http://localhost:5174/lucky-7`.

Validated on 2026-10-01: TypeScript and production build passed, followed by all 24 browser checks against the final packaged image. Responsive checks cover 320×568, 390×844, 768×1024, 568×320, 844×390 and 1280×720; centered throws also run at 360 px and 1366 px widths. Desktop and phone screenshots were inspected after landing to verify the hand contours exclude the ivory dice edges. Browser tests use Chrome emulation; actual hardware performance can vary.

The deployed HTML, JavaScript and CSS hashes match the tested package, and `/healthz` is healthy. Final image manifest: `521d67d92473d1aed315f71ba2e4cab3f65929045ed982147652c874a6b04697`. JavaScript SHA-256: `feda0a6cfa5f6ac3996b0046069e6d564818cbc35a4e3bbb47ebf7300158945c`.

The live-origin mobile smoke test passed two centered throws after deployment. Temporary preview containers, the development server and the reference-transfer tunnel were stopped; the main game remains running on port 5174.
