/** Server owns the draw and wallet. This contract only describes its broadcast. */
export const RACING_BIKES = [
  { id: 1, name: "Azure RR", color: "#338dff", accent: "#e54962" },
  { id: 2, name: "Crimson V4", color: "#ed414b", accent: "#ffffff" },
  { id: 3, name: "Volt RS", color: "#b5e843", accent: "#242a29" },
  { id: 4, name: "Solar R1", color: "#ffba3e", accent: "#ffffff" },
  { id: 5, name: "Violet GT", color: "#b18aff", accent: "#efdedf" },
  { id: 6, name: "Arctic S", color: "#43dee0", accent: "#ffffff" },
] as const;
export const RACING_VENUES = [{ id: "apex", name: "Apex International", country: "Grand Prix", distance: 1700, duration: 20, laps: 1 }] as const;
export const racingVenue = (_id: string) => RACING_VENUES[0];
export const BIKE_BETTING_MS = 20_000;
export const BIKE_RACE_MS = 20_000;
export const BIKE_RESULTS_MS = 5_000;
export interface BikePath { id: number; finishTime: number; lane: number; points: number[] }
export interface BikePlan { runners: BikePath[]; order: number[]; duration: number }
export interface BikeSlip { bikeId: number; amountPaise: string }
export interface RacingConfig {
  enabled: boolean; minStakePaise: string; maxStakePaise: string;
  bikes: Array<{ id: number; multiplier: number }>;
}
export interface RacingLiveRound {
  id: string; venueId: string; bettingOpensAt: number; startedAt: number;
  endsAt: number; nextRoundAt: number; phase: "betting" | "racing" | "results";
  serverSeedHash: string; plan: BikePlan | null; winnerId: number | null; config: RacingConfig;
}
export interface RacingBetReceipt {
  id: string; roundId: string; requestId: string; venueId: string;
  startedAt: number; endsAt: number; status: "placed" | "finished";
  bets: BikeSlip[]; totalStake: string; payoutAmount: string; winnerId: number | null;
}
export interface RacingLiveState {
  serverNow: number; balance: string; race: RacingLiveRound;
  myBet: RacingBetReceipt | null; history: RacingBetReceipt[];
}
export function bikeRoundSchedule(venueId: string, now: number) {
  const cycle = BIKE_BETTING_MS + BIKE_RACE_MS + BIKE_RESULTS_MS;
  const slot = Math.floor(now / cycle), bettingOpensAt = slot * cycle;
  const startedAt = bettingOpensAt + BIKE_BETTING_MS, endsAt = startedAt + BIKE_RACE_MS;
  return { id: `br1-${venueId}-${slot.toString(36)}`, venueId, bettingOpensAt, startedAt, endsAt, nextRoundAt: endsAt + BIKE_RESULTS_MS };
}
export function bikeRoundPhase(round: { startedAt: number; endsAt: number }, now: number): RacingLiveRound["phase"] {
  return now < round.startedAt ? "betting" : now < round.endsAt ? "racing" : "results";
}
const fractions = [0, .15, .32, .52, .73, .9, 1];
export function bikeProgress(runner: BikePath, elapsed: number) {
  const t = Math.max(0, elapsed) / runner.finishTime;
  if (t >= 1) return 1 + Math.min(.07, (t - 1) * .6);
  let k = 0;
  while (k < 5 && t > fractions[k + 1]) k++;
  const u = (t - fractions[k]) / (fractions[k + 1] - fractions[k]);
  return runner.points[k] + (runner.points[k + 1] - runner.points[k]) * u;
}
export function bikeOrder(plan: BikePlan, elapsed: number) {
  return [...plan.runners].sort((a, b) => elapsed >= Math.min(a.finishTime, b.finishTime)
    ? a.finishTime - b.finishTime : bikeProgress(b, elapsed) - bikeProgress(a, elapsed)).map(b => b.id);
}
