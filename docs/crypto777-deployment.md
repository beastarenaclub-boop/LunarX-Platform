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
18 October 2026. DNS verification and HTTPS must be checked after the Hostinger
zone points to Render. Keep unrelated DNS records, including mail records.
Before declaring the domain live, confirm authoritative DNS, Render domain
verification and a valid HTTPS response from `https://crypto777.in`.

The fallback B2C preview is <https://lunarx.live/b2c> after the web release is live.
