# Riya: native HD Teen Patti dealer

The current dealer is Riya, a fictional adult aged 28, wearing a burgundy satin
waistcoat and black top in a warmly lit casino studio. This is an AI performance,
not a live camera. The UI identifies her as an animated dealer.

## Runtime and source files

- `riya-hd-studio.mp4`: silent 1920 x 1080, 24 fps, H.264 CRF 18, fast-start MP4.
  One persistent player covers waiting and all three paired card turns.
- `riya-hd-betting.jpg`, `riya-hd-opening.jpg`, `riya-hd-result.jpg`: matching
  native-resolution fallback frames for waiting, opening, and completed hands.
- `riya-hd-media.json`: dimensions, cue boundaries, photographed card corners,
  and the static registration used to align the continuation.
- `riya-paired-source.mp4`: native 1080p original; retain frames 0 through 248.
- `riya-inner-pair-source.mp4`: native 1080p continuation, 97 frames. Its first
  frame references the original at 10.375 seconds. Retain the whole continuation.
- `riya-six-reference.png`: the exact six-card reference used for generation.
- `riya-generation.json`: generation prompts, parameters, job IDs and estimates.

The runtime film is 346 frames (14.4167 seconds). Only the four runtime media
files are imported into the application; no Higgsfield connection, credentials,
credits, or remote generation are needed to play the game.

## Build the media

From repository root, with Python, OpenCV, NumPy and FFmpeg/imageio-ffmpeg:

```sh
python artifacts/3d-game/scripts/prepare-teen-patti-hd.py \
  artifacts/3d-game/src/assets/teenpatti/riya-paired-source.mp4 \
  artifacts/3d-game/src/assets/teenpatti \
  5.5 14.3333333333 \
  artifacts/3d-game/src/assets/teenpatti/riya-inner-pair-source.mp4 10.375
```

The packager removes only the six prop backs from the waiting segment using
nearby photographed felt. Its assertions protect pixels outside those patches.
This lets the existing side shoe deal six backs without duplicate cards below.
The continuation receives one fixed spatial registration to match the original
room and table. There is no optical-flow interpolation, frame blending,
hand retiming, moving face replacement, or runtime blur filter. Natural motion
softness and small AI-generated imperfections may still be visible.

## Game integration and synchronization

`dealerFilm.ts` uses a 864 x 486 layout world, independent of the HD video.
Waiting loops forward before 5.4167 seconds; opening starts at 5.5 seconds.
The natural opening lasts 8.8333 seconds inside the existing 9-second server
reveal window. Betting remains 20 seconds. Late joins skip forward at 1x speed.

The turn order is A1/B3, A2/B2, A3/B1. Measured lift and landing cues drive the
recorded card sounds; both fingers must clear a pair before flat ink appears.
`PhysicalCardFace` projects server-supplied card artwork onto photographed paper.
The source video has blank card faces and never chooses a rank, payout or winner.
The winner appears only after all six cards; media failure cannot delay settlement.

`FilmedTeenPattiTable` imports the video and three matching posters. The camera
keeps the full dealer and both hands visible across desktop and narrow phones.
Readable card faces open below the film. Chip presets, custom amounts, instant
bets, audio controls, and wallet/server rules keep their existing behavior.

## Generation provenance

Higgsfield project: `7f600058-f772-42fb-8acd-aa3ca4688b7e`, 2026-09-30.

Paired source job: `83f28a5a-201b-445b-af73-a3a629ea7665`.
Continuation job: `c236157d-918b-4b4e-b913-c4af1358b727`.
Six-card reference job: `df6a7868-935e-4abf-9f03-e70495509dcb`.

Earlier test/full/repair takes were reviewed and rejected for inaccurate card
handling; they are not runtime assets. Request estimates total 530.75 credits.
Observed account balance changed from 9000.14 to 8427.39 during the work session;
that 572.75 difference is an account observation, not an itemized charge receipt.

## Verification

Run the application TypeScript check and a Linux Docker web build. Run
`tests/teen-patti-studio.spec.ts` plus the Teen Patti cases in
`tests/table-personalization.spec.ts` against the resulting preview.
Tests mock API, WebSocket, wallet and bets; they never place real wagers.
The suite covers native resolution, moving hands, empty felt during lifted cards,
six separate final cards, cue order, recorded audio, late joins, media failures,
reduced motion, hidden tabs, and tappable mobile bet/coin controls.

Verified 2026-09-30: TypeScript and Docker web builds passed. All 24 selected
Teen Patti browser cases passed across the full run and corrected-test rerun;
seven media/audio/responsive cases passed again against the final build.
Desktop and 320/390-pixel phone screenshots were reviewed. The deployed web
image and all four served media SHA-256 hashes were checked against the preview
and source files. No real bets or wallet writes were used in validation.
