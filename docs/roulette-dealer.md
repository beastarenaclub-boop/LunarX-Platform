# Roulette studio dealer

The roulette page now includes a photorealistic adult female AI dealer at a
casino table. This is generated video, identified as **AI DEALER** in the UI.
The dealer gestures over one controlled wheel. `RouletteStudioWheel.tsx`
composites a stationary photographic wooden housing over the recorded wheel,
covering the recorded loose ball and numbered rotor. During the gesture, a
570-pixel-tall foreground canvas restores the actual hand and held ball above
that mask. It copies the same decoded video frame, so it needs no extra video
decoder. The foreground never reaches the recorded number ring.
The game draws all 37 numbered pockets and the ball on top. The recessed bowl,
brass pocket dividers, shaded red/black/green beds and engraved number ring
share the European wheel order. The photographed cone retains its wood grain
and reflections, with its clip excluding the old film's pocket colours.
The ball has perspective-scaled size, a contact shadow and a short motion trail.
Its motion comes
from the existing server-result landing plan, so the visible ball stops in
the same printed pocket as the winning-number readout.

Wide view and 1.52× camera focus share one scene and one rotor/ball instance.
Only the framing changes; zoom cannot introduce another wheel or restart a
landing. The ivory ball parks at the front rim, clear of the spindle, and the
selected printed number is upright. Camera controls move above the wheel in
close-up so they do not cover the winning pocket on phones.

`RouletteDealerTable.tsx` starts the four-second action in the last four seconds
of betting. The final held-ball frame is frame 36 at 24 fps (1500 ms), with
ball centre (842, 535) in the original camera frame. The next two observed
positions are approximately (827, 560) and (814, 600). `dealerTiming.ts`
calibrates the 96 ms hand-to-track trajectory against these frames. Frame 37's
loose filmed ball is cleared through a small gap between the fingers and
replaced by the game ball; the hand stays in front of the rim. The release
reads decoded frame time while footage is running, then falls back to the
server clock if footage is paused, hidden or unavailable. The ball cannot
rewind/relaunch within a round. It counter-orbits at radius 475 while the rotor
turns the other way.
The studio landing profile uses slower rotor speeds and about one second of
radial drop with diminishing fret skips. At rest, all offsets disappear and
the ball is inside the exact indexed pocket. Each new round resets the held
ball and schedules its own throw. No continuous idle ball roll remains.
Each round plays the gesture at most once. Adjacent footage from seconds 4–12
provides the waiting loop. The complete camera frame is preserved on phones.
The clips loop; they are not a live human broadcast.

The table switches to the wheel close-up for reveal/settlement. `RouletteWheel`
drives both the SVG rotor and ball from the same motion state used for the
result clock and spin audio. Dealer footage can keep moving after the wheel
stops. Betting lasts 25 seconds, stored in server configuration and copied into
each new round; reveal and settlement remain separate phases. Migration 0044
updates roulette only, while existing round snapshots keep their deadlines.
Bootstrap seeds 25 seconds and retains the existing admin override behavior.
Payouts and wallet logic are unchanged. Failed/stalled video, late
arrival, pause, reduced motion, backgrounding and a new round cannot delay
settlement or replay an old throw. Reduced motion uses the poster.

Roulette effects and croupier speech have a dedicated 1.65× gain stage
(approximately +4.35 dB), with a -3 dB peak compressor before the existing
master volume. Other games retain their original audio routes. The sound
button beside the camera controls uses the saved sound preference; muting
stops the roll and announcements. `roulette-camera.spec.ts` checks that zoom
reuses the original media, results still wait, the audio graph includes the
boost/limiter, and mute stops the rolling loop. `roulette-pocket-sync.spec.ts`
tests every 0–36 result on desktop and mobile by transforming the ball's actual
screen position into each rendered pocket path and checking `isPointInFill`.
The printed text of the containing path must equal the result. It also checks
animated landings, duplicate results, camera changes, reloads and reduced motion.

Assets are in `artifacts/3d-game/src/assets/roulette-dealer/`. `reference.png`
was generated with the built-in imagegen tool; `dealer-master.mp4` was generated
with Higgsfield Seedance 2.5. `generation.json` records both exact prompts, the
reference ID, generation ID and source URL. Runtime imports only the poster
and H.264 clips (1080p desktop / 720p mobile), about 5.5 MB total across both
qualities. The reference and master are retained for future edits.

