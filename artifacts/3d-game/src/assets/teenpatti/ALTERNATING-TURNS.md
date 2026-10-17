# Alternating dealer turns

The current runtime uses `maya-natural-studio.mp4`, with the
[original dealer and studio colors restored](NATURAL-STUDIO.md). The turn
timing and middle-card repairs below are unchanged; see
[Hand clarity](HAND-CLARITY.md) for the single-exposure hand sampling.

`maya-alternating-turns.mp4` re-edits the existing photographic performance
into six alternating turns: A1, B3, A3, B1, A2, B2. Each turnover is shorter,
with the opposite hand waiting on its next card. Approaches and retractions
can overlap; the six main turnovers happen separately. The original
simultaneous outside/inside/middle pair presentation is no longer imported.

This is an edit of the existing generated take, not a newly generated dealer
or a new finger/grip performance. A [middle-card repair](MIDDLE-CARD-REPAIR.md)
redirects the photographed hand and paper together so both middle cards
return to their own slots. No mirrored limbs or backwards action were introduced.

`scripts/prepare-teen-patti-turns.py` is the reproducible OpenCV/FFmpeg pipeline.
It keeps the six-second eye-only waiting segment, then samples the arm/table
regions independently from monotonically increasing source times. A single
image supplies the head and face. Feathered joins sit in the central vest
and empty felt. Optical-flow interpolation is confined to the head/body;
each hand now uses one complete source exposure. Blended optical-flow hand
predictions produced soft or doubled finger edges during fast turns.
Output remains H.264, 864 x 496, 24 fps, 361 frames, silent.

The earlier rectangular vest grade had also tinted wrists gray when they
crossed its boundary. A feathered skin mask restores those pixels from the
corresponding ungraded source frames before retiming. It is restricted to
the forearms, excluding the accepted vest/felt colors and card surfaces.

The runtime plays the edited file forward at 1x. `dealerTurnTiming.ts` stores
the same source/edit maps; measured lift, contact and face-print cues map to
the first encoded frame reaching them. All six authoritative values, the
customer view and recorded card sounds follow these remapped cues. The
eight-and-one-eighth-second action window and server deadline are unchanged.
Both arm maps meet the original 8.5s final pose, so the existing result poster
and physical paper geometry remain valid.

The browser suite verifies the new media itself: during A's first turn the
B hand remains still; during B's next turn the A hand waits. Runtime capture
checks the six distinct A/B reveal cues, no premature winner, twelve card
sounds, eye-only betting, media failure, tab resume and narrow-screen framing.

Input master:
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/3fa49c49-be84-4f65-8ccd-aeb3c0d6c532.mp4

Original ungraded opening used for wrist color:
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/332c5c58-2d92-4cbe-972e-35b98700ff3d.mp4

Edited master with repaired middle-card landings (media 8c8de8b5-45dd-482d-ae1a-95d86a6eb7e9):
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/8c8de8b5-45dd-482d-ae1a-95d86a6eb7e9.mp4

Middle-card contact sheet:
https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/5cb3871f-6317-4849-90ff-cee3df379836.jpg

No generation credits were spent for this edit. Table design, readable card
sizes, eye-only waiting, shuffle, 20-second betting and music controls retain
their previous behavior.
