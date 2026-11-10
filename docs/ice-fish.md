# Ice Fish

The new `/ice-fish` game follows the visible layout in `Recording 2026-11-10 092553.mp4`: cracked blue ice, a 45-position metal wheel, anchor and fish betting areas, chip tray, countdown, wallet and result history. It is available from the B2C and player lobbies. Existing games retain their designs.

The second visual pass replaces the ice background, adjusts wheel size and placement, outlines the anchors, textures the hub, enlarges radial fish labels and reverses the betting-card fish to face the reference direction. The wheel zoom begins with the spin, boosts appear during deceleration, the pointer lights on landing, and an icy result card replaces the floating result. Chips hide and betting cards move down when betting closes. Five denominations match the reference's tray structure while retaining platform stake values. Responsive sizes keep menus, results and wallet controls reachable.

The player count uses actual round participants. [Background v2 provenance](ice-fish-visual-v2.json) records the built-in image-generation prompt.

The recording contains no audio and does not show the interior fishing bonus sequence. Sound cues, fish artwork and the catch animation are new implementations. Hidden provider weights cannot be recovered from a recording; this game uses the independently implemented, versioned platform rules in `lib/api-zod/src/ice-fish.ts`.

## Rules and controls

There are 19 white anchors, 19 grey anchors, four blue fish, two green fish and one red fish. Natural rounds draw uniformly from 45 positions with a committed HMAC seed. Fish values use published weights 50/25/15/7/2/1; values are 3/5/10/20/50/100 for blue, 5/10/20/50/100/200 for green, and 10/20/50/100/200/500 for red. Fish boosts are 1x with 90% probability, otherwise uniform 2–10x. Anchor boosts are 1x normally, otherwise uniform 3–10x with probability 199/4180. Anchor raw total return is one plus the boost; fish raw total return is the fish value times its boost.

Each winning return is scaled by the player's accepted RTP divided by that spot's exact raw expected return. The shipped natural target is 95.5%; integer-paise flooring and the configured cap can reduce realized theoretical return. A short session is not guaranteed to match a target. The UI explains configured result selection and marks managed results as unsuitable for seed-only verification.

Admin **Game Control → Ice Fish** provides the existing Normal, Collect, Distribute, Auto and RTP modes, bank settings, and five named outcome choices. B2C RTP, B2B master RTP and the combined bulk controls include the game. Migration 0069 inserts only missing Ice Fish defaults and preserves existing settings. New settings inherit a pre-existing shared loss allowance where applicable; no existing bank is reset or funded.

## Settlement

Shared server rounds use a 12-second betting period, 14-second reveal and 4-second settlement period. The frontend submits an explicitly selected draft before the server deadline. Requests have stable UUID keys, including uncertain-response retries. Cumulative round limits are checked under the user admission lock. Accepted bets keep their original pricing after an RTP change. Only the table settlement path can settle Ice Fish bets; generic cashout/loss routes cannot bypass it. Reconnect and restart recovery use server-authoritative slips and idempotent wallet entries.

Demo uses the same rules in its isolated worker and never copies real balances. The new game uses the shared wallet and realtime topics on both channels.

## Artwork and validation

Three WebP assets live in `artifacts/3d-game/public/media/ice-fish/`: `frozen-lake-v1.webp`, `fish-atlas-v1.webp`, and `banner-v1.webp`. Artwork was made with the built-in image-generation tool using frames from the user's recording; [the complete prompt set](ice-fish-art-prompts.json) records the inputs and output paths. The interactive wheel and UI are SVG/CSS/React, not a screenshot overlay.

Run `node tools/test-ice-fish.mjs` for isolated SQL, payout, authentication, mode-control and recovery tests. Run `ICE_FISH_URL=<local URL> node tools/test-ice-fish-browser.mjs` against a local player build for desktop, portrait and landscape layout, betting, same-key retry, bonus, menu and sound checks. Browser financial APIs are mocked; integration tests use an isolated database. Existing handoff, RTP wiring and bulk-control suites cover the expanded scope.
