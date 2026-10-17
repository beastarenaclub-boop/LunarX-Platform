# Lucky 7 centered dice throw

The existing Asha film, table size and playback rate are preserved. `DiceTable` now renders `TableDice`: two lightweight SVG cubes whose top faces use the server's dice values. There is no WebGL canvas or additional video decoder.

`tableDiceMotion.ts` defines the choreography in the original 1920 × 1080 frame. The first uncovered hand frame is at 3625 ms. The cubes start at the filmed dice positions, tumble, bounce once and slide into the middle of the felt by 4458 ms. Their edge size grows continuously from 24 to 58 source pixels as they approach the player. Landing positions, curve, tumble and resting angle are seeded by round ID; presentation never determines the outcome or payout.

`DealerFilmStage` delivers decoded video timestamps to the renderer. The release sound and settled result follow the same clock. Repeated round messages do not replay a throw. A late join or reduced motion shows the final faces immediately. If the action video is unavailable, a 760 ms fallback animation still resolves before the existing deadline. No timers extend a server round.

The original take contains small dice at a fixed position. An SVG mask covers their two footprints with clean felt from the same shot while the rendered dice are visible. `asha-cinema-felt.png` is an unretouched 140 × 85 pixel crop at x=1225, y=785 from the 1080p action clip at 3.0 seconds, when this area is empty. The patch is disabled during pickup/shaking, when the filmed hands contain the dice. The previous result moves back to the pickup point during the first 625 ms of the next action. Changing the film requires remeasuring these regions and timestamps. The dealer's recorded hand gesture remains the same; the dice trajectory and resting orientation vary.

Relevant files:

- `artifacts/3d-game/src/components/lucky7/TableDice.tsx`: projected cube faces, pips, localized felt repair and decoded-frame rendering.
- `artifacts/3d-game/src/components/lucky7/tableDiceMotion.ts`: release/landing/pickup cues and deterministic trajectories.
- `artifacts/3d-game/src/components/lucky7/DiceTable.tsx`: round lifecycle and settlement guards.
- `artifacts/3d-game/src/components/lucky7/dealerCast.ts`: synchronized film cues.
- `artifacts/3d-game/tests/lucky7-center-throw.spec.ts`: phone/desktop movement, growth, central bounds, round variation and stable video geometry.
- `artifacts/3d-game/tests/lucky7-dice-playback.spec.ts`: correct faces, unchanged playback source, fallback and settlement cases.

Validation on 2026-10-01: TypeScript and production Vite build passed. All 18 browser checks in `lucky7-center-throw`, `lucky7-dice-playback` and `lucky7-dealer-video` passed against the packaged release. This includes 360 px and 1366 px viewports, multiple throws, all six faces, reduced motion, unavailable/stalled media, late joins, repeated results and media cleanup.
