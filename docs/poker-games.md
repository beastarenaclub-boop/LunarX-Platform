# Poker games

Three shared-wallet games implement the supplied mobile references:

| Game            | Player route         | Betting window |
| --------------- | -------------------- | -------------- |
| Poker 1-Day     | `/poker-one-day`     | 20 seconds     |
| 20-20 Poker     | `/poker-20-20`       | 20 seconds     |
| Poker 6 Players | `/poker-six-players` | 20 seconds     |

The existing Crypto777 logo, dark purple card area, green announcement/support
strips, A/B colors, blue/pink markets, lock states, six-player grid, result strip
and 1-Day bonus tables follow the screenshots. Browser/device chrome is excluded.
The animated table deals hole cards, reveals the flop, turn and river, highlights
winning seats and shows settled returns before the next automatic round.
All three games appear in both shared lobbies and have authenticated routes.

## Rules and defaults

The user authorized choosing the missing rules and timings. Settings live in
`lib/api-zod/src/poker.ts`. The screenshot's 1-Day bonus tables are preserved
exactly. Other prices and timing are this implementation's defaults, not an
assertion about the reference site's hidden rules. Admin can pause each game
using its existing game availability setting; existing accepted bets still settle.

All games use a shuffled 52-card deck and the best five-card Texas Hold'em hand
from two private cards plus five community cards. Every rank and kicker counts;
suits do not break ties. A–2–3–4–5 is the lowest straight. Cards reveal after
betting closes: 2-second deal, then 3 seconds each for flop, turn and river,
followed by a 7-second result window. “1-Day” is the game name, not a 24-hour round.

- Winner back odds are 1.98; lay odds are 2.02. A/B ties refund back stakes and
  reserved lay liabilities. Side bets settle independently.
- A ₹100 lay reserves ₹102 liability. If the selected player loses, ₹202 returns
  to the wallet. If that player wins, nothing returns. Liability rounds up to
  the nearest paise. No exchange or peer matching is simulated.
- 1-Day two-card and seven-card bonuses pay only their highest qualifying tier.
  Tables use profit multiples: `1 TO 3` pays ₹400 total for a ₹100 bet.
- 20-20 exact categories pay total multiples: pair 2.20, two pair 4, three of a
  kind 20, straight 20, flush 30, full house 35, four of a kind 500, straight
  flush 3000. Royal Flush also qualifies for Straight Flush. These markets
  require the exact best category, not “at least” that category.
- Six-player starting cards are visible during betting. Deterministic sampling
  of 2,500 possible boards estimates equity using only those public cards.
  Prices are `floor(0.95 / equity * 100) / 100`, bounded to 1.01–100.00.
  This sampling is approximate, not a certified RTP. Quoted prices are fixed
  for that round. Tied winners split the total return equally, rounded down
  to paise. The actual hidden board is never used to calculate prices.
- Each selection requires at least ₹10. Cumulative debits, including lay
  liability, are limited to ₹5,000 per player per round. Bets require explicit
  confirmation. A click only stages a bet and does not debit the wallet.

## Server and wallet

`GET /api/poker/:game/table` returns the public round, quotes, shared balance,
current receipts, settled receipts and actual history. `POST /api/poker/:game/bet`
accepts `roundId`, `quoteId`, UUID `requestId` and `{market, amountPaise}[]`.
Authentication, existing rate limiters and strict input validation apply.

Cards, quotes, bets and settlement survive API restarts in PostgreSQL. Per-game
transaction locks serialize round transitions. Wallet row locks, cumulative
limits and a second deadline check prevent late or overdrawn bets. User/request
uniqueness prevents duplicate debits, including retries after a round has ended.
The browser keeps an uncertain confirmation ID in session storage across reloads.
A background engine settles accepted bets even after the player leaves.

Hidden cards and the random nonce are omitted from public snapshots until their
reveal phase. SHA-256 of JSON `[game, hands, board, nonce]` is published before
betting and can be checked in the UI after the result. This verifies a commitment,
not an independent audit of randomness. Six-player hands are public from the start.

Demo uses the existing isolated in-memory worker and demo wallet behavior; no
production wallet is used. The account reports include poker stakes and returns.

## Run and verify

For the local Docker app, run `docker compose build api web` followed by
`docker compose up -d --no-deps --wait api web b2b`. The API startup applies
database migrations automatically, including `0056_poker_tables.sql` for
`poker_rounds`, `poker_bets` and their indexes. Existing player and wallet data
are preserved. Open `http://127.0.0.1:5200/poker-one-day` (or either other route).
Rebuilding only source files does not update the running Docker services.

`npm run poker:dev` serves the full player app at `http://127.0.0.1:5298` and
proxies to the existing local API on port 5200 (`API_PROXY_TARGET` overrides it).
Use the existing login or demo flow, then select a poker game in the lobby.

- `npm run poker:test` runs ranking, payout, visibility and actual wallet/service
  integration tests in isolated PGlite memory, with normal finite ledger balances.
  It never connects to a production database.
- `npm run poker:test:browser` runs Chromium UI tests at 320, 390, 768 and 1440px,
  including confirmation, lock states, lay liability, rules, verification,
  reconnect/reload retry, history and stale draft clearing. Browser network
  fixtures are separate from the real service integration tests.
- `npm run poker:test:live` plays all three games against the running local
  app, using its actual API and isolated demo wallet. It confirms bets, observes
  every reveal phase, checks settlement and commitment, and waits for the next
  20-second betting window. No network responses or clocks are mocked.

No external site or third-party casino provider is required.
