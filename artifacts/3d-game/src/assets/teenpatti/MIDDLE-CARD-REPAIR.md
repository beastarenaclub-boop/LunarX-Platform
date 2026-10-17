# Middle-card landing repair

The source performance carried each middle card sideways onto the already
opened outside card, while an invented flat card appeared in the vacated
middle slot. Retiming alone retained this defect.

`scripts/repair-teen-patti-middle.py` corrects the source frames before the
alternating-turn pipeline samples them. A shoulder-anchored displacement
moves the filmed forearm, fingers and held paper together toward the middle.
Measured paper outlines and a refined foreground matte preserve the grip.
Uncovered source pixels restore the stationary outer cards and table rail;
inpainting removes the invented middle face while the real paper is raised.
The flat middle paper returns as the hand lands. The correction joins the
original final pose at source time 8.5 seconds.

This is a spatial repair of the existing performance. The original paper
bends and finger articulation remain; it is not a newly filmed grip. No
card value or round result is baked into the asset. Runtime card overlays,
readable customer cards and audio retain the existing timing maps.

Reproduce with OpenCV, NumPy and FFmpeg:

```sh
python3 scripts/prepare-teen-patti-turns.py input-master.mp4 output original-opening.mp4
```

Input and output provenance is in [ALTERNATING-TURNS.md](ALTERNATING-TURNS.md).
The browser regression decodes the shipped video and checks the lifted
middle-card positions, the empty vacated slot and stationary outside cards.
The pre-repair asset fails this check because the left lifted paper is
centered near x=262 instead of above its middle slot.

Validation on 2026-09-27: all 13 Teen Patti browser tests passed, including
the new middle-card pixel regression, six ordered reveals and sound cues,
eye-only waiting, media failure, background resume and framing at widths
320, 390, 640, 844 and 1440. The repaired media's SHA-256 is
`a360428772447a6d98987c9c0c11f7760a0eb8e6267f72e5c52047ffa7e4fae6`.
