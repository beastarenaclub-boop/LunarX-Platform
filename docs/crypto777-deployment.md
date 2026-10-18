# Crypto777 B2C deployment

The B2C storefront uses `crypto777.in`, with `www.crypto777.in` redirecting to
the apex domain. It is served by the existing `lunarx-web` Render gateway and
uses the existing private API, PostgreSQL database, persistent game data and
admin panel. There is no second production database.

The web Docker build sets `VITE_B2C_HOSTS=crypto777.in,www.crypto777.in`.
Only these hosts select the B2C storefront at `/`; other hosts keep their
existing lobby. Both frontends use the same game assets and API proxy, including
WebSockets. A standalone B2C build remains available with `npm run b2c:build`.
The admin build sets `VITE_B2C_SITE_URL=https://crypto777.in` for its B2C preview.

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

Auto-deploy remains disabled. Deploy the same reviewed Git commit to the API,
then the web gateway, and verify health, real admin login, B2C rendering, demo
bets, live demo presence, withdrawal rejection and logout. The API has a
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
