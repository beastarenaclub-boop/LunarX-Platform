# Mega Ball

Mega Ball is available at `/mega-ball` in the shared player app. Both the Lunar
and Crypto777 lobbies include the game, a dedicated Mega Ball category, a new
banner and the existing NEW badge. Authentication and the shared wallet are used.

## Local preview

Run `npm run mega:dev`, then open http://127.0.0.1:5340/mega-ball.
On Windows, `START-MEGA-BALL.cmd` runs the same preview.
The launcher builds the API and starts an isolated in-memory demo worker plus
Vite. It does not connect to a production database. Preview coins are unlimited
and the session expires in one hour. Restart the command for a new session.
`MEGA_BALL_WEB_PORT` and `MEGA_BALL_API_PORT` override ports 5340 and 5341.

## Reference and implemented rules

The supplied 230-second screen recording was reviewed across its full duration,
including studio/countdown, card purchase, machine closeups, 20-ball draw,
multiplier selection, Mega Ball and winning-card screens. Review frames remain
in `tmp/mega-ball-reference` locally. The gold/emerald studio, glass globe, spiral
chute, pack sizes, card layout, pay table and draw/result arrangement follow that
reference. The machine is generated Three.js geometry with 51 individually
numbered balls, in front of an AI-generated empty architectural studio.
The additional 61.5-second reference supplied on October 27 was reviewed at
two-second intervals and at half-second intervals through the multiplier reveal.
An original AI-generated presenter is composited into the studio. The supplied
recordings are references only; gameplay balls and outcomes remain live objects.
Rules are implemented locally and are documented in-game.

- Buy 1–100 cards in a single confirmed purchase per round, with a minimum ₹1
  per card. The default maximum aggregate purchase is ₹10,000.
- Cards contain 25 unique numbers in five columns, from 1–51, with no free cell.
- Draw 20 unique balls, select a 5×–100× multiplier, then draw one additional ball.
- Rows, columns and the two diagonals count. The highest line-count award on
  each card pays 1×, 5×, 50×, 250×, 1,000× or 10,000× for 1–6+ lines.
- If the Mega Ball completes an additional line, multiply that card's award.
  Returns include stake. All cards settle automatically into the shared wallet.
- Default phases are 20 seconds purchasing, 48 seconds drawing and 4 seconds
  displaying the result. Operators can configure subsequent rounds.

The payout schedule and multiplier weights are versioned game rules; no claim
is made that this implementation reproduces an external provider's certified RTP.

## Implementation

`lib/api-zod/src/mega-ball.ts` holds shared rules and line evaluation.
`megaBallMath.ts` uses HMAC with rejection sampling for deterministic outcomes
and cards. Cards derive from the public commitment and player ID; draws use the
unrevealed server seed. The API generates cards, enforces a 100-card cap and uses
a per-player/round database advisory lock for idempotent purchases.

The existing table-round engine persists rounds, cards and receipts. Internal
exact-paise settlement prevents client cashout/loss manipulation. Confirmed
cards survive refresh; REST polling supplements realtime events. `/recent` and
`/:roundId/verify` expose history and commitment/payout verification.

Bootstrap creates the game configuration without replacing operator settings.
No database migration is needed because rounds and cards use existing tables.
Deploy the API and frontend together when releasing this game.

## Generated machine and artwork

`BallMachineScene.tsx` loads `machineRenderer.ts`, which constructs the glass
globe, joint fasteners, steel extraction gate, clear descending S-track,
vented metal base, air impeller and 21-slot receiving tray. `studioMaterials.ts`
supplies a custom softbox reflection environment, machining texture and contact
shadows. Three.js supplies physical glass and metal materials, beveled geometry,
environment reflections and shadows. Number textures are generated locally and
printed on the glossy balls; there are exactly 51 persistent meshes, numbered
1–51. Gravity, an air jet, sphere contacts and the globe boundary keep unselected
balls moving inside the bowl. Only the selected ball can leave through the gate.

`machineTimeline.ts` defines a single presentation clock. Each normal draw has
one extraction slot; its number is revealed at the gate release point. The ball
travels through the chute and into the tray before the next release. There are
20 normal slots, followed by one Mega Ball slot. Bowl + chute + tray always sums
to 51, with at most one ball in the chute. Refresh reconstructs the same inventory.
Clock corrections cannot rewind the machine or repeat an already released ball.
The server remains authoritative: animation does not determine or change results.

`showTimeline.ts` coordinates the full broadcast sequence: closed bets and mixing,
20 individual draws, top-track closeup, a sliding logo door, a vertical multiplier
reel that rolls in both directions and decelerates to the server's multiplier,
purple bonus lighting, a held Mega Ball closeup, then the result. The final result
and winning-card awards appear only after the Mega Ball has reached the tray.
Camera moves smoothly between wide, machine, track, multiplier and extraction-gate
shots. The reel never selects a new outcome; its center row uses the authoritative
multiplier. Reduced motion preserves the same sequence without camera interpolation
or reel scrolling.

