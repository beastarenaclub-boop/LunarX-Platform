# Account security and activity

Administrators use `/admin/users/:id` to reset a password or open an audited, read-only account preview. `/admin/access` lists session activity; the same component on a user's detail page filters to that account.

## Passwords and support previews

- Super admins can manage all accounts. Regular admins can manage players, agents, support accounts and themselves, but not another admin or super admin. Support accounts have no access to these controls or activity history.
- Both actions require the current administrator's password and a 5–300 character reason. Combined requests are limited to 10 per administrator per 15 minutes.
- Passwords require at least 12 characters and at most 72 UTF-8 bytes. Passwords and hashes are never returned. Changing a password revokes every existing session and unused reset link, disconnects account WebSockets and sends an account notification. Resetting your own password signs you out too.
- Actor/target locks and a transaction protect authorization, password updates, session revocation and the audit entry. Password-reset tokens are rechecked while holding the user lock, and successful self-service resets also revoke sessions and all outstanding reset links. Existing login code checks the expected password hash under the same user lock before creating a session.
- Preview returns identity, branch, recorded wallet balance and ten recent wallet entries. It **does not create a customer login session or impersonate a customer**. It cannot perform gameplay, payments or other account mutations. The administrator retains their identity.
- Audit actions are `account.password_reset` and `account.support_view`. They contain the actor, target, reason, request IP and timestamp; no passwords, session tokens or confirmation headers are included.

## IP, location and device information

- New authenticated HTTP activity records the last observed IP/time and available browser client hints. Repeated identical requests update at most once per minute; IP/device changes update immediately. This is session activity, not evidence that a customer is currently playing.
- Login IP and the latest observed IP are shown separately. There is no continuous movement history or GPS collection. Older sessions retain their original login data and are labelled as legacy/unverified until new activity is observed.
- IPs use Express `req.ip` and the deployment's configured trusted proxy chain. Render currently has two trusted hops (edge and Nginx); changing that topology requires revisiting `TRUST_PROXY`. Client-supplied forwarding headers must not be trusted independently.
- Browser, OS and phone model come from User-Agent/client hints. Browsers may reduce or omit those values, and users can spoof them. Unknown models stay unknown. Browser platform versions are reported values, not guaranteed marketing OS versions.
- City/state/country are **approximate IP estimates**, affected by VPNs, carrier gateways and database coverage. Locations are resolved offline; customer IPs are not sent to a geolocation vendor. Missing records/databases display unavailable.
- The login screen tells users that IP, approximate location and browser/device information are recorded for account security.
- The admin response exposes hashed session row identifiers, never bearer session tokens, and sets `Cache-Control: no-store`. The interface isolates its query cache per mounted screen.
- History filters cover the last 90 days, today/yesterday/week/month, custom IST dates, email/IP/browser text and session state. The 90-day display window is **not a storage deletion policy**; underlying session retention is unchanged. Dates filter last observed activity, falling back to the login timestamp.

## Geo database maintenance

The API image downloads the October 2026 DB-IP Lite city MMDB from the publisher and verifies its published SHA-1 checksum at build time. The UI links to DB-IP to meet CC BY 4.0 attribution requirements. See [DB-IP Lite](https://db-ip.com/db/download/ip-to-city-lite).

For a monthly refresh, update the download URL/checksum in `deploy/render/download-geo.mjs`, the `databaseMonth` metadata in `accountGeo.ts`, and the attribution month in `AccountAccessHistory.tsx`. Verify IPv4 and IPv6 lookups, then deploy the API and web images. A failed download/checksum fails the image build; it does not replace a running deployment. `GEOIP_CITY_DB` can override the file path for local validation. The production default is `/app/geo/dbip-city-lite.mmdb`.

## Validation

`node tools/test-network.mjs` runs the dedicated database integration suite, including role restrictions, password requirements, password/session/reset-link invalidation, secret-safe audit history, account preview isolation and forwarded-IP spoof protection. It only accepts a database named with the `_network_test` suffix.

`corepack pnpm --filter @workspace/3d-game exec playwright test --config playwright.security.config.ts` runs mocked browser checks against the admin dev server at port 5319 (override `ADMIN_TEST_BASE_URL`). It covers mobile/desktop password and preview forms, filter pagination/error recovery, and role restrictions. Live verification must not reset a real customer's password.
