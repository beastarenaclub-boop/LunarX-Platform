# Betting expressions and individual-card shuffle

The separate-player runtime below is superseded by
[DEALER-MOVEMENT.md](DEALER-MOVEMENT.md). This file records source preparation;
the current player uses only its forward waiting frames.

Requested revision: restore the existing dealer's expressions throughout
betting and replace the two wobbling packs with a visible card shuffle.

`maya-betting-idle.mp4` reuses the calm end of the original fictional dealer
performance, starting at 7.25 seconds. Its 62 frames run forward and back
(excluding duplicate endpoints), giving a 122-frame loop at 24 fps. This
retains the same mild expression, blinks and small changes of gaze without
switching between reaction clips. No new identity or generated performance
was commissioned. `maya-betting-poster.jpg` is the fallback from this clip.

Source performance:
https://d8j0ntlcm91z4.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/hf_20260927_133108_b9fefa40-abe4-4af7-b475-e2780b09c625.mp4

Processed media: `34a9d0ca-8f3d-442d-9f2e-748ecf818c6e`.
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/34a9d0ca-8f3d-442d-9f2e-748ecf818c6e.mp4

The original prop cards are removed from each video frame using adjacent
unobstructed felt texture and feathered edges. Felt and waistcoat receive the
same navy/charcoal grade as the opening clip. Processing used OpenCV and
FFmpeg in the Higgsfield media sandbox; output is bundled locally as H.264,
864 x 496. There are no runtime remote media requests.

During betting, this separate muted player loops continuously. It pauses on
reveal, hidden tabs, the Cards camera, route departure and reduced motion.
The six-card opening player keeps its existing server deadline and cues.

`ShuffleShoe.tsx` is a rendered automatic shuffler, not filmed hand shuffling.
It has two feed hoppers and 52 individually animated sheets which interleave
into the receiving tray, square and load into the deal outlet. Its close-up
and table view reuse the exact same SVG mechanism and timing. The close-up
disappears after the shuffle. The six dealt cards leave this outlet during
the last 4.2 seconds of the unchanged 20-second betting window.

Browser coverage measures changed face pixels in decoded video, checks that
the idle player stays active after shuffling and pauses during reveal and
backgrounding, and verifies that all 52 sheets reach the output deck before
the six-card deal. Existing audio, deadline and media-failure checks remain.
