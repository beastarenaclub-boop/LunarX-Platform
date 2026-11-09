# Four selected games

Historical release note: the later table-engine restoration keeps this graphics selection but reconnects the imported result logic for every available table adapter. See `table-engine-restoration.md` for current behavior.

Keep American Roulette, Mini Roulette, Fun Target and Aviator/Lunar from the handoff release. Restore every other existing game's pre-handoff graphics and draw/payout path, using production commit `9d3401defe792f9af100ea84a2f8afa96375c931` as the reference.

The original Rummy and European Roulette stay in the lobby. Rummy Royale and Speed Auto Roulette are withdrawn; no new stakes are accepted. Existing paid Royale hands can still finish. Table recovery completes already revealed rounds and refunds interrupted unrevealed rounds. Accepted pricing, wallet receipts, bet history and bank history remain intact.

Only American Roulette, Mini Roulette and Fun Target read the imported result selector and shared budget. Legacy table draws ignore stale engine modes and forced results. Original per-game RTP and limits remain available. Aviator uses its committed crash outcome and existing RTP settings.

Migration `0067_four_selected_games.sql` disables the withdrawn games and subtracts excluded historical banks from combined budget floors, preserving current headroom for the remaining three games. New legacy rounds carry a version marker for the original payout path; previously accepted rounds retain their original receipt pricing. Atomic settlement and retry protection remain in place.

Validation uses isolated SQL databases for all legacy seed draws, retained table outcomes, engine access, budget isolation/migration, exact wallet payouts, withdrawn-game recovery and Lunar auto cashout. Browser checks exercise the four retained games on desktop/mobile and confirm the withdrawn games have no lobby cards. Production checks use only isolated demo accounts for bets.
