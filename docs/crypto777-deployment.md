# Crypto777 player websites

## Normal Play and Agent Play

The shared storefront is live on two account channels:

| Website | Channel | Account creation |
| --- | --- | --- |
| `https://crypto777.in/` | Normal Play / B2C | Public signup |
| `https://play.crypto777.in/` | Agent Play / B2B | Existing agent-created accounts |

Both use the Crypto777 design, shared games and existing API. The lobby links
to both player websites and the existing `https://panel.lunarx.live/agent/`
operator panel. The admin's **Crypto777 Websites** page previews both channels.
Master-specific branch pages retain their own navigation. Account sessions
remain host-only, and the API enforces the player's channel on login and requests.
Demo remains available on Normal Play only, matching the existing API policy.

Deployment configuration, applied on 19 October 2026 (IST):

- The existing private API includes `play.crypto777.in` in `B2B_HOSTS` and
  `https://play.crypto777.in` in `CORS_ORIGINS`. Previous values are preserved.
  `PLAY_HOST=play.lunarx.live` still generates existing master website links.
- `play.crypto777.in` is attached to the existing `lunarx-web` service and
  verified by Render. Hostinger has CNAME `play -> lunarx-web.onrender.com`,
  TTL 300; the apex and `www` records are unchanged. Both authoritative
  nameservers, Google and Cloudflare return the record. HTTPS validates.
- The web Docker build selects the Crypto777 storefront on all three hosts.
  The gateway preserves Host for API and WebSocket requests.

The existing deployment is not Blueprint-managed. `render.yaml` records the
same host/CORS additions for future provisioning; changing it alone does not
update the live API environment. No database migration or account conversion
is required.

## Verified dual-channel release: 19 October 2026

- Initial application commit: `428b0111eb3173d3114610f38f2968edb4d4ecc3`.
- Final web commit: `1d47c9e4504efadf69e65b7f0889b2ea8ee087ee`.
- Web deployment `dep-dbak3sk9v7es738r2i70`: live.
- API environment deployment `dep-dbajv3fbtjjs73ffdn8g`: live, from
  `558b5dc0e490ddc3d92e35c05c1e1a6411bb70a3`. API source was unchanged;
  only the channel host and CORS configuration changed.
- Both Crypto777 websites and the existing LunarX, Play, admin and panel
  domains returned HTTP 200 for `/api/healthz`.
- Live `/api/auth/site` returns B2C/public signup for the apex and B2B/no
  public signup for `play.crypto777.in`. Agent signup and demo requests return
  403; the agent login explains how to obtain an agent-created player account.
- Browser checks passed at 320, 390 and 1440 pixels with loaded game artwork,
  correct selected play links, no horizontal overflow and no JavaScript errors.
- Normal Demo starts, survives navigation to Dice and logs out. Public website
  branding now loads without session cookies, so the isolated demo allowlist
  cannot block the page after a reload. Gameplay still uses its demo session.
- Production admin login and both real website previews passed, including
  the 390-pixel preview and the selected website's external link.
- All 14 storefront browser tests, player/admin type checks and production
  builds passed. The Render Blueprint validated successfully.

Final browser verification used ordinary DNS and valid HTTPS, with no hostname
override. The API restart briefly interrupted gateway requests; the web rollout
restored health. No accounts were converted and no database migration ran.

## Existing normal-player deployment

The B2C storefront uses `crypto777.in`, with `www.crypto777.in` redirecting to
the apex domain. It is served by the existing `lunarx-web` Render gateway and
uses the existing private API, PostgreSQL database, persistent game data and
admin panel. There is no second production database.

The web Docker build sets
`VITE_B2C_HOSTS=crypto777.in,www.crypto777.in,play.crypto777.in`.
These hosts select the Crypto777 storefront at `/`; other hosts keep their
existing lobby. Both frontends use the same game assets and API proxy, including
WebSockets. A standalone B2C build remains available with `npm run b2c:build`.
The admin build sets `VITE_B2C_SITE_URL=https://crypto777.in` and
`VITE_B2C_AGENT_SITE_URL=https://play.crypto777.in` for its two previews.

## Existing resources

- Repository: <https://github.com/beastarenaclub-boop/LunarX-Platform>, `main`.
- Web: `srv-db9nceom7kps73e1jl8g`.
- Private API: `srv-db9ncb7avr4c73enfk60`.
- PostgreSQL: `dpg-db9nbvfbtjjs73cc6ij0-a`.
- API disk: `dsk-db9ncbfavr4c73enfkp0`, `/var/data`.
- Admin: <https://admin.lunarx.live>.

