# Crazy Time studio

Crazy Time remains at `/crazy-time`, reached from both main lobby sections on port 5200. Its bets, wallet and 54-segment outcomes are server-authoritative.

The v3 studio uses five compressed 1920×1080 H.264 clips: welcome, choices, last call, spin and result. The adult fictional presenter wears a red knee-length dress. Clips were generated with Higgsfield and share one fixed studio reference. Generation details are recorded in the v2 and v3 provenance JSON files under `artifacts/3d-game/src/assets/crazy-time/`.

## Timing and synchronization

- Default round: 30 seconds betting, 18 seconds reveal, 8 seconds settlement.
- Bootstrap upgrades only the original uncustomized 20/5/5 or 30/12/8 defaults. Operator-edited timings survive.
- `requestVideoFrameCallback` gates the wheel on the displayed host frame. Wheel motion begins at 3.875 seconds and lands at 7.5 seconds. Between decoded frames, the wheel interpolates by at most one frame for smooth display-rate rotation. Pause, seek and buffering stop interpolation; it cannot cross the pull before that frame is displayed.
- The spin source's extra rim contact is removed with a short dissolve. The roughly nine-second take plays at natural speed, followed by reactions for the rest of the reveal. Betting gestures use separate clips and never replay the pull.
- Late joins seek to the current round position. Hidden tabs pause media and resynchronize on return. Media errors and reduced-motion settings use a poster; they cannot delay server settlement.
- A WebGL foreground preserves fingers without per-frame CPU pixel readback. A separate composited wheel rotates inside a fixed elliptical projection, avoiding a wobbling rim. Its outcome comes only from the server.
- The active clip loads first, followed by the spin and the remaining clips. Complete local blobs are reused for seeks and rounds, and hashed production media has immutable caching. The previous frame stays visible until a replacement frame is decoded. A failed download offers a video retry without changing the game round.

## Audio status

Hindi welcome, choice, last-call and result speech is shipped as real audio files. The welcome uses a new Wan 2.7 audio-driven speaking video and its native audio. The remaining three use Seed Audio's Faye voice over existing gesture clips: they are commentary, not exact lip sync. Further talking-video submissions were rejected as out of credits; they produced no video jobs. Earlier v2 dialogue attempts remain documented in the v2 provenance.

Videos remain muted for reliable mobile autoplay. Predecoded Web Audio speech follows the active take, pause/seek, visibility and the shared sound/volume settings. A visible “Tap for Hindi sound” button unlocks browser audio. Coin, wheel and result effects remain enabled by the same switch. Result commentary is generic; it never announces a fabricated winner. The result recording is gently shortened to finish within its eight-second window.

## Validation

The browser suite checks responsive layouts, an intentionally paused presenter before the pull, interpolation during the spin, download size/priority/reuse, actual speech PCM at the audio output, mute, late joins, clip changes, media failure, reduced motion, all bonuses, automatic bets, wallet updates and rejected bets. Run `npm run crazy:test` and `npm run crazy:test:browser` with the Crazy Time development server running. The optional isolated database test requires explicit opt-in; routine main-lobby smoke checks do not submit real bets.
