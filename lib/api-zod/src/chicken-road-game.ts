/** Original, versioned paytables. Multipliers include the original stake. */
export const CHICKEN_VERSION = 3 as const;
export type ChickenVersion = 1 | 2 | 3;
export const CHICKEN_ROUND_DURATION_MS = 60_000;
export const CHICKEN_CLASSIC_RTP = 0.98;
// Guaranteed wins have a return that depends on the cashout lane, not one RTP.
export const CHICKEN_RTP = 0.85;
export const CHICKEN_DIFFICULTIES = ["easy", "medium", "hard", "hardcore"] as const;
export type ChickenDifficulty = typeof CHICKEN_DIFFICULTIES[number];
export const CHICKEN_MODES = {
  easy: { label: "Easy", returns: [101, 103, 106, 110, 115, 121, 129, 139, 152, 168, 188, 213, 245, 286, 339, 408, 498, 616, 772, 979, 1255, 1624, 2120, 2800] },
  medium: { label: "Medium", returns: [112, 128, 148, 173, 205, 246, 299, 368, 459, 580, 742, 961, 1260, 1672, 2245, 3049, 4188, 5816, 8166, 11592, 16638, 24146] },
  hard: { label: "Hard", returns: [125, 159, 206, 272, 366, 502, 702, 1001, 1456, 2160, 3269, 5046, 7947, 12768, 20926, 34989, 50000, 65000, 80000, 100000] },
  hardcore: { label: "Hardcore", returns: [150, 230, 360, 580, 960, 1630, 2840, 5080, 9330, 17600, 34000, 50000, 65000, 80000, 100000] },
} satisfies Record<ChickenDifficulty, { label: string; returns: number[] }>;

export function chickenReturn(difficulty: ChickenDifficulty, step: number): number {
  if (!Number.isInteger(step) || step < 0 || step > CHICKEN_MODES[difficulty].returns.length) throw new Error("INVALID_STEP");
  return step === 0 ? 100 : CHICKEN_MODES[difficulty].returns[step - 1];
}

/** Preserve classic replays; every valid version 2 step is guaranteed safe. */
export function chickenSurvival(difficulty: ChickenDifficulty, step: number, version: ChickenVersion = CHICKEN_VERSION): number {
  if (step < 1) throw new Error("INVALID_STEP");
  const next = chickenReturn(difficulty, step);
  if (version === 2) return 1;
  if (version !== 1 && version !== 3) throw new Error("INVALID_VERSION");
  return (step === 1 ? (version === 3 ? CHICKEN_RTP : CHICKEN_CLASSIC_RTP) * 100 : chickenReturn(difficulty, step - 1)) / next;
}

export function chickenPayout(stake: bigint, difficulty: ChickenDifficulty, step: number): bigint {
  return stake * BigInt(chickenReturn(difficulty, step)) / 100n;
}

export interface ChickenRound {
  id: string;
  requestId: string;
  version: ChickenVersion;
  difficulty: ChickenDifficulty;
  status: "active" | "cashed_out" | "busted";
  step: number;
  attemptedStep: number;
  totalSteps: number;
  stakeAmount: string;
  payoutAmount: string;
  cashoutAmount: string;
  multiplier: number;
  nextMultiplier: number | null;
  nextSurvival: number | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  createdAt: string;
  /** Older receipts may predate timed rounds. The server arms them on recovery. */
  expiresAt?: string | null;
  serverTime?: number;
  endReason?: "timeout" | null;
}
export interface ChickenConfig {
  enabled: boolean;
  minStakePaise: string;
  maxStakePaise: string;
  rtp: number | null;
  version: ChickenVersion;
  roundDurationMs?: number;
}
export interface ChickenState {
  round: ChickenRound | null;
  history: ChickenRound[];
}
