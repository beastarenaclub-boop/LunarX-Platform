# Horse Racing asset provenance

The current WebGL renderer uses textured CC0 horse and human meshes, PBR terrain,
authored skeletal motion, and a modeled audience. See [realistic/CREDITS.md](realistic/CREDITS.md)
for the current assets and their sources.

The historical artwork below was generated through the user's connected
Higgsfield account on 2026-10-01. It remains in portraits and the compatibility
renderer. Prompts requested fictional racecourses and generated adult jockeys.

## Compatibility characters and portraits (v3)

Eight separately generated photographic horses and adult riders, guided by the user's equestrian reference: natural anatomy, helmet and riding vest, breeches and boots, reins and quilted saddle pads. Each has its own standing image (GPT Image 2.5) and six-second isolated gallop source (Seedance 2.5).

| Runner | Standing source | Gallop source |
| --- | --- | --- |
| 1 | `9a9c520d-32a6-4fcd-81de-64de8530788d` | `a33f1131-ecf0-4054-a7cb-19d073772d2f` |
| 2 | `34c62c8a-7bb8-4b95-8df8-f33365dcb286` | `8a807080-7c08-4c37-a73d-40e6a28df56b` |
| 3 | `877c5ee4-be55-409c-b9e9-8402910123b6` | `33601410-9894-4ced-b40b-3c3fc76883dd` |
| 4 | `613fc098-ceee-4569-9af2-3d78f966cbf0` | `e6ade299-16ad-42bd-b784-f0b90a9e5fc6` |
| 5 | `a2b28128-d00d-4250-811b-f3005889feaa` | `3fa17589-a6e2-4f6f-baf9-cd1eb29885b3` |
| 6 | `eeaed04b-abed-4622-9814-e6adb3e908bd` | `821225e2-a549-4fef-9320-73a393c83dc8` |
| 7 | `94a905ea-8b45-4bc0-b6aa-27eb77bc1a52` | `bffa6199-b88c-4962-98cc-11ed730b849c` |
| 8 | `2fc4b077-d9e1-45cf-9419-eead524fcfe6` | `9e64ca42-9b57-4df6-a2ff-a84dcab7438c` |

`characters-v3/` contains keyed WebP standing poses, matching portraits and individual 24fps animation atlases. Desktop frames are 640×480 and mobile frames 320×240. The manifest stores each cycle's dimensions, muzzle positions and ground anchor. Native coat, skin and clothing colours are retained without runtime recolouring. The source clips are processed offline; they are not played as race videos. The processing script is `tmp/build-horse-characters.mjs`.

## Original assets and retained audio / courses

The original shared sprite and old portraits below are historical assets, replaced in the current renderer by v3 characters. Existing sound and course plates remain in use.

- Source horse image: `35adfb84-29cf-49ec-b524-d23328be29cd` (GPT Image 2.5).
- One six-second side-view gallop: `39f5d288-78d3-4c0b-8887-227f953c1ec8` (Seedance 2.5).
- Original atlas: source frames 77–93 at 24fps, green keyed out and spill reduced. Runtime coat/silk variants have been superseded by the individual v3 characters.
- `hooves.mp3`: native audio from the source gallop.
- `crowd.mp3`: native stadium audio from the earlier Royal Park race asset.
- Royal track: `c79f7304-c21f-4e26-9e86-edd6d418dae8`.
- Dubai track: `80c4d103-882e-428f-a921-1a87d6156e8d`.
- Alpine track: `271db432-fdbe-4b75-a187-e2867d53dc34`.
- Coast track: `6c780731-45b8-473d-a680-bcba0658cdea`.
- Night track: `a0dbd3bb-9e4f-426d-b8ce-1dbb124586ba`.
- Marathon track: `b2b3d461-c8fe-43b0-a33b-018a495c4ac8`.
- Portraits reuse the generated runner assets from `artifacts/horse-riding/public/assets/racing/higgsfield/`.

Track plates use GPT Image 2.5. Everything is bundled locally. No live generation or whole-race video playback is used in the game.
