# Tower Rush version 4: five-floor payout levels

Every five completed floors triggers the level-up visual. For new rounds,
the first payout milestone is floor 5: a ₹100 stake returns ₹150 total,
including the ₹100 stake and ₹50 profit. Cash-out is required to collect.

| Successful floors | Total multiplier | Total return on ₹100 |
| --- | --- | --- |
| 1 | 0.001× | ₹0.10 |
| 2 | 0.035× | ₹3.50 |
| 3 | 0.069× | ₹6.90 |
| 4 | 0.104× | ₹10.40 |
| 5–9 | 1.50× | ₹150 |
| 10–14 | 1.60× | ₹160 |
| 15–19 | 1.70× | ₹170 |
| 20–24 | 1.80× | ₹180 |
| 25 onward | 1.90× | ₹190 |

The opening four returns are retained from version 3. Any lower admin
multiplier cap applies. Returns are calculated with integer thousandths and
rounded down to paise. Zero-step recovery returns the original stake.

## Crash probability and compatibility

Crashes remain possible from floor 1, with independent seeded outcomes and
no maximum gameplay floor. For the uncapped paytable `M(n)`, per-floor
survival is `q = min(1, min((rtp / M(n))^(1/n)))` over
`n ∈ {1, 2, 3, 4, 5, 10, 15, 20, 25}`. Those points cover every possible
maximum of `q^n * M(n)`: between milestones and after floor 25 the payout
is constant while survival decreases. Thus the maximum theoretical stopping
return equals the snapshotted admin RTP before rounding or lower caps.
Other stopping floors can have substantially lower expected returns.

The random label is `tower:v4:floor:<n>` within the existing committed HMAC
stream. Outcomes cannot change on retry, cell selection, click timing or
later admin edits. Version 1–3 accepted rounds retain their paytable,
survival rules and cap. New placements require `towerPayoutVersion: 4`;
previous request IDs still recover their original receipts.

Auto build pauses at the effective payout cap (normally 1.90× at floor 25).
Manual builds can continue, with risk and no additional return. Level numbers
and the visual celebration continue every five floors; they do not imply
additional payout beyond the plateau. Reduced motion and animation controls
are respected. Restoring a round does not replay a level-up celebration.

Validation includes every payout boundary, theoretical RTP across stopping
floors, seeded replay, stale-page rejection, legacy round recovery, exactly-once
wallet credit, cash-out after the plateau, mobile layout and the level popup.
