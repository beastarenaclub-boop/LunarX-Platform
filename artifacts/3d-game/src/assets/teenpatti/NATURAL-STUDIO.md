# Natural studio restoration

The runtime now uses the original moving Maya dealer, with the photographed
burgundy waistcoat, white shirt, green felt and warm casino room. The Naina
face composite and charcoal/navy recoloring are no longer displayed.

Runtime files:

- `maya-natural-studio.mp4`
- `maya-natural-betting.jpg`
- `maya-natural-opening.jpg`
- `maya-natural-result.jpg`

Rebuild with `scripts/prepare-teen-patti-natural.py` from the repository root.
It uses `maya-cards.mp4` for the recorded waiting eyes/pose and
`maya-six-cards.mp4` for the opening. Waiting prop cards are removed with
adjacent photographed felt texture. The existing registered eye-only waiting
and alternating hand pipeline retain the six-second lead-in and all six
server card/sound cues, including the middle-card repairs and single-exposure
hand sampling from [HAND-CLARITY.md](HAND-CLARITY.md).

Authoring intermediates use lossless H.264 (`TP_AUTHOR_CRF=0`); the final
MP4 uses CRF 16, 24 fps, 864 × 496 and fast-start. Posters come from frames
0, 144 and 348 of the same final grading pass. No facial texture is composited
over the original performance. The fixed luminance curve raises midtones
without clipping the highlights. A bounded spatial detail pass stays within
local pixel extrema to avoid bright sharpening halos. No temporal smoothing
or extra hand-frame blending is introduced.

The scene's dark overlay is removed. Readout panels and the optional overhead
table use matching green tones. Full-width dealer framing, mobile bet controls,
game outcomes, betting duration and payout logic are unchanged.

This restores the source colors and performance; it is not a newly generated
1080p/4K take. The original clip's motion softness and background depth of field
remain. No paid video generation was submitted for this restoration.
