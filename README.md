# LunarX Platform

Game website, admin panel, master/agent panels, API and database migrations for
`lunarx.live`. This repository keeps the deployment source on the **main** branch.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fbeastarenaclub-boop%2FLunarX-Platform)

Deployment: **https://lunarx.live** (Render fallback:
**https://lunarx-web.onrender.com**). The API, website and database were deployed
on 17 October 2026. Hostinger DNS now points the apex and the `www`, `b2b`,
`admin` and `panel` subdomains to Render. All five domains are verified in
Render. HTTPS works on the apex and subdomains.

Both B2C and B2B visitors can browse and search the game lobby without signing
in. Opening a game or an account page requires login and then returns the
player to the selected page. Public signup remains available only on B2C.

## Crypto777 player storefronts

The **CRYPTO777** dark casino frontend uses **https://crypto777.in/** for normal
players and is configured for **https://play.crypto777.in/** for agent-created
players. The lobby has Normal Play and Agent Play links; the admin's
**Crypto777 Websites** page previews both. Agent Play keeps public signup disabled
and uses the existing agent accounts and channel isolation. Activation of the
new hostname requires the Render/DNS steps in the deployment guide.

`www.crypto777.in` redirects to the normal website at the apex. It is also available at
**https://lunarx.live/b2c**. The existing default lobby and all game engines
remain shared. Admin has a **Crypto777 Websites** sidebar entry at `/admin/b2c-website`
with desktop/mobile previews. See [domain and release status](docs/crypto777-deployment.md).

Run `npm run b2c:dev` from the repository root, then open
**http://127.0.0.1:5180/**. Its `/api` and `/ws` requests proxy to the existing
local service at `http://127.0.0.1:5200`; use `API_PROXY_TARGET` to change that.
The local admin preview expects this B2C dev server to be running.

`npm run b2c:build` produces `artifacts/3d-game/dist/b2c` with the new lobby at
`/` and the same playable game routes. It does not replace `dist/public` or
publish to a domain. For hosting, reuse the existing game gateway's SPA, media,
embedded-game, `/api` and WebSocket routing with this build as its website root.
Point API traffic to the existing backend and preserve the website Host header.
The production web Docker build sets
`VITE_B2C_HOSTS=crypto777.in,www.crypto777.in,play.crypto777.in`, so the shared gateway serves this
storefront at `/` on those hosts while retaining the existing lobby elsewhere.
All player origins must be included in the backend's CORS configuration;
`play.crypto777.in` must also be included in `B2B_HOSTS` before activation.

Set `VITE_B2C_BRAND` in `artifacts/3d-game/.env.local` before starting/building
to override the **CRYPTO777** name. The header uses the supplied logo at
`public/media/b2c/brand-logo.png`; `VITE_B2C_LOGO` can override its URL.
The production admin Docker build sets
`VITE_B2C_SITE_URL=https://crypto777.in` for its storefront preview and link.
Other deployments can override that value; without an override, the admin
preview falls back to the existing website's `/b2c` route.

The storefront headline is **Every Game. A New Thrill.** Its gold `777` SVG mark
appears beside the headline and as the browser favicon. Crypto777 hosts keep
the favicon on game and account routes; the `/b2c` preview restores the original
favicon when returning to the LunarX lobby. The supplied header logo remains
available at `public/media/b2c/brand-logo.png`.

Demo creates an anonymous ID for **one hour of playable practice**, with unlimited
demo coins and no signup. Refreshing or opening another tab reuses the same ID
and does not extend expiry. Deposits, withdrawals, transfers and account changes
are blocked by the server. Signing in starts a separate real session without
copying demo balances or wins.

The API runs the same game routers and engines in an isolated worker backed by
PGlite **in memory only**, with no database credentials or file storage. Temporary
identities and their gameplay are removed on logout/expiry; restarting the API
ends all demos. No visitor IP, email, device fingerprint or demo analytics are
saved. The admin Dashboard's **Demo users live** card polls every five seconds;
it counts distinct sessions active within the last 60 seconds, not tabs.

