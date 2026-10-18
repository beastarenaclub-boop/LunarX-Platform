# Coin Flip stadium rounds

The storefront /coin-flip page uses CoinFlipLive and the existing shared table-round engine. All players in the same runtime watch a new round every 30 seconds, whether or not they bet. Demo rounds and wallets remain inside the isolated demo worker.

## Clock and settlement

Each persisted round snapshots 15 seconds of betting, 10 seconds of toss footage and 5 seconds of result display. Betting checks the persisted deadline under the round row lock, including a final deadline check before commit. The seed commitment is public before betting opens; the actual seed and common Heads/Tails outcome stay private until the toss deadline.

One slip is accepted per user per round. Duplicate requests return that slip; changed side or amount conflicts. Stake debit, bet row and slip row commit together. Settlement uses the round's snapshotted RTP/cap and credits exact integer paise once. The payout includes the stake and rounds down to paise. Results appear in the existing account reports.

Restart recovery locks admission to an unrevealed round, refunds every accepted slip and marks the round void atomically. A revealed round keeps its persisted result and settles idempotently. A paused table still finishes a revealed round resumed after restart. No schema migration is needed.

The new endpoints are under /api/instant/coin-flip/live: GET round, GET state and POST bet. The legacy instant endpoints remain compatible for old clients.

## Presenter and hand reveal

The new generated source reuses the existing adult female presenter and cricket stadium. The first 4.25 seconds are retimed to the ten-second toss window, keeping the physical coin face hidden. On the server result, the view cuts to a close-up of her open palm. Heads/Tails artwork is composited directly over the physical coin using final-frame coordinates. The overlay and the image share the same cover scaling, including mobile crops. The AI HOST label identifies the presentation.

Assets: stadium-palm-toss.mp4, palm-reveal.jpg and palm-provenance.json under public/media/coin-flip. Provenance records the generation task, prompt, timing edit and hashes. The still remains usable with missing video or reduced motion. Joining during the toss seeks to the shared clock instead of restarting the shot. Media never gates settlement or betting availability.

## Auto-bet and recovery

Auto-bet starts only from its explicit Start button. It repeats the chosen side and fixed stake, once per shared round, for 1 to 1000 rounds (default 10). Optional net loss and profit limits stop future bets. A previous wager must reconcile before the next is placed. Stop remains usable during a round; an accepted wager still settles.

The plan lives only in memory. Hiding the tab, going offline, a stale/failed snapshot, a rejected or uncertain request, insufficient funds, reload or navigation stops future auto bets. It never automatically resumes. Pending requests persist the original round, side and amount for manual recovery; no new round ID is substituted during retry.

## Checks

- node artifacts/api-server/test-coin-live.mjs: volatile PGlite only; opposite-side settlement, exact paise, duplicate admission, rejected/late wagers, disclosure timing, no-bet rounds, payout snapshots and restart/refund races.
- playwright.coin-live.config.ts: passive viewing, both palm results and wins/losses, countdown, video sync, auto-bet count/limits/stop/hidden/offline/reload/errors, pending recovery, account chips and responsive layouts.
- playwright.instant-collection.config.ts covers the neighboring instant games. The obsolete instant Coin Flip browser cases moved to the shared-round suite.
- Frontend/backend TypeScript and production builds. Live verification uses volatile demo funds only.
