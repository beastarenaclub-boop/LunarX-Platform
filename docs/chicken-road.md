# Chicken Road

The lobby card opens `/chicken-road`. The game uses the existing authenticated
session, INR wallet, ledger, bet history, coin preferences and sound settings.
No extra player balance or browser-side settlement is used.

## Round timer (4 October 2026)

Each accepted round now has a fixed 60-second deadline. The controls show a
server-synchronized countdown, highlighted for the last ten seconds. Go,
refreshing, opening another tab and reconnecting never extend that deadline.
At expiry, an active round cashes out at its current safe lane. If no lane has
been crossed, the original stake is returned at 1x. A collision that already
ended the round remains a loss. The next bet requires the player to press Play.

The deadline and timeout reason are stored in the existing bet metadata. A
one-second server worker settles overdue rounds even when the browser is closed;
state recovery and late actions also enforce the same deadline. All settlement
paths lock the bet row and commit the result and wallet credit together, so
competing cashouts, late moves, workers and retries cannot pay twice. Old active
rounds without a deadline receive one persisted 60-second grace period on
recovery. No schema migration is needed.

The timer integration test uses the same isolated database restriction as the
original integration suite:

```sh
CHICKEN_ROAD_INTEGRATION=1 node --import tsx --test src/services/__tests__/chickenRoadTiming.integration.test.ts
```

Browser timer cases cover server/device clock differences, refresh and Go without
a reset, overdue controls, wallet refresh, mobile fit and no automatic new bets.

The local timer release at `http://localhost:5200/chicken-road` passed all 12
browser cases and seven server tests (including both isolated database suites).
Typechecks and production builds passed, and the real API, wallet connection,
timer rules and desktop/mobile layouts were checked on port 5200.

The deployed images are `aviator-game-api:chicken-timer-isolated-20261004` and
`aviator-game-web:chicken-timer-isolated-20261004`. They preserve the previously
deployed game rules and other games' code while adding the timer. The working
tree also contains separate in-progress changes; those were excluded from this
local release after a full-tree build exposed a Win Go schema mismatch. The
previous build was restored before preparing the isolated release. All 18 shared
or other-game frontend JS/CSS files were compared with the working deployment;
only dependency URLs changed to give the release fresh cache keys. Rollback
images retain the `before-chicken-timer-20261004` tag. The deployment override is
`tmp/chicken-timer-isolated/compose.yaml`.

## Gameplay and research

