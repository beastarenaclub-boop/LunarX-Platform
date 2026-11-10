# All-game B2B and B2C controls

Open Admin → B2C Game Control → **All games / B2B + B2C**, or `/admin/b2c-rtp?section=bulk`. Game Control also links to this screen. Opening it, refreshing it or previewing a change does not write settings.

The screen lists saved B2C policies, current B2B master targets, original payout rules and shared result modes. Fixed-payout games show their current mathematical paytable return, including a range when betting spots differ. Hand-dependent games do not claim a single fixed percentage. Other games identify their configured default as a target, not a guaranteed realized return.

## Operations

- **Player RTP across channels:** apply one percentage to B2C, every current B2B master, or both. This covers the existing 16 player-policy games: Lunar, JetX, Fury, Mines, Plinko, Dice, Ludo, Lucky 7 Live, Wheel 20 Live, Poker 20-20, Crazy Time, Chicken Road, 7 Up 7 Down, Coin Flip, Wingo and Ice Fish. Masters created later retain their normal defaults.
- **Include shared tables:** optionally switch all 18 configured table engines to RTP mode at the same target. This affects shared B2B and B2C table results even when only one player-policy channel is selected. A player's payout policy and a table's result target are separate controls; neither guarantees a particular realized return.
- **Result mode:** apply Normal, Collect, Distribute, Auto or RTP to every connected table. Auto and RTP require an explicit percentage. Other engine parameters remain intact.
- **Bank / loss budget:** use one combined table budget, the same amount for each table, or restore separate per-game floors. Combined and same-each floors are fixed against the locked bank balances at Apply, so later rounds consume the allowance rather than replenish it. Restoring separate mode preserves the existing individual floors. This budget covers the 18 shared table streams across B2B and B2C; independent crash, skill and other engines remain outside it. It is not the network profit/bonus wallet budget. Natural draws and forced results are not stopped by this selector budget.

Each operation previews affected policies, masters and tables, plus excluded games, before admin password confirmation. Accepted bets keep their saved payout terms. No live percentage, mode or budget is changed by installing this feature. Player graphics are unchanged.

## API and consistency

Admin-only endpoints under `/api/admin/game-control/bulk`:

- `GET /`: read-only overview, including payout-rule source.
- `POST /preview`: read-only operation preview and a signed, actor-bound token valid for ten minutes. Process restart invalidates unused previews.
- `PUT /`: step-up authenticated atomic apply with `operation`, `previewToken` and a UUID `requestId`.

A settings change between preview and Apply requires a new preview. Bank settlement alone does not invalidate a preview; Apply uses the current locked balances. A unique audit receipt makes repeated and concurrent requests idempotent. An already completed request can return its receipt after the preview expires or the process restarts. A lost response is retried using the same ID, including after a page reload or incorrect confirmation password. Session storage holds only the pending request, never the password. Do not run multiple independent API schedulers for the same table streams.

No schema migration is required. Run `node tools/test-bulk-controls.mjs` for isolated database/API integration checks and `node tools/test-bulk-controls-browser.mjs [admin-build-directory]` for desktop/mobile tests. These verify scope, read-only previews, authorization, stale-setting rejection, atomic changes, accepted prices, frozen budgets and idempotent retries without touching production settings.
