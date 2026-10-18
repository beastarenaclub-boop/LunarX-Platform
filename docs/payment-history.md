# Historical payment reconciliation

This release adds read-only reporting over existing deposit requests, withdrawal requests, payout records and wallet entries. It does not add payment collection, approval, payout or KYC bypass capabilities. Existing commission and weekly settlement reports retain their own accounting basis; deposits are not gaming revenue.

## Access

- Admin: Network > Payment history, with channel, master and agent selectors.
- Master: `/master/payments`, restricted to customers currently assigned to the master's agents.
- Agent: `/agent/payments`, restricted to the agent's current customers.
- Customer: `/wallet?tab=history`, restricted to the authenticated customer's own records. Operator identities and branch names are omitted from customer responses and exports.

The authenticated GET endpoints are `/api/network/payment-history` and `/api/payments/history`. Both return `Cache-Control: no-store`. Suspended account and branch checks continue to apply. Historical branch attribution uses **current membership**, not an immutable snapshot of the original payment's owner.

The history component uses a separate cache for each mount and immediately discards inactive queries. Returning to the screen waits for a fresh response instead of showing a prior panel session's payment records.

## Filters and export

All, today, yesterday, weekly, monthly and custom dates use India time. The date is the original request date, not the review or payout date. Search matches literal request IDs/references; operator searches additionally match customer and branch identities. Filters include record type, status, amount and wallet reconciliation. Counts and totals cover all matching records, independently of the page size.

CSV export uses the same access scope and filters and includes all matching rows, up to 10,000. Larger exports require narrower filters. Amount columns explicitly use paise. Text is quoted and spreadsheet formula prefixes are neutralized. Customer exports omit operator identities.

## Matching rules

`payment_requests` and player `withdrawals` remain distinct sources. A withdrawal request is never treated as a confirmed payout based on a shared amount, UTR or timestamp. Their IDs receive separate source prefixes. Colliding withdrawal request/payout IDs for the same customer are flagged, including when a filter hides the other source.

Wallet links require the same customer and currency plus either an explicit ledger entry ID or the correct ledger reference type and request ID. A mismatched reference on an explicitly linked entry is flagged. Approved deposits must match a positive wallet credit; approved/paid payouts must match a negative wallet debit. Rejected, cancelled or failed records with a nonzero wallet change require review. Refunded failed payouts with zero net wallet change match. Withdrawal requests have no reliable payout confirmation link and are labeled accordingly.

The deposit wallet total sums distinct linked ledger entries, preventing a reused bad pointer from inflating that total. A wallet match is **not bank verification**. Only payout records marked `paid` contribute to the paid withdrawal total; an approved request does not. The response explicitly sets `bankVerified: false`.

## Validation

- `node tools/test-network.mjs`: dedicated `_network_test` database only; integration coverage for roles, branch/channel isolation, forged filters, customer redaction, duplicate references, missing entries, refunds, totals, India date boundaries, pagination, CSV and unchanged wallet state after reads.
- `node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.commission.config.ts`: role-based browser fixtures, filters, CSV download, details, error recovery and mobile layout. New customer fixture server defaults to port 5317; operator/admin defaults remain 5318/5319. Fixtures do not submit payments.

No schema migration, new secret or DNS change is required.
