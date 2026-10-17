export type SportId =
  | "football"
  | "cricket"
  | "basketball"
  | "tennis"
  | "formula";
export interface Sport {
  id: SportId;
  name: string;
  short: string;
  venue: string;
  subtitle: string;
  color: string;
  format: string;
  teams: string[];
  tags: string[];
  colors: string[];
  selections: string[];
  weights: number[];
}
export const BET_MS: number,
  PLAY_MS: number,
  RESULT_MS: number,
  ROUND_MS: number,
  START_COINS: number;
export const SPORTS: Sport[];
export function sportById(id: string): Sport | undefined;
export function oddsFor(sport: Sport): number[];
