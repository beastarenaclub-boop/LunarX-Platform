The runtime background is `casino-ambient.webm`: a local VP8 derivative of
`casino-ambient.mp4`, 640x360 at 18 fps, 8 seconds, without audio. Keeping the
ambient layer small leaves decoding and rendering capacity for the 720p dealer
and the 3D dice. Original generation details are in `casino-ambient.prompt.json`.

The dealer's idle take is now `dealer-idle-v2.mp4`, with its source framing
shifted up 5.8% to match the throw. It contains natural breathing and blinks with
resting hands. `dealer-neutral.webm` is retained as a source asset but unused.
