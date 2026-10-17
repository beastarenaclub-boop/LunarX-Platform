# Aurum Forex Trading

Sign in at http://127.0.0.1:5200 and open **Forex Trading** from Hot Right Now or
All Games. The direct route is http://127.0.0.1:5200/forex-trading. Rebuild with
`docker compose up -d --build api web` after changing the app.

The integrated game shares the lobby's compact game viewport, coin rack and saved
coin preferences, coin settings, sound controls and winning receipt. Markets and
the graph stay next to the prediction controls; the information drawer holds rules,
open positions, history and completed results. The top-left arrow returns to the
lobby without signing out. The integrated game uses the same INR wallet as the
lobby and other games. The balance opens `/wallet`; there is no practice refill.
One coin represents ₹1. Trades, results, debits and payouts commit together in
PostgreSQL. Migration `0039_forex_shared_wallet` creates the funded market and
trade tables. Old SQLite practice balances and unfunded orders remain archived
and are never converted into shared wallet funds.

The optional standalone terminal is still available: run `npm run forex:build`
then `npm run forex:start`, or double-click `START-FOREX-GAME.cmd`, and open
http://127.0.0.1:5196. Node 24 is recommended. Quotes need outbound HTTPS access to
Google Finance; no API key is required. This separate standalone preview retains its own practice
identity and SQLite database at `artifacts/3d-game/data/forex.sqlite`.

## Rules

Gold, Silver, Platinum, Copper, EUR/USD, GBP/USD, USD/JPY, USD/INR, Crude Oil,
Natural Gas, Bitcoin and Ethereum share a 60-second round. Orders are accepted
for the first 45 seconds; the last 15 seconds are locked.

New funded rounds draw UP or DOWN independently for each asset with equal
probability. BUY predicts UP and SELL predicts DOWN. Winning predictions return
1.70 times the stake, including stake; losing predictions return zero. This gives
85% theoretical RTP and a 15% expected house margin over many plays. It does not
guarantee profit in a particular round or session.

Each round publishes a SHA-256 commitment before betting. After settlement, the
completed result reveals the seed; the HMAC-SHA256 message is
`roundId:assetId`, with the first digest byte below 128 selecting UP. Stakes,
pool totals and external market prices do not determine the result.

Already-open legacy funded rounds and the optional standalone practice server
retain the old pool-average rule and 1.90× return. New funded rounds use version 2.

Integrated stakes are ₹10–₹5,000 in multiples of ₹10, with at most 30 orders per
account per round. The ledger stores integer paise. Opening Forex never creates
funds. Stakes debit the shared wallet; wins return 1.70× including stake. Legacy flat
results refund the stake. The retired `/api/forex/refill` returns 410.

## Animated game chart and bet feedback

The default **Game chart** is explicitly labelled as a simulated game index,
with a round baseline of 100. It draws up to 80 candles, updates five times a
second, and offers 1s, 2s and 5s candle intervals. Its illustrative history is not
market data. Empty pools still animate in both directions; no bet means no wallet
profit. Funded rounds animate toward the existing pool signal without changing
settlement. A disconnected or stale game connection pauses the animation.

Accepted predictions appear as BUY/SELL markers on the game chart and an inline
confirmation. Pending and failed requests show their status beside the controls.
Order IDs use cryptographic random bytes when `randomUUID` is unavailable on an
HTTP LAN address; ID creation failures also clear the pending button state.
Retries keep the same request ID. Payout and wallet rules are unchanged.

## Google Finance market data

The ticker, watchlist, selected price, percentage change, sparklines and chart
in the **Google market** tab all use the same `/api/forex/quotes` snapshot. Both the integrated API and the
standalone server use `lib/forex/quotes.mjs`. Game rounds and wallet settlement
remain independent of this display feed. Historical predictions show pool
outcomes, not generated prices presented as market quotes.

The server reads Google Finance pages, validates the exact instrument and source
timestamp, and caches each quote for 30 seconds. Concurrent requests share a
refresh, with at most four outbound requests at once and an eight-second timeout.
Failures retain the last valid quote and back off up to five minutes. Missing
quotes display unavailable, never a seed price. Old or failed quotes display
"Last available quote" with the original quote time, including weekends. The
last successful fetch time is separate from the source quote time.

Google lists about 3 minutes of delay for currencies/crypto and 10 minutes for
COMEX/NYMEX futures in its [data disclaimer](https://www.google.com/intl/en-US_US/googlefinance/disclaimer/).
Automatic refresh does not remove this delay. This is a public-page integration,
not a supported streaming API; Google layout changes or request limits can make
quotes unavailable. There is no silent substitute provider.

| Assets | Google instruments | Displayed units |
| --- | --- | --- |
| Gold, Silver, Platinum | GCW00:COMEX, SIW00:COMEX, PLW00:NYMEX | Futures, USD/troy oz |
| Copper | HGW00:COMEX | Futures, USD/lb |
| Crude Oil, Natural Gas | CLW00:NYMEX, NGW00:NYMEX | Futures, USD/barrel and USD/MMBtu |
| EUR/USD, GBP/USD, USD/JPY, USD/INR | EUR-USD, GBP-USD, USD-JPY, USD-INR | Quote currency per base currency |
| Bitcoin, Ethereum | BTC-USD, ETH-USD | USD per coin |

The 15m/30m/1h views are anchored to the latest source quote. Candles aggregate
observed samples into minute buckets; they are explicitly sampled candles, not
exchange OHLC bars. Missing samples are not generated. Percentage changes and
chart zones reference the previous market close, never the pool's round opening
price. Pool volumes count only accepted game stakes; they are not market volume.

## Operation and checks

`npm run forex:dev` opens Vite on 5197 and proxies requests to the standalone
server on 5196. `FOREX_PORT` and `FOREX_DB` configure the standalone server.
The standalone service uses SQLite. The integrated API uses PostgreSQL and a
transaction lock across API workers. Request IDs prevent duplicate debits;
reusing an ID with changed details is rejected. Shared wallet row locks serialize
spending across games. Bets delayed beyond cutoff roll back with their debit.
The startup scheduler settles overdue funded trades even with no browser open,
and publishes wallet updates only after commit. Refresh and retries never pay
the same prediction twice.

```sh
npm run forex:check
npm run forex:test
npm run forex:build
npm run forex:test:browser
npm run forex:test:integrated
```

Browser tests use a separate temporary SQLite database and verify a complete
round, shared pools, reload persistence, chart controls, validation, rules and
320/390/768/1024/1440px layouts. Review images are in `tmp/forex-review`.
Standalone tests need Chrome or Playwright Chromium available locally.

`forexSharedWallet.integration.test.ts` checks zero initial funding, shared wallet
aliases, account isolation, duplicate requests, cross-game overspending, rollback,
pool direction, background settlement, wins/losses, equal-pool refunds and late
wallet-lock rejection. Run it with `SHARED_WALLET_INTEGRATION=1` against a separate
database whose name ends in `_shared_wallet_test`. `shared-wallet-forex.spec.ts`
checks real authenticated wallet updates across tabs and settlement after leaving
the game, using a funded fixture only in that isolated test stack.
