# Horse Racing: cinematic course graphics

## Pack close-up and direction correction (2026-10-03)

Close-up now frames the entire field; no horse is hidden to isolate a runner.
The winner is identified without removing the other seven runners. Individual
follow controls are removed, and field cards open the pack view. The compatibility
renderer follows the same rule. New visits and obsolete Front/Realistic saved
preferences start on Close-up; other supported camera preferences persist.

The source photograph is aligned to each horse's track tangent instead of
turning toward the camera. Supported cameras stay beside the field, including
an elevated following Grandstand view; camera changes use broadcast cuts.
Framing includes all eight actual horse bounds. Horse/rider proportions use a
4.25 by 3.1875 metre image plane, giving roughly 1.7 metre withers and 3 metre
mounted height in the supplied image. Contact shadows and number markers are
reduced with the horse rather than keeping their previous oversized dimensions.
The compact winner badge sits at the top beside the fullscreen control so the
finish view leaves the pack's legs visible.

Front is visibly unavailable and excluded from keyboard/Auto cycling. The
previous head-on camera incorrectly displayed side-profile cutouts. Generating
a matching head-on source through Higgsfield was rejected with "Out of credits"
before any generation job was submitted. A matching front-facing animated asset
is still required to enable a valid Front view; this change does not reconstruct
unseen anatomy or restore the old low-detail skeletal horse.
The existing clips generated from the supplied horse reference were also checked;
they all request a locked side profile and provide no matching frontal animation.

Validation: TypeScript and the production build pass. Browser checks cover all
eight runners through bends, the winner/reset sequence, WebGL loss, and every
available camera on desktop and mobile. Screenshots confirm the full pack and
the compact finish badge. The deployment verifies its entry and 56 asset hashes.

## Previous always-realistic revision (superseded camera behavior)


Every camera now uses the horse and rider from the user's share
https://higgsfield.ai/s/aU-or7QgYp8. Broadcast, Rail-side, Front, Grandstand,
Close-up and Auto remain available, along with individual runner selection,
keyboard cycling and the automatic winner close-up. Rail-side is the default;
the previous saved Realistic selection migrates to Rail-side. Other saved
camera preferences are preserved.

The share contains a six-second green-screen video, not a 3D model. A keyed
19-frame gallop atlas and the original standing image render as upright cutouts
on the existing course. Front changes the course viewpoint but still displays
the supplied horse's side profile. True front/back appearance requires matching
front/back source footage; it cannot be recovered from this single view.

Horse and rider GLBs are no longer loaded or rendered. The same local WebP pair
also supplies selection portraits and the Canvas compatibility view after
WebGL loss. No camera or graphics fallback restores the old skeletal horses.
Archived mesh files remain in the asset pack for reproducibility. If the shared
artwork cannot load in either renderer, the user gets a Retry state.

The atlas advances from the live race clock with separate phases and strides.
Each frame's muzzle anchor is placed at the server-driven track position;
winner selection and round reset follow the same live plan. Number markers and
coloured saddle pads identify all eight instances of the supplied horse/rider.
This does not create eight different horses or people. Contact shadows and
screen bounds follow the displayed cutout, including during camera changes.

The roughly 390 KB texture pair is shared by all runners, with no video elements
or per-runner video decoders. Prepare using
`tools/horse-assets/prepare-shared-horse.py` from the cached source video and
standing reference. Source IDs, frame/ground anchors and credits are retained in
`realistic/shared-horse/manifest.json` and `realistic/CREDITS.md`.

Front framing includes the full width of each cutout. Close-up/winner shots
hide an intervening finish support while it would cover the featured horse,
then restore it in field views. A minimum track-panel height prevents the
size-contained landscape layout from collapsing; this rule is scoped to Horse
Racing and preserves its 16:9 image and all six camera controls.

Validation: the frontend TypeScript check and production build pass. Eleven
distinct browser scenarios passed across the targeted runs, covering all camera
options, saved camera migration/persistence, no old horse/rider model requests,
independent gallop frames, selectable runners, exact winner/round reset,
WebGL-loss compatibility, six venues, frame/geometry budgets, and layouts from
320 to 1920 pixels including fullscreen. The broad responsive check exposed a
zero-height landscape panel; a measured CSS fix resolves it and the responsive
check passes. These checks validate integration, not true front/back footage or
GTA-level fidelity.

