# Irland Lotto lottery workspace

Irland Lotto is the display brand across the lobby, connected player/admin pages, standalone Admin/Agent/Shop/User panels, ticket series 10–19, results, exports and receipts. Migration `0047_irland_lotto_brand` updates the PostgreSQL branding; the standalone SQLite workspace applies its own one-time brand migration. Existing account credentials, balances, prices, series keys and historical ticket/draw IDs remain valid. New connected ticket/draw IDs use the `IRLAND-` prefix; the API also accepts historical `NICE-` draw IDs.

Irland Lotto in the main lobby uses the casino login, PostgreSQL database and shared INR wallet. The original standalone Irland Lotto operations app remains available for its separate Admin, Agent, Shop and User accounts, with its existing SQLite records.

## Main lobby, wallet and operator console

Open **http://localhost:5200/lottery** using your existing lobby login. The lobby card opens this route without a second account or lottery password. Wallet buttons open the casino Wallet page. One coin represents one rupee; the common coin rack and saved preferences are reused. A selected amount buys whole multiples of the selected series prices (for example, the ₹500 coin buys five Irland Lotto 10 units). Irland Lotto 10–Irland Lotto 19 fixed prices remain ₹100, ₹200, ₹500, ₹1,000, ₹2,000, ₹3,000, ₹4,000, ₹5,000, ₹7,500 and ₹10,000.

The main operator console at **http://localhost:5175/admin/lottery** lists lottery sales, tickets, players, credited prizes, refunds, upcoming draws and published results. Admins can pause sales, set the interval for newly scheduled draws and change the ticket cap after confirming their admin password. Support accounts have read access. The existing Games screen enables/disables Lottery. Lottery bets also appear in the common Bets, user details and dashboard records; every debit, win and refund appears in the shared wallet ledger.

Migration `0045_lottery_shared_wallet` adds settings, draws and tickets. Bet records and wallet entries commit in one PostgreSQL transaction. Wallet row locks prevent cross-game overspending; unique user/request keys prevent duplicate purchases. Cancellation refunds before the cutoff are idempotent. A background engine settles overdue draws after restarts and credits prizes exactly once without needing an open browser. Active seeds/results stay hidden even from the admin API; settled seeds reproduce results from their SHA-256 commitments. Existing draw prices and payout rules are snapshotted. This integration preserves the lottery's 80×/800×/8× exact-match returns.

Deploy locally with `docker compose up -d --build api web admin`. The API applies migrations on startup. Port 5190 is no longer required by the lobby lottery. Standalone demo credits/tickets are not copied into cash wallet records; their SQLite database and shop printing flow remain accessible at the addresses below. The connected User panel has no print or manual prize-claim endpoint.

Verification: `lotterySharedWallet.integration.test.ts` covers real PostgreSQL debits, concurrent spending, request replay, rollback across the draw cutoff, refunds, restart settlement, result secrecy, ownership and admin authentication. Set `DATABASE_URL` to an isolated database ending in `_lottery_test` and `LOTTERY_INTEGRATION=1`, then run `node --import tsx --test src/services/__tests__/lotterySharedWallet.integration.test.ts` from `artifacts/api-server`.

For browser verification, migrate the isolated database first. Start `scripts/lottery-wallet-fixture.ts` from the API workspace with `COOKIE_SECURE=false`, `DATABASE_URL` targeting that test database and `CORS_ORIGINS=http://127.0.0.1:5205`. In the player workspace start Vite with `PORT=5205` and `vite.lottery-wallet-test.config.ts`; then set `LOTTERY_TEST_API=http://127.0.0.1:5206` and run Playwright with `playwright.lottery-wallet.config.ts`. Tests cover the lobby link, purchase, shared balance in another game, common bet history, refunds, mobile layout and shared coin preferences. Fixture credits are restricted to that isolated test database.

## Run locally

Use Node.js 24 or newer. With this repository's existing dependencies installed:

```powershell
npm run lottery:build
npm run lottery:start
```

