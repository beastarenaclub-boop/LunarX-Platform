# 85% RTP policy

Except for Roulette (updated to 36× total return on 2026-10-08), new funded rounds target 85% theoretical return, corresponding to a 15% expected
house margin over many wagers. This is not guaranteed profit per round, session,
or after operating costs. Posted multiplier rounding and payout caps can lower
the realised theoretical return.

| Game | New terms |
| --- | --- |
| Crash games | Version 3 inverse-CDF draw, 15% edge; server owns the hidden threshold, flight clock and cashout validation. Auto cashout is committed with the stake and runs without a browser connection. |
| Mines, Dice, Plinko | 15% edge; Mines version 2 permits a return below 1× after low-risk steps instead of silently raising RTP. |
| Horse/Bike racing | Posted returns derived from winner probabilities and 15% edge. |
| Lucky 7 | Version 3: Under/Over 2.04×; Exactly 7 5.10×. Each spot has exactly 85% RTP before paise rounding. |
| Baccarat | Player 1.69×, Banker 1.64×, Tie 8.93×, Pair 11.37×. Main wagers push on ties. |
| Roulette | Total return = 36 / covered pockets; all 37 pockets remain equally likely. RTP 97.2973%, expected house edge 2.7027%. Historical 31.45/35 bases remain binding. See `roulette-rules.md`. |
| Teen Patti / Andar Bahar / Dragon Tiger | Prices account for actual card probabilities and tie/push rules; prices round down to hundredths. |
| Dragon Tiger One Day | Each available market is repriced against the remaining shoe at 85% target; previously accepted quotes remain binding. |
| Chicken Road | Version 3 survival probabilities target 85% at every stopping lane. |
| Vegetable Bowl | Normal/Hard 1.87× (~84.64% RTP), Risk 18.96× (~84.95%); junk still loses every option. |
| Crazy Time | Total returns adjusted per spot for 85% target, with the existing 5001× cap and downward rounding. |
| WinGo | Version 2: size/red/green 1.70×, violet 4.25×, exact digit 8.50×. |
| Integrated Forex | Version 2: independent seeded 50/50 UP/DOWN draws and 1.70× return. Commitment before the result; seed revealed in completed results. Market quotes and pool sizes do not decide winners. |
| Blackjack | Version 2 returns 85% of standard total payouts, including draws and insurance. Strategy affects RTP; this is not a fixed 85% RTP claim. |
| Rummy | 15% commission on the four-player pot. Individual return depends on skill and opponents. |

All multipliers above include the stake. Displayed rules disclose the changed
returns, including Blackjack's 0.85× draw return.

Migrations `0041_rtp_85_policy` and `0042_mines_rtp_version` backfill historical
rounds as legacy versions before setting defaults for new rounds. Table round
snapshots retain their payout version; stored Lucky 7/Chicken Road versions,
Roulette bases, Dragon Tiger prices, and One Day quotes remain replayable.
Existing pari-mutuel bets retain their accepted settlement mode. The optional
standalone practice Forex and WinGo servers keep their previous practice rules.

Validation includes exact finite-outcome RTP checks, crash distribution sampling,
legacy payout replay, shared-table integration, and an isolated HTTP/wallet test
covering fabricated rounds, early/excess cashouts, concurrent cashouts, reconnects
and background automatic settlement. Browser tests cover readable controls and
reachable actions on phones, tablets, landscape windows and desktops.
