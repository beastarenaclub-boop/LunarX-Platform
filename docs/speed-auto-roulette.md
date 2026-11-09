# Speed Auto Roulette

Player route: `/speed-auto-roulette`. The shared lobby includes a new banner, New Games label, Table Games category, Roulette family and searchable `speed auto roulette`, `auto roulette` and `3d` tags. The existing Roulette game keeps its own route and rounds.

The reference is the opening angled 3D table in `Screen Recording 2026-10-26 222637.mp4`: blue felt, burl-wood wheel, polished brass, leather chairs, racetrack and European betting layout. The revised renderer uses a photographic background derived from the supplied reference, with a real-time Three.js rotor, illuminated ball, chip overlays and projectively mapped betting targets. It retains one fixed camera; the surrounding table and chairs are photographic scenery, not orbitable geometry. Wheel labels are drawn from the authoritative European sequence, and the animated ball lands on the server's result. Recorded outcomes, chat and video playback are not used. Table bets opens accessible betting controls without changing the view. Asset provenance and the exact generation prompt are in [speed-auto-roulette-assets.md](speed-auto-roulette-assets.md).

The recording does not expose a full rules panel. The game uses the platform's standard European single-zero rules: 35:1 profit for a straight bet, 17:1 split, 11:1 street, 8:1 corner, 5:1 line, 2:1 dozen/column and 1:1 outside. Total returns include the original stake; zero loses outside bets. Traditional Tier, Orphelins, Voisins, Zero and configurable neighbour bets are supported. Default timing is 12 seconds betting, 9 seconds spinning, 4 seconds result, configurable on the server.

After the ball lands, a rounded wooden winning peg with two golden rings marks the winning printed number, including zero. It clears when the next betting round opens. Hovering a racetrack number or French sector previews its complete coverage on both the small racetrack and the main table, with a connected number strip and the exact group stake. A click or touch places the existing group bet; the strip then shows all numbers currently covered by the player's chips and the total on the table. Undo, Clear and round rollover update both highlights and the strip. Previewing does not place or submit a bet.

Selection marks fade between hover targets. Added chips land with a small rebound, contact shadow and fading gold ring; grouped selections pulse in sequence on both layouts and in the connected number strip. Adding to an existing number repeats the feedback. Persistent scene objects keep pointer movement and server refreshes from restarting chip animations. Undo/Clear fade removed chips out, and reduced-motion preferences show selections immediately.

Rounds, seed commitments, disclosure, wallet debits, stake validation and settlement use the existing server engine under the independent `speed-auto-roulette` code. The outcome stays hidden until the final 3.6 seconds of the spin. Single-number stakes are limited to ₹20,000 per player/selection/round; other selections to ₹1,00,000; minimum ₹10. The slip maximum is ₹5,00,000 with at most 40 selections. Generic cashout/loss routes cannot override settlement. Auto confirm sends only the current selected chips and never repeats a previous round. An uncertain network response disables resubmission for that round.

## Local preview

Run `npm run speed-roulette:dev`, then open `http://127.0.0.1:5338/speed-auto-roulette`. This builds the API and starts an isolated in-memory demo worker plus Vite. It does not connect to the production database. Stop with Ctrl+C. Optional ports: `SPEED_ROULETTE_WEB_PORT` and `SPEED_ROULETTE_API_PORT`.

Normal production startup seeds the new configuration without a schema migration. Deploy the frontend and API together to make the new lobby entry playable.

## Checks

- Browser: `tests/speed-auto-roulette.spec.ts` checks desktop/mobile betting, Undo/Rebet, all 37 wheel landings and winning markers, inward ball travel and depth, continued rotation after capture, round rollover, insufficient funds, no retry after an uncertain response, direct clicks on the photographed board/racetrack, complete neighbour/sector previews and touch selection. API and game WebSocket traffic are mocked; Vite HMR is held idle so edits elsewhere in the workspace cannot reload a test midway through a spin. Use `--output ../../.cache/speed-auto-roulette/marker-tests` from the frontend directory to keep screenshots separate from other game test runs.
- Backend: `src/demo/__tests__/speedAutoRoulette.test.ts` uses the actual built API and an isolated PGlite worker to check separate rounds, invalid/cumulative-limit bets, server-only settlement and exact payouts. It deliberately has an unusable production database URL.
- Banner: run `node --import ./artifacts/api-server/node_modules/tsx/dist/loader.mjs artifacts/3d-game/scripts/capture-speed-roulette-banner.ts` with `PLAYWRIGHT_BASE_URL` pointing at Vite; the capture uses mocked account traffic and the actual table render.

Validation images and temporary reference frames are stored in `.cache/speed-auto-roulette` and Playwright's ignored test-results directory.
