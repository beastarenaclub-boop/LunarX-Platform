# Operator insights release — 19 October 2026

Application commit: `dbcbc799bb3a4b7340e647fe693a2d64dcfa20d1` on
`beastarenaclub-boop/LunarX-Platform/main`.

The release adds live player counts and lists to the admin, master and agent
panels, scoped account reconciliation, full filtered Excel/PDF downloads, and
admin-only betting rankings and investigation signals. Signals require review;
they do not establish cheating or automatically restrict accounts.

## Existing services

| Service | Resource | Deployment |
| --- | --- | --- |
| Private API | `srv-db9ncb7avr4c73enfk60` | `dep-dbammf5g1s2s73cmsh60` |
| Web gateway and panels | `srv-db9nceom7kps73e1jl8g` | `dep-dbamo449v7es7394h8u0` |

Both deployments reached `live`: API at 01:01:23 UTC and web at 01:05:48 UTC
(06:31:23 and 06:35:48 IST respectively).

Both services deploy manually from the existing main branch in Pabesto's
workspace (`tea-d2dnj3er433s73ek9qr0`). The previous live application commit was
`3a51fc570b829d39631c96afd96385b462ac64e4`.

No database migrations, environment changes, DNS changes or new services are
part of this release. The API's persistent disk requires an instance restart.
Gateway requests briefly returned 502/504 during that restart and recovered
automatically after the new API became healthy; no manual gateway restart was
needed. Existing game recovery ran during startup.

## Verification

Local verification on the isolated release source passed TypeScript builds,
API/admin/agent production builds, and the in-memory SQL/browser suite. Coverage
includes branch and role access, live-session deduplication and expiry, exact
money handling, historical ledger breaks, filtered rankings, and full Excel/PDF
exports. Admin/master/agent mobile screens passed without horizontal overflow
or JavaScript errors.

Production API verification passed valid HTTPS health checks on the player,
agent-player, admin and operator domains; anonymous report/export rejection;
admin login; live presence; account and betting reports; date/channel/amount
filters; invalid-range rejection; and all four account/betting Excel/PDF export
combinations. Excel files parsed with five sheets and PDFs had valid headers
and end markers. Verification did not place wagers, approve payments, modify
balances or change user accounts. Verification sessions were logged out.

Live browser verification passed the new admin Accounts & Tally and Bets &
player review screens at 1440px and 390px, with no JavaScript errors or horizontal
overflow. All four download buttons produced completed files. Both master and
agent account routes served the updated operator bundle. Authenticated operator
permissions were exercised in the isolated suite, rather than by changing or
creating production operator credentials. Post-rollout API logs sampled during
verification showed no server errors.

## Access

- Admin accounts: <https://admin.lunarx.live/admin/accounts>
- Admin betting review: <https://admin.lunarx.live/admin/bets>
- Master accounts: <https://panel.lunarx.live/master/accounts>
- Agent accounts: <https://panel.lunarx.live/agent/accounts>

Existing operator credentials are required. Master/agent views remain scoped
to their branch; betting review and its exports are restricted on the API to
admin/super-admin roles. The README documents filters, reporting limits and
test commands.

## Rollback

If necessary, redeploy the prior application commit above to the two existing
services. This release does not require a schema rollback. An API rollback
also restarts the instance; recheck public health and gateway connectivity.
Avoid resetting database or persistent-disk contents.
