# Prize Lotto

Player: `/prize-lotto` in the main lobby. Operator: `/admin/prize-lotto` in the existing admin app. Both reuse existing accounts. Migration `0046_prize_lotto` adds three PostgreSQL tables; the normal API startup applies migrations and starts background settlement.

## Rules and economics

Eight choices: cashback, shopping, gift card, travel, gadgets, dining, fuel and gold. A winning ticket awards **10 times its stake, including the stake**: ₹1,000 returns ₹10,000. Vouchers denote face value, not an actual device, trip or quantity of gold. Cashback credits the shared INR wallet automatically. Other awards become voucher claims and do not create spendable wallet cash.

Defaults: 60-second draws, sales close five seconds before the result, ₹100–₹10,000 whole-rupee tickets, 85% reward-value RTP, ₹5,00,000 maximum payout exposure per category per draw. At 85% RTP, each category has 850 of 10,000 equiprobable buckets (8.5% chance). The remaining 3,200 buckets produce no prize. Expected return for every selection is 0.085 × 10 = 0.85. The 15% theoretical margin is not guaranteed profit. Voucher face value is included in RTP; cash-only RTP depends on the selection.

Admin settings allow 50–95% RTP, 30–900-second intervals, ticket caps and liability limits. RTP/interval changes apply only to newly scheduled draws; two upcoming draws are retained. Sales pause and stricter admission limits apply immediately. Settings require the existing admin password confirmation and produce an audit record. This game is managed through its dedicated Prize Lotto settings, not the generic crash-game RTP controls.

Exposure is the sum of all accepted non-cancelled stakes on a category × 10. A purchase that would exceed the limit is rejected before charging. There is no selection based on stake size, popularity or company losses; no winner override endpoint exists. Operators must provision funds and voucher stock to honour accepted tickets. The limit is an admission ceiling, not a funded reserve.

## Persistence and verification

Purchases, wallet entries, bet history and tickets commit in one transaction. The common wallet row lock prevents cross-game overspending. User/request idempotency keys prevent replay charges; the browser retains the key after an uncertain request. Cancellation refunds once before the cutoff. After waiting for a wallet lock, the server rechecks database time so a late purchase/refund rolls back atomically.

Each draw uses 32 random seed bytes. The commitment is SHA-256 over UTF-8 JSON of `["prize-lotto:v1", seed, id, rtp, intervalSeconds, maxTicket, maxLiability, salesEnabled]`. Results use HMAC-SHA256 with the seed string as key and `prize-lotto:v1:<drawId>:<attempt>` as message, starting at zero. Read the first four bytes as an unsigned big-endian integer; reject values at or above `floor(2^32/10000)*10000`. Reduce modulo 10,000 and divide into the published category buckets in catalog order. Results/seed remain hidden in both player and admin APIs until settlement. The browser verifies both commitment and result.

The one-second scheduler settles overdue draws after restarts without an open browser. A transaction advisory lock serializes game updates. Draw commitments are checked before settlement. Wallet cashouts and voucher award records are idempotent. PostgreSQL stores money in integer paise. Generic bet `payoutAmount` records only actual cash; voucher value is in bet metadata and Prize Lotto reports.

## Voucher fulfilment

The player requests a won voucher in **My rewards**. An admin opens the requested ticket and enters the actual issuer, code, expiry and redemption instructions, confirming their password. The code is available only in the owner's ticket response; admin lists and audit logs omit it. Voucher values must be honoured in full without an additional purchase requirement. The server rejects expired vouchers and requires at least 24 hours remaining at delivery. Replaying the same delivery succeeds; replacing an already delivered voucher is rejected.

No external gift-card supplier, travel-booking service or stock API is connected. The complete manual fulfilment flow requires the operator to obtain valid codes. The app does not generate fake redeemable codes. Reward obligations are recorded even when the player has not yet requested fulfilment. Admin reports separate cashback credited, voucher liability, refunds and awarded face value. Sales less awards excludes fees, supplier costs and pending draws.

## Run and verify

Use the existing stack: `docker compose up -d --build api web admin`.

```powershell
npm run prize:test
```

The PostgreSQL suite is opt-in. Set `DATABASE_URL` to an isolated database whose name ends with `_prize_lotto_test`, migrate it with the database package, then set `PRIZE_LOTTO_INTEGRATION=1` and run the same test command. It tests exact RTP across every allowed setting, malformed input, commitments, duplicate requests, shared-wallet contention, insufficient funds rollback, exposure admission, cutoff rollback, once-only refunds, paused sales, immutable draw rules, background recovery, cash versus voucher accounting, ownership, delivery idempotency, authentication and admin password confirmation.

Browser fixtures also refuse databases without that suffix. Start `artifacts/api-server/scripts/prize-lotto-fixture.ts` using `node --import tsx` from the API workspace with `COOKIE_SECURE=false` and `CORS_ORIGINS=http://127.0.0.1:5215,http://127.0.0.1:5217`. It uses the isolated test accounts `prize-browser@example.test` and `prize-browser-admin@example.test`, password `PrizeBrowser@12345`.

Start player Vite on `PORT=5215` with `vite.prize-lotto-test.config.ts`, and admin Vite on `PORT=5217` with its corresponding config. Set `PRIZE_TEST_API=http://127.0.0.1:5216` and run `npm run prize:test:browser`. Tests cover actual purchase/refund, player claim, admin voucher delivery, draw verification, settings, shared coins, and no horizontal overflow at 320, 390, 768, 932 and 1440px. Review images are saved under `tmp/prize-lotto-review/`.
