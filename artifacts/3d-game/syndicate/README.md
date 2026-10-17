# SYNDICATE merchant operations portal

Database-backed member operations built with React, Vinext and Cloudflare Workers. The existing game projects are separate and unchanged by this portal migration.

## Start locally

Run `START-SYNDICATE-PORTAL.cmd` from the workspace root, or from this directory:

```powershell
node scripts/run-framework.mjs dev --port 5198 --hostname 127.0.0.1
```

Open http://127.0.0.1:5198 and complete the entry game. The entrance contains no login/signup links. Only after unlocking the final gate does `/login` offer the three portals below:

For local HTTPS on Windows, stop the HTTP server and run `START-SYNDICATE-HTTPS.cmd` from the workspace root. It serves https://127.0.0.1:5198 using a 180-day server certificate trusted only by the current Windows user. The key and password are kept in an ignored, user-restricted `.sites-runtime/https` directory that Vite does not serve. To include a LAN address when first creating the certificate, run `powershell -NoProfile -File scripts/setup-local-https.ps1 -IpAddress YOUR_LAN_IP` from this directory before starting. Other devices do not automatically trust this local certificate. The existing HTTP launcher and hosted builds remain unchanged.

The root is served by `app/page.tsx`. Do not restore the old standalone `index.html` or demo Vite entry: Vite serves that file ahead of the portal route during development. Run `npm run test:local-entry` to check the complete desktop/mobile entrance on port 5198 as well as the usual built-Worker tests. The local entrance checks use anonymous browsing without changing account data.

| Panel  | Login           | Signup           | Dashboard           |
| ------ | --------------- | ---------------- | ------------------- |
| Admin  | `/admin/login`  | Not available | `/admin/dashboard`  |
| Agent  | `/agent/login`  | Earned from member eligibility | `/agent/dashboard`  |
| Member | `/member/login` | `/member/signup` | `/member/dashboard` |

The old `/signup?ref=...` link still supports member registration. On `/` and the legacy `/demo` entrance, solve the triangle directly on the starting screen (five correct fragment rotations from the initial position) to start **The Inner Gate**: align three triangle fragments toward the blinking eye, then watch the first gate open without a camera check-in, travel through the dark passage toward the light, search three objects for a randomly hidden key, pick it up, then unlock the final gate. The final animation opens `/login`, with the current admin, agent and member choices. The passage can be paused; keyboard controls, a clue, restart, back-to-entrance and reduced-motion mode are available. The root always shows the entrance so old browser entry flags do not skip the game. Direct login, signup and dashboard URLs redirect to the entrance until this browser completes the game. Member referral IDs are retained and restored after completion. Removed admin/agent signup URLs return 404. The server records the puzzle, passage, key discovery, pickup and unlock in order; a random HttpOnly, SameSite=Strict browser-session cookie permits the account pages for at most eight hours. Restarting a solved puzzle replaces that entry grant. Email signup/login/recovery APIs also require completion. The game does not authenticate anyone or access account data; location permission and account credentials are still required at sign-in. This is an entrance flow, not an anti-bot or identity-verification mechanism.

Passwords need 12–128 characters. Save the recovery code shown after signup; email delivery and email verification are not configured. Password recovery and password changes replace this code and revoke previous sessions. Keep the development server bound to loopback.

**Member signup is the only registration path.** The existing administrator account remains in place. Admin signup, invitations and the agent signup page/API are disabled; historical invitation tokens cannot create administrator access. Extra role fields in registration requests cannot change the member role.

**Members earn agent access on their existing ID.** Own approved onboarding plus approved left and right direct members unlock the agent panel automatically. Member login still accepts the same credentials after promotion and opens the agent dashboard. The Illuminati Syndicate journey appears on the overview, work/tasks page and the full **Agent eligibility** page: mandatory account/contact/KYC tasks, review status, direct-member progress and three approval seals. Uploaded documents alone do not produce 100% eligibility; all three profiles need approval. No new agent account or signup is needed.

**Location is required for account access.** Login, signup, recovery and password changes request browser location after an explicit acknowledgement. Denied permission, unavailable position and timeout block completion. The server rejects missing, invalid or stale coordinates (older than two minutes), and every new password session stores the accepted position. Earlier sessions without a location record require a new login. Connected sign-in also needs an expiring, identity-bound location grant before any portal data or document is accessible. Revoking the browser permission while the dashboard is open signs out the session when the browser supports permission-change events. API tokens remain server-to-server transaction credentials and do not request device location.

