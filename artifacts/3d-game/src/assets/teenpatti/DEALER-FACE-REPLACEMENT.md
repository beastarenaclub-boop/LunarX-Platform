# Naina dealer face

The current fictional adult dealer has a new face across the waiting video,
card-opening video, opening fallback, betting fallback and result image.
The recorded body and six-card handling come from the previously repaired
Maya take. This is a face composite, not a newly filmed hand performance.

Runtime assets:

- `naina-alternating-turns.mp4`: 864 x 496, 24fps, 361 frames, silent.
- `naina-betting-poster.jpg`: the new face on the fixed waiting pose.
- `naina-opening-poster.jpg`: first frame of the opening segment.
- `naina-result.jpg`: the matching final, face-up card pose.

`dealer-face-reference.png` is the edited identity reference produced with
the **built-in imagegen tool**, from `maya-eyes-poster.jpg`, on 2026-09-28.
The original generated file was copied into this asset directory; production
does not depend on the Codex image output directory or an external image URL.

## Final image prompt

Use case: precise-object-edit. Asset type: photorealistic dealer identity
reference for an existing Teen Patti browser game. Edit the supplied image:
replace ONLY the woman's face with a clearly different fictional adult Indian
female casino dealer, about 30 years old, softly rounded oval face, elegant
straight nose, naturally shaped fuller lips, gentle closed-mouth professional
smile, almond dark-brown eyes, softly arched eyebrows, subtle natural
casino-presenter makeup, realistic skin texture. Maintain a warm medium-brown
complexion matching her existing neck and hands. This must be recognizably a
different face, not just a retouch of the original. Keep the head at precisely
the same size, position, frontal angle and silhouette. Keep the existing neatly
tied dark hair and center part, her ears, the white shirt, black bow tie,
charcoal waistcoat, arms, hands, navy table and entire room identical. Direct
gaze at the viewer. Do not add objects, jewelry, words, watermarks, cards, motion
blur or extra people. Same wide composition and source image proportions.
Match existing warm room light, lens softness and photographic texture; avoid
beauty-filter/plastic skin. This is the edit target, not a style reference.
Output a single finished image.

## Video processing

Run `node scripts/recast-teen-patti-face.mjs render` from `artifacts/3d-game`.
The script uses local Chromium, FFmpeg, and MediaPipe Face Landmarker 1.0.1 to
track the source head, gaze and eyelids, then rasterizes the new facial texture
with a dense triangular mesh. Recorded inner-mouth detail is retained when
the original mouth opens. A feathered face boundary and skin color matching
join the new face to the original hair, ears and neck.

Authoring dependencies are pinned and cached locally before Chromium starts.
The compositor writes a lossless 140 x 170 head patch for every frame; FFmpeg
overlays that PNG sequence onto the original video at (375, 20). This keeps
the original body/card frames and avoids streaming full images into the encoder.

Video SHA-256:
`66ef0bfb4d09669d0d9a1a316d00afc7a0853cd23f1ac539d20ccabd29c1c0be`.

The first 144 frames freeze everything outside the eye regions. The opening
frames assert byte-identical body/card pixels below the face before encoding.
The source is `maya-alternating-turns.mp4`; the old media and reference images
remain available for reproduction. All card values still come from the server.
The compositor and landmark model run only during asset authoring; the game
downloads a normal MP4 and JPEGs, with no face model or tracking code at runtime.

Authoring API reference:
https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

## Validation

The 12 media/runtime checks passed in development, including alternating hands,
middle-card landing, eye-only waiting, sound, failure handling and five screen
sizes. The desktop result check initially timed out during a page navigation;
the same full six-card sequence passed against the deployed production build,
along with the mobile fallback check. The served MP4 matches the SHA-256 above.
