# Coin Flip studio

`/coin-flip` uses a dedicated responsive studio within `InstantCollection`.
The green and gold studio pairs a gold profile Heads coin with a silver compass
Tails coin. Both faces are original SVG artwork in `public/media/instant`.
Web Animations rotates a two-sided coin and lands on the server's `outcome[0]`
(0 = heads, 1 = tails). Animation never calculates a random result or payout.

The AI animated female host reuses the project's existing generated studio
assets: `public/media/dragon-tiger-one-day/dealer-idle.mp4` and its poster.
Their provenance is recorded alongside them in `motion-provenance.json` and
`provenance.json` (Higgsfield / Seedance 2.5, October 2026). No new paid generation
is required. The UI labels this as an AI host and looped studio video. It does
not represent a live dealer feed or imply the host determines the outcome.
Video pauses in a hidden tab, has a manual pause control, uses a still under
reduced motion and falls back to the poster on media errors.

Selecting a side or chip only updates the staged bet. The explicit Flip button
submits one request; all controls remain locked during submission and landing.
Shared chip presets honor profile Button Value overrides and wallet/game limits.
The editable amount permits paise. Potential returns use the server RTP and
multiplier cap, include the original stake and round down to paise.

An unconfirmed request keeps its idempotency key, side, stake and client seed in
the existing recovery storage. Reload restores those displayed controls, and
Retry submits the original request. A 15-second confirmation timeout unlocks
recovery without treating a missing response as a failed bet. Confirmed results
can land while wallet/history refresh in the background. Existing ledger,
settlement and demo isolation remain server-owned and unchanged.

Validation:

- Frontend TypeScript and production Vite build.
- `playwright.instant-collection.config.ts`: Heads/Tails wins and losses,
  wallet reconciliation, reload/retry identity, decimal rounding, payout caps,
  account chips, animated final face, duplicate-click locking, video playback,
  reduced motion and responsive studio/controls at 320, 390, 844 and 1440 px.
- `src/services/__tests__/instantCollection.test.ts`: seed determinism,
  distribution, payout and neighboring instant-game rules.

Production verification uses the volatile demo session, never a cash-account bet.
