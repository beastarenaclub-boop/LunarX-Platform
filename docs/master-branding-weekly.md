# Master websites and weekly collection

## Customer manual QR payments

Master panel: `/master/manual-payments`. Each master can save a receiver name,
UPI ID, optional PNG/JPEG/WebP QR image and an on/off switch. Images are stored
in PostgreSQL, so they survive service restarts without a disk. The customer
wallet uses the uploaded QR or generates one from the UPI ID. Check that the
uploaded QR and UPI ID identify the same receiver.

Authenticated B2B customers see only their assigned master's active account;
visiting another branch URL cannot select a different receiver. A missing or
disabled account shows no payment QR. B2B automatic gateway payments are disabled
for this manual collection flow. B2C keeps its existing platform payment accounts.
The platform's manual-deposit switch and amount limits still apply.

The customer submits the amount and bank UTR. The request snapshots the receiving
master, UPI ID and account version. Stale/foreign account details and duplicate
UTRs within a master are rejected. Submitting a UTR does not credit the wallet.
Masters review requests under **Manual payments**, verify the received bank funds,
then approve or reject with a reason. Agents cannot edit QR details or review
deposits. Admin can manage each master's account from Network > Manual payments.

Approval atomically debits the master's available wallet float and credits the
customer's shared wallet, with an audit entry and balance updates. The master
must have enough float. Both the master and existing admin approval endpoints
use this same operation; simultaneous reviews cannot credit twice. Rejection
does not move money. These transfers do not issue platform deposit bonuses or
count as game revenue/company weekly commission. Existing requests retain their
original receiver when the master later edits or disables the QR.

Migration `0053_master_manual_payments.sql` must run before the updated API.
Deploy the player, operator and admin bundles along with the API. No new secret,
payment gateway or DNS record is needed. Historical deposits keep their existing
review workflow; collector ownership is recorded only for new branch requests.

Verification:

- `node tools/test-network.mjs`: fresh migration chain and isolated PostgreSQL
  tests for role/branch isolation, recipient changes, duplicate UTRs, insufficient
  float, concurrent master/admin approval and rejection.
- From `artifacts/api-server`, run
  `node --import tsx ../../tools/test-master-payments-browser.mjs` after the network
  suite. It builds isolated preview bundles and checks QR upload, reload,
  customer submission, approval, wallet balances and mobile layout. Screenshots
  are saved under `tmp/master-manual-browser`.
  Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome browser.

## Website and domain setup

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
