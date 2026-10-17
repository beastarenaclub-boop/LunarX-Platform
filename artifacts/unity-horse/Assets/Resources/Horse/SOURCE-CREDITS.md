# Textured 3D racing assets

## User-supplied Higgsfield horse film (2026-10-02)

The `shared-horse/` standing image and gallop atlas derive from the user's exact
share: https://higgsfield.ai/s/aU-or7QgYp8 . The supplied asset is a Seedance video,
job `9e64ca42-9b57-4df6-a2ff-a84dcab7438c`, with source image job
`2fc4b077-d9e1-45cf-9419-eead524fcfe6`. These generated assets are not CC0 source
meshes. They are used in every race camera and the compatibility renderer, with keyed
background, spill reduction and saddle-pad colour variants. The same horse and
rider appearance is shared by all eight runners; numbers identify each runner.

`tools/horse-assets/prepare-shared-horse.py` uses NumPy and ffmpeg to prepare a
19-frame, 24fps loop and a standing pose, preserving the original horse/rider.
The runtime uses two local WebP textures, not video playback. The manifest records
source IDs, loop selection and muzzle/ground anchors. This is a side-profile
cutout, not a rigged GLB or newly reconstructed 3D model.

The following horse/rider meshes are archived for reproducibility and are no
longer loaded by the race renderer. Environment meshes and surface maps remain
in use. There is no remote generation at runtime.

## Live race performance meshes (2026-10-02)

`performance/jockey-mounted-v3.glb` derives from the same CC0 Vitruvian / CharMorph
racewear model below. Its existing fixed mounted pose is baked into plain meshes,
with head/hand attachment transforms and clothing UVs retained. Race-distance
topology reduces 107,113 triangles to 20,157. Jockey bounce, the eight silk patterns
and individual styling remain runtime animation/shading. Reproduce with
`tools/horse-assets/prepare-racewear-performance.py`; provenance and counts are
in `performance/provenance.json`.

`performance/thoroughbred-field-v3.glb` derives from the same CC0 v2 horse, with
15,607 triangles for field cameras. The original detailed horse remains loaded
for close-up and winner views. Both retain the 23-bone bind pose, UVs and Idle/
Gallop clips; all 62 animation frames are checked for finite deformation and
floor clearance. Reproduce from `.cache/horse-earth/thoroughbred-v2.blend` with
`tools/horse-assets/prepare-horse-lod.py`; the audit is
`performance/horse-lod-validation.json`. No new third-party assets are used.

## Tailored riders and coat detail (2026-10-02)

`racewear/jockey-racewear-v2.glb` further refines the same CC0 Vitruvian / CharMorph
rider with continuous smoothed race silks, fitted finger gloves, leather boot
materials and breeches folds. It preserves the mounted 52-bone rig and hand/foot
contact locations. Source licenses/attribution remain those documented below.
Reproduce with `tools/horse-assets/prepare-racewear-v2.py`; the audited rig/contact
points are in `racewear/racewear-validation.json`.

`racewear/thoroughbred-coat-v2.png` was edited with built-in image_gen from the
CC0 source HorseMain4k00.png UV texture. The layout is retained while its mottled
body is changed to a groomed brown short coat. The generated edit is not claimed
to be a photograph or part of the original CC0 release. The exact source,
generation prompt and mode are recorded in `racewear/provenance.json`.

Eight garment patterns, skin variations, collars/cuffs, boot details and a curved
English racing saddle with flaps, girth and hardware are authored in the renderer.
The riders share the licensed base human model; they are not eight scanned people.

## Horse and granular earth revision (2026-10-02)

`earth/thoroughbred-v2.glb` is a further local refinement of the CC0 horse below.
It retains the source UVs, 23-bone skeleton and authored Idle/Gallop timing while
tapering the throat/neck and refining the shoulder and hindquarter. Reproduce
with `tools/horse-assets/refine-racehorse-v2.py`; the complete 62-frame deformation
audit is saved in `earth/anatomy-validation.json`. It is an edited 3D mesh, not
a photogrammetry scan or an AI-generated 3D model.

`earth/racing-loam-v1.png` is newly generated artwork from the built-in image_gen
tool. The exact prompt, source and runtime usage are in `earth/provenance.json`.
Colour and shading relief are sampled from the same blended soil texture; this
is not represented as a measured PBR scan. Harrow relief, compacted patches,
instanced hoof impressions and clods are application-authored. Dust now emits
at animated hoof contacts and stays in world space as the horse moves away.

## Complete stadium and audience pack (2026-10-02)

`stadium/spectators-atlas-v1.png` and `stadium/hospitality-facade-v1.png`
were newly generated with the built-in image_gen tool. Prompts and usage are
recorded in `stadium/provenance.json`. They are generated artwork, not licensed
photographs copied from the reference footage or part of the CC0 source assets.
The spectator atlas supplies individual camera-facing cutouts with varied poses.
The facade texture is applied to authored 3D hospitality galleries. All stand,
terrace, stair, railing, truss, roof, pavilion and landscape geometry is authored
in the application. The earlier crowd model and row plate are retained as older
assets but are no longer loaded by the current stadium.

