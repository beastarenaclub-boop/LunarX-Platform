/** Shared horse racing contract: server draws the plan, browser only renders it. */
export const RACING_HORSES = [
  {
    id: 1,
    name: "Midnight Storm",
    color: "#4379ed",
    probability: 22,
    coat: "#37291f",
  },
  {
    id: 2,
    name: "Golden Eclipse",
    color: "#f2c74b",
    probability: 18,
    coat: "#b08852",
  },
  {
    id: 3,
    name: "Desert Falcon",
    color: "#ec4c46",
    probability: 15,
    coat: "#82412b",
  },
  {
    id: 4,
    name: "Silver Arrow",
    color: "#d8e2ec",
    probability: 13,
    coat: "#afaaa1",
  },
  {
    id: 5,
    name: "Emerald Prince",
    color: "#32b878",
    probability: 11,
    coat: "#423229",
  },
  {
    id: 6,
    name: "Crimson Spirit",
    color: "#eb73af",
    probability: 9,
    coat: "#a45c37",
  },
  {
    id: 7,
    name: "Ocean Blue",
    color: "#3bcbd9",
    probability: 7,
    coat: "#cbb895",
  },
  {
    id: 8,
    name: "Wild Comet",
    color: "#a980f2",
    probability: 5,
    coat: "#603125",
  },
] as const;
export const RACING_VENUES = [
  {
    id: "royal",
    name: "Royal Park",
    country: "England",
    distance: 1600,
    duration: 30,
    laps: 1,
    tint: "#d2c093",
    sky: "#a8c6d1",
  },
  {
    id: "dubai",
    name: "Dubai Sands",
    country: "UAE",
    distance: 2000,
    duration: 34,
    laps: 1,
    tint: "#dcac77",
    sky: "#e3bd86",
  },
  {
    id: "alpine",
    name: "Alpine Valley",
    country: "Switzerland",
    distance: 1800,
    duration: 32,
    laps: 1,
    tint: "#bec4b2",
    sky: "#a9cdda",
  },
  {
    id: "coast",
    name: "Ocean Downs",
    country: "Australia",
    distance: 1400,
    duration: 28,
    laps: 1,
    tint: "#daca9e",
    sky: "#9bd8dd",
  },
  {
    id: "night",
    name: "Neon Circuit",
    country: "Japan",
    distance: 2000,
    duration: 34,
    laps: 1,
    tint: "#776f84",
    sky: "#222d48",
  },
  {
    id: "marathon",
    name: "Marathon Stadium",
    country: "France",
    distance: 3200,
    duration: 48,
    laps: 2,
    tint: "#cabb97",
    sky: "#b4c9cf",
  },
] as const;
export type RacingVenue = (typeof RACING_VENUES)[number];
export interface HorsePath {
  id: number;
  finishTime: number;
  phase: number;
  stride: number;
  points: number[];
  lane: number;
}
export interface HorsePlan {
  seed: string;
  venueId: string;
  runners: HorsePath[];
  order: number[];
  duration: number;
}
export interface HorseSlip {
  horseId: number;
  amountPaise: string;
}
export interface RacingReceipt {
  id: string;
  requestId: string;
  venueId: string;
  startedAt: number;
  endsAt: number;
  status: "racing" | "finished";
  plan: HorsePlan;
  bets: HorseSlip[];
  totalStake: string;
  payoutAmount: string;
  winnerId: number | null;
  balance?: string;
}
export interface RacingConfig {
  enabled: boolean;
  minStakePaise: string;
  maxStakePaise: string;
  horses: Array<{ id: number; multiplier: number }>;
  raceSpeed?: number;
}
export interface RacingLiveRound {
  id: string;
  venueId: string;
  bettingOpensAt: number;
  startedAt: number;
  endsAt: number;
  nextRoundAt: number;
  phase: "betting" | "racing" | "results";
  serverSeedHash: string;
  /** Hidden until betting closes. Never send the seed or trajectories earlier. */
  plan: HorsePlan | null;
  winnerId: number | null;
  config: RacingConfig;
}
export interface RacingBetReceipt {
  id: string;
  roundId: string;
  requestId: string;
  venueId: string;
  startedAt: number;
  endsAt: number;
  status: "placed" | "finished";
  bets: HorseSlip[];
  totalStake: string;
  payoutAmount: string;
  winnerId: number | null;
}
export interface RacingLiveState {
  serverNow: number;
  balance: string;
  race: RacingLiveRound;
  myBet: RacingBetReceipt | null;
  history: RacingBetReceipt[];
}
export const HORSE_BETTING_MS = 20_000;
export const HORSE_RESULTS_MS = 5_000;
export const HORSE_RACE_SPEED = 1.65;
/** Fixed slots keep every viewer on the same clock, including after restarts. */
export function horseRoundSchedule(venueId: string, now: number) {
  const venue = racingVenue(venueId);
  const raceMs = Math.ceil((venue.duration + 3) / HORSE_RACE_SPEED) * 1000;
  const cycle = HORSE_BETTING_MS + raceMs + HORSE_RESULTS_MS;
  const slot = Math.floor(now / cycle);
  const bettingOpensAt = slot * cycle;
  const startedAt = bettingOpensAt + HORSE_BETTING_MS;
  const endsAt = startedAt + raceMs;
  return {
    id: `hr4-${venue.id}-${slot.toString(36)}`,
    venueId: venue.id,
    bettingOpensAt,
    startedAt,
    endsAt,
    nextRoundAt: endsAt + HORSE_RESULTS_MS,
  };
}
export function horseRoundPhase(
  round: { startedAt: number; endsAt: number },
  now: number,
): RacingLiveRound["phase"] {
  return now < round.startedAt
    ? "betting"
    : now < round.endsAt
      ? "racing"
      : "results";
}
export const racingVenue = (id: string) =>
  RACING_VENUES.find((v) => v.id === id) ?? RACING_VENUES[0];