Open **http://localhost:5190**. No PostgreSQL or Docker is required for this module. The production build and API use the same server. `npm run lottery:dev` starts the optional Vite preview on port 5191; keep the API running on 5190 as well.

These standalone portals use their own account IDs and balances. The main lobby integration described above uses `/lottery` and the shared casino account.

| Portal        | Address                     | Demo account ID |
| ------------- | --------------------------- | --------------- |
| Shop counter  | http://localhost:5190/shop  | `SHP-3001`      |
| Administrator | http://localhost:5190/admin | `ADM-1001`      |
| Agent         | http://localhost:5190/agent | `AGT-2001`      |
| User          | http://localhost:5190/user  | `USR-4001`      |

Initial password for these **local demo accounts**: `Lottery@123`. Each portal has a separate HttpOnly session cookie and server-enforced role. Change passwords in Settings.

Initial demo balances: agent ₹1,00,000; shop ₹25,000; user ₹5,000. Amounts are displayed in INR. These are internal demo balances, not bank deposits. Six historical demo draws are generated on a fresh database for exploring results. There are no fabricated sales or customers.

## Daily business flow

1. Admin creates agents with a commission percentage and allocates operating credits.
2. Agents create their own shops and transfer credits. Both balances change in one transaction.
3. Shop selects a game, JP series, numbers, quantity and draw. Confirmation deducts shop credit and creates a unique ticket.
4. Shop prints an 80 mm receipt with the ID, QR, numbers and draw time. The QR contains the ticket ID for lookup. Reprints are marked **DUPLICATE COPY** and never create another entry.
5. Sales and cancellations close 10 seconds before the draw. The server publishes results, calculates prizes and credits agent commission.
6. A winning shop ticket is claimed once at its issuing shop. Recording a payout restores the corresponding shop credits; the operator handles the physical counter exchange. User prizes are credited automatically.
7. Reports show sales, prize liabilities, earned commission and net totals by date and account. CSV exports are available. Only Shop accounts can request printable receipts, and only for their own tickets.

An "offline shop" means a physical retail counter. It can connect to the server on the same computer or local network without public internet. It must remain connected to the lottery server to issue, cancel or claim tickets. Disconnected sales cannot safely observe shared balances and draw cutoffs and are disabled.

## Panels

- **Admin:** overview, accounts, suspension/reactivation, credit allocations, tickets, results/schedule, ledger, reports, configuration, audit and support inbox.
- **Agent:** network overview, own-shop creation/funding, scoped tickets, commission credits, reports and support.
- **Shop:** the same colourful Irland Lotto 10–Irland Lotto 19 paper-ticket selector as User, above the number grid in two rows of five, with mobile horizontal scrolling. Tap tickets to toggle multiple series, or use All series to select/clear all ten. Includes 2D/3D/Titli, row/column selection, quick pick, even/odd filters, Family permutations, Cross, Box25, quantity presets, advance draws, refund/cancellation, claims, printing/reprinting, ledger and reports.
- **User:** white, simple betting flow with Irland Lotto 10–Irland Lotto 19 paper-style ticket selectors above the number grid, arranged in two rows of five. Each card displays its fixed price. One ticket is selected by default; “Ek se zyada tickets” enables multiple selection. The two rows scroll horizontally on mobile. Customers can type a number or tap a grid of 25 numbers, choose quantity (1×/2×/5×/10×/20× presets) and review individual series prices and the full total before confirming. Mobile has a fixed total and bet button. Game and advance draw controls are inside More options. My tickets, Results, Wallet and account pages remain available. No receipt permission.

The shared screen theme uses emerald for User, blue for Admin, purple for Agent and teal for Shop. White working surfaces, coloured summary cards, clear selected states and higher-contrast labels keep the panels easy to scan. Each Irland Lotto series has its own colour, consistent across the User ticket picker, Shop series selector and results: Irland Lotto 10 green, Irland Lotto 11 pink, Irland Lotto 12 sky blue, Irland Lotto 13 yellow, Irland Lotto 14 purple, Irland Lotto 15 orange, Irland Lotto 16 teal, Irland Lotto 17 indigo, Irland Lotto 18 lime and Irland Lotto 19 silver. Receipt printing remains monochrome. Colours supplement names, checkmarks and selection outlines.

