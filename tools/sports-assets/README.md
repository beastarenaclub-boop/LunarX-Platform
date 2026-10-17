# Virtual sports assets

`upgrade-football-player.py` builds the football performance asset from the
cached CC0 character sources. It preserves the original face UVs in a separate
2K material, welds and rebinds the jersey, bakes a separate fabric atlas, and
exports three LODs with four material surfaces. Cricket continues to use its
own three-surface asset. `preview-football-performance.py` renders the idle and
captured contact poses before the Unity runtime review.

Run `node tools/sports-assets/fetch-football-mocap.mjs` to fetch original CMU
subject 10 data. `cmu-football-motion.py` evaluates the ASF/AMC hierarchy;
the player pipeline trims and retargets capture 10_01 into the `Pass` clip.
CMU permits inclusion in commercial products but prohibits reselling the data
itself; this motion is not CC0. Source terms/checksums are recorded beside the
FBX. Existing Quaternius locomotion remains CC0.

`FootballMotion` releases the ball at the imported strike's 0.4-second contact
marker, uses continuous receiving points and follows the receiver until the
next possession. `FootballFootPlant` adds bounded support-foot correction after
animation. Athlete height uses bind-pose mesh bounds, so adding an animation
cannot change model scale. `ArenaBuild` validates the imported toe/ball distance,
passing continuity, receiving boundaries and existing entry choreography.
`review-football-performance.mjs before|after` captures the actual compiled
Unity model in entry, running and three strike poses. It changes only local
presentation clocks; server results and settlement remain authoritative.

The cricket graphics pass uses `ArenaCricketGeometry.cs` for an oval ground,
scalloped canopy bays, textured concrete, sight screens, boundary rope, mowing
stripes and a separately generated worn wicket. `CricketPlayerDetails.cs` adds
team-colour kits, navy batting helmets, fielding caps, ribbed white pads, gloves and shaped
bats. Equipment is positioned after animation in world metres and batched by
material; close grass has a distance LOD. Cricket lighting and camera changes
are scoped to cricket. `ArenaBroadcastDetails.cs` adds the umpire's hat, basketball
court markings and furniture, tennis furniture and Formula track/car details.
`CricketBroadcast.tsx` displays revealed runs, balls, innings and chase target in
a responsive television-style score strip. Scores, events and innings still
come from server state; the six-ball format does not simulate wickets.

The authenticated `/virtual-sports` routes now use the main PostgreSQL wallet.
Migration `0049_virtual_sports_shared_wallet.sql` stores rounds and funded bets
alongside the shared ledger. Stakes and payouts commit atomically, requests are
idempotent per account, and the background engine recovers unsettled rounds.
Amounts in the UI/API are rupees; ledger amounts and payout calculations use
integer paise. `/refill` is disabled in the main app. Historical SQLite practice
coins remain separate and are never converted into wallet funds. The standalone
`sports:dev` preview retains explicitly labelled practice mode.

The isolated database check is
`SHARED_WALLET_INTEGRATION=1 node --import tsx --test src/services/__tests__/virtualSportsSharedWallet.integration.test.ts`
from `artifacts/api-server`, with `DATABASE_URL` ending in `_shared_wallet_test`.
It checks all five sports, cross-game competing debits, retry, rejected bets,
background payout, exact paise and admission delayed beyond the cutoff.

`refine-cricket-kit.py` smooths the existing cricket shirt and its shoulder
weights, exports only the cricket FBX, and retains its UV0 and three LODs. Run
`validate-human-fbx.py` after it. Build with `npm run sports:unity:build`, copy
the player with `node tools/sports-assets/copy-unity-build.mjs`, then run
`node tools/sports-assets/review-cricket.mjs` against the local sports server.
That review captures actual Unity WebGL cameras, bowling/batting, both innings,
quality settings, mobile layouts and switching away from/back to cricket in
`tmp/unity-sports/cricket-review`. These are original Unity graphics; no
Frostbite SDK or third-party game footage is used.

The football matchday pass uses `FootballPresentation.cs` for a server-clock
walkout, referee lineup, taking positions and kickoff during the existing
20-second pre-match window. Late joins and the next round sample the same
timeline; kickoff and settlement timing are unchanged. All four football
fixtures receive the entrance and a themed stadium. Match result cameras
remain selectable, and revealed goal shots are explicitly labelled as replays.

`fetch-stadium-materials.mjs` downloads original 1K photographed concrete and
metal surfaces from Poly Haven, checks their source MD5, and records SHA-256
and CC0 provenance. The stadium itself is authored geometry with a double-sided
canopy, three seating tiers, hospitality glazing, dugouts and a hollow tunnel.
Crowd positions use physical arc-length spacing to avoid the old sparse areas
on straight stands. The spectator atlas is still generated artwork, and the
athletes are original CC0-derived characters, not real player scans.

