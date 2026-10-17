# Persistent dealer playback

The master and camera changes below are superseded by
[EYES-AND-CARD-DIRECTION.md](EYES-AND-CARD-DIRECTION.md). The persistent player,
decoded-frame timing and seek bridge remain in use.

The Teen Patti runtime now follows Lucky 7's persistent-player approach.
`maya-continuous-table.mp4` contains the first 62 forward frames of the
existing betting take, followed by the complete nine-second opening take.
It is H.264, 864 x 496, 24 fps. Rebuild with
`scripts/prepare-teen-patti-continuous.mjs` and an installed FFmpeg.
The original assets remain production sources; the runtime imports only
the combined master. No new identity or generated performance was used.

Betting repeats the forward waiting segment at 1x. The two final waiting
frames are a seek guard. The former backwards half and separate fading
player are removed. A 2D captured-frame bridge holds the displayed picture
while seeking, then retires on a valid decoded frame without a face/hand
crossfade. Canvas and video-frame callbacks are optional enhancements;
unsupported media still has the existing poster/authoritative-result path.

During a normal nine-second reveal, the first 450ms move the camera into
position while retaining the waiting pose and six card backs. The complete
8.125-second opening action then plays at 1x. Card ink and sounds consume
`requestVideoFrameCallback` media times, adjusted by 62/24 seconds to the
original measured cue timeline. Short windows and late joins seek to the
appropriate remaining action instead of speeding up the hands. Reconnects
discard old sound cues. Hidden tabs pause and resume against the deadline.
All six cards and the winner still settle by the server deadline.

These are improvements to playback and transitions. The two source takes
retain their photographed poses, and the original generated opening
performance has not been replaced or given newly synthesized hand motion.