All roles have password changes and separate sessions. The User panel has bottom navigation on mobile and an account menu for Settings, activity and support. Operational panels use a navigation drawer on smaller screens. Keyboard shortcuts in the Shop terminal: **F1** results, **F2** reports, **F3** reprint, **F5** reset draft, **F6** review ticket. Shortcuts do not intercept input fields or open dialogs.

User **All / Even / Odd** buttons sit directly above the number pages. They select all, even or odd numbers across `00–99` in 2D, or the displayed hundred group in 3D. Changing the button replaces selections within that group and preserves selections from other 3D groups. The visible range is labelled. At the Irland Lotto 10 price of ₹100, an Even or Odd group at quantity 1 totals ₹5,000. Titli uses symbol selection.

## Game rules

On desktop windows at least 1100 px wide and 640 px high, the User game and Shop terminal use the full screen as a compact workspace. Results sit across the top, all ten coloured tickets stay in two rows, numbers sit below, and a separate checkout stays visible on the right. Long selections and price breakdowns scroll inside their own panels. User game/draw options open over the ticket area rather than pushing the controls down. Smaller windows and mobile keep the normal scrolling layout. Browser checks cover 1280×720, 1366×768, 1440×900, 1920×1080 and 1366×650, including visible ticket prices, the last number and checkout with all series selected.

The shared User/Shop ticket artwork has a banknote-inspired paper finish: warm fibre grain, original fine-line engraved borders and rosettes, a faded Irland Lotto series medallion, a woven vertical strip, serial-style series labels and a perforated price stub. The ten series colours and fixed prices remain consistent, with a visible checkmark and outline for selected tickets. The vector artwork stays sharp on high-density screens; ticket numbers are assigned only when a purchase is confirmed.

The User main page shows the latest completed draw above ticket selection, with its date/time and all ten Irland Lotto series in their matching colours. Separate 2D/3D/Titli result tabs preserve the customer's current bet. Results refresh with the existing five-second server polling, show an empty state before the first published result, and link to the full result history with “Sabhi results”. Mobile displays the ten results in two rows of five.

Irland Lotto 10–Irland Lotto 19 are display names used throughout panels, ticket details, results, CSV exports and printed receipts. Existing `JP10`–`JP19` database/API keys remain unchanged so previously issued tickets and committed draw results retain their identity.

These are editable local defaults, **not commercial rates inferred from the screenshot**:

The user-confirmed fixed prices apply to each series in all three games:

| Series | Price per ticket |
| --- | ---: |
| Irland Lotto 10 | ₹100 |
| Irland Lotto 11 | ₹200 |
| Irland Lotto 12 | ₹500 |
| Irland Lotto 13 | ₹1,000 |
| Irland Lotto 14 | ₹2,000 |
| Irland Lotto 15 | ₹3,000 |
| Irland Lotto 16 | ₹4,000 |
| Irland Lotto 17 | ₹5,000 |
| Irland Lotto 18 | ₹7,500 |
| Irland Lotto 19 | ₹10,000 |

Admin Settings exposes each rate separately, with server-validated integer limits of ₹100–₹10,000. Rates are fixed for customers; quantity multiplies the rate. User and Shop start at quantity 1. For two numbers across Irland Lotto 10 and Irland Lotto 11 at quantity 1, the total is 2 × (₹100 + ₹200) = ₹600. The server ignores any client-supplied price and records the draw's rate on each sold line; printed receipts, details and CSV exports show that recorded price.

| Game  | Range                         | Exact-match return |
| ----- | ----------------------------- | ------------------ |
| 2D    | `00`–`99`                     | 80 × stake         |
| 3D    | `000`–`999`                   | 800 × stake        |
| Titli | 10 named symbols, IDs `0`–`9` | 8 × stake          |

