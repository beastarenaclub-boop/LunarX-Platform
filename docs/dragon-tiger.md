# Dragon Tiger

Open `/dragon-tiger` after signing in, or select Dragon Tiger in the lobby.
The table has its own AI dealer, Zara, in a new gold-and-teal Dragon Tiger studio.
The dealer uses native Full HD video takes for natural eye blinks, gaze changes,
articulated wrists and open-palm gestures. The old photo mesh and browser speech
synthesis have been removed. Betting opens with one invitation when at least
nine seconds remain. Dragon and Tiger selections play their corresponding hand
gesture; Tie and closing bets use the small two-hand gesture. Results immediately
return the dealer to her calm waiting take, with no winner hand gesture.
Cards and settlement remain controlled by the server.
Between gestures, a quiet eight-second waiting take loops with restrained blinks.
The button beside Zara replays the betting or dealing gesture and is disabled
during results. Repeated chips
on the same side do not restart an already playing take. Closing betting stops
the invitation immediately, including at the displayed countdown deadline.
Sound follows the saved game preference and volume levels. A table tap unlocks
browser audio; the speaker button explicitly enables or mutes it. Enabling sound
restarts the invitation when at least nine seconds remain. The same film's voice
is extracted and normalized, then played through the shared unlocked AudioContext.
The film itself stays muted. Voice follows the video's playhead, pause, buffering
and seeks, and stops on mute, hidden tabs, closed bets or unmount. Reduced-motion
and data-saver users can hear the invitation with the still poster.
Chip placement, undo, clear, confirmation, dealing and reveal have table effects.
Preferences are saved immediately so active engine ticks cannot postpone them.
Reduced motion and data saver keep the matching still without fetching videos.
Explicit replay in either mode loads one gesture, then returns to the still.
Hidden tabs pause playback. A media error leaves the still visible.
Every take retains native 1920 × 1080 resolution and 24 fps, encoded as H.264
with a fast-start MP4 header for inline mobile playback. Clips load on demand.
This is a fictional AI dealer using generated video, not a human livestream.
Asset sources and exact generation prompts are in [dragon-tiger-assets.md](dragon-tiger-assets.md).
The shared coin rack and coin settings match the other live tables, with
shared chip denominations up to the 5,000-chip table limit. Custom amounts must
be multiples of 10, and selected coin preferences are saved per account.
Balance is in the table header. The live leaderboard is
beside the table on desktop and in a compact row above the cards on phones; its expand button
opens the complete ranking and the player's own position. Empty rankings show
that a first completed round is needed. Sound is optional.

Phone layouts use viewport-height sizing and safe-area insets, with 44px or
larger betting/coin targets. Landscape puts the controls beside the dealer.
History remains scrollable below the table. Layout tests cover widths 280–932px,
including 320×568, and check that the primary controls fit without scrolling.
Expanded rankings and text zoom can extend the page; no fixed-height wrapper
clips content or traps scrolling.

This table uses the **shared wallet**, with one chip equal to one rupee.
Bets debit that wallet and settled returns credit it atomically. The server persists bets and rankings in PostgreSQL;
there are no fabricated players on the leaderboard.

## Rules

- Every connected player sees the same round: 20 seconds for bets, 3 seconds
  for dealing, and 6 seconds for the result.
- Choose chips, add them to any combination of Dragon, Tiger and Tie, then
  confirm. One confirmed slip per account per round. Undo, clear, double and
  rebet edit the draft only. Rebet always requires confirmation.
- Fresh eight-deck shoe each round; two cards sampled without replacement
  using Node's cryptographic RNG. Ace low, King high, suits ignored.
- Each revealed card shows a large central rank. The comparison between the
  cards shows, for example, `9 > 4` or `K = K`. Only the winning card glows;
  both glow on a tie. Result text also spells out A=1, J=11, Q=12, K=13.
- Dragon/Tiger wins pay ₹0.98 profit per ₹1 stake (1.98x total return). Tie pays ₹12 profit per ₹1 stake (13x total return).
- Settlement uses integer paise; payout history and leaderboard net retain two decimal places. Each round stores its rates, so rounds already open before the rate migration settle at their original rates. The table displays the current round's rates.
- On a tie, main bets return half their stake.
- Minimum 10, maximum 5,000 wallet chips per round, in multiples of 10.
- The all-time board ranks settled net profit, then winning rounds, then
  account ID for stable ties. In-flight stakes do not change the ranking.
  The signed-in account's own rank is shown even outside the top 10.
- Rankings and table state refresh every 1.5 seconds while the page is visible.
  The crown announces a change of leader. Disconnected clients cannot bet.

## Server and persistence

Authenticated `GET /api/dragon-tiger/table` and
`POST /api/dragon-tiger/bet` share a PostgreSQL transaction and advisory lock.
The POST body is `{ roundId, spots: { dragon, tiger, tie } }`.
Duplicate identical submissions are idempotent; a changed slip is rejected.
The authoritative clock is read after the lock, and cards stay secret until
the result phase. Balances and bets settle atomically and only once.

Rounds advance on authenticated requests. If nobody is connected, a persisted
round settles when the next request arrives, then a fresh betting window
opens. This also recovers unsettled bets after an API restart. The current
design is intended for this application's single shared table.

Migration `0035_dragon_tiger` creates the players, rounds and bets tables.
Migration `0037_dragon_tiger_paise` preserves payout history, adds paise precision
and pins each round's rates. New rounds pay 98 paise main profit and ₹12 Tie profit per ₹1.
The existing Docker startup applies it automatically:

```sh
docker compose -p aviator-game up -d --build api web --wait
```

## Checks

```sh
corepack pnpm --filter @workspace/api-server exec node --import tsx --test src/services/__tests__/dragonTiger.test.ts
corepack pnpm --filter @workspace/3d-game exec playwright test tests/dragon-tiger.spec.ts
corepack pnpm --filter @workspace/3d-game exec playwright test --config playwright.dragon-tiger-payout.config.ts
```

Browser tests need `PLAYWRIGHT_BASE_URL` pointed to the running player website
and Chromium installed (or `PLAYWRIGHT_CHROMIUM_PATH`). They intercept the API
for reproducible layout, reconnection and result checks. The separate
`dragonTiger.integration.test.ts` uses real PostgreSQL and requires
`DRAGON_TIGER_INTEGRATION=1` with `DATABASE_URL` naming an isolated database
ending in `_dragon_tiger_test`. It changes the round clock and cleans its
fixtures; never point it at a player database.
