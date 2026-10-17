# Eye-only betting and fixed card direction

Current runtime assets: `maya-eyes-table.mp4` and `maya-eyes-poster.jpg`.
The six-second waiting segment fixes the head, mouth, body, hands and room
to frame 28 of the existing betting source. Only two feathered eye patches
retain recorded gaze and eyelid motion. The rigid facial landmarks are
registered before compositing, so head motion cannot move the eye patches.
One forward eye performance is surrounded by quiet pauses. There are no
reversed frames or new generated identity/performance.

`scripts/prepare-teen-patti-eyes.py` is the reproducible OpenCV/FFmpeg pipeline.
Its raw-frame assertion verifies zero changed pixels outside the two eye
regions. The encoded browser regression separately measures eye motion and
less than one intensity level of average change everywhere else. The
unchanged opening take follows at media time 6 seconds; all opening cues use
time relative to that offset. The file remains 864 x 496 at 24 fps.

The old ink cues coincided with first contact with the table, while several
cards were still angled or under fingertips. `DEALER_FILM.printAfter` now
separates a flat, unobstructed face from its earlier contact-sound cue. The
fixed four-corner paper projection is only shown after that measured frame.
The source hand performance itself is unchanged.

Auto camera stays at the same hand-table angle through settlement. Its
transform, card order and card orientation do not change at the result.
Settlement displays the photographed final pose in that same source world,
so a late-join seek cannot put revealed ink over an older card-back frame.
The Cards button still provides an explicitly selected overhead view.
Regression coverage compares opening/result matrices at 320, 390, 844 and
1440 pixels and checks that no printed face precedes its flat-paper cue.

Processed master:
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/3fa49c49-be84-4f65-8ccd-aeb3c0d6c532.mp4

Poster:
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/dfc86876-7c7d-49cc-897c-a61c10fb66c9.jpg