The final responsive/fullscreen and desktop/mobile photographic-horse run passed
all three scenarios after the layout fix. Deployment verifies the exact entry
and 55 file hashes, including the current advertising assets. The deployed
browser smoke check verifies the photographic horse, no old horse/rider model
loads, all camera controls, and both legacy redirects without monetary requests.
A concurrent container recreation interrupted the first asset copy; the current
release was backed up and compared before applying the tested update.

## Smooth racing revision (2026-10-02)

`smooth-racing-v5` fixes frame pacing and reduces the work needed while all eight
horses gallop. The previous strict 16.667 ms / 33.333 ms gate discarded valid
animation callbacks. Rendering now follows each display callback, while the
server's race clock still determines progress, muzzle crossing and the winner.

The fixed rider pose is baked into a 20,157-triangle mesh instead of skinning
107,113 triangles through an unused 52-bone rig. Clothing patterns, skin variants,
helmets and the existing rider bounce remain. Matching rigid materials are
batched. Field cameras use a 15,607-triangle horse with the same skeleton and UVs;
close-up and winner cameras retain the original 37,160-triangle horse. The field
mesh passes a 62-frame Idle/Gallop deformation audit, and the renderer checks its
joint order before sharing the animated skeleton.

Broadcast rendering bypasses the extra HDR/occlusion pass. Optional long-lens
blur is retained on desktop when the rendering budget permits. Shadows use a
1024 map and the horse/rider silhouette, omitting subpixel equipment and the
distant stadium from the moving shadow pass. Static scenery matrices are cached;
14,239 spectators are divided into culled sectors. Hidden runners no longer
animate or emit dust in close-up shots, and reins/hoof queries update only the
required bone ancestry. Sustained slow rendering reduces pixel density in two
steps (to 85%, then 70%), without reducing animation frequency. The browser no
longer preserves an extra drawing buffer.

Read-only mocked-race measurements on this machine (Intel Iris Xe, Chrome,
8-second samples after warmup):

| Full-field rail view | Previous | Optimized |
| --- | ---: | ---: |
| Desktop rendered frames/second | 15.2 | 52.3 |
| Desktop 95th percentile frame interval | 87.4 ms | 30.2 ms |
| Desktop triangles, including shadows | 2,906,053 | 859,562 |
| Desktop draw calls | 771 | 397 |
| Mobile viewport rendered frames/second | 13.8 | 59.5 |

These are headless browser measurements on the same desktop GPU, not a guarantee
for physical phones. Raw results and review screenshots are in
`test-results/horse-baseline-performance.json` and `horse-lod-performance.json`.
Reproduce with Node 22.18+ using `tools/horse-assets/benchmark-race.cjs`, setting
`HORSE_GAME_URL`, `BENCH_LABEL` and optionally `PLAYWRIGHT_CHROMIUM_PATH`. The
benchmark mocks every account/race endpoint and rejects non-GET API requests.

`horse-performance.spec.ts` verifies that a simulated second consumes at least
50 animation ticks on both layouts, the field stays below 450 draws and one
million triangles, all eight runners/audience/boards remain, and close-up
switches back to the detailed horse. This checks scheduler and geometry
regressions independently of machine-specific measured FPS.

New versioned assets and source derivations are in `realistic/performance/`;
the previous detailed assets remain available. The release stages only compiled
graphics imports, the performance asset folder and its credits/manifest, with
the player entry verified equivalent after normalizing generated bundle hashes.

Validation: TypeScript and the production build passed. All nine production
browser scenarios passed without retries (2.6 minutes), including the two new
performance regressions, all six mobile venues, eight selectable riders,
responsive/fullscreen cameras, finish/winner/reset and WebGL fallback. An early
development-server run was interrupted by a public-asset hot reload; the complete
suite was then run against the fixed production build. The local deployment
verified its entry and 51 SHA-256 file hashes, including live advertising assets.
The deployed repeat (`test-results/horse-live-smooth-performance.json`) measured
45.6 fps desktop / 52.4 fps mobile viewport in the full-field view, with 29.6 ms /
28.1 ms 95th-percentile frame intervals. All four ad images loaded, all spectators
remained and no page errors were reported. Variation between runs reflects the
shared desktop's GPU load; the measured improvement is roughly 3–4 times the
previous full-race frame rate, not a universal locked-60-fps claim.

## Tailored riders and horse coat detail (2026-10-02)

