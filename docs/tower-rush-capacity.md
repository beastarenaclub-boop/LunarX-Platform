# Tower Rush performance and capacity

## Current release

The browser uses TypeScript/React for controls and Three.js/WebGL for the scene.
GPU animation does not make server requests per frame. Python produces the
right-sized, content-addressed art pack. Changing language alone does not establish
server capacity.

The optimized art pack is 379,404 bytes, down from 1,504,751 unique source bytes
(74.8%). Four exact sound excerpts total 121,378 bytes instead of downloading the
642,301-byte recording. The loading screen reuses the first facade instead of
fetching a 609 KB lobby atlas. Normal maps are 128px, facades 384px, and the light
environment is 512px or smaller. All GPU assets load in one parallel phase.

One comparative cold-load run of the production bundle, at 200 KB/s and 80 ms
latency with cache disabled, 4x CPU slowdown and a headless software GPU, measured
4,005,531 -> 1,383,122 transferred bytes and 24.466 -> 13.472 seconds to the first
ready WebGL scene. The initial scene shell was 4.974 -> 6.768 seconds; the bundle
bootstrap still needs improvement. APIs were mocked: these are browser-loading
measurements, not a real-device SLA or server capacity benchmark.

Immutable filenames receive one-year browser/CDN caching. Missing Tower Rush art
returns 404 instead of SPA HTML. Authenticated instant-game responses are private
and no-store. Successful extra floors use their authoritative move receipt instead
of requesting state and wallet data again. Placement, settlement, recovery and
window focus still reconcile with the API.

The renderer limits resolution, keeps at most twelve completed floors, shares
geometry, pauses hidden scenes and has an explicit animation preference. Road
markings, passing vehicles and the crane make motion visible. Reduced motion is
honored until the player explicitly enables animation.

## One million daily players is a workload target, not a verified capacity

With an illustrative average session of ten minutes, 1,000,000 sessions/day means
about 6,944 average concurrent sessions. A 4x peak factor means about 27,778 peak
concurrent sessions. If everyone takes a move every three seconds, that is about
2,315 average / 9,259 peak move requests per second, before placements, settlements,
auth, history and other games. These are assumptions, not observed traffic.

Production was inspected on 2026-11-18. The existing Render API has one 1-CPU/2-GB
instance with a persistent disk, and the web gateway has one 0.5-CPU/512-MB instance.
No paid resources were resized by this change. No large load test ran against live
players or real balances.

The API disk currently prevents horizontal scaling. Render documents this
restriction at https://render.com/docs/scaling. The realtime bus is a process-local
EventEmitter (`artifacts/api-server/src/realtime/eventBus.ts`) and the database pool
uses default configuration (`lib/db/src/index.ts`). Simply increasing replica count
would not provide a reliable multi-instance realtime system.

## Required capacity work before accepting this target

1. Establish measured peak concurrent players, session duration, actions/second,
   regional distribution and an infrastructure budget.
2. Move disk-dependent data to shared storage or a separate stateful service;
   inventory game schedulers and ensure a single authoritative round owner before
   running API replicas. Preserve wallet transaction locks and idempotency.
3. Add cross-instance pub/sub for realtime events and revocations. Keep private
   wallet/account messages scoped to their owners.
4. Size managed PostgreSQL and its connection pool from transaction benchmarks,
   with per-instance limits, slow-query metrics, backups and a connection proxy if
   required. Do not multiply the current default pool blindly across replicas.
5. Verify Cloudflare edge hit rates for hashed public assets and HTTP compression;
   keep auth, wallet, game state and POSTs out of CDN caching.
6. Run the staging-only load script with disposable funded test accounts on an
   isolated database. Ramp traffic progressively; observe p95/p99 latency, errors,
   event-loop delay, CPU, RSS, DB locks/connections, settlement correctness and
   socket delivery. Test duplicate actions, interrupted responses and failover.
7. Choose paid plans and replica limits from those results, then repeat a soak
   test. Infrastructure provisioning and data migration require their own review.

## Reproducible checks

`tools/tower-assets/optimize_runtime.py` and `optimize_audio.mjs` reproduce the
runtime assets. The latter needs `FFMPEG_PATH` or ffmpeg on PATH.

`artifacts/3d-game/tests/tower-rush.spec.ts` covers UI, animation, recovery,
unlimited floors, payout cap, request reduction and context loss. Wallet and
randomness are separately verified in the isolated backend tests.

`tools/tower-assets/staging-load.js` is a k6 staging workload. It is deliberately
not a production benchmark or a claim of one-million-player readiness. Never
use real customer sessions or balances in its account fixture.
