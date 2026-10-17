# Lucky 7 — Naina centered 2K dealer

This describes the earlier burgundy outfit. The active black-dress bar variant, assets and timing are documented in [lucky7-bar-dealer.md](lucky7-bar-dealer.md).

The active dealer is Naina. One generated 2560 × 1440, 24 fps take shows a calm adult dealer collecting two dice at the center, gently shaking them in cupped hands and releasing them onto the felt. Her expression remains restrained. The waiting loop comes from the same take, with the same wardrobe, lighting, camera and table. No reaction, greeting or clapping clips are used.

## Assets and provenance

All integration assets live in `artifacts/3d-game/src/assets/lucky7/cast/`:

- `naina-center-reference.png`: reference made with the built-in imagegen tool.
- `naina-center-master-2k.mp4`: original Higgsfield MiniMax H3 output, job `a5ea6076-972f-4281-a6f2-44217e8aa5fe`.
- `naina-center-action-2k.mp4`: original video bitstream, audio removed without re-encoding.
- `naina-center-idle-2k.mp4`: forward-only calm tail from 6.333333 to 7.291666 seconds.
- Corresponding `1080p.mp4` phone assets, `720p.webm` codec fallbacks, full-resolution poster and a small clean-felt crop.
- `naina-center-generation.json`: exact reference and video prompts, model parameters and generation ID. Reference generation used built-in imagegen mode.

The preparation command is reproducible:

```powershell
./artifacts/3d-game/scripts/prepare-lucky7-2k.ps1 `
  -Source ./artifacts/3d-game/src/assets/lucky7/cast/naina-center-master-2k.mp4 `
  -FFmpegDirectory <directory-containing-ffmpeg.exe-and-ffprobe.exe> `
  -IdleStart 6.333333 -IdleEnd 7.291666
```

`dealerCast.ts` selects these packaged assets. Desktop chooses 2K, phone/low-memory/save-data chooses 1080p, and failed MP4 decoding falls back to 720p WebM or the poster. Both videos are fetched once, then reused. The video has no CSS blur, resize animation, crossfade ghosting, reversed frames or interpolated frames; playback stays at 1×.

## Frame synchronization

The measured action cues in `tableDiceMotion.ts` are pickup start 500 ms, palms covering dice at 875 ms, uncovered release at frame 94 (3916.67 ms), and rendered landing at frame 112 (4666.67 ms). `DealerFilmStage` sends decoded timestamps to `TableDice`, which updates two small SVG meshes without React state updates per frame, WebGL or a third video decoder.

Coordinates remain normalized to 1920 × 1080. Release starts near the centered palms, at (938,905) and (988,893). Dice grow from 42 to 64 source pixels and land near (870,961) and (1050,961), with small round-seeded variations. Previous results move toward the filmed pickup positions only as the hands approach. Faces always come from the server outcome; visual randomness never changes betting, payouts or RTP.

`dealerDiceFootprints.ts` records the native dice bounds during the 15 uncovered release frames. A localized SVG mask replaces those bodies with a clean 320 × 280 crop taken from source x=1120, y=1040 at 1.875 seconds. It never replaces the dealer or a broad section of table. The repair is hidden while the palms hold the dice. The cube shadows are small and remain attached to the landing surface.

Existing deadline, duplicate-result, late-join, reduced-motion, media-failure, stalled-decoder and offline-cache behavior remains active. The native clip continues to its calm resting pose after the result lands. The table frame and betting controls retain their responsive sizing.

Generated video still has normal motion softness during hand movement; it is not live human footage. Each round reuses the same physical hand gesture, while the rendered dice path and orientation vary.

## Validation

Run TypeScript and a production Vite build, then the mocked browser suites `lucky7-center-throw.spec.ts`, `lucky7-dealer-video.spec.ts` and `lucky7-dice-playback.spec.ts`. They verify 360 px/1366 px layouts, hand visibility, center landing and growth, full-resolution assets, all six server faces, repeated rounds, fallback behavior, no video speed changes, offline reuse and resource cleanup. These suites do not place real bets or modify real balances.

Validated on 2026-10-01: TypeScript and production build passed; all 18 dealer/dice/playback checks passed on the final packaged release. All six additional responsive checks passed at 320×568, 390×844, 768×1024, 568×320, 844×390 and 1280×720. The responsive test compensates for scrolling inside the application shell when measuring layout stability. The SVG frame callback's measured 95th-percentile work was 1.2 ms at 360 px and 1.0 ms at 1366 px in desktop Chrome emulation; this is drawing work, not a hardware-wide FPS guarantee.

Release image: `aviator-game-web:lucky7-naina-2k`. Previous running web image retained as `aviator-game-web:before-naina-2k`. Deployment replaces only the web container; API, database, admin and wallet state are unaffected. The production build contains hashed copies of all imported runtime media.

Deployment verified at `http://localhost:5174/lucky-7`: served HTML, JavaScript and CSS hashes match the tested release, `/healthz` is healthy, and a live-origin mocked mobile smoke test completed two centered throws successfully. The temporary preview, development server and reference-transfer tunnel were stopped. Release manifest: `6b6752f4d5926e3ea3003c922235482a486fa7da12dfec501450bba34bf2ac42`.