`racewear-detail-v4` gives the eight jockeys complete coordinated riding gear:
smoothed continuous silk shirts/sleeves, separate fitted finger gloves, breeches,
tall leather boots, collars/cuffs, boot soles/heels/buckles, helmets and goggles.
Silks use eight continuous patterns (chevrons, sash, diamonds, epaulets/hoop,
centre stripe, quarters and double hoops), keeping each runner's existing UI
colour. Skin tones and modest jaw proportions vary over the shared licensed human
base model. These are styled instances of the CC0 Vitruvian/CharMorph rider, not
eight newly scanned people. The 52-bone mounted rig and hand/foot contacts stay.

`realistic/racewear/jockey-racewear-v2.glb` is prepared with
`tools/horse-assets/prepare-racewear-v2.py`. Cloth is smoothed then reduced for
the game. Boots and gloves use leather shading; the silks retain cloth normal
detail. Accessories merge into three draws per rider, and the curved English
saddle, leather flaps, girth and metal hardware merge into two draws per horse.

`realistic/racewear/thoroughbred-coat-v2.png` is a built-in image_gen edit of the
CC0 source horse UV texture. It replaces the mottled body with groomed brown
short-coat detail, preserving the anatomical layout for recolouring across the
field. The original anatomical normal map and generated fine-coat grain remain.
The exact edit prompt/source is in `racewear/provenance.json`; the generated
texture is not a calibrated skin scan or a new 3D horse model.

Both horse markings and outfit patterns now use a cached per-vertex rest-space
attribute sampled with the skinning matrices applied. Imported mesh matrices
alone did not account for the GLB bind transform: this corrects misplaced hoof,
sock and facial masks while retaining frame-by-frame animation. The current
horse geometry, muzzle timing, live race plan and dirt/stadium/advertising remain
compatible. Review images for all eight outfits are
`test-results/horse-racewear-runner-1.png` through `runner-8.png`.

Validation: TypeScript, the production build and all seven browser scenarios
passed without retries. Coverage includes eight selectable players, asset/shader
loading, six mobile venues, responsive/fullscreen views, camera persistence,
winner framing/reset and WebGL fallback. Local deployment verified its entry
and 47 SHA-256 file hashes, including the preserved live advertising config and
artwork. This verifies the tested desktop/browser mobile layouts, not all devices
or a fidelity match to a large-budget reference game.

The final deployed preview over `127.0.0.1:5174` loaded all four advertising
images and all eight outfits with no browser/shader errors (767 draw calls and
about 2.91 million rendered triangles in the sampled full-field view). An earlier
cold preview via localhost repeated the pre-existing two-artwork timeout and
connection resets; the repeat preview passed. No ad configuration was overwritten.

## Horses and granular dirt (2026-10-02)

`horse-earth-v3` loads `realistic/earth/thoroughbred-v2.glb`, a further refinement
of the same CC0 horse with a tapered throat/neck, defined shoulder and leaner
hindquarter. Its UVs, 23-bone rig and Idle/Gallop timing are retained. The coat
shader now converts source mesh coordinates to scaled horse rest coordinates:
leg, muzzle and facial markings previously used incompatible source units.
Eight subdued natural coats retain fine source texture, anatomical normal maps,
short-coat bump detail, dark horn hooves, lower-leg dirt and restrained sheen.
Mane alpha coverage and eye roughness are also refined.

The generated `earth/racing-loam-v1.png` replaces the dirt track's previous
surface. Two rotated sampling scales, irregular compaction, shallow harrow
relief and matching shading normals break up repetition. Physical clods and
hoof impressions are split into eight culled sectors: 3,200 of each on desktop,
1,200 of each on phones. This is granular racecourse soil; Alpine keeps its turf.
Hoof dust and ballistic clods emit from the four animated hoof contacts, remain
in world space, and reset when the venue or race clock changes. There are at most
320 dust and 320 clod particles on desktop, 192 of each on mobile.

Source attribution, the exact built-in image_gen prompt and asset roles are in
`realistic/earth/provenance.json` and `realistic/CREDITS.md`. The texture is
generated artwork with shader-derived relief, not a calibrated material scan;
the horse is an edited mesh rather than a scanned real horse. Reproduce with
`tools/horse-assets/refine-racehorse-v2.py` and review the staged output in
`.cache/horse-earth/` before copying the versioned GLB into the public assets.
The stored animation audit checks finite vertices, floor clearance and constant
bone lengths across all 62 Idle/Gallop frames.

The graphics changes are confined to the lazy renderer and its local assets.
The normalized player entry is identical to the previous deployment. Release
staging backs up the entry and metadata, retains the older meshes, and records
the live advertising artwork/configuration without replacing those files.

