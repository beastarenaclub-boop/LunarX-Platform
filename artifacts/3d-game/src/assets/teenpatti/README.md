# Teen Patti dealer performance

The current game uses [Riya in native 1080p](RIYA-HD-STUDIO.md).
The source takes, exact prompts, packaging script and runtime assets are retained
for integration and reproduction. The older Maya/Naina documents below describe
superseded performances; they are not the current runtime configuration.

`maya-cards.mp4` is a silent, AI-generated performance of a fictional adult
casino dealer. It is not a live camera feed. The room, expressions, shoulders,
fingers and card handling are one continuous 1280×720, 24 fps shot.
`maya-poster.jpg` is a frame from the same shot and is the reduced-motion / media
failure fallback. No external media URL is fetched at runtime.

Higgsfield project: `7f600058-f772-42fb-8acd-aa3ca4688b7e`.
Kling 3.0 standard, 10 seconds, native audio off.
Generation: `b9fefa40-abe4-4af7-b475-e2780b09c625`, 2026-09-27.
Source: https://d8j0ntlcm91z4.cloudfront.net/user_3DfogZPGkbXS9yE4AofyWrtGEMw/hf_20260927_133108_b9fefa40-abe4-4af7-b475-e2780b09c625.mp4

The requested six individual flips rendered as one presentation gesture per
hand. The game therefore opens each three-card readout after the corresponding
physical turnover, rather than pretending six individual filmed flips exist.
The unprinted prop card faces never encode a game outcome. All six displayed
ranks, categories and the winner come only from the server's round result.
The winner remains hidden until all six readout cards are up. Film loading,
failure, background tabs and reduced motion cannot delay settlement.

The table's music uses the existing ambient music asset, scoped to Teen Patti.
The chip and round calls use the existing recorded table audio pack; the two
turnover cues use short filtered paper-friction buffers on the shared SFX bus.
Sound/music controls and music volume persist; music starts on a player gesture
and pauses on mute, backgrounding and route departure.
