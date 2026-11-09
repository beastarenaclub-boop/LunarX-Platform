export interface Outcome { pocket: number }
export interface WireBet { type: "straight"; selection: [number]; amountPaise: string }
export interface Config {
  enabled: boolean; houseEdge: number; maxMultiplier: number; minStakePaise: string; maxStakePaise: string;
  maxBetsPerSlip: number; payouts: { straight: number }; digits: number;
  bettingWindowMs: number; revealDurationMs: number; settleDurationMs: number;
}
export interface Chip { digit: number; amount: bigint }
export interface Reveal { roundId: string; pocket: number; duration: number; bets: WireBet[]; scoreBeforeResult?: bigint }
export interface PendingPlacement { key: string; roundId: string; bets: WireBet[]; pricingVersion?:string }