Preserve `API_UPSTREAM=lunarx-api:4000`, the existing database connection and
the single API instance. Production demo sessions are isolated in RAM and end
after one hour or an API restart. Demo balances cannot be withdrawn. Admin
presence counts sessions active in the last 60 seconds. This release does not
change the production database schema or import local data.

## Release procedure

Auto-deploy remains disabled. Frontend-only changes need a web deployment.
For API changes, deploy the reviewed source to the API before the web gateway,
then verify health, real admin login, player rendering and the changed flows.
Demo runtime changes also require checks for practice bets, live demo presence,
withdrawal rejection and logout. The API has a
persistent disk, so its deployment briefly interrupts connections. Its shared
game engines retain their existing restart/recovery behavior.

Both custom domains were attached to the existing Render web service on
18 October 2026. Hostinger DNS, Render verification and HTTPS were completed
later that day. For future DNS changes, keep unrelated records, including mail
records, and recheck authoritative DNS, Render verification and valid HTTPS.

The fallback B2C preview is <https://lunarx.live/b2c> after the web release is live.

## Verified release: 18 October 2026

Application commit: `00a79a56393238566e8b2c5ccee33b99ab5ce8cb`.

- API deployment `dep-dbadfh67bikc73e6s10g`: live.
- Web deployment `dep-dbadh5rncjis73d59qi0`: live.
- Health checks returned 200 for the website, B2B, admin and operator domains.
- Production admin login passed. Existing user and bet counts were retained.
- The live admin dashboard displayed the demo counter increasing on demo start
  and decreasing on logout. Its B2C Website link points to `https://crypto777.in/`.
- Browser checks on `https://lunarx.live/b2c` passed: automatic one-hour demo,
  unchanged expiry after reuse, a settled Dice practice bet, admin live presence,
  no production user/bet rows for the demo ID, blocked financial operations,
  mobile wallet explanation and logout. No browser JavaScript errors occurred.
- Production assets, supplied logo and game posters are available. Desktop and
  mobile host-routing checks passed against the built gateway locally.

The API restart briefly caused gateway 502 responses; health recovered before
the web rollout completed. Check the gateway after future API-only releases,
including its resolution of the API's current private address.

### Domain activation: 18 October 2026

The Hostinger connection is working. The complete zone was read and saved to
the local ignored file `.cache/crypto777-dns-before-2026-10-18.json` before the
change. There were two web records and no mail, TXT, CAA or AAAA records. The
previous values were `A @ = 2.57.91.91` (TTL 50) and
`CNAME www = crypto777.in.` (TTL 300). No historical Hostinger snapshots existed
before this change; the saved values provide a rollback reference. Hostinger
created snapshot `189339060` during the update.

Hostinger validated and applied these records, both with a 300-second TTL:

| Type | Name | Target |
| --- | --- | --- |
| A | `@` | `216.24.57.1` |
| CNAME | `www` | `lunarx-web.onrender.com` |

The nameservers remain `lunar.dns-parking.com` and `solar.dns-parking.com`.
Both authoritative servers (queried over TCP), Google and Cloudflare returned
the new records. Render reports both domains as `verified`.

The domain is live over HTTPS. Google Trust Services issued valid certificates
for both hostnames. The apex returns 200, and `https://www.crypto777.in/`
redirects to `https://crypto777.in/` with HTTP 301.

Checks on the actual domain passed:

- Desktop (1440 x 1000) and mobile (390 x 844) storefront rendering, logo,
  banner images, login dialog and no horizontal overflow on mobile.
- No browser JavaScript errors or failed asset responses during the storefront
  checks. The existing LunarX homepage still renders its original lobby.
- One-hour demo expiry, session reuse without extending expiry, a settled Dice
  practice bet, live admin presence, no production user/bet rows for the demo
  ID, blocked deposits/withdrawals/transfers, mobile wallet explanation and logout.
- API health returned 200 on Crypto777, LunarX, B2B, Admin and operator domains.
- The admin dashboard's demo counter increased/decreased for a Crypto777 demo
  session. Its B2C Website page rendered the live domain in both desktop and
  mobile previews, and its Open website link points to the apex.

Activation used the already deployed application commit listed above. No new
application deployment or database migration was needed for this DNS cutover.
Reference: <https://render.com/docs/configure-other-dns>.

### Storefront headline and icon

