// Keep wallet keys and historical settlements readable, but never offer or
// accept new play for these games.
export const RETIRED_GAME_CODES: ReadonlySet<string> = new Set(["lunar", "aviator", "chicken-road-2"]);

export function isRetiredGame(gameCode: string): boolean {
  return RETIRED_GAME_CODES.has(gameCode);
}
