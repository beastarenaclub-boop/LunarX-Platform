# Runtime asset sources

The audience uses the **Eric 001, Carla 001 and Claudia 002** scanned, rigged
people from [Renderpeople's free downloads](https://renderpeople.com/free-3d-people/).
The jockey uses Eric's scanned head with the existing CC0 racewear body.
The scans were posed, simplified and converted locally by
`tools/horse-assets/prepare-scanned-crowd.py` and `prepare-jockey-scan.py`.

Renderpeople's [terms](https://renderpeople.com/general-terms-and-conditions/)
permit use in games, including commercial games, but prohibit redistribution
as standalone models or an asset/template pack. These are **not CC0 assets**.
Keep `Assets/Resources/Horse/Crowd/`, `Horse/JockeyScan.fbx` and
`Horse/Textures/Jockey-scanned-face.png` in the licensed working project.
Distribute the compiled game. Do not include those source assets in a public
Unity template ZIP. Another developer can obtain the same free downloads from
Renderpeople and run the preparation scripts with Blender 4.2.

Revision 4 replaces the horse with [Grab3D's Bay Horse](https://grab3d.com/models/animals/horse/),
published under CC0 on 2026-09-28. The source is AI-assisted (Meshy base mesh and
textures, cleaned and checked in Blender), not a scan of a real animal.
The 731,120-triangle source was simplified locally to 31,997 triangles while
retaining its UVs and PBR textures. The runtime uses a 4096px coat map and
2048px normal/roughness maps. The exact license is in
`Assets/Resources/Horse/BAY-HORSE-LICENSE.txt`.

The replacement 56-bone horse rig and source Run/Walk animations come from
[afk-rig 0.1.2 / Mesh2Motion](https://afk.ai/developers), whose skeletons and
animations are CC0. Joint placement was corrected against cross sections of
this mesh, skin weights were fitted and smoothed, UV-seam twins were welded
and Run was retimed to the game's visual gait clock. The standing Idle and
tail motion were authored locally to preserve the mesh's rest posture.
This does not change race progress,
server results or betting. The scripts are `prepare-bay-horse.py`,
`rig-bay-horse.mjs` and `export-bay-horse.py` in `tools/horse-assets/`.
The animation license is `Assets/Resources/Horse/HORSE-ANIMATIONS-LICENSE.md`.

Clothing and environment provenance is recorded in
`Assets/Resources/Horse/SOURCE-CREDITS.md`; that historical document describes
the old Chad M horse and older web renderers, which revision 4 no longer uses
for the active horse mesh.

Warhorse Lite by Literock Studios was downloaded for evaluation and rejected
because its medieval armour and canter animation do not suit this racing game.
It is not included in the Unity scene or distributed game.

The source import and review work does not train an AI model or create a dataset.

The trackside trees use [Poly Haven's Island Tree 01](https://polyhaven.com/a/island_tree_01)
by Rob Tuytel and Rico Cilliers (CC0). Revision 4 rebuilds the canopy as 5,521
complete leaf cards, restores the author's separate opacity map and keeps
the trunk/branches at lower detail (21,315 total triangles per tree). Distant
leaf shading uses upward canopy normals. Reproduction: `prepare-tree-canopy.mjs`
and `export-tree-canopy.py`; cached source records: `.cache/horse-v4/tree-source.json`.
