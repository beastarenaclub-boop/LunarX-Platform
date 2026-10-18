# Commission dashboards

Master and agent dashboards (`/master/`, `/agent/`) and the admin dashboard (`/admin/`) include **Commission summary**. The same report is available in admin → Business network and in each operator's **Commission & P&L** page (`/master/ledger`, `/agent/ledger`).

- Today and Yesterday follow India midnight, independent of browser/server timezone.
- Weekly means the current Monday–Sunday. Monthly means the current calendar month.
- Custom dates include both endpoints; choose up to 366 days and press **Apply dates**.
- Masters can select any of their agents and see their own commission alongside agent allocations. Agents see only their own earnings. Admin can filter master, then agent, or switch to direct customers.
- Summary cards show settled stake, player returns, net revenue, commission, active players and distinct settled wagers. Breakdowns show each visible master/agent, including accounts with zero activity, plus daily totals.

`GET /api/network/reports` accepts `period=today|yesterday|weekly|monthly|custom`, `from`, `to`, `channel=b2b|b2c`, `masterId` and `agentId`. The server resolves preset dates and authorizes every account filter. Cross-branch access is rejected. Agent responses contain no company/master commission amounts; master responses contain no company commission amounts.

Reports read the immutable `network_ledger`. Dates refer to settlement/correction **posting time**, not wager opening time. Each correction contributes its signed delta. Stake and payout are counted once per settlement event, never once per allocation recipient. Each summary and its breakdowns share one database statement/snapshot. Wager counts are distinct source/reference pairs with activity in the period, including corrected or voided wagers; daily distinct counts should not be added to reconstruct the period's distinct count.

The ledger page uses the server's resolved dates and selected branch for its paginated entries. A master's detailed entries show the master's own allocations; agent allocations are shown separately in the summary. Wallet float, all-time outstanding allocation settlements, and Monday weekly payment obligations remain separate. This reporting update does not change commission rates, wallets, weekly grace periods, or branch locks.

Validation: `node tools/test-network.mjs` includes timezone, leap-year, signed correction, zero-activity and role isolation checks. `artifacts/3d-game/playwright.commission.config.ts` covers master/admin/agent filters, custom dates, matching ledger dates, error recovery and mobile layout. Its UI tests use isolated API fixtures; local operator/admin Vite servers are expected at ports 5318/5319 (override with `OPERATOR_TEST_BASE_URL` / `ADMIN_TEST_BASE_URL`).
