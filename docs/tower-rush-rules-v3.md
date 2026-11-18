# Tower Rush version 3

New rounds can crash on any build, including floor 1. There are no guaranteed
safe floors and no maximum floor. A successful floor does not automatically pay;
the player must cash out. Existing version 1 and version 2 rounds keep their
accepted rules, including version 2's fixed crash between floors 20 and 35.

## Total returns and RTP

For successful floor `n >= 1`, the uncapped multiplier is
`M(n) = (1 + floor(999 * (n - 1) / 29)) / 1000`.
Floor 1 returns 0.001×, floor 30 returns 1×, and floor 100 returns 3.411×.
The round's snapshotted payout cap applies. Payouts use integer thousandths
and round down to paise. Returning before the first build refunds the stake.

Each floor independently succeeds with probability `q`. The shared
`towerStepChance(rtp)` calibrates `max(n >= 1, q^n * M(n))` to the round's RTP.
This is a maximum theoretical stopping return before paise rounding and caps;
cash-outs at other floors can have a substantially lower expected return.
The old minimum RTP of 62.1% no longer applies to new rounds.

Calibration uses binary search on `q` in `[0, .99]`; .99 already gives a maximum
return above 100%. With `a=999/29000` and `b=.001-a`, `q^n*(a*n+b)` bounds the
rounded paytable from above. Beyond its continuous peak
`-1/log(q)-b/a`, that bound decreases. Once the bound is below the best return
found, the entire remaining tail is excluded. No gameplay floor limit is used.
The bounded cache stores up to 64 RTP calibrations per process.

The random value is the first 13 hexadecimal digits of HMAC-SHA256 divided by
`2^52`, with the round's server seed as key and message
`instant:v1:tower-rush:<clientSeed>:tower:v3:floor:<n>`.
A floor succeeds iff that value is below `q`. Timing, selected cell, retries,
reloads and later admin edits cannot change an accepted round's outcomes.

## Client and settlement

New placements require `towerPayoutVersion: 3`; stale pages receive a conflict
before debit. Existing request IDs recover the original receipt even when the
submitted version is old. Moves use the version and RTP stored on the bet.
The wallet retains transaction locking, expected-step validation and idempotency.

Auto build operates only on the current stake, pauses at the payout cap or on
loss/error/tab exit, and does not pause at floor 34 for version 3. Manual builds
remain possible after the payout cap, with risk but no additional return.
The UI shows the per-floor survival chance and distinguishes payout caps from
floor limits. Rendering continues using the bounded visible floor window.

Verification covers probability calibration, seed replay, floor-one losses,
survival beyond 35, cash-out at 100, wallet credit idempotency, RTP snapshots,
legacy rounds, stale pages, browser recovery and the existing graphics suite.
