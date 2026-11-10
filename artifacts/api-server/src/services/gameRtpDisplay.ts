import type { GameConfig } from "@workspace/db";
import { CHICKEN_RTP } from "@workspace/api-zod/chicken-road-game";
import { coinLiveMultiplier, SEVEN_SPOTS, sevenMultiplier, sevenWins } from "@workspace/api-zod/instant-collection";
import { L7_SPOTS, L7_SUITS, l7Payout } from "@workspace/api-zod/lucky7-live";
import { W20_RTP } from "@workspace/api-zod/wheel20-live";
import { CRAZY_TIME_RTP } from "@workspace/api-zod/crazy-time-game";
import { multiplierFor, PAYOUT_VERSION } from "../../../3d-game/wingo-server/rules.mjs";

export type RtpDisplay = { minPercent: number | null; maxPercent: number | null; source: string; note: string };
const range = (values: number[], source: string, note: string): RtpDisplay => ({
  minPercent: Math.min(...values) * 100, maxPercent: Math.max(...values) * 100, source, note,
});

/** Use current payout rules for fixed-price games; their legacy houseEdge field
 * is not necessarily the return their accepted prices actually deliver. */
export function defaultRtpDisplay(code: string, config?: GameConfig): RtpDisplay {
  if (code === "ice-fish") return range([1 - (config?.houseEdge ?? .045)], "Ice Fish payout rules v1", "Natural-draw target before paise rounding and caps; shared result modes have their own target.");
  if (code === "coin-flip") return range([coinLiveMultiplier(.97, 1000) / 2], "Fixed paytable", "Natural draw at the current coin payout.");
  if (code === "7up7down") return range(SEVEN_SPOTS.map(spot => {
    let sum = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (sevenWins(spot, a + b)) sum += sevenMultiplier(spot, .97) / 36;
    return sum;
  }), "Fixed paytable", "Return varies by selected dice spot; a winning payout is not the same as RTP.");
  if (code === "lucky-7-live") return range(L7_SPOTS.map(spot => {
    let sum = 0;
    for (let rank = 1; rank <= 13; rank++) for (const suit of L7_SUITS) sum += Number(l7Payout([{ spot, amountPaise: "1000000" }], { rank, suit }, 1)) / 1000000 / 52;
    return sum;
  }), "Fixed paytable", "Natural-draw return varies by betting spot.");
  if (code === "wheel-2-live") return range(Object.values(W20_RTP), "Fixed paytable", "Natural-draw return varies by wheel bet.");
  if (code === "crazy-time") return range(Object.values(CRAZY_TIME_RTP), "Game rules", "Before integer rounding and payout caps.");
  if (code === "chicken-road") return range([CHICKEN_RTP], "Game rules", "Current Chicken Road payout version.");
  if (code === "wingo") return range(["red", "green", "violet", "big", "small", ...Array.from({ length: 10 }, (_, i) => String(i))].map(pick =>
    Array.from({ length: 10 }, (_, n) => multiplierFor(pick, n, PAYOUT_VERSION)).reduce((a, b) => a + b, 0) / 10),
  "Fixed paytable", "Return varies between colour, size and individual-number bets.");
  if (code.startsWith("poker-") || code === "blackjack" || code === "rummy") return {
    minPercent: null, maxPercent: null, source: "Game rules", note: "Depends on the hand, selected market and player decisions; no single fixed RTP.",
  };
  if (code === "roulette" || code === "roulette-american" || code === "roulette-mini") return range(
    [code === "roulette" ? 36 / 37 : code === "roulette-mini" ? 18 / 19 : 36 / 38], "Fixed paytable", "Natural-draw return; table result modes have their own target.");
  if (code === "fun-target") return range([(config?.ftDigitReturn ?? 9) / 10], "Game payout", "Winning-digit total return divided by ten.");
  if (code === "ludo") return range([.9], "Pool rules", "Original pool return is 90%; the remainder is commission.");
  if (config) return range([1 - config.houseEdge], "Saved game default", "Configured game target. Fixed paytables, rounding, caps and game decisions can differ.");
  return { minPercent: null, maxPercent: null, source: "Game rules", note: "See this game's payout settings." };
}
