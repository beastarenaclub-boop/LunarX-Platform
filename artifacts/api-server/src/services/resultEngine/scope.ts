// Every available scheduled table with a complete outcome/payout adapter uses
// the kit engine. Crash and player-action games keep their own RTP controls.
// Withdrawn games remain excluded even while historical bets finish.
export const RECONNECTED_ENGINE_GAMES = [
  "roulette", "baccarat", "teen-patti", "teen-patti-live", "teen-patti-joker",
  "andar-bahar", "lucky-7", "lucky-7-live", "wheel-2-live", "coin-flip",
  "7up7down", "vegetable-bowl", "crazy-time", "mega-ball",
] as const;
export const RESULT_ENGINE_GAMES = [
  "ice-fish",
  "roulette-american", "roulette-mini", "fun-target", ...RECONNECTED_ENGINE_GAMES,
] as const;
export function usesResultEngine(code: string): boolean {
  return (RESULT_ENGINE_GAMES as readonly string[]).includes(code);
}