Login logs store coordinates rounded to two decimal places, reported accuracy, capture/consent time, connection IP and device information. Admins and the account owner can view the audit record. No IP-location fallback or background position tracking is used. Browser-reported coordinates and acknowledgement are not hardware-attested proof of physical presence; a custom client can fabricate them. HTTPS or localhost and working device location services are required.

The existing owner manages company details in Workspace settings. Member registration requires an initialized workspace and an available sponsor referral ID. Public requests cannot initialize a new administrator or promote a member to admin; a fresh installation requires owner provisioning outside public signup. Existing accounts, documents and audit history are preserved. No default credentials or sample KYC records are seeded into the working database.

Both `/` and the legacy `/demo` address open the working database-backed portal. The sample preview and demo role selector have been removed; `/preview` redirects to `/`. Historical browser sample data is not imported into the working database. This localhost update does not publish a new hosted deployment.

For a fresh checkout, use Node.js 22.13+ and run `npm run install:ci`, then `npm run build`. Initialize the local database once:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_swift_dragon_lord.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_breezy_maddog.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_fair_brother_voodoo.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_complex_squirrel_girl.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_youthful_power_pack.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_fine_drax.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_modern_kingpin.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_fine_drax.sql
```

Apply each migration once, in order. For an existing database, apply only migrations it is missing. Future schema changes use `npm run db:generate`. Hosting deploys the tracked Drizzle migrations; application requests never create tables.

## Included behavior

- Authenticated signup with referral ID, five bank preferences and an administrator/member/agent permission model enforced on the server.
- **New member signup** inside the dashboard creates a shareable signup URL for a sponsor with an open position. Referral IDs prefill from the link. An already-signed-in visitor can explicitly switch accounts without silently replacing their session. Signup validation errors remain visible on the form.
- Administrator **Members & documents** includes draft, submitted, approved and correction-requested profiles, search/status filters, account/proof/KYC counts, completion checks and incomplete email registrations. Each member has a complete profile page with business and contact references, all saved bank accounts, linked contacts and limits, required/missing documents, private image/PDF/video previews and downloads, review decisions, tasks, financial entries and recent activity. Admins can also open this page from the account register, binary network or review queue.
- Email/password login, logout, recovery-code reset and password changes. Passwords use salted scrypt hashes; only hashes of session tokens and recovery codes are stored. Sessions last eight hours and use HttpOnly, SameSite cookies, with Secure on HTTPS. Persistent email/IP attempt limits reject repeated login guesses.
- Binary placement with unique left/right positions. A full sponsor rejects a third direct signup; a new signup must use an available downline sponsor's reference.
- Binary cards, the network register, member overview and administrator member pages distinguish the member's own referral ID from the sponsor's referral ID used to join, and show the sponsor name and left/right position. A member can see their direct sponsor's name/ID even when the sponsor is outside their visible downline; this does not expose the sponsor's private profile, documents or finances.
- Onboarding: registered firm/GST references; two owner-controlled contact references; five current and two savings account references, contact mapping and ownership consent. Only the last four account/contact digits are collected in form fields.
- Signed-in members see current/savings account counts, bank-proof and KYC upload counts on the overview and **My bank accounts** page. Bank selection and account forms are available directly there. **Save progress** stores complete account references individually while business/contact details are still being collected; empty slots are not counted. Final submission still validates the complete profile.
- Each saved account has a private PDF/JPG/PNG bank-proof upload (15 MB maximum), replacement and download. Proofs are bound to the account ID, bank, type, masked digits and holder; changing those details requires fresh evidence. Administrators can download the matching proof from the account register or member review. New review submissions require seven matching bank proofs plus seven KYC documents. Previously approved profiles stay approved; administrators can reopen them to collect missing evidence.
- Private PDF/image documents and MP4/WebM KYC uploads to R2, file-type checks, a 15 MB limit, authenticated owner/admin downloads and manual review. GST format checks do not verify government registration. Video upload is not an automated identity check.
- Requested current-account limits of INR 50 lakh or INR 1 crore. Administrators record independently evidenced bank-approved limits; the portal does not grant bank limits or take account/SIM control.
- Own approved onboarding plus two directly referred approved members automatically unlock agent assignment. Agents may assign work only to approved members in their own downline. Members progress tasks, then the assigner/admin approves completion.
- Manual and authenticated API transaction recording, pending approval, immutable reviewed entries, unique-reference duplicate protection and exact integer paise storage.
- Expenses require a private receipt before administrator approval. Members upload receipts against their own pending expenses; administrators can attach and review them. Uploads lock once reviewed. The **Expenses & allowances** page shows these records, receipt downloads and exports. Administrators can record member allowances as pending income; approved allowances affect bookkeeping only.
- Wallet bookkeeping = approved income minus approved expenses. Turnover is shown separately and never added to spendable funds. The portal does not hold, receive, send or settle money.
- Today, yesterday, current/last month and custom date filters (Asia/Kolkata), bank filters, day/month totals, real Excel workbooks, PDF financial reports and individual/all-task PDFs. PDFs are rasterized for reliable Unicode rendering.
- Server audit events with connection IP, device/user-agent and available network city/country. Browser location is mandatory for sign-in, requires explicit sharing and browser permission, and is rounded to two decimal places. An IP does not reliably identify a person or their precise location.
- Profile revision checks, review queues, 15-second data refresh, server-side role checks and private document access. Agents see downline status/counts and aggregate member performance; raw account details, documents and ledger entries remain private.
- **Commission chart** inside Commissions & rewards shows the current plan split, an editable example combining five or more accounts, and separate left/right turnover examples. The confirmed default is INR 1.20 per INR 100 verified turnover: 0.50 source member, 0.20 eligible direct parent, one shared 0.10 indirect pool and 0.40 company/admin. INR 1 lakh therefore funds INR 1,200 total: INR 500 member, INR 200 direct agent, INR 100 shared indirect pool, INR 400 company when every share has an eligible recipient. Rewards reserve remains zero. Joining alone earns no commission.
- **Tree calculator** illustrates 1–20 full binary downline levels without materializing millions of nodes. Set per-member turnover/transaction count and 0–1,000 eligible ancestors above the selected agent. Click a level or diagram node to trace one source's allocations, including whole-paisa pool rounding. Per-level earnings, whole left/right branches, company reconciliation and Excel/PDF exports use the same settlement engine. Equal activity and full eligibility are explicit assumptions, not actual/guaranteed income.
- **Member performance** provides date-filtered own, direct and indirect booked commissions, whole left/right branch totals, actual source-level summaries, clickable direct members, bank/day summaries, task status and Excel/PDF exports. Agents can inspect only their own descendants; ordinary members can inspect only themselves, and administrators can inspect everyone. The server enforces this scope independently of UI selection. Successful counts come from posted settlements, reversed settlements are excluded, and historical allocations are not recomputed under the current plan. Tree levels use current ancestry and original booked amounts; each source is counted once. Approved and settled turnover are shown separately. Turnover and operating income/expense remain distinct from commission entitlements.
- Administrator-editable company declarations, existing commission/reward policy controls, and an interactive Hinglish **Portal guide** with browser-supported narration.


**Visitor camera check-in (optional):** solving the triangle opens the gate directly. Camera permission, a saved photo and a visitor receipt are not required for entry or account access. Clicking the eye manually opens an optional camera preview; dismissing it or denying permission never blocks the game. A green check marks a saved photo only, not identity verification or entry eligibility. Deleting or expiring an optional receipt does not revoke completed game access. No camera or location request runs on page load. After explicit acknowledgement, the visitor enables camera and location, previews a live camera feed, captures one photo, reviews/retakes it and presses Save. Capture and closing stop every camera track; no audio is recorded. D1 stores consent/version/time, a visitor-supplied name, connection IP/device and approximate browser coordinates; private R2 storage holds a bounded JPEG. This is an unverified visitor receipt, not face recognition or identity verification. Only administrators can list, view or delete records under **Visitor check-ins**; member and agent access is rejected. The same browser can withdraw its photo/record for 24 hours; administrators can delete it later. Records otherwise remain until deleted. Anonymous upload sessions are random HttpOnly cookies, rate limited, size bounded and checked for fresh consented coordinates. Localhost logs a loopback IP.

The entry soundtrack continues through client-side page navigation, walk pause and background tabs after initial interaction, with an explicit mute control. The 3D/code background and eye blink respect reduced-motion preferences.

## API imports

An administrator creates a token under Workspace settings. The secret is shown once; only its SHA-256 hash is stored. Keep it on an authorized integration server. Tokens are limited to transaction ingestion and can be revoked immediately.

```http
POST /api/entries
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN

