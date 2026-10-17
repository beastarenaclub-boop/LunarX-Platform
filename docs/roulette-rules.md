# Roulette: 36× returns and selection limits

The 2026-10-08 update uses a European wheel with 37 equally likely pockets
(0–36). A winning straight bet returns 36 times its stake in total: ₹10 pays
₹360, including the original ₹10. Split/street/corner/line/dozen or column/
outside returns are respectively 18×/12×/9×/6×/3×/2×. Expected RTP is 36/37
(97.2973%); expected house edge is 1/37 (2.7027%). Results remain independent
of wagers. Individual rounds and sessions do not guarantee company profit.

Each selection accepts ₹10 minimum. Straight bets, including zero, have a
₹20,000 maximum; every other legal selection has a ₹1,00,000 maximum. Limits
aggregate all slips from the same player on that selection in the same round.
The existing overall slip cap remains configurable (₹5,00,000 by default),
with at most 40 selections per slip. Reordered numbers or irrelevant fields
cannot create a new selection identity. Invalid requests fail before debit.

The API checks these rules even when called directly. Cross-process player
admission locks serialize cap checks, debit and slip persistence. A separate
four-connection admission pool prevents lock holders from exhausting wallet
connections. Generic bet/cashout/loss endpoints cannot create or settle
roulette bets. Settlement credits integer paise exactly, preserves receipts
on retry, and recomputes round payout totals without double counting.

New rounds snapshot the 36-base terms. Migration `0043_roulette_36x_limits`
changes only the live roulette configuration. Already accepted rounds retain
their committed 31.45/35/36 bases and can still be independently replayed.
The admin paytable and player rules disclose the current returns and limits.

The responsive betting panel provides saved coin choices from ₹10 to ₹1 lakh,
custom whole-rupee coins, Undo, Clear, Rebet, wallet balance and per-selection
totals. Auto Bet submits explicitly selected chips once near the current
round deadline; Cancel disarms it. Drafts clear when the phase/round changes.
The Auto Bet switch also exposes manual placement. Rebet stages a selection
only after checking limits and balance. The redundant top countdown is gone;
one betting clock remains beside the board. The AI dealer and result wheel
keep their existing round synchronization.

Validation:

- `rouletteRules.test.ts`: inclusive limits, canonical selection identity,
  exact return across all 37 outcomes, historical base replay.
- `rouletteRules.integration.test.ts`: isolated `roulette_rules_test` DB only;
  invalid debit protection, cross-slip limits, concurrent same/different users,
  per-round reset, endpoint bypass protection, exact wallet return, repeat and
  interrupted receipt recovery, legacy rounds and closed windows.
- `roulette.test.ts` and the roulette case in `economics85.test.ts`: existing
  geometry, historical payout and economics regressions.
- `roulette-betting.spec.ts` and `roulette-dealer.spec.ts`: mocked HTTP/socket
  traffic, desktop/mobile placement, coins, custom limits, Auto Bet cancellation,
  320px/tablet/landscape layouts and dealer playback. No real accounts or funds.

Local release: `http://localhost:5200/roulette`. Images are tagged
`aviator-game-api:roulette-rules` and `aviator-game-web:roulette-rules`.
Previous container filesystems are retained as `:before-roulette-rules`.

Validation completed on 2026-10-08: API/player TypeScript checks and production
builds passed; 33 roulette math/wallet checks, four economics/admin checks and
all 11 browser checks passed. The deployed origin also passed five placement,
Auto Bet, responsive layout and dealer checks. Migration 0043 is recorded; the
latest round snapshots base 36, house edge 1/37 and minimum 1,000 paise. Both
services are healthy; live HTML/entry JS/CSS match the final build byte-for-byte,
and dealer video range requests return HTTP 206. Temporary Vite was stopped.
