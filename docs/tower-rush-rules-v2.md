# Tower Rush rules version 2

New placements explicitly acknowledge `towerPayoutVersion: 2`. Older pages are
rejected before a debit and instructed to reload. An existing request ID can
still recover its original receipt. Each accepted round snapshots its version,
RTP, payout cap and seeds; metadata without the version uses legacy rules.

Floors 1–19 always succeed. One crash floor in the inclusive range 20–35 is fixed
by HMAC-SHA256 of the server/client seeds, using label `tower:v2:crash-floor`.
The crash floor fails, rather than paying then failing. The server seed stays
hidden until settlement. Player identity, past winnings and click timing do not
change the draw. No round automatically pays at floor 30.

Successful-floor total returns, before the admin cap:

| Floor | Multiplier | ₹100 stake returns |
|---|---|---|
| 1 | 0.001× | ₹0.10 |
| 10 | 0.311× | ₹31.10 |
| 19 | 0.621× | ₹62.10 |
| 20 | 0.655× | ₹65.50 |
| 25 | 0.827× | ₹82.70 |
| 30 | 1.000× | ₹100.00 |
| 34 | 1.137× | ₹113.70 |

The linear curve in thousandths is `1 + floor(999 * (floor - 1) / 29)`.
Multiply integer paise by integer thousandths and divide by 1000, rounding down.
Small stakes can therefore return zero paise at early cash-outs. Version 1 still
uses its original hundredth precision. A zero-move exit refunds the original
stake. A return below 1× is a partial return, not profit.

## Admin RTP and crash probabilities

To retain the existing admin RTP control, the distribution mixes uniform crash
floors 20–35 with extra probability at floor 35. For a successful floor n in
20–34, survival is `w + (1-w)*(35-n)/16`. Choose the largest w for which
`survival(n) * multiplier(n) <= RTP` at every stopping floor. The maximum expected
stopping return equals the target before paise rounding and payout caps; earlier
cash-outs can have lower expected returns. At a high RTP most crashes are late.
The UI displays conditional survival for the next floor and explains weighting.

Since floor 19 is guaranteed and pays 0.621×, a target below 62.1% is impossible
under these rules. Game Defaults rejects an edge above 37.9%; new placements also
guard against invalid existing configuration. Existing rounds can still settle.
Game Defaults exposes the house-edge control and keeps its RTP fields consistent.

Auto build pauses at floor 34, or earlier at the payout cap. It never places the
next bet. A warning states that building floor 35 loses the round; cash-out is
available before that move. No maximum-height change applies to legacy rounds.

## Validation

Run the API math tests in `instantCollection.test.ts`; they cover all crash
boundaries, calibration across multiple RTP targets, replay and exact payouts.
Run `node tools/tower-assets/check_wallet.mjs` from the repository root for normal
wallet debits/credits in a disposable in-memory PostgreSQL database, including
stale-page rejection, request recovery, admin edits, crash 20/35, floor 30 cash-out
and legacy rounds beyond 35. It never connects to the live database.
Browser coverage is in `artifacts/3d-game/tests/tower-rush.spec.ts`.

Tower moves use a separate budget of 120/minute per player and 600/minute per IP
(demo workers retain their IP exemption). New placements keep the existing
30/minute per-player and 60/minute IP limits. A floor advances an existing stake;
it must not consume the placement budget and block a 35-floor round. The local
HTTP regression in `towerRateLimit.test.ts` verifies both limits remain enforced.