The B2C headline is **Every Game. A New Thrill.**, displayed above the featured
games for guests and in the lobby header for signed-in/demo visitors. Its
original gold `777` SVG mark lives at `/media/b2c/brand-icon.svg` and is also the
browser favicon. The landing page title uses the brand and headline. Crypto777
hosts retain the icon on direct game/account routes; the `/b2c` preview restores
the LunarX favicon when leaving that page. The supplied full header logo is
retained.

This is a web gateway release; it requires no API deployment or database change.

Published on 18 October 2026 from commit
`a1607ea4b6dff7e8cec9cd0c9290e2991ae94e70` in web deployment
`dep-dbaeivu7bikc73eavig0` (`live`). Frontend TypeScript, the production build
and all 11 B2C browser tests passed. Production-bundle checks passed at 320,
390, 768 and 1440 pixels, including restoration of the LunarX favicon after
leaving its B2C preview. Live checks confirmed the headline, SVG favicon,
desktop/mobile layout, login, and the favicon on demo game and wallet routes.
The existing demo gameplay/isolation checks also passed; all five website/API
health endpoints returned 200, with no browser JavaScript errors or failed
storefront assets during verification.

### Profile reports and security settings

The profile cards, account sidebar and storefront account menu provide Account
Statement, Current Bets, Activity Log, Casino Results, Live Casino Bets,
SportBook Bets, Set Button Value, Change Password and Security Auth Verification.
Reports use /report/{accountstatement,currentbets,activity,casinoresult,
livecasinoresult,sportbookresult}; settings use /settings/{buttonvalue,
changepassword,secureauth}. All routes require sign-in.

Reports read the authenticated user's existing ledger, audit events and bet
records, including separate WinGo, Forex, Dragon Tiger, One Day, virtual sports
and Rummy stores. They support IST date filters, refresh and cursor pagination;
no future outcomes, seeds, audit payloads or session tokens are returned.
SportBook explicitly describes the existing virtual sports and racing games.
Demo reports run only in the volatile worker; account settings stay blocked.

Button Value saves six account-specific cash-game presets on this browser.
Compatible shared chip controls use them; practice/fixed-denomination controls
retain their game rules. Settings do not submit bets. Game selection behaviour
is unchanged. Restoring defaults clears the saved override.

Password changes verify the current password, invalidate existing sessions and
password-reset links, close the account's WebSockets, clear the cookie and
return to login. Login checks the password version inside the session-creation
lock. Security Auth Verification supports current-password verification, an
active-session list and password-confirmed sign-out of other devices. It does
not claim authenticator/OTP two-step verification is available.

No schema migration is required. Deploy the API before the web gateway.
Validation commands:

- node artifacts/api-server/test-account.mjs (volatile PGlite integration tests; no production database)
- node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.account.config.ts
- TypeScript checks for both applications and production builds for API/web

Published and verified on 18 October 2026 from application commit
`597e98eea5f58575d3b97da9794173964d4bd368`: API deployment
`dep-dbaf5ddg1s2s73bsl8tg` and web deployment
`dep-dbaf7ds9v7es7389qmn0` are both live. Five account API tests, six
isolated demo runtime tests, all sixteen storefront/account browser cases,
both TypeScript checks and the production builds passed.

Live checks on crypto777.in passed for all six report endpoints and all three
settings pages, the nine profile cards and dropdown entries, desktop/mobile
layout, session-list token redaction and demo account restrictions. A settled
practice Dice bet appeared in the new casino report. No browser JavaScript
errors were observed. Public storefront checks also passed at 320, 390 and
1440 pixels; branding, login, assets, the existing LunarX lobby and all five
domain health endpoints remained healthy. Password changes/revocation were
exercised only against isolated test accounts, not production credentials.

The API replacement briefly caused public gateway 502 responses. Restarting
the existing web gateway restored access before the frontend release. For
future API-only updates, check the public /api/healthz path as well as Render's
private-service status and refresh the gateway if its upstream stops responding.

### Coin Flip studio and AI host

Published on 18 October 2026 from application commit
`f53a027dfcb2cb7e548088c6a713863be3ec5eb9`, web deployment
`dep-dbafma6q1p3s73bgghcg` (`live`). The existing API remains on
`597e98eea5f58575d3b97da9794173964d4bd368`; no server or database changes
were needed. See [Coin Flip studio](coin-flip-studio.md) for implementation,
asset provenance and recovery behavior.

The `/coin-flip` studio now has distinct gold Heads and silver Tails SVG coins,
a two-sided flip animation, the existing AI-generated female host video,
responsive shared chip controls and explicit server-confirmed results. The
host is labeled as AI and looped video. An interrupted bet restores its original
side and amount; retry preserves the request ID. A 15-second response timeout
allows recovery, and a slow background refresh does not hold a confirmed result.