## Derby broadcast pack (2026-10-02)

`derby/jockey-crouch-v1.glb` is a further locally authored mounted pose of the
same CC0 Vitruvian / CharMorph rider described below. Its source license and
attribution are unchanged. `derby/rider-pose.json` records the validated pose;
reproduce with `tools/horse-assets/prepare-derby-rider.py`.

`derby/grandstand-crowd-v1.png` was newly generated with the built-in image_gen
tool for this project. It is a crowd texture used on upper grandstand tiers,
not a photograph from the supplied video and not part of the CC0 source models.
The exact prompt and provenance are in `derby/provenance.json`. The architecture,
track surface shaders, dust and dirt clods are authored in the application.

## Horse — CC0

`racehorse.glb` derives from Lyndon Daniels' Realtime Ranchers horse, rigged by
ChadM. Both source releases designate the asset CC0:

- https://opengameart.org/content/rigged-horse
- https://opengameart.org/content/realtime-ranchers-3d-model-pack
- Source file: https://opengameart.org/sites/default/files/riggedHorse.blend

Local changes: skin bindings for eyes/mane/tail, smooth subdivision, trimmed mane,
PBR coat/normal/hair materials, normalized game scale, and authored Idle/Gallop
skeletal clips. The racing-form-v2 revision corrects reversed mane/tail bindings,
refines torso shape/weights and adds four hoof joints with ground-aware gallop
poses. Individual coats, saddlecloths, helmets, numbers and tack are
assigned or constructed in the game. No ROME horse geometry is used by this renderer.

## Higgsfield-assisted thoroughbred revision

`higgsfield/thoroughbred-v1.glb` refines the same CC0 horse against a new
Higgsfield-generated side-profile reference: narrower torso, tucked flank and
smaller hoof cross-sections. The existing 23-bone rig, skin weights and locally
authored Idle/Gallop animation clips are retained. This is an edited source mesh,
not a generated 3D model. Reproduce with `tools/horse-assets/refine-thoroughbred.py`.

`higgsfield/coat-detail-v1.png` is a generated short-coat surface tile, used for
subtle color variation and secondary bump detail over the anatomical normal map.
`higgsfield/thoroughbred-reference.png` is the shape reference and is not loaded
during gameplay. Both images were generated using `gpt_image_2_5` through
Higgsfield; job IDs and asset provenance are in `higgsfield/provenance.json`.
Generated images are not represented as part of the original CC0 source release.
The reviewed Higgsfield catalog horse was unsuitable and is not bundled.

## Riders and spectators — CC0 character assets

`jockey.glb` and `spectator.glb` derive from the Vitruvian / CharMorph human,
distributed with body, head and textures in Agile Lens' VitruvianGodot project:

- https://github.com/ibrews/VitruvianGodot
- https://github.com/ibrews/VitruvianGodot/blob/main/NOTICE.md
- Vitruvian: Sean Buckley and Olaf Delgado-Friedrichs; CharMorph: Upliner.
- Further original credits: SirMaxim (skin LUT), Upliner (rig), Mindfront
  (eyebrows), J Hill (eye textures).

Only CC0 character geometry and textures are included. Imported Mixamo animation
clips are removed. Mounted and seated poses are authored locally. Original
project code and Godot shaders are not included. Local changes include PBR
materials, attached head/eyes, racing pose, mesh reduction, texture compression,
weighted long racing sleeves, silk panels, and a baked seated crowd LOD for GPU
instancing. The rider now uses a low crouch with raised knees and bent elbows.

## Environment — Poly Haven CC0

- `tree.glb`: Island Tree 01, reduced for trackside instancing.
  https://polyhaven.com/a/island_tree_01
- `tree-canopy-0.png`, `tree-canopy-1.png`: local transparent Cycles renders
  of the full-resolution Island Tree 01. The distant woodland uses upright
  instanced cards to preserve leaf coverage on mobile. Reproduce with
  `tools/horse-assets/render-tree-impostors.py` (24 samples, 768px).
- `raked_dirt-*`: diffuse, OpenGL normal and roughness maps, 1K.
  https://polyhaven.com/a/raked_dirt
- `grass_ground-*`: diffuse, OpenGL normal and roughness maps, 1K.
  https://polyhaven.com/a/grass_ground
- `aerial_rocks_02-*`: diffuse, OpenGL normal and roughness maps, 1K.
  https://polyhaven.com/a/aerial_rocks_02
- `daylight.hdr`: Kloofendal 48d Partly Cloudy, 1K environment lighting.
  https://polyhaven.com/a/kloofendal_48d_partly_cloudy
- License: https://polyhaven.com/license

Preparation scripts live in `tools/horse-assets/`. The runtime keeps all assets
on the application's own origin. Existing sound and compatibility artwork are
documented in the parent `CREDITS.md`.
