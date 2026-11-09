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
| Aviator / Lunar | `/aviator-pro` | Kit graphics with the existing seed-committed crash engine |

The existing European Roulette and Rummy remain available at their existing routes. The added games use the platform wallet, authenticated sessions, lobby and launcher. Roulette and Fun Target have a configurable cumulative maximum per position per player per round (default ₹5,000), plus the platform's per-slip minimum and maximum. Changes to limits and Fun Target payouts apply to newly opened rounds. TAKE clears the cabinet's win display; settlement already credits the wallet.

## Engine coverage

The shared result engine covers all 17 available scheduled tables with outcome adapters:

`roulette-american`, `roulette-mini`, `fun-target`, `roulette`, `baccarat`, `teen-patti`, `teen-patti-live`, `teen-patti-joker`, `andar-bahar`, `lucky-7`, `lucky-7-live`, `wheel-2-live`, `coin-flip`, `7up7down`, `vegetable-bowl`, `crazy-time`, `mega-ball`.

The four-game graphics selection remains: American Roulette, Mini Roulette, Fun Target and Aviator/Lunar use the new graphics; all other games keep their existing graphics. Rummy Royale Classic and Speed Auto Roulette stay withdrawn. Already funded Royale hands remain reachable at the old route until finished; new deals are disabled. Revealed Speed rounds settle on their accepted terms; interrupted unrevealed rounds refund through normal restart recovery.

Every listed table now reads the imported Normal, Collect, Distribute, Auto and RTP modes, result controls and shared budgets. Existing operator modes and parameters resume without resetting. Normal still uses the game's natural seed draw. Accepted rounds from the intervening rollback keep their old draw and payout path until settled. Aviator retains its independent crash RTP controls and cannot use a forced table result.

Crash games, blackjack, the existing multiplayer Rummy, poker, Ludo, standalone instant games and other independent engines retain their own draw logic and existing Game Defaults controls. Game Control identifies those games and links to their settings. This follows the kit's distinction between steerable tables and games with committed draws or player-dependent outcomes.

This platform has shared table rounds, so the result modes and budgets apply to the shared platform stream. Partner bets retain their original wallet and payer attribution; there are no new private per-partner result streams. Do not run multiple independent round schedulers against the same stream.

## Settlement and verification

Accepted slips retain their payout configuration. Exposure calculations use those same prices. Betting closes before the engine reads the book. Result writes and decision history commit together. Terminal round status and bank settlement commit together; wallet and ledger retries do not credit a second payout.

Natural draws retain their original derivation. Managed rounds carry a result source. The player rules disclose configured result modes, and existing table verification endpoints reject seed-only verification for managed results.

Compared with the supplied selectors, unbacked-result streaks cannot force an expensive payout, collecting ties do not always choose the first candidate, distribution is paced between realizable returns, and player recovery cannot be amplified by a new outsized wager.

## Migration, builds and checks

`0065_handoff_game_control.sql` is additive. `0067_four_selected_games.sql` withdrew the two extra games and temporarily disconnected the existing table engines. `0068_restore_table_engines.sql` reconnects the existing tables, adds their historical banks back to combined budget floors without changing remaining headroom, and applies an existing same-each allowance to the reconnected games. Individual settings, wallets, accepted bets and history remain intact. Old accepted rounds retain their saved draw/pricing version; new rounds use the imported engine and exact accepted payout path.

For a configured environment, apply migrations with `pnpm --filter @workspace/db migrate`, then build/restart the API, player and admin apps. The existing API Docker entrypoint runs migrations before starting. This change does not itself deploy or modify a running database.

Checks:

```sh
pnpm handoff:test:engine
pnpm handoff:test
pnpm handoff:test:browser
```

The browser command expects production player/admin builds. Integration tests use isolated PGlite databases, including upgrades from the 0064 schema through withdrawal and reconnection. They cover every table adapter, all five mode settings on the reconnected games, funded bets, forced and natural outcomes, exact accepted payouts, wallet/bank totals, retry safety, old-round compatibility and shared budgets. Browser checks save/reload both existing and new game controls and verify the retained lobby graphics at desktop/mobile sizes. Screenshots are written to `tmp/handoff-browser`.
