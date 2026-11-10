# Labelled demo activity

Every catalog game and recognized partner launcher displays a slim **Demo activity · SIMULATED** bar. It names one practice profile and its changing practice state. Opening the bar lists that game's demo profiles and explicitly explains that they are not real users, bets or winnings.

The browser derives a single deterministic pool of 100 synthetic IDs from the same sorted game catalog and clock. Each ID belongs to exactly one game. The current 50-game catalog therefore displays two profiles per game; adding games redistributes the same pool. Profile assignments rotate every two minutes and practice states every six seconds. Route changes, tabs, B2B/B2C views and aliases do not create additional IDs. The aggregate never exceeds 100, even if there are more games than profiles.

This is a presentation feature. It sends no requests, creates no accounts, places no bets, posts no wallet entries and changes no RTP, result, winner or real-player counters. The label remains visible when its details are collapsed. It is independent of the isolated financial Demo session.

`tools/test-demo-activity.mjs` checks the aggregate, deterministic assignments, state changes, aliases and empty/duplicate catalogs. The Ice Fish browser suite checks the disclosure, total and responsive integration in addition to normal betting behavior.
