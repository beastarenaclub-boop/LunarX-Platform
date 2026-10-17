# Hand clarity and full-width dealer

The hand-sampling change was first shipped in `naina-clean-hands.mp4`.
The current runtime uses `maya-natural-studio.mp4`, documented in
[NATURAL-STUDIO.md](NATURAL-STUDIO.md), with the same sampling and framing.
Both are 864 × 496, 24 fps, 361 frames, with six seconds of waiting and the
same six-card timing.

The arm retiming in `scripts/prepare-teen-patti-turns.py` selects one complete
source frame per hand. It no longer warps and blends two fingertip/card images
with optical flow. Sampling rounds down, so a paper landing cannot occur
before the existing source-time cue. The head/body interpolation, waiting
eyes, middle-card spatial repairs, card values and audio cues are unchanged.

The earlier Naina reproduction used `maya-eyes-table.mp4` as the master and `maya-six-cards.mp4`
for ungraded wrist pixels. The script accepts an `FFMPEG` executable override.
The existing 361 Naina face patches from `recast-teen-patti-face.mjs` were
overlaid at (375, 20), using the same H.264 CRF 17 encoding and fast-start flag.
The current Maya restoration does not use those face patches; production
needs only its final MP4 and matching posters, all imported by the application.

This removes additional temporal blending of the hands. Motion softness
already photographed/generated in a source exposure remains; this is not
a newly recorded high-resolution performance or an AI reconstruction.

The camera keeps the film at full table width during betting, opening and
result. It adds vertical room for the six readable cards instead of shrinking
the dealer above them. Tests verify the film width, visible head/hands,
six-card sequence, middle-card positions, sounds and mobile bet controls.
