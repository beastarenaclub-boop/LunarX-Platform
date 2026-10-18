# Coin Flip stadium toss

`/coin-flip` uses a responsive cricket stadium presentation within
`InstantCollection`. An AI-generated adult female presenter stands on the
pitch, flicks a physical-looking coin upwards, follows it with her eyes and
catches it. The camera moves closer during the shot. The presenter and toss
trajectory stay centered for narrow mobile screens.

## Media and result presentation

`public/media/coin-flip/stadium-toss.mp4` is a 1920 x 1080, 24 fps, ten-second
Runway-generated video. The first frame is the idle/reduced-motion poster.
`provenance.json` records the prompt, generation task, encoding and asset hash.
The visible AI HOST badge identifies the generated presentation.

Video plays once after an explicit bet. Entering the page, selecting a side,
changing the stake or reloading does not play a toss. `useStadiumToss` resets
playback for the next bet. The physical coin stays covered at the end, so the
video never specifies a Heads/Tails outcome.

A small verified-result coin lands on the server receipt's `outcome[0]`
(0 = heads, 1 = tails). Its two original SVG faces live in `media/instant`.
Animation never calculates a random result or payout. Result audio, the visible
wallet and the latest history chip wait until the catch and reveal finish;
ledger settlement remains immediate and server-owned.

## Controls and recovery

Only the explicit Flip button submits a bet. Controls remain locked during
submission, video playback and reveal. Shared chips honor profile Button Value
presets and wallet/game limits. Editable stakes permit paise; potential returns
use the server RTP and multiplier cap, include the stake and round down to paise.

Unconfirmed requests retain their idempotency key, side, stake and client seed
across reloads. Retry submits that same request. A 15-second confirmation timeout
unlocks recovery without assuming a missing response means failure. Wallet and
history refresh run in the background after confirmation.

Disabling animation, reduced motion, a media error or hiding the tab releases
presentation without another bet. Returning to the tab does not replay the toss.
A 13-second media watchdog prevents a stalled video from locking a settled bet.
Rejected bets stop playback and suppress the previous receipt. Existing ledger,
settlement and demo isolation remain unchanged.

## Verification

- Frontend TypeScript and production Vite build.
- `playwright.instant-collection.config.ts`: both Heads/Tails wins and losses,
  wallet reconciliation, replay/reload identity, decimal rounding, payout caps,
  profile chips, one toss per bet, reveal timing, duplicate-click locking,
  skipping, tab visibility, stalled/missing media, rejected bets, reduced motion
  and responsive scene/controls at 320, 390, 844 and 1440 px.
- Production checks use a volatile demo session, never a cash-account bet.
  Public health checks run without the restricted demo cookie.
