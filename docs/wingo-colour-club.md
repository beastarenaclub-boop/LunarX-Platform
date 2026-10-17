# Lunar Colour Trading

A colour-prediction game integrated into the existing games lobby at **http://localhost:5174/lunar-colour-trading**. Open the **Lunar Colour Trading** card in Hot Games or All Games after signing in. The game uses the platform API and the shared account wallet for bets and winnings, with saved game history. Its React UI uses a violet Lunar theme with a moon logo, responsive number chips, countdown, controls, wallet and history. The previous `/wingo` route still opens the same game; API paths, account data and saved preferences retain their existing identifiers.

The **All games** button returns to the same lobby. Styles are scoped to this game, including its modal portals, so visiting it does not change the other games. Phones and short landscape windows use native scrolling instead of shrinking the entire game. Predictions and coins keep touch targets of at least 44px. On desktop, the round and predictions sit alongside each other; on smaller screens they stack. Dialogs stay within the visible viewport.

## Integrated app

```sh
docker compose up -d --build api web
```

The main frontend includes Lunar Colour Trading in its regular build. Its authenticated endpoints are `/api/wingo/session`, `/api/wingo/state` and `/api/wingo/bets`. No separate service is required. PostgreSQL migration `0038_wingo_shared_wallet` stores rounds and bets alongside the common wallet ledger. Bets and payouts are atomic, retries cannot debit twice, and a background scheduler settles rounds after navigation or restart. Wallet buttons open the main Wallet page; balance changes update other game screens and tabs. One coin represents one rupee, stored as integer paise.

The old integrated `/api/wingo/refill` endpoint returns 410. Previous SQLite practice balances and predictions stay archived in the retained `wingo-practice` volume; they are not converted into shared funds. New accounts use their existing shared balance, with no extra grant for opening Lunar Colour Trading. See [shared wallet](shared-wallet.md).

The anonymous standalone version below remains available for previews. Its guest balances are separate from account balances in the integrated app.

In the lobby version, choose a coin amount and prediction. The shared coin controls show an automatic submission countdown and let you cancel before submission. The original base-amount/multiplier controls and confirmation dialog remain in the standalone preview.

## Run

Requires Node.js 24 or newer. The existing workspace dependencies are used for building.

```sh
npm run wingo:build
npm run wingo:start
```

Open **http://localhost:5192**. On Windows, `START-LUNAR-COLOUR.cmd` builds and starts the app. The previous `START-WINGO.cmd` and npm commands still work; `lunar:colour:build`, `lunar:colour:start` and `lunar:colour:check` are aliases. Keep the server running while playing.

For development, run `npm run wingo:start` in one terminal and `npm run wingo:dev` in another, then open http://localhost:5193. `WINGO_PORT` overrides the server port; update the Vite proxy as well when using a different backend port.

## Included

- Independent 30-second, 1-minute, 3-minute and 5-minute rounds, aligned to server time.
- Green, violet, red, numbers 0–9, Big and Small predictions.
- Shared coin selection and timed submission in the lobby; base amounts, ×1/5/10/20/50/100 multipliers, random selection and confirmation in the standalone preview.
- A five-second prediction lock before each reveal.
- The shared account balance in the lobby; 10,000 free practice coins per anonymous session in the standalone preview.
- PostgreSQL wallet transactions in the lobby, SQLite transactions in the standalone preview, balance validation, idempotent requests and settlement after restart.
- Last 100 completed results per mode, recent personal predictions, CSV export and a number chart.
- Optional win sound, accessible dialogs, connection feedback and mobile layouts down to 320px.
- Server-generated result commitments, revealed secrets and browser-side SHA-256 verification.
- Standalone preview only: free refill to 10,000 when balance is below 1,000 and there are no pending predictions.

The standalone preview uses free virtual coins only. The lobby version uses the existing shared wallet, deposit and withdrawal pages. Administrator result controls and public production hosting are not included.

## Rules used in this implementation

| Selection | Winning numbers | Total return |
| --- | --- | --- |
| Green | 1, 3, 7, 9 | 2× |
| Green | 5 | 1.5× |
| Red | 2, 4, 6, 8 | 2× |
| Red | 0 | 1.5× |
| Violet | 0, 5 | 4.5× |
| Big | 5–9 | 2× |
| Small | 0–4 | 2× |
| Exact number | Selected number | 9× |

The return includes the original stake. This practice implementation applies no fee. A 10-coin green prediction on a result of 5 returns 15 coins; its net change is +5 coins. The amount multiplier changes the stake, not the payout odds. Multiple predictions per round are allowed and settled independently against the same result.

The server draws with `crypto.randomInt(10)` and creates a random 32-byte secret when the round is created. It publishes `SHA-256(period:number:secret)` and withholds both the result and secret until settlement. Verification confirms that the reveal matches the published commitment; it is not external certification of the operator or RNG. Each outcome is independent of player stakes or previous results.

## Standalone preview persistence and behavior

Default database: `artifacts/3d-game/data/wingo.sqlite` (ignored by Git). `WINGO_DB` overrides it. The server listens on loopback by default. A single server process handles this local app.

Balance arithmetic uses integer hundredths of coins. Only integer coin stakes from 1 to 10,000 are accepted. A request key is unique per player, so replaying an accepted request cannot deduct twice. An old round identifier is rejected for new predictions.

All four active rounds are created together. There is no fabricated previous-round history. After a shutdown, persisted overdue rounds settle before the next state is returned; empty rounds during downtime are not invented. History is capped to the latest 100 entries in API responses, while settled totals use the complete ledger.

Refreshing or switching timers keeps the same practice wallet. Separate browser sessions get separate wallets and share round results. Clearing cookies creates a fresh guest account; there is no account recovery across browsers. During lost connections, prediction controls lock until live state returns.

## Verification

```sh
npm run wingo:check
npm run wingo:test
npm run wingo:build
npm run wingo:test:browser
npm run wingo:test:integrated
npm run lunar:colour:test:responsive
```

The Node tests also cover platform-account isolation and balance recovery across restarts. The Lunar responsive suite starts a local Vite server and uses deterministic API fixtures to check 320px through 1920px layouts, short landscape, 200% zoom, touch targets, dialogs, all four timers, prediction selection and cancellation, lobby navigation and the old route. Standalone browser checks use the real local game server for placement, settlement and persistence. Run the existing authenticated integration suite against the main stack; `PLAYWRIGHT_BASE_URL` can override its default address.

## Research

The implementation is original; no third-party game source was copied.

- [WinGo colour mapping on GitHub](https://github.com/gamingsoftsolution/WinGo-Colour-Prediction-tool): reviewed the odd/even colour mapping and shared violet numbers. The repository's prediction formula and advertised success-rate claims were not adopted.
- [Node.js crypto documentation](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback): cryptographic random integers and SHA-256.
- [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html): built-in SQLite database support.

Payouts above are explicit rules of this demo, not an assertion that every commercial provider uses identical fees or returns.