{
  "member": "MEMBER_ID",
  "account": "APPROVED_ACCOUNT_ID",
  "kind": "Turnover",
  "amount": "10000.00",
  "date": "2026-10-10",
  "reference": "PROVIDER_UNIQUE_REFERENCE",
  "description": "Reconciled processing volume"
}
```

Kinds: `Turnover`, `Income`, `Expense`. Amount is a positive rupee decimal with at most two decimal places. Turnover requires an approved account; income/expenses may use the company ledger by omitting `account`. All imports remain `Pending` until reviewed. Identical reference retries return the existing record. Changed values with the same reference are rejected. Imports are limited to 60 successful API-import audit events per administrator per minute. No bank/provider credentials or provider adapter are configured.

## Commissions and rewards

Open **Commissions & rewards** for the distribution calculator, entitlement ledger, membership progress and the administrator policy editor. The confirmed default plan is **active: turnover based, expressed as rupees per INR 100 verified turnover**. All of a member's accounts contribute their actual approved turnover. Transaction count remains a reporting/rank input and does not multiply this rate. Existing administrator-saved plans retain their configuration; future edits can pause the plan or change its basis and rates. Settlement still requires administrator review of actual service revenue.

Confirmed allocation per INR 100 turnover: 120 paisa gross fee (1.2%); 50 paisa self (0.5%); 20 paisa direct eligible agent (0.2%); 10 paisa shared indirect pool (0.1%); 40 paisa protected company/admin share (0.4%). The shared pool is funded from the previously configured company share. At INR 1 lakh, the split is INR 500 member, INR 200 direct, INR 100 indirect pool and INR 400 company. Left and right members each doing INR 1 lakh pay their direct agent INR 200 each, INR 400 combined; if their combined turnover is INR 1 lakh the direct total is INR 200. Rates remain administrator-editable, subject to budget validation. Missing or ineligible shares stay with the company: without any indirect recipient, company retains INR 500; without any upline it retains INR 700. Fees above the configured budget and record-level rounding remainder also stay with the company; underfunded records are rejected. Amounts are floored to whole paise per settlement, then summed across accounts; fractional paise are not carried between records.

Two indirect modes are supported:

- **Pool:** all eligible indirect ancestors share a single pool. Whole-paise remainder goes to the nearest eligible ancestors. With many ancestors, some shares can round to zero.
- **Limited levels:** each eligible indirect ancestor within the configured physical depth receives the configured rate. Ineligible positions are not compressed. The default fee budget supports only one fixed 10-paisa indirect level if this mode is selected; pool mode can share the same 10 paisa across all eligible ancestors without a fixed depth cap. Increasing the pool, level payouts or reserve requires rebalancing another share. Unlimited identical upline payments cannot fit a finite fee budget.

For a selected root agent with five full downline levels, no eligible agents above it, and INR 1 lakh turnover per member in one settlement each: own INR 500; level 1 INR 400; level 2 INR 400; level 3 INR 400; level 4 INR 533.28; level 5 INR 800; total INR 3,033.28. Level 4 sources each create a INR 100 pool split as INR 33.34 / INR 33.33 / INR 33.33; the selected root gets the farthest INR 33.33 share. The 63 sources generate INR 75,600 in fees, reconciled as INR 31,500 self, INR 12,400 direct, INR 6,000 indirect and INR 25,700 company (including unallocated top-level shares). Additional eligible ancestors above the selected agent dilute its indirect share; the calculator includes this input.

Only an administrator can post commissions against an approved, unprocessed turnover record. Each settlement requires a verified successful transaction count, actual earned company fee and reconciliation note. The server recomputes entitlements, rejects underfunded fees, enforces one settlement per source, and stores the original policy version and recipient amounts. Enrollment, bank/SIM submission and referral counts do not generate commission. Booked entitlements are separate from the operating ledger and no money transfers are executed.

Membership defaults use rolling 30-day verified service transactions in the member's branch and completed personal tasks: Gold = 1,000 transactions plus 20 tasks; Pro Gold = 5,000 plus 50. Names and targets are editable. Task completion timestamps are recorded going forward; historical tasks without timestamps do not qualify automatically. Rank follows current performance and can fall after reversals or the rolling window expires.

Starting reward catalog: INR 5 per approved task, INR 500 monthly task cap, INR 500 Gold voucher, INR 10,000 Pro Gold travel allowance. The current default creates no new incentive reserve; approvals require a funded balance from an administrator-configured plan. Benefit titles, budgets, required ranks, availability and catalog entries are editable. These are requests subject to eligibility and funded administrator approval, not guaranteed trips. Each task may be claimed once; each catalog benefit once per member/calendar month. Pending task requests count toward the monthly cap. Approval atomically deducts the full cost from the reward reserve, so concurrent approvals cannot overspend it. Approved travel/voucher budgets are benefits, not cash added to the task-bonus wallet.

Policy edits create new versions and never recalculate past settlements. Reversals remove the settlement's commissions and reserve while preserving already-approved reward costs. A resulting reserve shortfall blocks new approvals. Audit events record policy changes, settlements, claims, decisions and reversals.

Existing local databases that are missing these migrations must apply them once:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_breezy_maddog.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_fair_brother_voodoo.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_complex_squirrel_girl.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_youthful_power_pack.sql
```

