# Lucky 7 — loop jump and throw shadow correction

The previous waiting video was only 39 frames (1.625 seconds). Its face moved substantially between the last and first frame, repeating the same nod. The player also resumed that loop at its old paused time after the throw. A full-frame pixel average hid the face jump because most of the scene was stationary.

The replacement uses one newly generated 15.083-second, 2560×1440, 24 fps take of the same adult dealer, black satin dress and bar scene. Frames 0–216 supply the action; frames 217–361 supply the 6.0417-second waiting loop. These are adjacent parts of the same performance. `DealerFilmStage.tsx` rewinds the idle while the action covers it, so the action ends on the frame immediately preceding the idle start. Playback remains forward at 1× with no resize animation, frame interpolation or reversed footage.

The added SVG dice-shadow gradient has been removed. Original filmed dice and their small contact shadows are repaired using bounds measured in every action and idle frame. The donor texture comes from unoccupied felt at the same table depth on the right side; it does not contain the moving hand shadow that contaminated a center crop. Offline hand contours preserve actual fingers in front of the dice. Natural shadows present in the dealer footage remain.

## Runtime and source assets

All files live in `artifacts/3d-game/src/assets/lucky7/cast/`, using prefix `naina-bar-natural`:

- `generated-2k.mp4`: original MiniMax H3 output, job `2419522c-1a55-4c23-bf59-0a7869ef1616`.
- `master-2k.mp4`: table-side/front stabilization, preserving the dealer and background motion.
- `action-2k.mp4` / `idle-2k.mp4`, their `1080p.mp4` phone copies and `720p.webm` decoding fallbacks.
- `poster.jpg`, `felt.png`, and `generation.json` with exact prompt, parameters and reference media IDs.

The existing built-in-imagegen reference `naina-bar-reference.png` was reused. No new still-image identity was generated. `dealerCast.ts` imports all runtime assets; source videos are retained separately. The browser preloads and reuses two video buffers, with the existing poster, reduced-motion and decoding-failure handling.

Measured timing in `tableDiceMotion.ts`: pickup begins at 500 ms, hands close at frame 27 (1125 ms), and release is frame 93 (3875 ms). The current rendered roll ends at frame 149 (6208.33 ms), after 2333.33 ms of motion. Dice begin at (936,856) and (978,852) in the 1920×1080 coordinate system, then grow from 42 to 64 pixels toward the existing centered landing area. These presentation changes do not affect server outcomes, payout logic or wallet balances.

## Longer roll and gradual stop

The earlier 750 ms throw stopped rotating after just 570 ms. The current `naina-roll-out-29` scene uses a 2333 ms throw with progressively smaller bounces followed by a slowing slide. Each die turns roughly two revolutions; angular speed declines throughout and reaches zero at the final pose instead of stopping early. Round IDs vary the path and orientation, while the final faces always use the server result. The fallback SVG roll uses the same duration when sufficient presentation time remains.

The measured hand release and 1× dealer playback are unchanged. No footage, hand masks, assets, table dimensions or blur effects are changed for this timing adjustment. A five-second reveal cannot contain the longer roll after a 3875 ms hand release, so an already-started throw may use up to two seconds of the existing settlement phase. `Lucky7.tsx` calculates a presentation deadline separately from the original reveal deadline. `DiceTable.tsx` retains that deadline through the settlement event and only shortens it if the server window contracts. At least 1500 ms of a normal settlement window remain reserved for the result UI. Wallet settlement still follows the server; the win receipt and result highlight wait for the visible dice to stop.

Late joins use the original reveal deadline to decide whether to animate, and joining during settlement shows the final faces immediately. Hidden tabs, reduced motion, unavailable footage, insufficient time and stalled decoders retain their guarded completion behavior. A new betting round closes the old presentation window. The browser uses the existing decoded-frame callback and two SVG meshes; it does not introduce another video decoder, canvas or per-frame React updates.

`lucky7-roll-out.spec.ts` checks continued rotation/translation near the end, decreasing angular speed, and continuity at the final pose. Its mobile and desktop browser cases deliver a real settlement event during the roll and verify that dice continue moving, the win popup waits until rest, repeated settlement does not replay it, and next-round betting is available. All server data and balances are mocked.

## Reproduction

From the repository root:

```powershell
$media = 'artifacts/3d-game/src/assets/lucky7/cast'
$ffmpegDirectory = '<directory containing ffmpeg.exe and ffprobe.exe>'

node artifacts/3d-game/scripts/lock-lucky7-table.cjs `
  "$media/naina-bar-natural-generated-2k.mp4" "$media/naina-bar-natural-master-2k.mp4" $ffmpegDirectory