- Each Irland Lotto series has its own result for each game. Both series and number must match.
- Quantity: 1–500 per selection, subject to available balance and the total ticket limit. Returns include the original stake and use the winning series' fixed price. A quantity-1 Irland Lotto 19 2D winner returns ₹10,000 × 80 = ₹8,00,000.
- Draw interval: 15 minutes; eight upcoming draws support advance booking.
- Ticket limit: ₹20,000 and 1,000 distinct selections.
- Agent commission: initially 5%, rounded down to whole rupees per ticket and paid after settlement. Cancelled tickets earn none.
- Draws save their original price, payouts, limit and schedule. Edits affect newly scheduled draws after existing ones. Sales pause takes effect immediately.
- Random seeds use cryptographic randomness, a pre-sale SHA-256 commitment and deterministic HMAC rejection sampling. Seeds are hidden until settlement; the UI verifies their commitment. Exact result derivation is in `lottery-server/store.mjs`.
- No API can manually pick a winner or change a settled result.

## Persistence and scope

Database: `artifacts/3d-game/data/lottery.sqlite`. WAL transactions store accounts, sessions, draws, tickets, ledger, audit, request keys and support. Restart settles overdue draws and preserves balances. For backup, stop the server cleanly and copy the complete data directory; do not delete it to restart.

The earlier INR migration established legacy ₹1 pricing. The newer `2026-10-nice-series-prices` migration applies the confirmed fixed-price table to settings and unsold future draws only. Draws with issued tickets keep their original rates and payout snapshots. Historical lines without a saved rate resolve it from their original draw configuration. Account balances are not changed by pricing migrations. Both migrations run once, preserving later Admin edits. Monetary CSV columns specify INR and receipts use ₹.

This is a **local demo/internal-credit application**, not a connected real-money lottery operator. No payment gateway, bank withdrawal processing, official draw provider, identity-verification service or jurisdiction-specific commercial setup is connected. Printing uses the browser dialog. The receipt PDF was verified; physical thermal-printer hardware was unavailable.

| Environment variable     | Default / purpose                                               |
| ------------------------ | --------------------------------------------------------------- |
| `LOTTERY_PORT`           | `5190`                                                          |
| `LOTTERY_HOST`           | `127.0.0.1`; use a LAN interface for multiple counters          |
| `LOTTERY_DB`             | Custom SQLite path                                              |
| `LOTTERY_DEMO`           | `true`; `false` creates an empty workspace                      |
| `LOTTERY_ADMIN_PASSWORD` | At least 12 characters; required for a fresh non-demo workspace |
| `LOTTERY_COOKIE_SECURE`  | Set `true` when serving behind HTTPS                            |

For non-demo startup, use a **new database path** with `LOTTERY_DEMO=false` and a custom admin password. The administrator ID remains `ADM-1001`. Changing the flag does not remove existing demo accounts, balances or results. SQLite deployment is intended for one application process.

Ticket history and report totals include the full account scope. Ledger shows 500 latest entries; audit 150 events; results 100 draws. Exports contain their displayed scope. Cancellation keeps the ticket and writes a refund entry.

## Verification

```powershell
npm run lottery:check
npm run lottery:test
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/lottery-server/tests/playwright.config.ts
```

Backend tests cover authorization, scoped visibility, integer balances, atomic rollback, duplicate requests, cancellation/refunds, cutoffs, claims, user prizes, commission settlement, draw verification, configuration snapshots, suspension, password revocation, support and restart recovery.

Browser tests cover actual Shop sale/print/reprint/refund, Admin creation/funding, Agent shop creation/funding, User 3D purchase, picks across number groups, multi-series totals, quantities, denied receipt access, commitment verification, CSV downloads and navigation at 360, 390, 600, 768, 1024, 1440 and 1916 px. Browser tests use an isolated database.

Screenshots and a receipt PDF are in `tmp/lottery-review/`.

## Workflow references

The retail workflow separates sale, draw publication and verified prize claims. Official [National Lottery claim guidance](https://www.national-lottery.co.uk/results/how-to-claim) and [Kerala State Lotteries claim guidance](https://keralalotteries.com/English/index.php/prize-claim) were consulted for that distinction. This app does not copy their formats, payout rates or claim requirements.