Apply missing migrations to the separate QA store too before testing. A future Sites deployment applies hosted migrations automatically.

## Boundaries and privacy

Business/license details are company declarations, not independently certified by this software. Account-opening, bank connectivity, money movement and automated KYC require actual provider integrations. The portal guide is an interactive narrated walkthrough; no separately rendered AI video is included. Email addresses are login identifiers without ownership verification; password recovery uses the saved code, not an emailed reset link.

D1 stores login credentials as hashes, sessions, profiles, task states, financial records and audit metadata. R2 holds private document bytes. Local records persist in `.wrangler/state`. Audit records older than 90 days are purged on the next administrator session; the UI returns the latest 250 admin / 100 personal events. Business records and documents persist until a separate retention/deletion workflow is implemented. Do not put PINs, OTPs, banking passwords or card credentials in uploads or descriptions.

Hosted connected sign-in also trusts Sites edge-injected identity headers; existing connected-sign-in profiles retain that sign-in method. Password signup cannot claim their existing email addresses. The portable dev plugin strips incoming forged identity headers. The production-worker test harness below injects trusted-header fixtures on loopback only and must never be exposed as a public authentication server. Localhost can record a loopback IP; public-IP city/country metadata requires the hosted edge. Browser location is required for sign-in and always requires user permission.