Build the API before running demo: `node artifacts/api-server/build.mjs` generates
the volatile schema from the shared game schema and builds `demo-worker.mjs`.
Deploy both API bundles and their dependencies together. The current design uses
one API instance; multiple instances require session affinity and aggregated
presence before scaling. Game availability/settings sync into demo every 30 seconds.
Run `npm run demo:test` for session, isolation and playable-game checks.

Login, signup permissions, game availability and balances use the existing API.
Recent wins display the player's settled wins from their latest 50 bets; no
public winner amounts or fixture results are fabricated.

The B2C graphics are AI recreations of the supplied reference style. Banner,
casino, instant, sports and avatar images are local files in
`artifacts/3d-game/public/media/b2c`; `generation-manifest.json` records the
built-in image tool prompts. `game-banner-prompts.json` records the new Crash
Games and Instant Games poster prompts. The hero rotates those posters and Live
Casino every six seconds, with manual controls and interaction/reduced-motion
pausing. The match poster is no longer used in the carousel.
The public layout has an eight-column game grid; the demo/account lobby uses
a provider sidebar and six columns on wide screens. These graphics only apply
to the additional storefront.

NOW TRENDING and TOP WINNERS continuously scroll in a seamless loop. Both rows
support touch swipes, previous/next controls and pause/resume. Autoplay pauses
on hover, keyboard focus, open dialogs and hidden tabs, and respects reduced motion.

Browser checks: `node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.b2c.config.ts`
(uses installed Chrome by default; override `PLAYWRIGHT_CHANNEL` if needed).

## Deploy on Render

These steps create a new environment. The existing deployment was provisioned
through the Render API and is not managed by a Blueprint; use its existing
services for releases. See [deployment details](docs/render-deployment.md).

1. Connect the GitHub account that can access this repository to Render.
   In the Render GitHub app, grant access to **LunarX-Platform**.
2. Click **Deploy to Render** above, or choose **New > Blueprint** in Render.
   Select this repository, branch **main**, and Blueprint path **render.yaml**.
3. Enter `SUPER_ADMIN_EMAIL` and a unique `SUPER_ADMIN_PASSWORD` of at least
   16 characters in Render. Review the paid resource estimate before deploying.
4. The Blueprint provisions `lunarx-web`, `lunarx-api` and `lunarx-db`.
   Verify both builds and the web service's `/api/healthz` before connecting DNS.
5. Follow [the deployment guide](docs/render-deployment.md) to connect the
   Hostinger domain and verify HTTPS.

Database table definitions are in [lib/db/src](lib/db/src), and SQL migrations
are in [lib/db/drizzle](lib/db/drizzle). Database contents, users, balances,
passwords and local exports are not included. Existing data requires a separate
database import. GitHub stores the application source; Render runs the database.

Both Docker images built successfully on Render. Live checks passed for API
health, admin login, secure cookies, authenticated WebSocket connections, and
the lobby at desktop and mobile sizes. See the deployment guide for the exact
verification scope and domain status.

## Local Docker setup

The **B2B / B2C Network** section in the admin panel manages master branches,
agents, agent-created players, funds, commissions and settlements.

| Panel | Local address |
| --- | --- |
| Admin network | http://127.0.0.1:5175/admin/network |
| Master panel | http://127.0.0.1:5176/master/ |
| Agent panel | http://127.0.0.1:5176/agent/ |
| B2B player website | http://127.0.0.1:5202/ |
| B2C direct website | http://127.0.0.1:5200/ |

Rebuild with `docker compose up -d --build --wait`.
**START-BUSINESS-PANELS.cmd** starts already-built local panels and opens admin.
Admin creates a master from
**B2B / B2C Network**; that master creates agents, and only agents create B2B
players. Each account uses its assigned email and password. Existing public
accounts stay B2C. Referral links no longer assign public signups to agents.
The **Downline** tab opens a connected tree: company → master → agent → user.
Expand one branch or use Expand all / Collapse all; search by master or agent
name or login email. Users load under their own agent in pages of 50, and a
master sees only its own branch. Table view keeps the full ledger columns.
Master and agent panels also have a **Downline tree** sidebar link, with direct
routes `/master/downline` and `/agent/downline`. Agents see their own account
and users, can search those users, and open Funds or change user status from the
tree. Their master is identified by name without exposing other branches.
Legacy referral accounts keep their admin history but cannot access B2C users
through the old agent API. Create new branch accounts using the hierarchy above.
Company fees are fixed when a master is created (10% default). Master
participation is a percentage of the remaining allocation; each agent receives
its configured percentage of that master's allocation. With 100% master
participation and 50% agent share, ₹100 net income divides into company ₹10,
master ₹45 and agent ₹45. Losses use the identical signed ratio.

