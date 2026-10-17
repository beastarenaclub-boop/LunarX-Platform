# Lunar responsive layout tests

`playwright.performance.config.ts` checks that inactive crash games do not poll,
route changes stop and restart the correct engine, signed-out pages stay idle,
and 60 animation ticks do not rerender idle JetX controls. It also checks that
balance changes and the betting cutoff still update those controls. Start Vite
on port 5186, then run from the repository root:

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.performance.config.ts
```

These tests use mocked accounts and rounds; they place no real wagers.

`playwright.responsive.config.ts` checks every player game route at eight widths,
from 320px phones through portrait tablets and phone landscape to 1920px desktop.
It checks horizontal overflow, native control sizes, reachable coin controls and
dialogs after rotation. Short screens scroll vertically instead of shrinking the
entire game. API sessions and rounds are mocked; no real wagers are placed.
Start Vite on port 5186 (or set `PLAYWRIGHT_BASE_URL`), then run from the repository root:

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.responsive.config.ts --project chromium
```

`playwright.audio.config.ts` verifies the original sound designs for all 25 casino
games and the three lottery modes. It checks audible PCM, distinct win cues,
seamless flight loops, cold-cache clicks, delayed audio-device startup, mute/volume, route cleanup, dice-impact
throttling and browsers without Web Audio. Run from the repository root:

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.audio.config.ts
```

The suite uses Vite on port 5186 and needs no API or real wagers. Sound designs
live in `src/game/gameSoundDesign.ts`; embedded games use the shared mixer while
standalone colour trading and lottery games own a disposable audio context.

`audio-autostart.spec.ts` also checks music on entry across the shared game
palette, including the lottery routes, without placing a bet. It exercises
recorded Baccarat/Teen Patti/live-table beds, sports commentary, standalone
music, visibility cleanup, navigation and saved mute. Separate real Chrome
policies test permitted autoplay and a normal-page-tap fallback. Startup runs
in the page's module script so CDP evaluation cannot accidentally grant a
synthetic user gesture.

`playwright.playback.config.ts` checks Vegetable Bowl and Colour Trading on the
actual local site at `http://127.0.0.1:5174` (`PLAYWRIGHT_BASE_URL` overrides it).
It measures audio after the master gain for selection, collection and mute,
using mocked accounts and rounds. Run it with the same Playwright command and
this config name. A source/Vite build alone does not update the Docker site:
rebuild `web`, then run `docker compose up -d --no-deps web` before verifying it.
On Windows, Chrome needs access to the system audio service for this output
measurement; run it from a normal terminal if a restricted runner leaves the
audio context suspended. Keep the browser's default autoplay policy enabled.

`playwright.wins.config.ts` checks winning receipts across all 26 game routes in
Chromium, Firefox and WebKit, from 320px phones and short landscape windows to
1920px desktops. It checks settled Vegetable Bowl and Colour Trading payouts,
queued wins, dismissal, duplicate prevention, and fullscreen round transitions.
Start the player server on port 5186 (or set `PLAYWRIGHT_BASE_URL`), then run
`pnpm exec playwright test --config playwright.wins.config.ts` from `artifacts/3d-game`.
All sessions and payouts are mocked; no API server or real wagers are needed.

`playwright.shared-betting.config.ts` checks shared coin preferences across game
families, cancellable automatic submission, combined Vegetable Bowl slips,
WinGo's betting deadline, rejected/expired drafts and phone layouts. All wagers
and sessions in these tests are mocked; no running API or wallet debit is needed.

`playwright.fit.config.ts` checks game frames and dialogs during resizing.
Betting controls keep their native size and short screens can scroll. Vegetable Bowl also checks
the moving bowl, falling produce, gradual 18-second collection and a full recent
history on small phones. Start the player server on port 5186 (or set
`PLAYWRIGHT_BASE_URL`), then run:

```sh
pnpm --filter @workspace/3d-game exec playwright test --config playwright.fit.config.ts
```

`playwright.vegetable.config.ts` also runs `harvest-motion.spec.ts`: all 12
possible vegetable counts, junk clearance during dodges, and non-repeating
backgrounds. Browser coverage checks live scene changes, refresh persistence
and reduced-motion collection; junk never contributes to the winning count.
Version 2 adds independent 5% junk-only rounds: stones, boots and cans land in
the bowl, the vegetable count stays zero and all three bets return zero. The
suite checks the disclosed chances/RTP, delayed final result, refresh and round
reset, while legacy rounds retain their original odds. The API vegetable math
and integration suites also cover all-option losses, seed replay and idempotent
wallet settlement; run integration tests against a disposable database.

`game-viewport.spec.ts` checks all 21 casino routes against a shared 1440px
maximum frame, phone/landscape/desktop resizing, readable winning receipts and
scrollable settings. `game-popup-lifecycle.spec.ts` drives mocked live settlements
in Lucky 7 and Teen Patti Live, including the next round and fullscreen. These
tests mock the API and need only the player web server, with no database or wagers.
`horse-viewport.spec.ts` checks the three racing routes; set `HORSE_PREVIEW_URL`
when they are served somewhere other than `http://localhost:5174/horse-riding`.

```sh
pnpm --filter @workspace/3d-game test game-viewport.spec.ts game-popup-lifecycle.spec.ts horse-viewport.spec.ts
```

Playwright spec (`lunar-responsive.spec.ts`) that exercises the `/play` route across 11 viewports and asserts:

- no horizontal page scroll,
- the active bet/cashout/cancel button stays in-bounds,
- chat + side-panel are reachable on every breakpoint,
- top-bar dialogs (Settings, Stats, Provably Fair, Achievements) render fully inside the viewport.

