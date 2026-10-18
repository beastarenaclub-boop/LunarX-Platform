# Panel transaction filters

Master, agent and admin wallet transaction lists, company settlements, commission ledger entries, weekly payment history, and admin deposit/withdrawal lists support server-side filtering. Every match is counted before pagination; wallet and settlement totals include all matching rows. Lists use 50 rows per page in the UI.

- Dates: all time, today, yesterday, current Monday–Sunday week, current calendar month, or an inclusive custom range of up to 366 days. Calendar boundaries use Asia/Kolkata. Commission entries follow the selected commission summary period and branch.
- Search: literal, case-insensitive matching of relevant account/email, transaction ID, reference/UTR and memo fields. Percent and underscore characters are treated literally.
- Amount: inclusive minimum/maximum in rupees in the UI, converted exactly to integer paise. The range compares absolute amounts. Signed ledgers also support credit/debit selection.
- Wallet transactions: type and permitted master/agent selection. Commission entries: game code. Weekly payments: pending/confirmed/rejected. Admin payment requests retain their status and deposit-method selectors.
- Apply filters submits search/amount/type inputs and resets pagination. Date presets apply immediately. Reset filters clears the transaction toolbar and returns to the first page; branch, channel and existing admin status/method selectors remain selected.

Filters only narrow the authenticated user's existing scope. Masters can see their branch wallet records and their own settlement/commission account. Agents can see their own permitted records. Weekly payment filtering does not alter commission due, overdue balances, payment review, or the Monday grace period and Tuesday lock rule.

## API compatibility

`GET /api/network/wallet-ledger` and `/settlements` add `items`, `total`, `summary: {credit, debit, net}` and `range`, retaining the `entries`/`settlements` aliases. Weekly responses add `paymentTotal` and `paymentSummary`; the `payments` list alone is filtered. Admin deposits retain their existing object response and add summary totals. Admin withdrawals return the legacy array unless `paged=1`, which returns `{withdrawals, total, summary}`.

Common query parameters: `period`, `from`, `to`, `q`, `minAmount`, `maxAmount`, `direction`, `limit` (1–200), and `offset`. Type/status/game/account filters apply where supported. No payment mutation, database schema, or DNS change is required.

## Validation

`node tools/test-network.mjs` checks real PostgreSQL filtering, literal search, India-midnight boundaries, whole-result totals, deterministic pagination, invalid inputs and branch isolation. Playwright transaction coverage is included in `artifacts/3d-game/playwright.commission.config.ts`, alongside commission and master-panel regression tests. Local operator/admin servers use ports 5318/5319 or the corresponding test base URL environment variables.