`refine-football-kit.py` is the earlier matchday pipeline. The current football
asset is produced by `upgrade-football-player.py`, which also retains the
original generic Kick action for the other sports. Run `validate-human-fbx.py`
after export. `ArenaBuild` also checks continuous entrance paths, kickoff
positions, match phases and pitch bounds before building. Actual runtime
screenshots and clock/venue/camera checks are produced by
`node tools/sports-assets/review-football-matchday.mjs` (port 5198 by default).
`capture-football-entrance.mjs` verifies a continuously advancing pre-match
clock and saves a canvas recording. Recording introduces GPU readback/encoding
overhead; use `benchmark-unity.mjs` without capture for performance comparisons.

The website now supports the Unity WebGL project at `artifacts/unity-sports`.
Build it with `npm run sports:unity:build`, then run `npm run sports:build`.
Only a successful build publishes `/unity-sports/ready.json`; the React page
uses this manifest to enable the Unity iframe for all five sports. The detailed
setup, asset provenance, current visual limitations and validation status are
in `artifacts/unity-sports/SETUP.txt`.

`upgrade-unity-human.py` is the base Unity character pipeline. It combines
the CC0 Vitruvian face/eyes with the existing weighted sports body, repairs the
jersey binding, bakes albedo/normal atlases and exports three LOD meshes with
three materials each. Its six authored/retargeted clips remain the shared
baseline; the football upgrade above adds the captured `Pass` clip and replaces
the football surfaces. Run it with Blender 4.2 using `--python-exit-code 1`; inspect the result
with `preview-human.py` before building. `archive-legacy-human.ps1` moves older
generated textures/materials outside Unity Resources into the local cache.
`export-unity.py` remains the earlier source export. `ArenaBuild.cs` creates the URP scene,
materials, mesh resources and WebGL player. The iframe receives only revealed
match state; it has no wallet or betting authority.

Run `validate-human-fbx.py` with Blender before the Unity build. It reimports
both exported FBXs, checks all six LOD meshes have exactly one UV channel and
samples the jersey atlas to catch missing/replaced UV data. Blender viewport
previews alone are insufficient: Blender can select a different render UV
channel from the UV0 used by Unity. Copy UV values before removing UV layers;
Blender layer references can change as earlier layers are removed.

`review-unity.mjs` loads actual WebAssembly and captures all five sports plus
camera and mobile views. `check-unity-live.mjs` checks the integrated local
website without placing bets. `test-unity-bridge.mjs` uses a fixture solely to
check message isolation and lifecycle; it is not a graphics test.

`benchmark-unity.mjs before|after` records actual GL-submitting frames, draw
calls, triangles, GPU identity and canvas resolution at a fixed desktop size.
Use `UNITY_REVIEW_URL` for the isolated preview and `ARENA_QUALITIES=auto,high,balanced`
to exercise all modes. Headless timings are local comparisons, not a guarantee
for every browser/device. Auto caps the initial render at 1280x720 equivalent,
then adjusts pixel count using Unity frame timings with hysteresis; the visible
game screen retains its full size. High allows 1600x900 equivalent. Distant
players use simpler meshes and reduced animation evaluation rates. Hidden or
offscreen scenes stop camera rendering; match clocks/results continue on the server.

The legacy Three.js football renderer uses a separate player rig and stadium
from the other four sports. It remains available when no Unity build is
installed. This is an original browser match simulation inspired by televised
football, not an EA/FIFA game or a recording of a real match.

`prepare-football.py` runs in Blender 4.2. Its inputs are cached at
`.cache/football-pro/soccer-player-source.glb` and
`.cache/football-pro/animations/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb`.
The CC0 source pages and licenses are recorded in
`artifacts/3d-game/src/components/virtual-sports/assets/CREDITS.txt`.
The player comes from Innerscene/MakeHuman and the locomotion clips from
Quaternius Universal Animation Library Standard. The pipeline reduces the mesh,
builds a 21-bone rig, binds body and kit, retargets world-space bone directions,
adds football kick/celebration actions, and exports `football-player.glb`.

`prepare-athlete.py` builds the earlier athlete used by cricket, basketball
and tennis. Football changes do not require rebuilding that asset.

`football-fans.png` was generated with built-in `image_gen`. The exact prompt,
original generated path and transparency settings are in
`assets/football-fans-provenance.json` beside the image. The renderer samples
the 16 cells directly; no raster editing or external runtime hosting is needed.

Validation:

```text
npm run sports:check
npm run sports:build
node --test tools/sports-assets/football-motion.test.mjs
npm run sports:test:browser -- --grep "all five 3D"
```

`FootballMotion.ts` generates only presentation positions. Server state still
owns results, scores, odds, wagers and settlement. The main app uses the shared
INR wallet; the standalone practice app uses virtual coins. Goal replays
begin only after a goal has been revealed and are labelled as replays. All
model and texture URLs are bundled into both the practice app and main app.
High quality enables player shadows and close-camera grass geometry; balanced
quality reduces crowd density and disables those effects.
