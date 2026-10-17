# Bike Racing

Open http://localhost:5174/bike-racing after starting the existing Docker Compose stack, or run `START-BIKE-GAME.cmd`. Log in with the same account used for Lucky 7. The lobby also contains a Bike Racing card.

This is the shared-wallet coin-betting game. Its six 3D bikes race automatically around the circuit using the server's race plan. No video is played. The separate `artifacts/3d-game/bike` arcade is an older manual-driving prototype.

## Player flow

- Each shared round has 20 seconds for betting, a 20-second race and a 5-second result, followed by the next betting window.
- Select the shared coin denomination and tap one or more bikes. Each tap adds that coin. One coin is ₹1. The slip submits near the end of the timer with a 1.2-second network buffer.
- Cancel removes an unsubmitted selection. One combined slip is accepted per player per round. Accepted stakes cannot be cancelled or cashed out.
- Auto play repeats the chosen slip for 5, 10 or 20 rounds, including the initial bet. Stop prevents the next unsubmitted slip. Auto stops on errors, low balance, leaving the page or hiding the tab.
- Each numbered, coloured 3D bike matches its betting entry. The live order updates as the bikes race. The official winner is shown after the 20-second race ends.
- Broadcast, Trackside, Leaders, Wide, Close-up and Auto cameras change the view. Close-up lets the viewer follow a numbered bike. Camera changes do not place bets or influence results.
- Every bike has an equal 1-in-6 chance. The initial 3% house edge gives a 5.82× total return, including stake. ₹100 on the winning bike returns ₹582; stakes on other bikes lose.
- Refresh resumes the shared clock. Winnings settle without an open browser. If graphics are unavailable, live timing and the official result stay available alongside betting. Retry 3D reloads the view.

## Implementation

`@workspace/api-zod/bike-racing-game` defines the shared clock and presentation. `bikeGame.ts` derives an independent SHA-256 finish order from the securely generated server seed; bets never enter the draw. The race plan is withheld while betting is open.

`BikeRaceScene.tsx` loads `bike3dRenderer.ts` on demand. Six motorcycle and rider models follow `bikeProgress` around the circuit, with spinning wheels, banking, suspension movement, daylight, trackside scenery and numbered labels. Both live standings and rendered positions use the shared plan and server time offset. The winner camera follows the first finisher, and the official result banner waits for the server result. The scene resizes on desktop, mobile and fullscreen. GPU context loss and asset failures switch to live timing with retry; graphics loading never blocks a betting window. Scene resources are released when leaving or retrying.

All models, textures and daylight maps are local under `public/assets/bike-racing`. The old video and photographic renderer are inactive and never loaded by this game. The reference image remains a static field thumbnail in Game information. Optional engine sound uses the existing sound preference.

`bikeLiveGame.ts` persists `br1-apex-*` slots in `table_rounds` and version 1 receipts in `bets`. Stake, receipt and round counters commit in one transaction. Round/user advisory locks and request fingerprints prevent duplicate or modified retries. The cutoff is checked again after acquiring the wallet lock. Settlement pays all players atomically and is restart safe. All money uses the existing shared INR ledger; there is no browser wallet or local payout calculation.

Authenticated API: `GET /api/bike-racing/game/config`, `GET /api/bike-racing/game/live`, `POST /api/bike-racing/game/live`. POST requires a UUID `requestId`, current `roundId`, `venueId: "apex"`, and `bets: [{ bikeId: 1..6, amountPaise: "1000" }]`.

Default config is inserted only if missing. Admin enablement, stake limits and house edge are respected; accepted rounds retain their original config. No schema migration is required.

## Validation

`bikeGame.test.ts` covers schedules, exact boundaries, coin validation, draw distribution and finishing order. `bikeLiveGame.integration.test.ts` covers shared spectators, private betting outcomes, retry debits, shared-wallet funds, betting cutoff, duplicate payouts and restart settlement. These backend tests use a dedicated test database.

`artifacts/3d-game/tests/bike-live.spec.ts` covers delayed submission, auto repeat/stop, recovery, cancellation, hidden tabs, unattended races and refresh using mocked funds. Visual cases load real 3D assets, verify changing rendered pixels and positions, camera controls, desktop/mobile layouts, matching server finish order, asset-failure retry, GPU context-loss recovery and devices without WebGL. They also check that no video or photographic renderer is requested.
