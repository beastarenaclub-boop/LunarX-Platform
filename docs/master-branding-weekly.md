# Master websites and weekly collection

Every master automatically receives `https://play.lunarx.live/branch/<master-id>/`.
The dashboard shows the complete playing URL with Open, Copy and WhatsApp controls.
The same URL is inherited by the master's agents. Browsing is public; gameplay still
requires the assigned player account. The former `b2b.lunarx.live` hostname redirects
to `play.lunarx.live`, preserving paths and query strings.

Masters manage their site at `/master/website`. A website name and raster logo are
stored per master; uploads are resized in the browser and limited to 64 KB server-side.
SVG/HTML logos are rejected. Only the owning master and platform admin can change branding.
The logo/name appear on the lobby, account/login pages and website link card.

Custom domains are optional. The master saves a hostname, then adds the displayed
ownership TXT record (`_lunarx.<hostname>`) and CNAME to the platform's Render hostname.
Root domains may use Render's `216.24.57.1` A record instead. Verify & activate checks
ownership and routing before registering with Render, then waits for verified DNS and
working HTTPS. The permanent branch URL stays usable during setup. An active custom
hostname serves this master's lobby at `/`; player sessions are scoped to that master.
Disconnect returns the website to its permanent URL. Platform domains are reserved.

Runtime domain provisioning uses `RENDER_DOMAINS_API_KEY` and
`RENDER_PLAYER_SERVICE_ID`, configured as secrets/service settings, never in Git.
`PLAY_HOST` sets the shared hostname; `PLAY_CNAME_TARGET` sets the DNS destination.
Render's domain allowance and additional-domain charges apply to the platform account.
The live services are managed through the Render API; `render.yaml` records matching
non-secret configuration and secret placeholders for reproducible provisioning.

## Weekly account

- Week: Monday 00:00 through the following Monday 00:00, `Asia/Kolkata`.
- Grace: the full Monday. Enforcement starts Tuesday 00:00.
- Amount: signed **company** allocations from the immutable game commission ledger,
  using the original wager's commission terms. Losses/refunds carry forward. This is
  separate from the existing master/agent profit allocation settlement ledger.
- Activation: `weekly_started_at` is set when migration 0051 runs for existing nodes,
  or when a new master is created. Earlier ledger entries cannot cause a new lock.
  The first statement can be a partial week; the activation time is visible in the panel.
- A payment submission records amount and bank/UTR reference. It does not transfer
  money and does not unlock the branch. Only an admin's **Confirm received** action
  counts it. Partial payments reduce the due; rejected payments do not count.
- Submitted payment identifiers are idempotent. Reviews serialize per master and
  confirmed/rejected records are immutable. Actions are recorded in the audit log.
- Overdue commission prevents new wagers at the database boundary (including the
  shared wallet debit path) and prevents master/agent management writes. Existing
  rounds, payouts and refunds may settle. Masters retain login, read-only reports and
  the weekly payment submission screen so they can resolve the account.
- The lock is evaluated from the ledger on every operation: no scheduler or manual
  status reset is required. Clearing all overdue commission unlocks the branch.

Master: `/master/weekly`. Admin: `/admin/network` → **Weekly account**, select a master,
review the payment and confirm only after checking the received funds. Agents see
whether the branch is locked; master commission amounts, statements and payment
references are restricted to the master and platform administrator.

## Verification

`node tools/test-network.mjs` runs against a dedicated `_network_test` PostgreSQL DB.
It covers role/branch isolation, Monday/Tuesday boundaries, signed refunds, payment
idempotency, duplicate approval, immutable reviews, new-wager locks and unlocking.
Playwright guest/master-panel suites cover mobile/desktop playing links, neutral
customer wording, branding, DNS instructions, reports and payment submission.

The Render Nginx gateway resolves the private API hostname repeatedly using its own
container DNS. This allows the API's address to change during deployment without
requiring a second web restart. Proxy paths, Host headers and WebSocket routes retain
their original semantics.
