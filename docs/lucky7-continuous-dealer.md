# Lucky 7 continuous dealer

The cinema-dealer-24 scene shows Asha in a burgundy satin evening dress. In one
continuous camera shot she picks up the two dice from the right side of the
felt, cups them in both hands, shakes them, and releases them back onto that
side of the table. Her hands return naturally after landing.

The waiting loop is the final, quiet portion of that same shot, played forward
with interpolation. There is no separate room or actor take and no reversed
blink. The complete frame uses object-fit: contain. Small screens scroll
vertically when needed so controls and history remain accessible.

## Media and reproducibility

Assets are under artifacts/3d-game/src/assets/lucky7/cast, with the prefix
asha-cinema-. The reference was edited with built-in imagegen. Exact image and
video prompts, source job IDs, URLs, delivery assets and processing constraints
are saved in cinema-generation.json in the same directory.

The reviewed source is Seedance 2.5 job dc3f7cc7-2597-4119-8c61-4bb7a2a4334d.
The separate MiniMax waiting take was rejected because its framing and blink
timing differed. It is not used by the game.

Run artifacts/3d-game/scripts/prepare-lucky7-cinema.py with the source MP4 and an
output directory to reproduce the delivery assets. It requires FFmpeg, OpenCV,
NumPy and Pillow. Processing preserves all hands, felt and dice shadows. Only
the stationary dice face regions are restored for the server-authoritative
pips; source frames 17 through 97 are wholly untouched before encoding.
At most 1,700 pixels of a 1920x1080 frame are retouched. The review is saved at
.config/asha-cinema-pip-cleanup-review.jpg.

The 24 fps H.264 Baseline action lasts 5.5 seconds. Release is at 3.542 seconds
and landing at 3.750 seconds. The 2.417 second waiting loop comes from source
frames 120 through 144, interpolated forward. Its first/last mean RGB difference
at 320x180 is 1.642. The two 720p MP4 files total 1,922,224 bytes; the desktop
pair totals 3,992,316 bytes. VP8 WebM and a matching Full HD poster cover failed
or unsupported media decoders.

## Playback and results

Both clips preload once. Coin selection never replaces either player or seeks
the waiting clip. Only the visible video plays; hidden tabs pause it. Each new
round starts one action, and duplicate events do not replay it.

Decoded-frame callbacks synchronize release, landing and perspective pips.
On older engines a visible-action-only animation-frame loop samples media time;
the coarse timeupdate event alone can miss the 208 ms landing. The filmed
dice body, movement and contact shadow stay in the action video. Six small SVG
paths place the actual server numbers on their three visible faces; opposite
faces add to seven. There is no independent CSS or WebGL dice flight.

The same action player remains visible through release, landing and the
dealer's return gesture. Settlement does not seek it, change its source or
switch to the waiting loop. Only the native end of the take returns to waiting.

Failed downloads, refused autoplay, a stalled decoder, late joins and reduced
motion cannot block the server result. A ready first frame is required before
showing the action, and the last picture/poster remains available beneath it.
Object URLs are revoked on departure. Hashed videos and posters use immutable
caching and byte-range responses.

## Verification

The focused Playwright suite covers native looping, continuous landing,
server dice values 1 through 6, two successive rounds, stable coin selection,
offline playback, failed/stalled decoders, reduced motion, URL cleanup and six
viewport sizes. Run with playwright.lucky7.config.ts and PLAYWRIGHT_BASE_URL
set to the frontend. Windows Chrome can be selected with
PLAYWRIGHT_CHROMIUM_PATH. Tests use mocked accounts and do not place real bets.

The offline test requires a blob-capable media backend because Playwright
routing disables native HTTP caching. Browser emulation does not certify
every physical phone.

The final local production build passed TypeScript checking and 38 focused
browser checks: 22 in Chrome, eight in Firefox and eight in WebKit. Chrome's
landing assertion was rerun against decoded frame timestamps, because those
can lead the media element's currentTime. Docker reports the web service
healthy, and the 720p action responds with HTTP 206 and immutable caching.

Desktop (1366x900) and phone (390x844) screenshots were reviewed after deployment.
Both had no page errors; the full hands, side dice and controls remained visible.
During screenshot capture Chrome reported four dropped frames out of 132 at
1080p and two out of 132 at 720p. These are automated desktop measurements,
not a guarantee of zero dropped frames on every device.
