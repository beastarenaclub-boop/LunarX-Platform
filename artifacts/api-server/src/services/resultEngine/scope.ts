// The only games retaining the imported table result engine. Lunar keeps its
// separate seed-committed crash engine and existing RTP settings.
export const RESULT_ENGINE_GAMES = ["roulette-american", "roulette-mini", "fun-target"] as const;
export function usesResultEngine(code: string): boolean {
  return (RESULT_ENGINE_GAMES as readonly string[]).includes(code);
}
