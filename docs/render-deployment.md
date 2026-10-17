# lunarx.live on Render with Hostinger DNS

The root `render.yaml` provisions two Docker services and a managed PostgreSQL
16 database in Singapore. It uses paid compute and does not configure a live
payment provider. Deployment configuration is not a production security audit
or legal approval for real-money operation in India.

| Resource | Configuration |
| --- | --- |
| `lunarx-web` | Public Nginx gateway, 0.5 CPU / 512 MB |
| `lunarx-api` | Private Node API, 1 CPU / 2 GB, one instance |
| `lunarx-game-data` | 5 GB disk mounted at `/var/data` on the API |
| `lunarx-db` | PostgreSQL 16, 0.5 CPU / 1 GB, 15 GB storage, external connections blocked |

These are initial deployment sizes, not a concurrent-player capacity guarantee.
Review the account's current compute, disk, bandwidth and workspace charges
before provisioning. The existing media assets make bandwidth usage relevant.
Provider prices: <https://render.com/pricing>.

## Source and deployment

1. Connect the Render account and authorize access to the source repository.
2. Use the `main` branch of `beastarenaclub-boop/LunarX-Platform`, including
   the local game changes, assets, database migrations, `render.yaml` and
   `deploy/render/`. Future releases must include the intended local game changes;
   deploying an older branch will not deploy the current game. Exclude local
   databases, exports, credentials, `.env` files and dependencies.
   If using another release branch, change both `branch` entries in `render.yaml`.
3. Grant the Render GitHub app access to the private `LunarX-Platform` repository.
   Create a Blueprint from that repository using branch `main` and `render.yaml`
   at the root, or use the **Deploy to Render** button in the repository README.
   Enter `SUPER_ADMIN_EMAIL` and a unique `SUPER_ADMIN_PASSWORD` of at least
   16 characters in Render's secret fields. Do not put these values in Git.
4. The API obtains the internal database URL and the gateway obtains the API's
   internal host/port automatically. Database migrations run before API startup;
   a failed migration stops startup. The database starts empty: existing local
   accounts and balances are not imported by this Blueprint.
5. Verify both builds and `/api/healthz` on the actual web service's assigned
   `https://<service>.onrender.com` URL. The provider assigns this hostname;
   do not assume that the service name is its available public hostname.
6. Configure DNS only after the service is healthy. Then verify the custom
   domains in Render and wait for HTTPS certificates to finish provisioning.
7. Automatic deploys are deliberately off. Build and deploy reviewed releases
   manually, including an explicit migration and rollback plan.

Render guide: <https://render.com/docs/infrastructure-as-code>.

## Hostinger DNS records

Keep the existing Hostinger nameservers. In the DNS zone for `lunarx.live`, use
the target hostname shown on **lunarx-web -> Settings -> Custom Domains**.

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `216.24.57.1` (verify the value displayed by Render before cutover) |
| CNAME | `www` | The actual `lunarx-web` service's `*.onrender.com` hostname |
| CNAME | `b2b` | The same Render hostname |
| CNAME | `admin` | The same Render hostname |
| CNAME | `panel` | The same Render hostname |

Replace conflicting A/CNAME records only for these web hostnames. Remove their
conflicting AAAA records because Render's documented custom-domain ingress uses
IPv4. Preserve mail MX, SPF, DKIM, DMARC and unrelated TXT records. Save the old
web records before cutover so DNS rollback is possible. Check CAA restrictions
against Render's current certificate requirements if issuance fails.

Render adds `www` and redirects it to the apex when the apex domain is attached.
Hostinger registration does not need to be transferred to Render.

DNS reference: <https://render.com/docs/configure-other-dns>.
HTTPS reference: <https://render.com/docs/custom-domains>.

## Routes and proxy trust

| URL | Application |
| --- | --- |
| `https://lunarx.live/` | B2C player lobby and integrated games |
| `https://b2b.lunarx.live/` | B2B player website |
| `https://admin.lunarx.live/admin/` | Admin panel |
| `https://panel.lunarx.live/master/` | Master panel |
| `https://panel.lunarx.live/agent/` | Agent panel |

The gateway preserves the Host header, which the API uses for B2B and operator
session isolation. API calls and `/ws` remain on each page's own origin. Existing
Unity, horse-riding and media routes are generated from the existing Nginx
configurations. Query strings are omitted from access logs because launch links
can contain tokens.

Only the gateway is public. `TRUST_PROXY=2` is specific to the route
browser -> Render edge -> Nginx -> private API. Review forwarding and rate-limit
behavior if adding Cloudflare or changing that topology. Secure cookies are
required. This configuration does not add MFA or a comprehensive WAF.

## Local verification

Preparation status (17 October 2026): the Blueprint passed validation against
Render's current JSON schema and the API Docker image built successfully. The
fresh frontend Docker build was interrupted when the Windows C: drive ran out
of space. The integration smoke test could not create its temporary Docker
network because Docker stopped responding. Frontend compilation and runtime
smoke tests therefore remain required; no successful production deployment is
implied by the presence of these files.

From the repository root, with Docker Desktop running Linux containers:

```powershell
docker build -f deploy/render/api.Dockerfile -t lunarx-render-api:verify .
docker build -f deploy/render/web.Dockerfile -t lunarx-render-web:verify .
node deploy/render/smoke-test.mjs
```

The smoke test creates uniquely named containers and a temporary PostgreSQL
database on a private Docker network. Only its web port is exposed, on loopback.
It checks migrations, bootstrap login, Secure/HttpOnly cookies, built pages and
JavaScript for each panel, B2B host handling, missing assets and an authenticated
WebSocket upgrade. It removes its own containers and network afterward. It does
not modify the existing local Compose database or the Hostinger DNS zone.

The Blueprint can additionally be validated using Render's current schema:
<https://render.com/schema/render.yaml.json>.

If frontend builds already exist locally, `node deploy/render/smoke-test.mjs
--reuse-local-frontends` mounts those outputs read-only instead of requiring a
new web image. This mode checks routing and API integration only; it does not
verify that the latest frontend sources compile.

## Operations before public launch

The persistent API disk preserves relevant SQLite files across redeployments.
An attached disk prevents horizontal scaling and zero-downtime deploys for that
service. Keep one API instance until game-engine ownership, shared state and
cross-instance events have been reviewed. Schedule releases between rounds and
verify restart/refund recovery. Reference: <https://render.com/docs/disks>.

Configure and restore-test PostgreSQL backups and application-consistent SQLite
backups before accepting valuable data. Do not treat a disk snapshot alone as
a complete database backup. Database migrations are separate from image rollback;
reverting an image does not revert database changes. Avoid automatic destructive
schema rollback.

External uptime/error alerts, admin MFA/access restrictions, payment-provider
configuration, legal review, load testing and an existing-data migration are
separate launch tasks. They are not automatically provided by this Blueprint.