Validation: TypeScript and the production Vite build passed. All seven browser
scenarios passed in one run without retries: asset/shader rendering, mobile at
six venues, responsive layouts/fullscreen, eight selectable close-ups, camera
persistence, exact winner framing/round reset and WebGL fallback. No shader
errors were reported. Local deployment verified the exact production entry and
43 SHA-256 file hashes, including unchanged live advertising files. Browser
previews use mocked race data and send no monetary requests. These checks cover
the tested desktop/browser mobile layouts, not every physical device or fidelity
equivalent to filmed horses.

The deployed visual smoke check passed on reload with all four ad images,
145 hoardings, 42 ground ads and no browser/shader errors. On the first cold
load, two ad artwork requests hit the existing timeout and displayed their
neutral fallback. Final close-up, grey-horse, rail, broadcast and stadium views
are saved under `test-results/horse-earth-*.png`.

## Stadium advertising (2026-10-02)

The stadium now has 145 double-sided physical hoardings and 42 ground sponsor
graphics with replaceable artwork: inner/outer rail panels, grandstand fascia,
infield billboards, elevated bend screens, entrance-road boards and a finish-line
sponsor board. Paved service lanes and rear entrance roads carry additional
painted logos. Broadcast and Rail-side framing includes more of the advertising
backdrop. Four independent placement groups
load campaigns from a public JSON file, with optional venue and date selection.
The sample YOUR BRAND artwork is bundled locally. See
[Stadium advertising](horse-stadium-advertising.md) for sizes and publishing.

Campaigns refresh every minute without rebuilding the app. Image/configuration
failures leave neutral branding in place and do not block racing. The player
entry remains unchanged after normalizing compiled graphics chunk references.

## Full stadium and audience (2026-10-02)

`stadium-audience-v2` replaces both earlier stand implementations with one complete
racecourse seating bowl in all six venues. Two deep grandstands have lower and
upper seating decks, stair aisles, access portals, concourses, pitched metal
canopies with triangular trusses, hospitality balconies and textured glazed bays.
Rear elevations have four floors of window bays, cornices and entrance canopies.
Royal and Marathon have octagonal lantern pavilions and spires. Open stepped
terraces follow both bends, with planting beds and floodlight masts around them.
Grandstand camera now provides a fixed overview of the entire stadium and course;
the other cameras continue to follow the race.

The seating contains 14,239 individually positioned spectators across four GPU
batches. Fourteen usable photographic cutouts from a generated atlas provide
varied adult faces, outfits, hats, binoculars and cheering poses. Each spectator
has independent scale, tint and subtle sway, disabled by reduced-motion preference.
These are camera-facing textured cutouts with individual depth positions, not
fully rigged 3D human bodies. They replace the previous repeated row photographs
and sparse single-character crowd. The audience density is preserved on phones.

`realistic/stadium/` contains `spectators-atlas-v1.png` and
`hospitality-facade-v1.png`, generated with the built-in image_gen tool. The full
prompts and usage details are in `provenance.json` in that folder. Geometry is
authored in `raceStadium3d.ts` and the audience renderer is `stadiumAudience3d.ts`.
All assets load locally. This is an authored racecourse inspired by the reference,
not an exact surveyed reconstruction of Churchill Downs.

Validation: TypeScript and the production Vite build passed. Seven browser
scenarios passed across the initial run and a focused rerun: desktop assets and
shaders, mobile rendering in all six venues, responsive layouts and fullscreen,
runner selection, camera persistence, winner framing/reset and WebGL fallback.
The initial run had a test-clock pause race and a layout timeout; both passed
unchanged in isolation. The local deployment matches the staged entry and all
27 asset hashes. Its player entry is unchanged after normalizing compiled asset
references. Vite reports the existing sourcemap, mixed-import and bundle-size
warnings. These checks cover rendering and integration, not every device's FPS.
The final rear-facade detail pass was checked separately in the deployed wide
view and race cameras; it does not change crowd placement or camera behavior.

## Derby broadcast revision (2026-10-02)

The `derby-broadcast-v1` renderer uses the supplied Kentucky Derby 2023 YouTube
reference as direction for a dirt-racing presentation. The reference thumbnail
was inspected directly; full video playback did not load and the remote scene
analysis remained queued. The source footage is not bundled.