The [InOut product page](https://www.inout.games/en/game/chicken-road), checked
on 3 October 2026, describes four difficulties, a chicken moving towards a golden
egg, increasing risk and 98% RTP. It does not publish its proprietary algorithm
or complete multiplier tables. This implementation is an original adaptation:
original SVG artwork and explicitly versioned paytables, without an InOut logo,
certification claim, simulated online counts or fabricated live winners.

Choose a stake and difficulty, press Play, then Go for each lane. Cash Out is
available after the first lane. New **version 2** rounds use guaranteed-win
rules: every lane is safe in all four modes, with no collisions. The final lane
cashes out automatically. Leaving, refreshing or restarting the server preserves
the active round. This operator-requested mode differs from the researched game.

| Mode | Lanes | First return | Maximum return |
| --- | ---: | ---: | ---: |
| Easy | 24 | 1.01x | 28x |
| Medium | 22 | 1.12x | 241.46x |
| Hard | 20 | 1.25x | 1000x |
| Hardcore | 15 | 1.50x | 1000x |

The road, cashout result and game history display profit factors: total return
minus 1. Easy therefore starts at **+0.01x profit**. A 100 rupee stake cashed out
at that lane returns 101 rupees total (100 stake plus 1 profit). Cashout amounts
and wallet credits still include the stake. Rules and fairness details explain
this distinction. Displaying profit does not alter the total-return paytable.

Chicken audio is synthesized locally in `src/game/chickenSounds.ts`: a three-part
cluck on Play, a soft rising/falling boing with wing flaps and a landing tap on safe steps,
a happy call with chimes on cashout, and a squawk for historical classic collisions. These
use the shared sound bank, volume and mute setting; enabling sound previews the
cluck. Navigation and hidden tabs cancel playback. Action calls follow accepted
game actions, so state refreshes and restored rounds do not replay old sounds.
While waiting before Play or Go, the chicken hops in place every 2.8 seconds,
with a quieter version of the boing on each repeated animation cycle. Idle motion pauses during
requests, crossing, results, dialogs and hidden tabs. Reduced-motion preferences
disable this loop; the shared mute toggle silences its calls without stopping
the chicken's motion. Idle animation never places a bet or advances a lane.

Full tables are in `lib/api-zod/src/chicken-road-game.ts`. Values are integer
hundredths. Payout is `stakePaise * returnHundredths / 100`, using integer
division. Returns include the stake. Version 2 uses survival probability 1 at
every valid step. Historical version 1 uses `0.98 / nextMultiplier` at step one
and `currentMultiplier / nextMultiplier` afterward, preserving 98% RTP and its
original seed replay. The version is stored with each accepted round.

### Guaranteed wins and exposure

Version 2 has **100% win chance**, not 100% RTP. The customer chooses a cashout
lane, so the guaranteed total return depends on that lane: from 101% of the
stake at Easy's first lane to 100,000% at the maximum Hard/Hardcore lane, before
paise rounding. There is no fixed RTP or positive house edge for this mode.
For example, ₹100 cashed out at Easy's first lane returns ₹101; finishing Hard
returns ₹100,000. The server's config response uses `rtp: null, version: 2`
and the UI explains the win chance and total return separately.

Classic version 1 retains its 98% RTP and 2% theoretical house edge. Existing
results are not rewritten. No unfinished classic rounds existed when the
guaranteed-win change was prepared. Other games' winning rules are untouched.

With the default ₹10,000 maximum stake, the maximum single-round gross return
is ₹280,000 on Easy, ₹2,414,600 on Medium, and ₹10,000,000 on Hard/Hardcore.
The current implementation enforces stake limits but has no aggregate bankroll
reservation or separate payout cap. Maximum stake and enabled status can be
changed through the existing game configuration before accepting new rounds;
lower stakes reduce the size of the guaranteed payouts. Any future payout cap
must be defined in the published rules and enforced at placement without
reducing the promised return on an already accepted round.

RTP describes a long-run average, as explained in the
[Gambling Commission's RTP guide](https://www.gamblingcommission.gov.uk/public-and-players/guide/return-to-player-how-much-gaming-machines-payout).

## Settlement and recovery

`POST /api/chicken-road/place` accepts a UUID request ID, client seed, integer
paise stake and difficulty. An advisory transaction lock serializes placement
per user. The round and wallet debit commit in the same transaction. Repeating
the same request returns the original receipt, including after settlement.
Changing the payload on a used ID is rejected. An active round prevents another
placement, even across API processes. Insufficient funds roll everything back.

`POST /api/chicken-road/:id/step` and `/cashout` require `expectedStep` and lock
the owned bet row. A stale step conflicts; a terminal replay is read-only.
Progress, payout, ledger credit and terminal status commit together. The general
bet place/cashout/loss services reject this game, so a player cannot submit their
own multiplier. Partner callback sessions are rejected rather than debiting
the local wallet accidentally. Cash and shared-wallet play are supported;
bonus/free-bet balances are not offered for this game.

Rounds use the existing `bets` table, with private versioned state in metadata.
The generic bet serializer excludes metadata. The game receipt is an explicit
allowlist and reveals the server seed only after cashout or loss. Recent history
and active round queries are separate, so an old unfinished round remains
recoverable. UI requests are pessimistic; it retains ambiguous placement IDs in
session storage and recovers through `/state` instead of charging again.

For classic version 1 lane n, HMAC-SHA256 uses the hex server seed string as key and the UTF-8
message `chicken-road:v1:CLIENT_SEED:DIFFICULTY:n`. Divide the first 13 hex digits
by `2^52`; values below the lane survival probability are safe. The UI shows
the SHA-256 commitment before the first step and the replay details afterward.
This is a replay mechanism, not a claim of independent certification.
Version 2 retains seed records but does not use them to determine a loss: every
valid lane is safe. Its round-details panel describes this deterministic rule.

## Configuration and validation

Startup seeds an enabled `chicken-road` config with minimum ₹1 and maximum
₹10,000, without overwriting an existing operator row. Admin metadata exposes
stake limits and availability, and explains the guaranteed-win rule. Generic
RTP/house-edge columns remain legacy data and do not control Chicken Road;
the game's own config endpoint and per-round version are authoritative.
No database schema migration or new dependency is required.

From `artifacts/api-server`, run:

```sh
node --import tsx --test src/services/__tests__/chickenRoad.test.ts
# Only against an isolated database whose name ends in chicken_road_test:
CHICKEN_ROAD_INTEGRATION=1 node --import tsx --test src/services/__tests__/chickenRoad.integration.test.ts
```

Browser tests use the existing player app with controlled API fixtures to cover
coins, sound toggle, win/loss presentation, recovery, wallet display and screen
sizes. Point `CHICKEN_GAME_URL` at a running player app, then from the root run:

```sh
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.chicken-road.config.ts
```

## Local deployment verification (2026-10-03)

The Docker player app at `http://127.0.0.1:5200` was serving an older frontend
and API image, so neither the lobby card nor the API route was available.
Both services now use the compiled Chicken Road build. Existing public game
media was retained when layering the new frontend assets onto the local image.
The standard Dockerfiles still build the updated source for future deployments.

Verified the real lobby card, navigation to `/chicken-road`, enabled game config,
mobile game screen and shared wallet connection in Chrome without mocked API
responses. The temporary zero-balance account was removed after verification.
Both app containers report healthy. The wallet integration test also passed
against the isolated `aviator_chicken_road_test` database, covering placement
and cashout races, rollback, recovery, seed privacy and automatic final payout.

Local rollback images are tagged `aviator-game-api:before-chicken-road-20261003`
and `aviator-game-web:before-chicken-road-20261003`. The current API has the
`chicken-guaranteed-20261003` tag; the frontend with softer jump sounds has
`chicken-jump-20261003`, in addition to Compose `latest`.
The immediately previous API is `before-guaranteed-20261003`, and the previous
frontend with idle jumps and chicken calls is `chicken-idle-20261003`;
previous frontends remain available as `chicken-sounds-20261003`,
`chicken-profit-20261003`, `shared-coins-20261003` and
`chicken-road-design-20261003`.

The design refresh uses navy controls, a violet road, mint/gold actions,
coloured traffic and distinct next/safe/hit lane states. The chicken aligns
with lane centres, and an accessible progress indicator shows completed lanes.
Compact portrait and landscape layouts keep the betting controls and wallet
status visible. Rules explain guaranteed version 2 wins separately from classic
version 1 RTP. Historical version 1 probabilities and seed replay are preserved.

Profit display verification passed frontend typechecking, production build and
all five Chicken Road browser tests. The first safe Easy lane shows +0.01x,
while a 100 rupee stake still pays 101 rupees total and credits the shared wallet.
The deployed lobby and game at port 5200 also passed a real API browser check.

The chicken sound and idle update passed typechecking, production build, all nine
Chicken Road browser cases and all ten shared audio tests. Playback checks
cover start/hop/win/loss calls, mute persistence, navigation cancellation and
bounded sound levels, plus idle motion and calls before Play/Go, hidden-tab
pausing and reduced motion. A real API browser check at port 5200 confirmed
the idle animation, repeated clucks and mute control; its temporary
zero-balance account was removed.

The jump sound refresh replaces hop clucks with a short rounded boing, light
wing flaps and a quiet landing tap. Idle jumps use a softer variant. Play,
cashout and classic collision calls retain their existing hen sounds. Three
playback/mute/idle browser checks and the shared sound-level matrix passed,
along with frontend typechecking, the production build and the live browser
check on port 5200. All 143 frontend files matched the build manifest.

Guaranteed-win validation passed five math/replay tests, the isolated database
integration test, ten Chicken Road browser tests, typechecks and both production
builds. The database test crosses every lane in all four modes, checks automatic
final payouts and verifies retries never duplicate wallet credits. Port 5200
was checked with real API responses for version 2, `rtp: null`, the 100% win
chance label, shared wallet, rules, idle jumps and sounds. The test account was
removed, and all local app services report healthy.

During packaging, a full host disk made Docker's filesystem read-only. Obsolete
temporary task builds were removed and Docker was restarted normally. The API
image was rebuilt from a fresh context after detecting empty files in the failed
candidate. Before activation, all 336 copied API files and 143 frontend files
matched source SHA-256 hashes; the named database and math tests then passed
inside the verified image. No volume was deleted or reformatted.

Shared betting presets are ₹100, ₹500, ₹1,000, ₹2,000, ₹5,000 and ₹10,000,
filtered by each game's stake cap. Coin preferences use `table-coins:v3` to
apply this ladder once to existing accounts while retaining custom-amount
visibility. Later player choices still persist across games. The wallet's
deposit-pack catalog remains separate. Verified the list on 21 actual game
screens at port 5200, including Rummy and capped Forex/Dragon Tiger tables.