Roulette coverage in `roulette-wheel.spec.ts` also verifies:

- the final-20-second wheel presentation uses one continuous wheel instance,
- the optimized 3D model loads on capable desktops and phones use the 2D fallback,
- every one of the 37 supplied-model pockets lines up under the top pointer, and
  the shipped GLB still has the materials/axis the renderer drives (both read the
  asset directly, so they hold even where headless Chromium has no WebGL),
- the result stays hidden until the exact server pocket is physically reached,
  including the provably-fair server seed,
- the pocket and seed are absent from the round payload *and* the WebSocket
  traffic for the whole visible spin — the server only discloses them for the
  final landing, so the outcome cannot be read ahead off the network,
- winning-pocket emphasis appears across the wheel, banner, board, and live history,
  then clears when the next betting window opens,
- the spin plan (`spinPlan.ts`) is asserted as pure maths — it picks up at the
  speed already on screen without dipping, holds the fast finishing run, brakes
  for the last two seconds, drops the ball inside that brake, and lands exactly
  on the server's pocket even when evaluated past its deadline (hidden tab) or
  squeezed into a clipped reveal window,
- the rendered transforms are sampled frame by frame through a whole
  presentation: anticipation → final run → launch → run → brake → settled, with
  no sag at the hand-over into the landing and a visible ~2s slow-down to a stop,
- the ball-roll loop rides the motion the whole way: audible during the ordinary
  idle spin between rounds and through the anticipation spin (long before the
  pocket is disclosed), and always stopped once the wheel settles,
- backgrounding the tab mid-spin silences the roll and still rests the wheel on
  the announced pocket when the player returns,
- leaving the table stops the rolling-ball loop,
- reduced-motion mode remains static and shows the result without blinking.

## Prerequisites

The compact game layout suite uses mocked game data and needs only the player
web server. From `artifacts/3d-game`, run
`pnpm exec playwright test --config playwright.compact.config.ts` with
`PLAYWRIGHT_BASE_URL` pointing to that server (default `http://127.0.0.1:5186`).
It covers all 25 routes in Chromium, Firefox and WebKit, checks coins, bets,
timers and results across portrait, landscape and desktop sizes, rejects nested
vertical play-area scrolling, and checks the information drawer, desktop edge alignment, usable chip sizes, settings access and focus return.
Racing uses its supported timing view so GPU availability does not affect layout.

- The Lunar dev server (`artifacts/3d-game: web` workflow) must be running.
- The API server (`artifacts/api-server: API Server` workflow) must be running on the same origin so `POST /api/auth/signup` can bootstrap a session for each test.
- Playwright's Chromium binary must be installed. The post-merge script (`scripts/post-merge.sh`) provisions it automatically after every task merge; to install it manually run:

  ```bash
  pnpm --filter @workspace/3d-game test:install
  ```

## Run locally

With both workflows already running on Replit, just run:

```bash
pnpm --filter @workspace/3d-game test
```

The Playwright config picks up `REPLIT_DOMAINS` automatically and points the browser at `https://${REPLIT_DOMAINS}` (which proxies both `/` and `/api`). Override the target with `PLAYWRIGHT_BASE_URL=http://localhost:5173 pnpm --filter @workspace/3d-game test` for plain `pnpm dev` setups.

If no dev server is running, set `PLAYWRIGHT_START_SERVER=1` and Playwright will boot `pnpm dev` for the 3d-game artifact (the API server still has to be started separately).

## Run as a registered validation step

A validation command named `responsive` is registered in this project. It runs the same `pnpm --filter @workspace/3d-game test` against the running dev + API workflows and surfaces failures in the validation run summary.

`playwright.instant.config.ts` covers the redesigned Mines and Plinko pages: manual
start, reveal/cashout/loss, refresh recovery and retry, invalid amounts, all three
Plinko row counts, result timing, exact landing pockets, bounded auto drops,
stop/navigation cleanup, seed rotation and verification, and five responsive sizes.
Sessions and wallet responses are mocked, so these browser tests do not place wagers.

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.instant.config.ts
```

The default player server is `http://127.0.0.1:5186`; set `PLAYWRIGHT_BASE_URL` to
check the deployed local site at `http://localhost:5200`.

`instantGames.integration.test.ts` exercises real service/database settlement,
Mines restoration after more than 50 historical rounds, duplicate cashout rejection,
all-gem settlement, Plinko wallet returns and seed replay. It requires
`INSTANT_GAMES_INTEGRATION=1` and a migrated, disposable `DATABASE_URL` whose database
name starts with `instant_games_test_`. It never runs against the regular app database.
Run with `node --import tsx --test src/services/__tests__/instantGames.integration.test.ts`
from `artifacts/api-server`, and discard that test database afterward.

`playwright.pirate-audio.config.ts` starts an isolated entry for the real Pirate
Edition page and shared audio lifecycle. It checks mobile controls, accepted hops,
loss and refund cues, music and sound toggles, pending responses, navigation and
reloads with mocked wallet requests. The same cases also run in the full app via
`playwright.instant-collection.config.ts`.

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.pirate-audio.config.ts
node artifacts/3d-game/scripts/export-pirate-audio.mjs
```

The export command writes original 48 kHz WAV clips, a listening preview and a
manifest to `exports/chicken-road-pirate-audio`. The game renders the same score
locally without downloading files; these are newly composed sounds, not recordings
from the reference site. Pirate music starts on entry when the browser permits
audio and follows the saved music preference and master sound toggle. A visible
audio button handles browsers requiring a first tap; no bet is needed to hear it.