Royal Park now has a harrowed dirt circuit, a flatter perimeter and long,
volumetric grandstand galleries with pavilion spires. Generated spectator rows
sit on stepped upper terraces; the existing individual 3D spectators remain in
the lower stands. Architecture uses instancing and crowd strips are merged into
two meshes. Alpine retains turf; the other courses use dirt. Crowd artwork and
its full generation prompt are bundled in `realistic/derby/provenance.json`.

The separate `derby/jockey-crouch-v1.glb` lowers the rider's torso and hands into
a tighter racing seat, while retaining the existing CC0 character and skinning.
`tools/horse-assets/prepare-derby-rider.py` reproduces it from the prepared Blender
source. Coats have restrained natural colours, dark leg/muzzle points and finer
hair detail. Jockey movement follows the gallop cadence and the reins update
after the rider's motion. Broadcast and rail cameras use longer lenses; the
front camera frames the field, and Close-up gives a more side-on horse portrait.
Only selected runners show floating number markers during wide shots.

Opening strides gradually narrow lateral spacing, keeping distinct lanes. Race
progress, results and crossing times remain authoritative. Instanced translucent
dust and ballistic dirt clods trail the visible horses; turf gets a lighter
spray. Mobile uses half the particle count. These are browser-rendered graphics
improvements using the existing horse mesh, not photographic footage or an exact
recreation of Churchill Downs.

Validation: the frontend TypeScript check and production build passed. All seven
production-browser scenarios passed: desktop and native mobile asset/shader
rendering across six venues, 320–1920px layouts and fullscreen, all runner
close-ups, camera switching/persistence, the exact first-finisher shot/reset,
and context-loss fallback. The local deployment matches the staged entry and
all 24 asset hashes. The player entry is identical to its previous version after
normalizing compiled asset references. Vite emitted its existing large-bundle,
mixed-import and UI sourcemap warnings; the build completed successfully.

## Earlier asset and environment revisions

The `higgsfield-thoroughbred-v1` revision uses a Higgsfield-generated
thoroughbred reference to refine the existing animated horse's torso, flank and
hoof proportions. A generated short-coat tile adds subtle color and bump detail
over the existing normal map; markings and per-runner colors are preserved.
The horse is an edited CC0 mesh with the existing 23-bone rig and Idle/Gallop
clips, not a new AI-generated 3D mesh. The reference image is included for review
but is not loaded by the game. Generation IDs are recorded in the asset pack's
`higgsfield/provenance.json`. All runtime assets are served locally.

The cinematic-course-v3 renderer adds a directional sun with a matching procedural
sky, soft cloud layers, venue-specific haze, and a separate HDR environment for
material reflections. Horses have less glossy coats with stronger normal detail.
One depth-buffer postprocessing pass supplies short-range contact occlusion on
desktop, restrained lens falloff, and background focus in Close-up/winner views.
Wide views remain sharp. Mobile skips contact occlusion and uses a lower pixel
ratio; the existing 30fps phone and 60fps desktop caps remain.

Ground now combines photographed PBR maps with variation in world space, subtle
mowing bands, rolling perimeter terrain and instanced grass along the rails.
Distant trees use two transparent renders of the full-resolution CC0 tree instead
of a heavily decimated leaf canopy. Upright GPU-instanced cards keep the source
leaf silhouettes while avoiding thousands of leaf triangles per tree. They are
background scenery rather than fully volumetric close-up trees. Sky, terrain and
foliage stay local and do not require external services.

These changes improve this browser scene; they do not provide GTA V asset quality
or turn the racing game into an open-world game. The current horse refinement
preserves the existing authored gallop. Race timing, outcomes, bets and wallet
code are unchanged.

The main game at `/horse-racing` now loads a textured, skinned horse and an
anatomical human rider with skin, face, fingers and cloth detail. It replaces
the earlier smoothed ROME horse and primitive jockey. Each runner has independent
animation and coat/silk colors. Tack follows the animated head; the camera tracks
the subject's translation before smoothing its viewing angle, keeping fast
runners inside the close-up frame.

The racing-form-v2 assets correct the source mane/tail binding, stabilize torso
weights, slim the horse's barrel and use four additional hoof controls for a
planted/extension/recovery gallop. Jockeys now use a low racing crouch, full
weighted sleeves, satin silks, goggles and raised stirrups. Horse materials keep
facial/leg markings while removing the source pinto patches from dyed coats.
These are improvements to the existing mesh; the result does not match the
photographic fidelity of the supplied real-race photos.