Validation passed: frontend TypeScript and production build, six instant-game
math tests, the 33-case browser suite plus an additional timeout/media-failure
case and a repeat of the animation/mobile check after final styling. This covers
34 distinct browser cases, including neighboring instant games.

Live checks used only volatile demo funds. Both Heads and Tails selections
settled correctly; a lost round returned zero and a winning INR 100 round
returned INR 194. The rendered coin matched each receipt, both rounds appeared
in history and Casino Results, and reload restored the last result. Host video,
reduced motion and layouts at 320, 390 and 1440 pixels passed with no browser
JavaScript errors. All five public API health endpoints returned 200. Public
health checks use a signed-out request because the demo sandbox intentionally
blocks API paths outside its gameplay/report allowlist.

### Cricket stadium Coin Flip

Published on 18 October 2026 from application commit
`c4ec3e2cf5ffad0a55bd2fb87811813f9517cfb8`, web deployment
`dep-dbafvlajnfac73fipijg` (live). The API remains on
`597e98eea5f58575d3b97da9794173964d4bd368`; this release changes only
frontend presentation and media. See [Coin Flip stadium toss](coin-flip-studio.md).

A newly generated ten-second stadium shot shows a standing adult female AI
presenter flicking one physical-looking coin upwards and catching it while the
camera moves closer. The centered shot supports mobile cropping. Playback runs
once per explicit bet. The coin remains covered in the video; the UI reveals the
server-confirmed Heads/Tails receipt after the catch, together with result audio
and the updated wallet. The visible AI HOST label identifies the presentation.

Checks passed: frontend TypeScript, production Vite build, all 37 instant-game
browser cases and a final repeat of the toss/mobile check after styling. Tests
cover both result sides, wins/losses, single playback, duplicate-click locking,
recovery, missing/stalled video, animation skipping, hidden tabs, rejected bets
and reduced motion.

Live verification used only volatile demo funds: Heads lost to Tails with zero
return; Tails won with INR 194 returned on an INR 100 stake. Both receipts and
Casino Results matched, reload restored the receipt without replaying the toss,
and the second toss was exercised at mobile width. Layouts at 320, 390 and 1440
pixels passed with no JavaScript errors. The served MP4 hash matches the reviewed
asset (3153647 bytes). All five public API health endpoints returned 200.

### Shared 30-second Coin Flip and palm reveal

Published and verified on 18 October 2026 from application commit
`2d9b1505276da9b98a3a6b60af4d728e7fca56be`. API deployment
`dep-dbagds8m7kps738ooe9g` and web deployment
`dep-dbagfics728c73ae12d0` are live. The API replacement briefly
interrupted the gateway; restarting the existing web gateway restored public
health before the frontend rollout. No database migration was needed.

Every shared round now has 15 seconds of betting, a ten-second stadium toss and
five seconds showing the result. Rounds continue without wagers. The AI
presenter holds out her open palm, with the server-confirmed Heads/Tails coin
rendered directly on her hand. Playback follows the server clock; the result
also works with reduced motion or missing video.

Auto-bet is off by default. Start repeats the selected side and fixed amount
once per round, for the selected count, with optional net loss/profit limits.
Stop, reload, navigation, hiding the tab, lost connectivity or an uncertain
wager stops future bets. Accepted wagers still settle. Admission, recovery and
settlement retain the original round and cannot double-debit or double-credit.

Validation passed: nine isolated API integration tests, twenty distinct Coin
Flip browser cases, twenty-five neighboring-game browser cases, both TypeScript
checks and both production builds. The Coin Flip browser cases passed across
the main run and a targeted rerun after fixture timing corrections.

Live verification used one volatile demo session. A passive result matched the
coin on the presenter's palm before any wager. Two automatic INR 100 Tails bets
were sent to distinct rounds, and both returned INR 194 after Tails landed.
The plan then stopped; reload kept it off. Receipts matched Casino Results.
Three consecutive results had deadline gaps of 30004 and 30003 milliseconds.
Demo wallet balances retain the existing unlimited practice behavior; exact
wallet debits/credits were checked in the isolated API suite.

The served video hash matched the reviewed asset. Layouts at 320, 390 and 1440
pixels passed, with no JavaScript errors or horizontal overflow. Public API
health returned 200 for Crypto777, LunarX, B2B, Admin and operator domains.
See [Coin Flip stadium rounds](coin-flip-studio.md) for recovery and media details.
