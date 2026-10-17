# Navy table and camera pipeline

Current waiting media and result-camera behavior are documented in
[EYES-AND-CARD-DIRECTION.md](EYES-AND-CARD-DIRECTION.md).

The user selected a restyle of the existing dealer. This revision retains her
identity, expression and six-card hand performance. It is an animated dealer,
not a live human camera feed. All media are bundled locally.

## Runtime assets

- `maya-navy-table.mp4`: 864 x 496, 24 fps, nine seconds. The clean master from
  [the six-card take](SIX-CARD-TAKE.md) is colour graded to navy felt and a
  charcoal waistcoat. The face, hands and card-action timing are preserved.
- `maya-navy-poster.jpg`: still at 0.375 seconds, before the opening action.
- `maya-navy-result.jpg`: still at 8.5 seconds, after all six cards are open.
- `maya-betting-idle.mp4` / `maya-betting-poster.jpg`: moving betting
  expressions and matching fallback; see [BETTING-IDLE.md](BETTING-IDLE.md).
- `maya-empty-table.png`: the preceding static clean plate, retained as a
  production source. The moving betting clip now replaces it at runtime.

The graded clip was processed with OpenCV and encoded as H.264 in the existing
Higgsfield sandbox. Media ID: `936d035a-f29b-4c91-be2b-0fd07ead43da`.
Source: https://d2ol7oe51mr4n9.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/936d035a-f29b-4c91-be2b-0fd07ead43da.mp4

## Image edit provenance

Mode: built-in `image_gen.imagegen` tool, using `maya-navy-poster.jpg` as the
reference. Final workspace asset:
`artifacts/3d-game/src/assets/teenpatti/maya-empty-table.png`.

Final prompt:

> Edit this exact game background image. Remove ONLY the six playing cards lying on the navy felt table and seamlessly reconstruct the empty navy felt in those small areas. The entire table must be empty, with no cards, no objects, no text. Preserve the exact adult female dealer identity, face, expression, charcoal waistcoat, ivory sleeves, hands, arm pose, every background object, lighting, table rim, camera, framing and perspective. Keep the same landscape composition and exact aspect ratio. This is a clean plate for an interactive game; do not redesign, beautify, move or add anything else. Photorealistic texture, no smears or patch rectangles.

## Round presentation

The existing 20-second betting window contains a 5.2-second side-tray shuffle
and a six-card deal during its last 4.2 seconds. Cards alternate A/B, leaving
the separate side shoe and reaching the recorded card positions. Recorded
shuffle and placement sounds follow those actions. No result is needed for
this preparation.

Auto camera uses the dealer view for betting, a closer view of the hands for
opening, and a rendered overhead table after all six cards have turned. The
user can select Dealer or Cards manually. Both cameras use the same server
card values and reveal timing; the overhead view includes complete card
faces with corner ranks, suits and pip layouts. Old hands clear on the next
betting phase. The winner remains gated on the last card opening.

## Card dimensions and camera correction

Reviewed the supplied 29.13-second screen recording, including the opening
and result transition. The previous opening view used an independent CSS
zoom with a 66 x 32 rank label stretched across each paper card. The camera
cross-fade could also expose that ink over the overhead view for a few frames.

The film, dealt backs, lettering and printed card faces now share a fixed
864 x 496 source world and one uniform camera transform. The opening camera
fits both outside hands and all six cards at phone, tablet and desktop widths.
Controls and round status occupy separate bars outside the image viewport.

`PhysicalCardFace.tsx` projects the same 66 x 94 artwork used by the overhead
camera onto four measured paper corners. A small SVG mesh approximates the
projective mapping; only ink is drawn, preserving filmed paper, edges and
contact shadows. Faces still follow the existing release cues and server
outcome. The overhead view contains the full card row with uniform scaling.

The result cut now hides the entire film viewport immediately. No old paper
ink can remain over the next camera. Regression coverage checks the shared
transform, both outside hands, all six card bounds, undistorted overhead
cards and exclusive camera visibility at 320, 390, 844 and 1440 pixel widths.
It samples the initial zoom frames too: camera interpolation occurs in root
coordinates before subtracting the viewport inset, avoiding the old temporary
downward jump when the header/footer crop takes effect.

Betting and opening now share the persistent player documented in
[DEALER-MOVEMENT.md](DEALER-MOVEMENT.md). [BETTING-IDLE.md](BETTING-IDLE.md)
documents the earlier source preparation.
Media failure and reduced motion still expose the authoritative outcome by
the reveal deadline. Card sounds discard missed cues after reconnecting.
Casino room ambience and lounge music retain independent controls; see
`../audio/teenpatti/README.md` for sources and licences.