To re-encode, use ffmpeg with action seconds 0–4 and idle seconds 4–12,
`-an -c:v libx264 -pix_fmt yuv420p -movflags +faststart`. The poster is frame
96 (4 seconds). Keep all four runtime video filenames when replacing media,
and remeasure release/action timing.

Browser checks live in `artifacts/3d-game/tests/roulette-dealer.spec.ts`.
They mock all API/socket traffic and never create accounts or real bets.
They cover two rounds at desktop/mobile sizes, exact result display, late
arrival, reduced motion, media failure, pause/backgrounding, and responsive
table/control layout. The ordinary player-app TypeScript and Vite build
commands also apply.

The subsequent betting/settlement update is documented in [roulette-rules.md](roulette-rules.md).
The original dealer-only release was served at `http://localhost:5200/roulette`. The web-only
image is `aviator-game-web:roulette-dealer`; the prior container filesystem
is retained as `aviator-game-web:before-roulette-dealer`. The API and database
containers are not replaced for this presentation change.

Validation on 2026-10-08: TypeScript and the production build passed; all seven
dealer browser checks and four existing wheel calibration/landing checks
passed. The final camera-toggle adjustment passed desktop/mobile two-round
playback and late-arrival checks again. Deployed HTML, JavaScript and CSS match
the build byte-for-byte, video range requests return HTTP 206 `video/mp4`, and
both web/API health endpoints return 200. Main JavaScript SHA-256:
`760d920d1488fba7e6bf4486c3a22e4a253060b988d14bd5b65552f8dcfc0c1a`.
The deployed origin also passed the 390px two-round browser check with mocked
API/socket data. Temporary development and preview servers were stopped.

The subsequent same-wheel camera/audio release uses
`aviator-game-web:roulette-camera`, with `:before-roulette-camera` retained
for rollback. It changes only the player web image. TypeScript, production
build, the seven dealer checks and three camera/audio checks passed. The
deployed HTML, entry JS and CSS match that build. Its entry JS SHA-256:
`83bcc73f63d7dd688d3eb1cec36d84a19038661444b4866f593691d26ac080df`.

The controlled-pocket correction is deployed at `http://localhost:5200/roulette`
as `aviator-game-web:roulette-controlled`, with `:before-roulette-controlled`
retained for rollback. Image ID:
`sha256:f14afdcfbfc4998ea24f03e566140d7d7598c52557dc7451efdb4609792f4230`.
Validation completed on 2026-10-09: player TypeScript and production build
passed, along with twelve dealer/camera/audio/landing regression scenarios.
On the deployed build, every pocket from 0 through 36 passed the actual-ball
containment check at desktop and phone sizes. Additional deployed checks passed
for reduced motion with missing video, animated landing with duplicate events
and page reload, and the louder audio/mute path. The reload angle comparison
allows only floating-point roundoff; the printed pocket match is exact.
HTML, entry JavaScript and CSS match the build byte-for-byte; web and API health
return 200, and the public roulette config still reports payout base 36.
Controlled-pocket release entry JavaScript SHA-256:
`f74f702c9556609da8c08169e9678131079dbdfcb95ece2d7caa95c840183f3f`.
The temporary roulette development server was stopped.

The subsequent realistic-motion/25-second release is deployed on 2026-10-09.
Both API and web use the `:roulette-realistic` tag, with their previous images
retained as `:before-roulette-realistic`. API image:
`sha256:f6fe5b7f04dfced7e0cb41657d1ddabfaf6b4e1a4ba9ca27787db8657b86ab75`.
Web image:
`sha256:13157523d8a9b843ba2c53d97985373b51a992c9fb3a07c642a984fbcd9e26e2`.
Player TypeScript, API build, web build and sixteen browser scenarios passed.
The new launch checks observe two consecutive throws on desktop and mobile:
the ball is hidden before release, moves counter to the rotor inside the bowl,
and resets for the next round. All 37 printed-pocket containment checks pass.
Five scenarios also pass on the deployed origin, covering repeated throws,
animated landing/reload, missing video/reduced motion, and the louder sound/mute.
Migration 0044 passed in a rolled-back test transaction, then applied through
the deployed API's normal migrator. Both live configuration and newly persisted
roulette round snapshots report `bettingWindowMs: 25000`; payouts remain 36x.
Served HTML, JavaScript and CSS match the build bytes, and both health endpoints
return 200. That release's entry JavaScript SHA-256:
`d621e2d463b337d0da9726110c3ae7754ea527a91237e04593db74285d703f6f`.
The temporary development server is stopped.

