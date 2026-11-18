# Tower Rush visual assets

## Realism revision v3

The repeated low-detail city meshes are replaced by
`public/media/tower-rush/site-photographic-v3.webp` (relative to the game).
Six photographic facade skins add authentic shutters, curtains, glazing,
brickwork, carved stone and clock details to the 3D blocks. Both WebGL and
the lightweight fallback use these skins. Run `prepare_facades.py` to rebuild
them from `source-facades-v3.webp`. Exact built-in imagegen prompts and saved
runtime paths are in `realism-v3-prompts.json`.

New Tower rounds use the [version 2 payout rules](../../docs/tower-rush-rules-v2.md):
19 safe floors, a seed-fixed crash in 20–35, and 0.001× to 1× at floor 30.
Historical rounds retain their original unlimited-floor rules. Only the most
recent twelve floors are rendered. The admin payout cap remains in effect.

The game UI uses React and TypeScript. The lazy-loaded Three.js renderer handles
lighting, shadows, materials, crane sway, falling blocks, impact dust and camera
movement. It does not calculate outcomes or change wallet settlement.

`source-materials.webp` is an atlas generated with the built-in imagegen tool.
The five panels are oak, brick, limestone, corrugated metal and asphalt.
Its original PNG is preserved at the imagegen output location.

Run `python tools/tower-assets/generate_materials.py` with Pillow installed to
rebuild the 256px WebP albedo/roughness maps, PNG normal maps, dust sprite and
clock face in `artifacts/3d-game/public/media/tower-rush/materials`.
Normals and roughness are approximate detail maps derived from the same image,
not calibrated scans. If the atlas is absent, deterministic procedural materials
are generated with seed 777.

Generation prompt:

> Create a technical PBR diffuse texture atlas, wide landscape exactly five equal vertical rectangular panels side by side, zero margins zero gutters, no text or labels. Each panel occupies exactly 20 percent of image width. Left to right: (1) aged honey oak horizontal wooden planks, fine wood grain, subtle scratches and narrow seams; (2) old warm terracotta red brick wall, alternating rows, grey-beige mortar, realistic porous brick surface; (3) pale warm limestone masonry with fine mineral speckles and small weathering, rectangular stone blocks; (4) weathered painted silver-grey corrugated metal with subtle fine scratches, shallow vertical ridges, minimal rust; (5) dark grey asphalt close-up, fine granular pebbles, no road markings. All five are physically believable photorealistic close-up MATERIAL SURFACES, flat orthographic front view, evenly illuminated neutral diffuse light, no cast shadows, no lighting gradient, no perspective, no objects, no scenery. Surface detail rather than decorative patterns. Panels align exactly edge to edge for software cropping, crisp natural material detail throughout.

The renderer merges static building geometry by material, instances the distant
city, limits pixel ratio to 1.25 on narrow canvases / 1.5 otherwise, and lowers it
to 1 under sustained low frame rate. It stops rendering when hidden, respects
reduced motion and retains the vector scene if WebGL is unavailable or lost.

Verification: from `artifacts/3d-game`, run
`playwright test --config playwright.tower-3d.config.ts`.
The config uses Chrome on Windows or Playwright Chromium elsewhere; set
`PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_BASE_URL` to override.
Headless software GPU timing is diagnostic, not a physical phone benchmark.