The Front camera tracks the approaching field from a low angle. Close-up and
winner cameras use a longer lens and depth-buffer-based background blur with
one scene render. The background blur rejects nearer samples to protect the
horse silhouette. All racing positions and winner timing still come from the
same shared race plan. Alpine uses turf; the Derby revision switches Royal to dirt,
woodland, occupied seating and alpha-tested tree foliage.

The venue scene includes a seated human crowd rendered with instancing, a reduced
textured tree, photographed soil/grass/rock maps, and an outdoor HDR environment.
Meshes and textures are served locally. This is real-time browser 3D; it is not a
photoreal video or an exact reproduction of the user's reference game.

Existing 20-second betting windows, shared automatic races, server-selected
results, locked betting after the start, wallet, auto-bet, sound, location
selection and first-finisher winner shot remain in place. If WebGL is lost, the
compatibility renderer preserves the current live round and winner.

## Source and preparation

See `artifacts/3d-game/public/assets/horse-racing/realistic/CREDITS.md`.
The Blender 4.2 scripts in `tools/horse-assets/` run from the repository root.
Source assets are downloaded into `.cache/horse-realism/` and output GLBs go to
`artifacts/3d-game/public/assets/horse-racing/realistic/`.

1. Download the source files listed by `download-sources.mjs` using Node 20+.
2. Run `prepare-horse.py` with `riggedHorse.blend` open in background mode.
3. Run `prepare-rider.py` in an empty background Blender session.
4. Run `prepare-crowd.py` with `.cache/horse-realism/prepared-rider.blend` open.
5. Run `prepare-tree.py` in an empty background Blender session.
6. Run `render-tree-impostors.py` for the runtime distant-tree cards. It renders
   the original full-resolution tree with Cycles, 24 samples, transparent PNGs
   at 768px. Keep the original tree GLB for the earlier asset pack.
7. Run `refine-thoroughbred.py` with `prepared-horse.blend` open. It stages the
   refined GLB and a 62-frame geometry/bone-length validation report in
   `.cache/horse-higgsfield/`. Review before copying the GLB into
   `realistic/higgsfield/thoroughbred-v1.glb`; retain `racehorse.glb` as the earlier
   asset revision. The generated texture and reference are already bundled.

Use `--disable-autoexec` for all downloaded Blender files. Existing GLBs are
already bundled; Blender is not needed to build or run the app.

## Verification

The Higgsfield-assisted revision passed TypeScript, the production Vite build,
and four production-browser scenarios covering desktop/front/close-up rendering,
native mobile rendering across six venues, exact winner framing/round reset,
and WebGL-loss fallback. No shader errors were reported. Asset preparation
validated finite geometry and constant bone lengths across 62 animation frames.
The deployed player entry matches the previous entry after normalizing compiled
asset references; changes remain inside the lazy graphics bundle. These checks
verify rendering and race integration, not photoreal fidelity or every device.
Deployment verified all 20 asset hashes and the exact production entry. A browser
smoke check confirmed the new model, live UI and both legacy redirects without
submitting monetary requests. The first smoke attempt hit a local navigation
timeout; rerunning with a 60-second navigation allowance completed successfully.

The cinematic-course-v3 production build passed the frontend TypeScript check
and seven browser scenarios: desktop and native mobile rendering, all six venues,
shader compilation, context-loss fallback, exact winner framing, camera persistence,
and 320–1920px layouts/fullscreen. The production entry matches the previous
player entry after normalizing compiled asset references; gameplay code is unchanged.
The localhost deployment verifies all 16 model/environment asset checksums.

Type-check `artifacts/3d-game/tsconfig.json` and build the Vite app. Browser checks
are `horse-game.spec.ts`, `horse-live.spec.ts`, `horse-finish.spec.ts` and
`horse-realism.spec.ts`. They cover camera/venue controls, desktop/mobile sizing,
shared rounds, stake handling, automatic betting, winner framing, context loss,
and loading the textured character/environment assets.

The racing-form-v2 update passed TypeScript and production build checks. Six
targeted browser scenarios passed across the production suite and a focused
fallback rerun: responsive/venue controls, selectable runners, camera persistence,
winner framing, context loss, and asset/front-camera rendering. The fallback test
now pauses the race clock while compatibility artwork decodes, avoiding a test
that accidentally observes the following automatic round.

Deployment verifies the exact staged entry and SHA-256 hashes of all 14 bundled
models/environment assets. Legacy `/horse-riding/` and `/horse-riding/race`
redirect to `/horse-racing`; deployment smoke checks submit no monetary requests.