export function seededRandom(seed: string) {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++)
    x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  return () => {
    x += 0x6d2b79f5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeHorsePlan(
  seed: string,
  venueId: string,
  speed = 1,
): HorsePlan {
  const venue = racingVenue(venueId),
    random = seededRandom(seed);
  // An exponential race samples the first finisher with the advertised weights.
  const order = RACING_HORSES.map((h) => ({
    id: h.id,
    key: -Math.log(Math.max(1e-12, random())) / h.probability,
  }))
    .sort((a, b) => a.key - b.key)
    .map((h) => h.id);
  const lanes = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  const times = order.map(
    (_, i) => (venue.duration + i * 0.23 + random() * 0.16) / speed,
  );
  const runners = RACING_HORSES.map((h, i) => ({
    id: h.id,
    finishTime: times[order.indexOf(h.id)],
    phase: random(),
    stride: 0.91 + random() * 0.18,
    lane: lanes[i],
    points: [
      0,
      0.11 + random() * 0.07,
      0.27 + random() * 0.085,
      0.46 + random() * 0.095,
      0.69 + random() * 0.075,
      0.865 + random() * 0.045,
      1,
    ],
  }));
  return {
    seed,
    venueId: venue.id,
    runners,
    order,
    duration: Math.max(...times) + 0.8 / speed,
  };
}
const fractions = [0, 0.15, 0.32, 0.52, 0.73, 0.9, 1];
export function horseProgress(runner: HorsePath, elapsed: number): number {
  const t = Math.max(0, elapsed) / runner.finishTime;
  if (t >= 1) return 1 + (t - 1) * 0.8;
  let k = 0;
  while (k < 5 && t > fractions[k + 1]) k++;
  const u = (t - fractions[k]) / (fractions[k + 1] - fractions[k]);
  return runner.points[k] + (runner.points[k + 1] - runner.points[k]) * u;
}
export function horseOrder(plan: HorsePlan, elapsed: number) {
  return [...plan.runners]
    .sort((a, b) => {
      if (elapsed >= Math.min(a.finishTime, b.finishTime))
        return a.finishTime - b.finishTime;
      return horseProgress(b, elapsed) - horseProgress(a, elapsed);
    })
    .map((h) => h.id);
}
export function horseOdds(probability: number, edge: number, cap = 1000) {
  return Math.min(
    cap,
    Math.floor(Math.round((1 - edge) * 10000) / probability) / 100,
  );
}