Each newly accepted cash wager snapshots its contract. Settled wagers post
immutable entries; retries are idempotent, and corrections or voids append
reversals. Reports start with wagers accepted after migration 0050. Historical
reports remain available. Promotional/bonus bets and external API partners are
excluded from this cash branch ledger. The company settlement screen records
payments already made or losses collected, with references; it does not initiate
a bank payment. Wallet float transfers are separate, atomic entries along the
admin → master → agent → player chain. Report dates use Asia/Kolkata.

For production domains, set `B2B_HOSTS` and `OPERATOR_HOSTS` to comma-separated
exact host names (including ports when nonstandard), configure the reverse proxy
to preserve Host, and add those origins to `CORS_ORIGINS`. B2B, operator and B2C
sessions use separate cookies. Local ports above are not public hosted domains.

Run `docker compose --profile network-test up -d --wait network-test-db`, then
`npm run network:test` for isolated integration tests. This uses a temporary
PostgreSQL database on port 5449; the runner refuses databases without the
`_network_test` suffix. Stop it with `docker compose --profile network-test stop
network-test-db` when finished.

**Arena Virtual Sports** adds Football Arena, Cricket Super Six, Basketball Pro,
Tennis Masters and Formula Sprint under the lobby's **Virtual Sport** category.
Open `/virtual-sports` or `/virtual-sports/football` after signing in. Each game
has a real-time 3D venue, three camera views, shared scheduled matches, fixed-odds
betting and automatic settlement. The five games share **10,000 practice coins**;
these are separate from the main wallet and have no cash value. Bets, receipts
and balances persist in SQLite (`VIRTUAL_SPORTS_DB`, or beside `WINGO_DB` in Docker).
Rounds run for 75 seconds: 20 seconds betting, 45 seconds simulation, 10 seconds results.

The broadcast graphics use locally bundled textured, skeletal athletes (22 in
football, 13 on the cricket field, 10 in basketball and 2 in tennis), HDR lighting,
grass normal maps, photographic crowd artwork, detailed open-wheel cars and
tracking cameras. High and Balanced graphics remain available. This is rendered
3D, not real match footage. Asset credits are in
`artifacts/3d-game/src/components/virtual-sports/assets/CREDITS.txt`; the human
preparation script is `tools/sports-assets/prepare-athlete.py`.

For an immediate standalone preview, double-click `START-VIRTUAL-SPORTS.cmd` or run
`npm run sports:dev`, then open http://127.0.0.1:5198. It uses a separate local practice
account per browser and stores data in `data/virtual-sports-preview.sqlite`. Node
22.13+ is required. Run `npm run sports:check`, `npm run sports:test` and
`npm run sports:test:browser` to verify it. `npm run sports:build` followed by
`npm run sports:start` serves the production preview on the same port. Rebuild the
Docker `api` and `web` services to update the main lobby.

The game lobby now uses **port 5200**. After the initial Docker build, double-click
`START-GAME-LOBBY.cmd` to start the existing services and open http://127.0.0.1:5200/.

Open **Forex Trading** from the main lobby at http://127.0.0.1:5200/, or directly
at http://127.0.0.1:5200/forex-trading after signing in. Aurum uses the shared
game layout, coin selector/settings, sound controls and win receipt, with rules
and history in the information drawer. Prices and charts use Google Finance quotes,
automatically refreshed every 30 seconds with source timestamps and delay labels.
Metals and energy show futures quotes. Pool totals independently decide game results:
above-average investment gives DOWN, below-average gives UP. The integrated game
uses the lobby's INR wallet for bets and payouts. The optional standalone practice terminal
still runs through `START-FOREX-GAME.cmd` on port 5196. See [rules and setup](docs/forex-trading.md).

