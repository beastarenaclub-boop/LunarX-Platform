# Handoff games and Game Control

Integrated from `handoff-kit/game-integration-kit-2026-11-09.zip`.

## Operator entry point

Open **Operator Console → Game Control** (`/admin/game-control`) as an admin or super admin. All configured games appear in the list. Support and player accounts cannot read or change the engine settings.

For connected games, select Normal, Collect, Distribute, Auto or RTP, edit the parameters and save. Settings take effect at the next result decision. The 90% RTP preset sets a 1,000-basis-point house hold. This is a target over settled history, not a guaranteed individual return.

Budget policies are separate per game, the same amount for each game, or one combined amount. Saving a budget fixes its floor against the bank at that time. A combined budget uses the combined settled bank. These are selection constraints, not guaranteed loss caps: natural draws, explicit forces, simultaneous unsettled rounds and player decisions can exceed them.

Next-result controls apply once and expire after five minutes. They are held in process memory and clear on restart. Decision history, bank entries, parameters and budgets persist in PostgreSQL. Export downloads the current settings as JSON. Concurrent edits to a game's settings require reloading before saving.

## Added games

| Game | Player route | Notes |
| --- | --- | --- |
| American Roulette | `/roulette-american` | Kit classic wheel: 38 pockets, including 0 and 00 |
| Mini Roulette | `/roulette-mini` | 19 pockets, including 0 |
| Fun Target | `/fun-target` | Ten digits; configurable winning-digit total return |
| Rummy Royale Classic | `/rummy-royale` | Kit game against three computer players |

The existing European Roulette and Rummy remain available at their existing routes. The added games use the platform wallet, authenticated sessions, lobby and launcher. Roulette and Fun Target have a configurable cumulative maximum per position per player per round (default ₹5,000), plus the platform's per-slip minimum and maximum. Changes to limits and Fun Target payouts apply to newly opened rounds. TAKE clears the cabinet's win display; settlement already credits the wallet.

## Engine coverage

The shared result engine covers these 18 scheduled table games:

`roulette`, `speed-auto-roulette`, `roulette-american`, `roulette-mini`, `fun-target`, `baccarat`, `teen-patti`, `teen-patti-live`, `teen-patti-joker`, `andar-bahar`, `lucky-7`, `lucky-7-live`, `wheel-2-live`, `coin-flip`, `7up7down`, `vegetable-bowl`, `crazy-time`, `mega-ball`.

It also selects initial deals for `rummy-royale`. Rummy player actions can change the final result; its mode cannot guarantee a winner. Party/player balancing history is available on the scheduled tables; Rummy's global RTP history comes from its settlement ledger.

Crash games, blackjack, the existing multiplayer Rummy, poker, Ludo, standalone instant games and other independent engines retain their own draw logic and existing Game Defaults controls. Game Control identifies those games and links to their settings. This follows the kit's distinction between steerable tables and games with committed draws or player-dependent outcomes.

This platform has shared table rounds, so the result modes and budgets apply to the shared platform stream. Partner bets retain their original wallet and payer attribution; there are no new private per-partner result streams. Do not run multiple independent round schedulers against the same stream.

## Settlement and verification

Accepted slips retain their payout configuration. Exposure calculations use those same prices. Betting closes before the engine reads the book. Result writes and decision history commit together. Terminal round status and bank settlement commit together; wallet and ledger retries do not credit a second payout.

Natural draws retain their original derivation. Managed rounds carry a result source. The player rules disclose configured result modes, and existing table verification endpoints reject seed-only verification for managed results.

Compared with the supplied selectors, unbacked-result streaks cannot force an expensive payout, collecting ties do not always choose the first candidate, distribution is paced between realizable returns, and player recovery cannot be amplified by a new outsized wager.

## Migration, builds and checks

`0065_handoff_game_control.sql` is additive. It introduces engine state, decision and bank history, cabinet win displays, Rummy rounds, payout/position settings and placement idempotency. Existing game settings remain intact. Engine modes start as Normal; no Collect or RTP policy is enabled automatically.

For a configured environment, apply migrations with `pnpm --filter @workspace/db migrate`, then build/restart the API, player and admin apps. The existing API Docker entrypoint runs migrations before starting. This change does not itself deploy or modify a running database.

Checks:

```sh
pnpm handoff:test:engine
pnpm handoff:test
pnpm handoff:test:browser
```

The browser command expects production player/admin builds. Integration tests use isolated PGlite databases, including an upgrade from the 0064 schema. They cover all table outcome adapters, permissions, stale updates, forced results, cumulative position limits, accepted pricing, wallet totals, retry safety, budgets, Rummy and managed verification. Browser checks save/reload settings and require actual game controls at desktop and mobile sizes. Screenshots are written to `tmp/handoff-browser`.