./artifacts/3d-game/scripts/prepare-lucky7-2k.ps1 `
  -Source "$media/naina-bar-natural-master-2k.mp4" -Prefix naina-bar-natural `
  -FFmpegDirectory $ffmpegDirectory -ActionEnd 9.041666666 `
  -IdleStart 9.041666666 -IdleEnd 15.083333

node artifacts/3d-game/scripts/prepare-lucky7-hand-occlusion.cjs `
  "$media/naina-bar-natural-action-2k.mp4" $ffmpegDirectory

node artifacts/3d-game/scripts/prepare-lucky7-dice-footprints.cjs `
  "$media/naina-bar-natural-action-2k.mp4" "$media/naina-bar-natural-idle-2k.mp4" $ffmpegDirectory

node artifacts/3d-game/scripts/extract-lucky7-clean-felt.cjs `
  "$media/naina-bar-natural-master-2k.mp4" "$media/naina-bar-natural-felt.png" $ffmpegDirectory

node artifacts/3d-game/scripts/inspect-lucky7-continuity.cjs `
  "$media/naina-bar-natural-idle-2k.mp4" $ffmpegDirectory tmp/lucky7-natural-idle-continuity.json
```

The felt donor is a 768×280 crop at source (1730,1040), frame zero. Runtime placement remains (720,780), 576×210, clipped to measured native dice bounds and excluding fingers. Only the donor’s clear central columns are sampled. These masks and timing are specific to this take; remeasure them when changing footage.

## Validation

The offline 320×180 face-region mean pixel jump fell from 8.52 to 2.19 (0–255 scale); hands fell from 5.00 to 1.95. The cycle is nearly four times longer. The rail-stability check passes across all 362 master frames, with maximum mean deviation below 0.69 while actual hand and background movement remains present. These are pixel-continuity measurements, not hardware FPS guarantees.

The browser regression now checks the face and hands separately, requires at least six seconds of waiting footage, compares the action-end/idle-start frames, and verifies the hidden idle resets before every return. The old clip fails the new regression. Center-throw screenshots include the middle of the throw as well as release and landing. All test bets, API responses and wallet balances are mocked.

Chrome’s 1080p decoding path measures loop differences of 3.51 for the face and 2.82 for the hands; action-to-idle differences are 1.77 and 1.43. These stay below the respective 4 and 2 limits. Whole-scene difference is 4.40: the bartender moves independently in the background, so that separate limit is 5. The footage still loops and does not represent an endless live recording. Actual hand shadows in the source remain; synthetic dice shadows and the contaminated repair patch are removed.

Original loop/shadow release image: `aviator-game-web:lucky7-natural-motion`, manifest `f81bcdd90cfd75b38664962fb2f5fdb8843b7661f67fc48abc8946f61887942f`. The prior web image is retained as `aviator-game-web:before-natural-motion`. Original release JavaScript SHA-256: `febe036c752d5e8ff7dc3967d19c4846d8daaaddb199227c2417be9b0ed6f952`.

Original loop/shadow release validation on 2026-10-01: TypeScript and production build passed. All 24 relevant browser checks passed against that packaged release (23 in the full run, then the refined continuity check separately). A live-origin mobile smoke test also passed two throws. Served HTML, JavaScript and CSS hashes matched the package; `/healthz` was healthy. Only the web container was replaced at `http://localhost:5174/lucky-7`. The temporary preview and development servers were stopped.

Current roll-out release on 2026-10-01: `aviator-game-web:lucky7-roll-out`, manifest `98c14899043a3e1b404ce7e253439c6995293cbd3e7213fced4855b18a272923`, scene `naina-roll-out-29`. The previous web image is retained as `aviator-game-web:before-roll-out`. JavaScript SHA-256: `43a3b57c4590f33e9f5503463ef84a463b8ae26bbd19fc2cd314bf8ceb41348d`; CSS and media assets are unchanged.

TypeScript and the production build passed. All 21 distinct checks passed (20 browser cases plus the trajectory check). The initial suite passed 20; the existing continuity test captured a stale idle surface immediately after seeking the action video. Its test-only frame capture now waits for `requestVideoFrameCallback` at the requested media time, with the original pixel thresholds unchanged. That check then passed twice, reporting the original handoff differences of 1.77 for the face and 1.43 for hands. Mobile/desktop center-throw captures were reviewed. Measured SVG frame callbacks averaged 1.80/2.44 ms on the test machine; this is not a device-independent FPS guarantee.

The new image is served at `http://localhost:5174/lucky-7`. HTML, JavaScript and CSS hashes match the tested package, `/healthz` passes, and the live-origin 360 px settlement-during-roll regression passed with mocked API/wallet data. Only the web container was replaced; server round durations and financial settlement were not changed. The temporary preview container was stopped.