For **Bike Racing with shared coins and auto bet**, double-click `START-BIKE-GAME.cmd`,
or run `npm run bike:build` then `npm run bike:start` and open http://localhost:5200/bike-racing.
See [bike betting rules and setup](docs/bike-racing.md).

For the separate **LottoDesk lottery app** (Admin, Agent, Shop and User panels), see [setup and demo accounts](docs/lottery-lottodesk.md). Run `npm run lottery:build` then `npm run lottery:start` and open http://localhost:5190.

**Lunar Colour Trading** is available in the main lobby at http://localhost:5200/lunar-colour-trading, with 30s/1m/3m/5m colour, number and size predictions and the same shared wallet as every other lobby game. The Lunar theme reflows from 320px phones to desktop, with native scrolling and full-size touch controls. The old `/wingo` link remains supported. See [rules and setup](docs/wingo-colour-club.md). The optional standalone preview is available via `START-LUNAR-COLOUR.cmd` at http://localhost:5192.

Start Docker Desktop with Linux containers, then run from this directory:

```sh
docker compose up -d --build --wait
```

Docker builds the API and both websites from source, applies database migrations,
and waits for service health checks. A host Node.js or pnpm installation is not required.

| Service | Address |
| --- | --- |
| Player website | http://localhost:5200/ |
| Lunar Colour Trading (shared wallet) | http://localhost:5200/lunar-colour-trading |
| Rummy Royale (shared wallet) | http://localhost:5200/rummy |
| Vegetable Bowl (shared wallet) | http://localhost:5200/vegetable-bowl |
| Dragon Tiger (shared wallet, live leaderboard) | http://localhost:5200/dragon-tiger |
| One Day Dragon Tiger (two betting chances, shared wallet) | http://localhost:5200/dragon-tiger-one-day |
| Horse Racing (shared wallet) | http://localhost:5200/horse-racing |
| Admin panel | http://localhost:5175/admin/ |
| API health | http://localhost:5200/api/healthz |

If `localhost` hangs on Windows while Docker reports healthy services, try
http://127.0.0.1:5200/ for the player website and
http://127.0.0.1:5175/admin/ for the admin panel. This bypasses a stalled IPv6
loopback (`::1`) relay. Check http://127.0.0.1:5200/api/healthz for
`{"status":"ok"}`. The Bike Racing launcher uses this IPv4 address as well.

Create a player account from the website. On a fresh local database, the default
admin login is `admin@local.test` / `Admin@12345`. Set `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD` before the first start to override those defaults.
These defaults and the HTTP cookie setting in Compose are for local development.

```sh
docker compose ps
docker compose logs --tail 100 api
docker compose down
```

Stopping the stack keeps the PostgreSQL data volume. Re-run the startup command
after source changes to rebuild the affected images.

Rummy Royale includes an animated computer dealer, three computer opponents,
13-card validation, manual play, and bounded auto-bet/auto-play. Sign in through
the existing player account. Its bets and winnings use the same wallet as every other lobby game. See [Rummy rules and implementation](docs/rummy-game.md).

Dragon Tiger has shared server rounds, the common wallet and a live player
leaderboard, all inside a mobile-friendly table. See [Dragon Tiger](docs/dragon-tiger.md).

One Day Dragon Tiger adds a separate AI dealer studio with 56 markets and a second
betting window after Dragon opens. Conditional bhav, accepted prices, history and
payouts use the same shared wallet. See [rules and implementation](docs/dragon-tiger-one-day.md).

Horse Racing includes eight independently animated runners, six photographic
racecourses, a two-lap marathon, stadium audiences, hoof and crowd audio, and
three selectable camera views and automatic camera changes following the coded race. Sign in with the existing player
account to use the same wallet, coin rack and automatic betting controls as
Lucky 7. Bets and payouts settle on the server; all visual assets are bundled.
See [Horse Racing controls and setup](docs/turf-club.md).
