# Kit Lunar / Aviator

The kit's Aviator interface is available at `/aviator-pro` under the canonical
game code `lunar`. `/play`, `/lunar`, and `/aviator` redirect to that route.
Both lobbies include its supplied poster and the partner launcher accepts
`game=lunar`. The separate retired `aviator` backend code stays retired.

The kit plane, canvas, two bet panels, chat, history, menus and avatars use
the existing server-authoritative crash engine and shared wallet. Accepted
bets remain committed; the button shows **Bet placed** until flight. Active
or automated bets prevent removal of their panel. Cashout waits for server
confirmation. Partner mode runs the engine and retains its game header.

RTP, stake limits, timing and auto-cashout bounds are exposed through the
existing admin RTP configuration. Lunar also participates in B2C/master RTP
policies. Prices remain pinned to each round. As documented in the kit,
seed-committed crash games do not support the table result engine's forced
outcomes or Collect modes. The fairness dialog includes the current round RTP.
The kit's separate bank-targeting `aviator-fun` demo engine is not imported;
the host's isolated demo worker runs the same crash rules with demo funds.

Migration 0066 enables the previously retired Lunar config once, preserving
saved limits and RTP. Fresh databases start at the platform's existing 85%
target. Future admin disables and Lunar RTP edits survive restarts.

Validation: `node tools/test-lunar.mjs` exercises migration, persistent admin
disable/RTP, B2C pricing, round privacy, authentication, hidden seeds, wallet
debit, exact auto-cashout/loss settlement, replay protection and late bets in
PGlite. `--browser` uses the prepared production player bundle to verify the
lobby entry, desktop/mobile kit interface, actual bet placement, reload
recovery and fairness dialog. Test funds and database are isolated.

The Lunar audio integration uses the handoff archive's exact `takeoff.mp3`,
`flyAway.mp3`, `cashout.mp3`, `click.mp3` and `music/ambient.mp3` recordings.
Their checksums are stored in `src/assets/audio/lunar-kit/manifest.json`.
The kit's recorded flight cues replace the previous generated Lunar sounds;
its continuous synthesized engine hum remains disabled. Background music
loops with the kit's two-second fade and follows the existing Music control.
Sound mute, browser gesture unlock, hidden-tab handling and route cleanup
continue through the shared audio context. Other game sound packs are unchanged.

`lunar-kit-audio.spec.ts` verifies archive checksums, exact decoded waveforms,
audible flight/music recordings, no extra engine loop, mute/music controls,
navigation cleanup and failed/late downloads.
