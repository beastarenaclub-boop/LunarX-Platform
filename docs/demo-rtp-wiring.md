# Demo RTP configuration sync

The main API previously copied only `game_config` into its isolated demo worker.
Saved B2C RTP policies and the 17 supported table engines' Game Control settings
were absent there. Production settings were already wired to their game services;
demo visitors could therefore receive different prices or engine modes.

The bridge now captures a consistent, read-only configuration snapshot at startup
and every 30 seconds. The worker applies game settings, B2C policies, engine modes,
parameters and local budget settings in one transaction. Changes affect new quotes
and future decisions; accepted bets retain their stored payout terms.

Demo balances, identities, history, streaks and settlement records remain independent.
No production account IDs, forced outcomes or bank balances are imported. At startup
or a changed operator revision, a demo engine receives the source's remaining loss
budget and distance to target, translated against its own bank. Combined budgets use
the demo's combined bank. These floors and targets stay frozen between revisions:
polling does not refill a spent budget or undo the demo's automatic return to Auto.
Configuration commands are serialized and revision cursors advance only after commit.

This repair does not change saved production modes, RTP percentages, budgets,
graphics, or the set of games eligible for table result control. Normal mode still
uses each table's natural draw. Crash and player-action games retain their own RTP
and payout paths.

Validation:

- `node tools/test-rtp-wiring.mjs`: all supported policies and engine modes, refresh,
  relative/frozen budgets and targets, rollback/retry, policy removal, accepted Mines
  payouts, and the existing funded B2B/B2C RTP integration suite.
- Build the API, then run `node --import tsx --test src/demo/__tests__/configuration.worker.test.ts`
  from `artifacts/api-server`: actual Dice quotes and bets through the built worker,
  stale-quote rejection, refresh, policy reset, and admin-route isolation.
- Existing result-engine, handoff, Lunar and demo gameplay suites cover selection,
  settlement, round immutability, wallet idempotency, and other game families.

Live verification compares saved settings before/after deployment and reads demo
public game configs against the effective B2C policies without changing settings.
