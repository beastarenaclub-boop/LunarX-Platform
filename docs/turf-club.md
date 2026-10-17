# Horse Racing

Open **http://localhost:5174/horse-racing** and sign in through the existing player account. The lobby card and older `/horse-riding/` and `/horse-riding/race` links open this game.

## Playing

- Pick Royal Park, Dubai Sands, Alpine Valley, Ocean Downs, Neon Circuit or Marathon Stadium. Distances range from 1,400m to 3,200m; Marathon has two laps. These are themed fictional venues.
- Choose a coin and tap one or more of the eight horses. Each tap adds that coin. The common selection timer submits after three seconds. Cancel clears an unsubmitted slip.
- Every venue runs continuous shared rounds, even with no bets or viewers: **20 seconds betting, the race, 5 seconds results, repeat**. All players at a venue see the same absolute server clock and race. Joining or placing coins never starts or resets a round.
- The server accepts one multi-horse slip per player per round and debits the shared wallet once. Betting locks exactly at the scheduled start, including requests held up by wallet locks. An unsubmitted draft expires at the cutoff; it never carries into another round.
- Each race has new lane assignments, stride phases, pace changes, overtakes and a weighted finish order. The winner crosses the visible finish first. Outcomes do not depend on the selected bets.
- Winning return is the winning stake multiplied by snapshotted decimal odds, including stake. Other stakes return zero. Settlement runs on the server even after navigation, disconnection or restart. Refresh joins the current shared round and restores any accepted slip.
- Auto play places the same slip once in each new betting window for 5, 10 or 20 rounds. Stop prevents further bets. Errors, insufficient balance, page exit or a hidden tab stop auto play. Accepted races continue.
- Sound controls hoofbeats and audience audio. Fullscreen enlarges the race. Select Broadcast, Rail-side or Grandstand beneath the track to change the view, or choose Auto to rotate views every eight seconds. Press C to cycle cameras. Your choice persists after refresh; camera controls remain available in fullscreen and during an accepted race.
- Coins, custom denominations, wallet, selection countdown and win dialog use the existing shared components.

## Implementation

The main player application owns the route, authentication and wallet subscription. Horse Racing fills the browser width and keeps the race stage at 16:9. Desktop and landscape screens put betting beside the race; portrait phones put compact selections and coins below it. The field sidebar appears on large desktop screens. Short windows retain the shared measured fit so controls remain visible.

The primary renderer is a real-time Three.js WebGL scene with textured, skeletal CC0 horses and anatomical human riders. Face, skin, fingers, cloth, coat and muscle detail comes from authored meshes and texture maps. Individually colored silks, saddles, bridles and reins follow the runners. A seated human crowd and textured trees use GPU instancing. Photographed PBR ground maps, an outdoor HDR environment and directional shadows light the six venues. See [the textured character update](horse-racing-3d.md) for asset preparation and provenance.

Broadcast, Rail-side and Grandstand use a perspective camera with different heights and distances. Auto changes views every eight seconds. Close-up follows any runner using the eight controls or a sidebar portrait, without selecting a bet. The winner camera triggers at the first runner's actual finish time: it immediately frames that horse alone, hides competing runners and follow/leaderboard overlays, and displays its number and name. The winning horse continues a slower run-out while the camera follows. Camera controls resume with the saved preference on the next betting window. Browser sound changes from hoofbeats to the crowd at this crossing.

New rounds run at 1.65 times the original pace. Betting remains 20 seconds and results remain five seconds. Pace is persisted on each round alongside odds; existing hr3 rounds keep their original deadlines and pace through deployment. New schedules use hr4 IDs. Royal Park's main run takes about 18 seconds, with its race window lasting 20 seconds. Marathon remains a two-lap event.

The scene is lazy loaded. Pixel ratio and frame rate are capped on phones; the crowd uses instancing, riders share textures and horse geometry is shared. If WebGL is unavailable or its context is lost, the existing photographic canvas renderer provides a compatibility view with the same race and winner focus. Portraits and fallback atlases remain bundled. All models, textures and audio are local; the race stage has no video player or provider branding. Current model provenance is in public/assets/horse-racing/realistic/CREDITS.md. Preparation scripts are in tools/horse-assets/.

