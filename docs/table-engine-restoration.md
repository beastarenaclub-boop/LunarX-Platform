# Existing graphics with imported table logic

The four-game graphics release (`747e4b57`) remains the visual baseline. Player pages, artwork, styling, banners, routes and lobby cards are unchanged. Game-information text now describes configured result modes for every connected table.

All 17 available scheduled tables use the imported result engine, including the 14 existing tables temporarily disconnected by the prior release. Normal, Collect, Distribute, Auto, RTP, next-result controls, decision history and bank budgets use the same admin surface. Saved modes and parameters are preserved. Rummy Royale Classic and Speed Auto Roulette remain withdrawn.

Migration 0068 preserves combined budget headroom when historical banks rejoin and freezes an existing same-each allowance against each reconnected bank. Per-game budgets and the three already connected tables are left intact. It does not change player balances, accepted bets, existing game payout settings or historical records.

New table rounds use the imported selector and exact accepted-price settlement. Rounds accepted under the rollback version retain their natural draw and old payout path, including when an admin has queued a forced result. Their settlement does not create a new imported-bank entry. Previously managed historical rounds remain recoverable and idempotent.

As in the supplied kit, Aviator/crash games keep seed-committed crash derivation and RTP settings. Blackjack and player-action games use their own payout/limit controls; the kit does not provide Collect or forced table outcomes for them. No controls are presented as supported without a connected outcome adapter.

Verification covers funded placement and exact wallet/bank settlement on every reconnected adapter, all five mode settings, forced outcomes, natural draws, accepted-round compatibility, budget migration, desktop/mobile admin controls and unchanged visual source files.