The same release state supplies the current-number badge, drawn list, card marks
and `useBallCall.ts` announcements. Sound enables the device's English speech
voice; stale calls are cancelled on mute, navigation and hidden tabs. Sound is
off initially and no recorded number audio is replayed.
Phase announcements introduce the draw, multiplier and Mega Ball; an available
English female device voice is preferred. The presenter loop is not lip-synced to
these device-generated announcements.

The renderer pauses in hidden tabs and respects the Machine motion setting.
Machine motion defaults to off when the device requests reduced motion.
If WebGL is unavailable or its context is lost,
a generated SVG machine continues to show the same numbered inventory and the
user can retry 3D. The camera fits the actual stage dimensions on resize; controls
and wallet stay in their own rows.

Built-in imagegen created `studio-backplate-v2.png`, an empty architectural set
with brushed brass, emerald panels and warm indirect light. Its exact prompt is
saved in `studio-backplate-v2.prompt.txt`. This image contains no machine or balls;
all 51 balls, the bowl and the track remain live 3D objects. The backplate covers
the camera viewport on desktop, phone and rotation without exposed plane edges.
It loads once (about 2.1 MB); if it fails, the draw remains playable against a plain
studio color. Ball textures use 512-by-256 pixels to limit mobile GPU memory.

Built-in imagegen also created the lobby `banner.jpg` and an earlier `studio.jpg`
concept. Their prompts are in `generation-prompts.json`. The generated banner
remains on both storefronts.

`presenter-green.png` was created with built-in imagegen; its retained art brief is
in `presenter-image-brief.txt`. Runway's `seedance-2`
animated this original adult presenter into a ten-second loop, with a restrained
presenting gesture cued when the multiplier door opens. The generated clip is
served as `presenter-host.mp4` at 540 by 960 pixels; its full generation prompt,
model and task identifier are in `presenter-generation.json`. `presenter.ts`
removes the green background in a shader, pauses footage when off-camera or hidden,
and uses the still portrait if video loading fails. The clip contains no game
balls, numbers, multiplier values or result footage.

The photographic set includes `studio-relief-v3.png`, a brass wall
with stamped petals, fine machining and concealed lamps (built-in imagegen;
exact prompt in `studio-relief-v3.prompt.txt`). `studioFloor.ts` adds restrained,
blurred reflections of the live presenter and machine at twelve updates per
second, excluding the photographed backplate. The draw itself continues at the
browser's animation rate. Glass uses a thin acrylic shell, metal has brushed
roughness, balls have a molded polymer finish and a centered readable number,
and the extraction gate includes clear plates and pneumatic fittings. The
cabinet door's enamel and embossed lettering are generated locally on canvas.

The next studio pass adds physical recessed brass portals, a warm-lit machine
niche, a taller bowed emerald counter, floor inlays and a lacquered green floor.
`studio-gold-inlay-v4.png` supplies photographic metal facets for the inset panels;
it was made with built-in Imagegen and its exact prompt is saved beside it.
`multiplierCabinet.ts` now uses nine reusable curved tiles with physical borders,
embossed exact-text artwork, recessed glass, fixed gold pointers and two sliding
door leaves. The circular medallion travels intact with the right leaf. The
reported reel value is read from the tile aligned with the pointers, allowing
the browser check to compare it to the declared winning multiplier.

Closer inspection of the second recording confirms 12×, rather than 2×, in the
reference reel and history. This graphics update preserves the published game
rules and their supported outcome values; adding a new winning multiplier would
require a separate rule/version change.

## Validation

`npm run mega:test` runs draw/card/line math tests and an isolated integration
test for purchase retries, wallet ledger debits/credits, hidden outcomes,
refresh recovery, automatic settlement and verification. Build the API first
with `node artifacts/api-server/build.mjs` after server changes.

With the preview running, `npm run mega:test:browser` checks both lobbies, the
complete purchase-to-result cycle, restored cards and 390px/320px/landscape UI.
It also checks 51-ball conservation, exactly one exiting ball per spoken number,
all 20 + 1 calls against the UI/card marks, presenter-only video requests, reduced motion,
WebGL failure/recovery and responsive fitting.
Screenshots are stored in `test-results/mega-ball`.

Run the pure timeline tests with
`cd artifacts/api-server && node --import tsx --test ../3d-game/tests/mega-ball-machine.test.ts`.
They check every release boundary and 20,001 positions across a complete round,
the complete stage order, delayed result declaration and bidirectional reel stops
for every supported multiplier.
