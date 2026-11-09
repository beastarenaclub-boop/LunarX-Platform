export const funTargetRules = {
  name: "Top 10 Target",
  objective: "Bet on one or more digits from 0 to 9. One shared wheel result settles every player's slip.",
  controls: "Select a denomination, tap or hold a digit, then press Bet Ok. Cancel Bet and Cancel Specific Bet affect staged chips only. Bet Ok flashes its button image while bets are staged, with steady text. Valid staged bets automatically confirm at 12 seconds unless cancelled or already placed. One confirmation per round in this cabinet. Take dismisses the win display; funds are already credited.",
  phases: "One clock repeats from 60 to 0. Betting closes at 10. At 0 the next minute starts while the wheel animates for six seconds. The result and win/loss message appear after it stops. On wins only the Take button image, the result digit and pointer blink; button labels remain steady; the winning amount and both win/loss messages stay steady. No separate reveal or settlement countdown.",
  payouts: "A matching digit normally returns 9x its stake including the stake; other digits return zero. The configured maximum multiplier can cap that return.",
  limits: "The configured minimum and maximum apply to the entire slip. At most ten distinct digit positions per slip. A configured per-position ceiling counts accepted stakes on this round.",
  rtp: "Fixed paytable: 90% theoretical RTP and a structural 10% edge for ten equally likely digits paying 9x. A lower cap reduces RTP. This is not a guarantee for any session and does not describe steered rounds.",
  fairness: "The server determines the outcome. The platform supports operator/studio results and result-engine steering. No seed is disclosed to players.",
};
