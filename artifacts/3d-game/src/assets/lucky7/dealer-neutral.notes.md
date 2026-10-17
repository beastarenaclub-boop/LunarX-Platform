# Neutral dealer loop

`dealer-neutral.webm` is derived locally from `dealer-forward.mp4` (the same
fictional adult dealer and camera framing used for the throw).

The resting-hand segment at 4.56–5.00 seconds is sampled every 40 ms, then
played forward and in reverse at 12 fps. The 1280×720 VP8 loop replaces the
separate idle take so idle gestures cannot look like an unscheduled throw.
No additional generated media or external upload was used for this edit.

The throw uses source frames 400–5000 ms. Its palm opens at 2800 ms; the dice
and foreground hand matte follow the decoded video timestamp, not a separate
animation timeout. Runtime calibration lives in `dealerMedia.ts`.
