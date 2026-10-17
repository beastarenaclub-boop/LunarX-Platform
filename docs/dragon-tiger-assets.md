# Zara studio assets

Created for Dragon Tiger on 2026-09-30. Zara is an original fictional adult AI dealer.

- Still generator: built-in `image_gen` tool; no CLI fallback.
- Original: `artifacts/3d-game/src/assets/dragon-tiger/zara-studio.png`.
- Web poster: `artifacts/3d-game/src/assets/dragon-tiger/zara-studio-poster.jpg` (same image, JPEG encoding at quality 86).
- Invitation edit: built-in `image_gen`, preserving the studio and changing only the hand pose.
- Invitation original: `artifacts/3d-game/src/assets/dragon-tiger/zara-invitation.png`.
- Invitation web asset: `artifacts/3d-game/src/assets/dragon-tiger/zara-invitation.jpg` (JPEG quality 86, 229,347 bytes).
- Retired animation: `artifacts/3d-game/src/assets/dragon-tiger/zara-idle.mp4`, Higgsfield Seedance 2.5 job `5190e92a-50c2-423c-84ea-77ccba8063a6`. No longer imported or downloaded: its breathing/expression was too pronounced.
- Retired photo rig: `zara-foreground.png`, `zara-invitation.jpg` and `zara-studio-empty.jpg`. These historical assets are not imported by the dealer.
- Current playback: Seedance 2.5 generated video at 1080p/high bitrate, using the original resting studio as both first and last image reference.
- Takes: `zara-hd-idle.mp4` (8 seconds), `zara-hd-invite.mp4` (8 seconds, native Hindi speech), `zara-hd-dragon.mp4`, `zara-hd-tiger.mp4`, and `zara-hd-both.mp4` (4 seconds each).
- The HD originals are generated HEVC video, converted to H.264 High level 4.1, yuv420p, CRF 18, slow preset, GOP 48 and MP4 fast-start. No resolution upscaling or synthetic frame interpolation. Non-speaking clips have no audio.
- The two-hand source unexpectedly contained two decorative card backs on the felt. Only those stationary table regions were cleaned with FFmpeg `delogo` at `(794,762,130,50)` and `(985,762,135,50)` before encoding. No face, hand or body pixels are synthesized by the player. The application draws the actual cards from the server result.
- All five web files were checked with FFprobe and Chromium at 1920 × 1080, 24 fps. Sizes: idle 2,416,709 bytes; invite 3,190,028; Dragon 1,502,989; Tiger 1,545,143; both 1,451,783. Silent takes contain no audio stream; the invitation retains its generated AAC track.
- Exact prompts, generation job IDs, requested durations and audio settings: [zara-hd-video.prompts.json](../artifacts/3d-game/src/assets/dragon-tiger/zara-hd-video.prompts.json).
- Web encoding uses the Windows essentials FFmpeg build linked from [FFmpeg's download page](https://ffmpeg.org/download.html). The download was checked against the publisher's SHA-256.
- The dealer rests during the displayed server result, without a winner hand gesture; she does not choose or change cards or outcomes.
- Audible invitation: `zara-invitation-voice.mp3` (162,628 bytes), extracted from the existing invitation film; no new speech generation. FFmpeg filter `loudnorm=I=-16:TP=-1.5:LRA=7`, mono 44.1 kHz, MP3 160 kbps. Decoded duration 8.05 seconds. Mean level improved from -24.4 to -19.0 dBFS. The browser plays this through its unlocked AudioContext while the video stays muted to avoid mobile audible-autoplay rejection.

## Final image prompt

Use case: photorealistic-natural.
Asset type: original dealer-and-studio background asset for a responsive Dragon Tiger browser game, no UI.
Primary request: create a completely new fictional adult female casino dealer named Zara in a completely new luxurious Dragon Tiger studio.
Scene: a refined private Asian-inspired casino studio, midnight teal lacquer walls, symmetrical softly illuminated bronze dragon relief on the left and tiger relief on the right, warm gold architectural light strips and a circular bronze inset behind the dealer. Elegant, sophisticated, uncluttered, no crowds. Deep emerald felt card table across the entire lower third, with a slim brushed-brass rear rail.
Subject: an original adult South Asian woman around 30, distinct oval face, medium warm brown skin, straight shoulder-length dark hair neatly tucked behind one ear, calm natural welcoming smile. Tailored black high-collar dealer jacket with understated gold piping and ivory shirt; fully clothed professional uniform, no bow tie, no burgundy waistcoat. Seated facing camera, shoulders relaxed, both natural hands gently resting near the BACK edge of the felt.
Composition: 16:9 landscape, straight locked camera, premium photographic realism. Entire head and shoulders remain in the CENTRAL 30 percent of frame, generous headroom. Crown at 10% image height, eyes at 25%, hands around 62%. Keep the lower 32% as CLEAN EMPTY FELT for game cards and controls overlaid by code. All essential person content must survive a centered narrow phone crop. Dealer is pleasantly medium-sized, not extreme closeup. Symmetry with tasteful depth.
Lighting: soft flattering key on face, gentle warm rim lights, atmospheric teal-and-gold studio.
Constraints: no text, logos, letters, watermark, UI, playing cards, dice, chips, drinks or objects on the felt. Correct anatomy, five fingers on each hand. Generate a polished production asset, not a webpage mockup.

## Retired animation prompt

A seamless six-second idle loop of this fictional adult professional casino dealer seated in this exact Dragon Tiger studio. Preserve her exact identity, black and gold uniform, anatomy, backdrop and table. Tripod camera completely locked, no zoom, pan, reframing or cuts. She makes two natural soft blinks, breathes very subtly and gives a tiny relaxed smile, then returns exactly to the first frame. Both hands remain gently resting together at the rear edge of the table. No arm gestures, no dealing action, no cards, dice, chips or other objects appear. The empty felt stays empty. The dragon and tiger reliefs and architectural lights stay perfectly still. No speech or audio. Natural restrained lifelike movement only.

## Retired invitation image prompt

Use case: identity-preserve. Edit this exact photograph as one subtle invitation pose for a Dragon Tiger casino dealer in a browser game. Keep the woman's exact face, identity, closed gentle neutral smile, eye direction, head position, torso, shoulders, hair, black/gold jacket, image framing, dimensions, studio, backdrop, dragon left, tiger right, lighting and empty table PIXEL-ALIGNED with the source as closely as possible. Change ONLY her forearms and hands: elbows stay resting at the table, forearms separate a little, her right hand (viewer left) and left hand (viewer right) each gently present their respective side with relaxed open palms turned slightly upward, at table height. Both hands remain close to her body and inside the central 34 percent of the image so mobile cropping retains them; do not reach far sideways or toward the viewer. Natural subtle professional inviting hand pose, exactly five anatomically correct fingers per hand, fingers relaxed together. No chest movement, no exaggerated smile, no open mouth, no new objects, no cards, no chips, no text, no watermark. Preserve all of the clean empty felt in the bottom third for game UI. Single photorealistic landscape image matching the source aspect ratio, not a collage.

## Retired foreground-layer prompt (built-in imagegen)

Use case: precise-object-edit. Edit target: the supplied Dragon Tiger dealer studio photograph. Create a production PNG foreground layer by removing ALL background and table pixels, leaving ONLY the exact seated woman including her hair, black-and-gold jacket, sleeves, both wrists, and both open hands. Preserve her exact face, expression, identity, every hand and finger, pose, clothing, lighting and image coordinates unchanged. The background, architectural lights, circular wall medallion, dragon, tiger, table, brass table rail and empty felt must all become genuinely TRANSPARENT alpha. No checkerboard painted into the pixels, no solid-color background, no shadow outside the woman. Preserve fine hair edges. Keep the original 1672 by 941 landscape canvas and the woman's original size and placement: head around x 840 y 60, elbows x 560 and 1100 y 590, open hands around x 690 and 985 y 625. Do not crop or enlarge the subject. Clean natural photographed silhouette, no outline or glow. The lower central jacket should end exactly behind the old table edge; no new lower body. This will be composited over the original studio while animating only her hands.

## Retired stationary-background prompt (built-in imagegen)

Use case: precise-object-edit. Edit target: this exact Dragon Tiger casino studio photograph. Remove the woman COMPLETELY, including all hair, body, clothing, forearms, hands and their shadows. Reconstruct only the studio and table that were behind her: a centered circular bronze wall medallion and dark teal panel, symmetric warm gold vertical architectural lighting, distant rear ledge, and clean continuous emerald felt table. The thin straight horizontal brass rear edge of the felt must continue perfectly straight across the FULL image at exactly its existing height around y=630 of the 941-pixel image. Preserve every already-visible part of the original studio, left dragon relief, right tiger relief, perspective, lighting, camera framing, table texture, and dimensions 1672 by 941. This is a stationary clean background plate, to place the dealer cutout back over. No people, hands, limbs, shadows of people, playing cards, chips, new props, writing, logos, added decorations, or watermark. Keep lower third clean empty teal felt. Do not move or curve the table edge.