`lib/api-zod/src/horse-racing-game.ts` contains the contract and deterministic presentation plan. The API's `horseLiveGame.ts` persists shared rounds in `table_rounds`, snapshots odds and stores player slips in `bets` (metadata version 3). A one-second engine creates fixed wall-clock slots at all six venues and settles all accepted slips, including after restarts. A round lock serializes acceptance and settlement; wallet updates and bet records commit together. The plan and seed remain hidden while betting is open. The old `horseGame.ts` engine only recovers already accepted version-2 races. The shared wallet ledger performs atomic balance checks. Client-supplied winners or payouts are never accepted. UUID requests are idempotent; using the same UUID for a different slip is rejected.

- `GET /api/horse-racing/game/config`: limits and odds.
- `GET /api/horse-racing/game/live?venueId=royal`: shared round, server time, current personal slip, history and balance.
- `POST /api/horse-racing/game/live`: authenticated, rate-limited slip with roundId, requestId, venueId and unique horseId/amountPaise entries. Retries return the original receipt without charging again.
- Old `POST /game` tabs receive a reload message; new personal races are no longer created. The generic bet API cannot place or manually cash out live horse slips.

The old ride, Derby and jockey remain at `/horse-riding/ride`, `/horse-riding/derby` and `/horse-riding/jockey`. The `?from=derby` handoff retains its original display. Earlier Turf Club exports are historical snapshots, not this shared-wallet version.

## Verification and deployment

Backend tests cover weighted draws, changing trajectories, continuous forward movement, correct finishes and slip validation. Isolated database tests cover atomic debits, concurrent duplicate requests, race locking, once-only payout and background recovery. Browser tests mock monetary requests and cover multi-horse selection, bounded auto play, cancel/rejection, lost responses, reload, finish order, all venues and 320–1920px layouts.

Camera checks cover all three field views, Close-up for each horse, automatic changes, keyboard controls, saved preferences, active-race continuity, visibility of all eight runners in wide views and controls in fullscreen. The finish test checks the exact crossing boundary, correct winner despite another selected camera subject, a single visible runner, mobile framing and the next-round reset. The 3D renderer is horse3dRenderer.ts, the world is raceWorld3d.ts and the textured characters and animated tack are in raceCharacters3d.ts; raceTrack.ts and horseAssets.ts support the compatibility view.

```powershell
node node_modules/typescript/bin/tsc -b lib/api-zod
node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p artifacts/3d-game/tsconfig.json --noEmit
$env:PLAYWRIGHT_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:HORSE_GAME_URL='http://localhost:5174/horse-racing'
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.config.ts horse-game.spec.ts horse-live.spec.ts horse-finish.spec.ts
```

The integration test requires `HORSE_GAME_INTEGRATION=1` and a database whose name ends in `_shared_wallet_test`. The horse integration tests create and remove their own fixture accounts and round rows. `horseLiveGame.integration.test.ts` verifies multiple players, spectator and empty rounds, seed secrecy, exact cutoff and wallet-lock rollback, duplicate debit/payout protection, and restart settlement. Never run it against player data.

Deploy with `docker compose up -d --build api web`. No new database migration is required.

Live-round update verified on 2026-10-01: 9 browser tests and 5 backend checks passed, including isolated database settlement and the existing race math. Both application typechecks and production builds passed. The localhost API and web were updated; deployment checks verified all six venue clocks and an unattended Royal Park round transition. No player bets were placed during deployment verification.

3D pace and finish update verified on 2026-10-01: all 11 browser scenarios passed across the final targeted runs (six live betting tests, three camera/layout tests and two finish/context-loss tests). Five backend checks passed, including faster-draw invariance and migration of an accepted hr3 round without changing its deadlines. Both application typechecks and production builds passed. Localhost now serves the WebGL build and its animated model; the deployment smoke test verified legacy route redirects and made no monetary requests.

Textured horse/human update verified on 2026-10-01: all 12 browser scenarios passed across final targeted runs, including textured asset loading, camera persistence, desktop/mobile framing, automatic betting, context loss and winner-only close-up. The frontend typecheck and production build passed. Fourteen bundled 3D/environment asset checksums matched the staged release. No player bets were placed by deployment checks.