## Verification

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/run-framework.mjs build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/qa-state --file drizzle/0000_swift_dragon_lord.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/qa-state --file drizzle/0001_breezy_maddog.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/qa-state --file drizzle/0002_fair_brother_voodoo.sql
node node_modules/@playwright/test/cli.js test
```

Initialize the isolated `.wrangler/qa-state` database once. Keep the ordinary development preview on port 5198 running for the spoofed-header rejection test. Playwright starts the built Worker on loopback port 5201 with the separate QA store. Stop that worker before rebuilding on Windows to release output-file locks. QA state and uploaded test fixtures are ignored by Git and excluded from deployment.

Tests cover direct/referral email signup and login, recovery-code rotation, session revocation, login rate limits, administrator member review screens, draft/missing-document visibility, private file previews, authorization, document privacy, receipt approval/locking, administrator-only allowances/settings, concurrent-profile revisions, full binary positions, mandatory onboarding, automatic agent eligibility, task transitions, approval-only financial totals, decimal precision, retry-safe imports, token revocation, mandatory login location, permission denial/timeouts, stale or invalid positions, permission revocation, Excel/PDF files, legacy route redirects and mobile layout.

Bank choices are selected from the [RBI directory](https://www.rbi.org.in/Scripts/bs_viewcontent.aspx?Id=3657) and [MSME lender handbook](https://msme.gov.in/sites/default/files/KNOW-YOUR-LENDER_2025.pdf). Quick choices are a UI preference, not a ranking. [Axis corporate banking guidance](https://www.axisbank.com/docs/default-source/default-document-library/corporate-internet-banking-faqs.pdf?sfvrsn=2) describes bank/corporate-configured limits.
