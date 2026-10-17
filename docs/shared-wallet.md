# Shared wallet

Prize Lotto (`/prize-lotto`) uses this same wallet for tickets, cancellations and
automatic cashback. Voucher wins are recorded separately as face-value rewards;
they are fulfilled through `/admin/prize-lotto` and do not increase spendable cash.
See [Prize Lotto rules and verification](prize-lotto.md).

Every playable game uses one INR wallet per account. Existing `?game=` query
parameters and game codes are accepted for compatibility; the physical wallet
keeps its original `lunar` key. `/wallet/balances` returns aliases of the same
balance, so clients must never sum those values. Deposits, withdrawals, bets,
refunds and winnings all use the shared ledger. One chip represents one rupee.

This covers every game in the main lobby, including Win Go, Bike Racing,
Horse Racing, Rummy, Dragon Tiger, Forex Trading and Irland Lotto. Separate standalone previews and the offline Irland Lotto shop application keep their own accounts and balances.

Irland Lotto uses migration `0045_lottery_shared_wallet`. Its `/lottery` route reuses the current lobby session, shared coin preferences and Wallet page. Fixed series prices determine how many ticket units a selected coin buys. Tickets, common bet records and shared wallet debits/refunds/prizes are atomic in PostgreSQL. The background draw engine recovers after restarts and never credits a prize twice. The operator console's Lottery page provides tickets, results, totals and audited settings; the existing Games switch stops new bets. Archived standalone SQLite demo credits are not converted into shared funds. See [lottery integration](lottery-lottodesk.md) for test commands and separate shop access.

Forex Trading uses migration `0039_forex_shared_wallet`. Its bets and settlements
commit atomically with the shared ledger in PostgreSQL. Retries cannot debit or
pay twice, and background settlement continues after leaving the screen. Its
balance and add-funds links open the main Wallet page. The old practice refill
returns 410; archived SQLite practice funds are not converted to wallet money.

Win Go uses PostgreSQL rounds and bets from migration `0038_wingo_shared_wallet`.
Its bet debit, result and payout commit atomically with the shared ledger.
Request keys prevent duplicate deductions; wallet row locks prevent simultaneous
games from spending the same funds. The startup scheduler recovers overdue rounds
and pays winnings even after the player leaves. Its wallet buttons open the main
Wallet page, with live balance updates across tabs. The old integrated refill
endpoint returns 410. The archived SQLite practice balances and unfunded practice
bets are not converted into shared wallet funds; the old volume is retained.

Migration `0036_shared_wallet` transfers the outstanding balance of each legacy
game wallet into the shared wallet with paired adjustment entries. Original
ledger entries remain intact, the total value is unchanged and the old wallets
have zero spendable balance. Deployment must run migrations before starting the
updated API. Take a database backup before applying it to an existing instance.

Dragon Tiger now debits and settles the shared wallet within its existing round
transaction. Its leaderboard still measures only Dragon Tiger results. Legacy
practice balances remain archived; unbacked practice chips and pending practice
slips are not converted into wallet money. The server continues settlement when
players leave the screen.

Rummy now stores its table and turn deadline in PostgreSQL. The server alone
shuffles, validates moves and computes payouts. Clients submit versioned actions;
stale requests cannot debit a second entry. Stock and opponent cards are hidden
until the hand ends. Bets and payouts share the same transaction as the table
update. Refresh restores the server table and auto-bet plan. Browser practice
state is ignored and the local refill button has been replaced by a wallet link.

All games use the common chip ladder where their stake limits permit it.
Wallet events invalidate all cached balance displays. Winner receipts identify
their originating game; table receipts use settled rounds, instant games wait
for their reveal, and crash receipts use authenticated server settlement events.

Verification:

- `wingoSharedWallet.integration.test.ts`: all wallet aliases, account isolation,
  concurrent cross-game bets, retry safety, failed-debit rollback, hidden results,
  background settlement and exactly-once payouts, including fractional returns.
  Uses the same isolated database requirement below.
- `shared-wallet-wingo.spec.ts`: authenticated test account, real wallet debits,
  another browser tab updating, wallet navigation, refill rejection and settlement.
  Run `scripts/seed-shared-wallet-browser.ts` in the API against an isolated
  `_shared_wallet_test` database, then supply its `WINGO_TEST_EMAIL` and
  `WINGO_TEST_PASSWORD` plus `PLAYWRIGHT_BASE_URL` for that test stack.

- `sharedWallet.integration.test.ts`: one physical wallet, concurrent debit
  serialization, once-only demo funding, Dragon Tiger retry/settlement, hidden
  Rummy cards and authoritative once-only Rummy payout. Requires a separate
  database ending in `_shared_wallet_test` and `SHARED_WALLET_INTEGRATION=1`.
- `shared-wallet-layout.spec.ts`: all 21 game routes at 320×568, 390×844,
  768×1024, 932×430 and 1440×900, plus wallet/lobby consistency. Its test API is
  isolated from the deployed app (`SHARED_WALLET_TEST_API`, default port 5180).
- `shared-wallet-horse.spec.ts`: Horse Racing balance, common chips, bet controls
  and result overlay at the same five screen sizes, with a mocked winning race.
- `shared-wallet-popup.spec.ts`: game labels and large amounts fit phone and
  landscape dialogs. `coin-packs-chips.spec.ts` checks the shared chip catalog
  and deposit packs; Dragon Tiger and Rummy gameplay suites cover their results.