The hand-contact correction is deployed on 2026-10-09 as
`aviator-game-web:roulette-hand`; `:before-roulette-hand` retains the previous
web release. Image ID:
`sha256:dea92174bbb4739a6fda336ea0296c70b839a834fee48bd4fe27253a1bea49c0`.
The original dealer footage is retained. A request for a new low-placement
gesture was rejected by the video provider because the workspace had no
credits; no replacement video was generated. This release fixes compositing
and the contact trajectory, rather than claiming a new recorded gesture.
TypeScript and the production build passed. Camera/audio, repeated throws,
hand contact, pause/backgrounding, unavailable video, reduced motion and
animated landing/reload checks passed. Four checks also passed on the deployed
origin: hand contact at 65% playback speed and consecutive throws, each at
desktop and phone sizes. The hand-contact test samples actual decoded frames,
checks the foreground pixels and cleared loose-ball region, and verifies the
game ball stays hidden while the filmed fingers still hold it. Both health
endpoints return 200; served HTML/JS/CSS match the build byte-for-byte. Betting
remains 25000 ms. Current entry JavaScript SHA-256:
`1195f9de8f8d7742ca7e9a643cf93801dec7037607811a17a3546bba5d140c98`.
The temporary development server is stopped.

The attached betting dock is deployed on 2026-10-09 as
`aviator-game-web:roulette-dock`, image
`sha256:3d3b50c5eb89b96b1d285dae406241de70f0c0bf6ab733090c128017a56ed875`.
The studio and betting controls share one bordered frame. Portrait layouts
put betting directly below the dealer; wide layouts join the two columns.
The board and expandable limits/paytable scroll inside the panel, while the
coin rack, selected total, Undo/Clear/Rebet, Auto bet and submit action keep
their own space. The horizontal coin rack retains every denomination and
custom amounts. Short landscape windows can still scroll the outer frame.
Dealer timing, wheel geometry and betting rules were not changed by this edit.

TypeScript, the production build and five existing browser scenarios passed.
Three scenarios also passed against the deployed origin: mobile manual bets
and limits, auto bet/reset, and compact layouts. All browser traffic used the
mock roulette fixture; these checks did not create real accounts or bets.
Served HTML, entry JS and CSS match the build bytes; both health endpoints
return 200. Entry JS SHA-256:
`56e16e04301ec0e4037a35bd79930a792787d0b7cfb454df789877709f646c55`.
The immediately preceding live web image is retained as
`:before-roulette-dock`. The temporary development server is stopped.

The follow-up layout release places the keypad directly below the studio on
desktop as well as phones. It is deployed on 2026-10-09 as
`aviator-game-web:roulette-bottom`, image
`sha256:249af917108704278acd6a137b13a8123f13462a8778315397c3855b2344a9b9`.
The previous live image remains `:before-roulette-bottom`. Wide screens put
the coin/actions rack beside the number grid within the bottom dock. Phones
keep those controls below the grid. The studio preserves its 16:9 aspect ratio
inside the available space; taller phones no longer add a gap below the video.
Number, dozen and outside rows fit in view, with extra selection/payout details
remaining scrollable. Edge betting hotspots retain their hit areas and now
highlight on hover or keyboard focus instead of obscuring the numbers.

TypeScript and the production build passed. Manual betting, limits, auto bet,
round resets and camera/result timing passed using mocked API/socket traffic.
Measured bounds at 320x740, 390x844, 390x960, 768x1024 and 1366x960 confirm the
whole base grid and actions fit, the dock touches the studio, the video remains
16:9 and there is no horizontal page overflow. Two existing browser checks
also passed on the deployed origin. HTML/JS/CSS match the build, both health
endpoints return 200, and the temporary Vite server is stopped. Entry JS SHA-256:
`29eb296c27e279a5eee7d5d8d08403864a1e95b587131f5c23ee84cc421a1daf`.
