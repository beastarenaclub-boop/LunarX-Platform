import { db, betsTable, gameRoundsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { requireGameConfig, sha256Hex, generateSeed } from "./rtp";

export const HORSE_RACING_GAME_CODE = "horse-racing";

export interface RaceHorseDef {
  id: number;
  name: string;
  color: string;
  winProbPct: number;
}

export interface RaceStateDef {
  id: string;
  name: string;
  racecourse: string;
  theme: string; // hint for the client's track look
  horses: readonly RaceHorseDef[];
}

/**
 * 7 Indian racing states, each with its own field of 6 horses. Win
 * probabilities are integer percentages summing to 100 per state so all odds
 * math stays in integer space. The payout multiplier for each horse is
 * (1 - houseEdge) / winProb truncated DOWN to 2 decimal places (standard
 * bookmaker rounding — never rounds in the player's favor), so the effective
 * per-horse RTP is within ~0.15% of the configured target.
 *
 * Every state uses the same probability ladder (30/22/17/13/10/8) so the
 * house edge is identical everywhere; names/colors give each state flavor.
 */
const LADDER = [30, 22, 17, 13, 10, 8] as const;

function field(
  entries: ReadonlyArray<readonly [string, string]>,
): RaceHorseDef[] {
  return entries.map(([name, color], i) => ({
    id: i + 1,
    name,
    color,
    winProbPct: LADDER[i],
  }));
}

export const RACE_STATES: readonly RaceStateDef[] = [
  {
    id: "maharashtra",
    name: "Maharashtra",
    racecourse: "Mahalaxmi Racecourse, Mumbai",
    theme: "coastal-evening",
    horses: field([
      ["Marathi Toofan", "#5C3A21"],
      ["Deccan Queen", "#2F2F2F"],
      ["Konkan Express", "#8B4513"],
      ["Sahyadri Storm", "#1C1C2E"],
      ["Mumbai Meri Jaan", "#B87333"],
      ["Peshwa Pride", "#D9D9D9"],
    ]),
  },
  {
    id: "west-bengal",
    name: "West Bengal",
    racecourse: "Royal Calcutta Turf Club",
    theme: "monsoon-green",
    horses: field([
      ["Howrah Hurricane", "#3B2A1A"],
      ["Bengal Tiger", "#C46A1B"],
      ["Hooghly Flash", "#4A4A55"],
      ["Durga's Arrow", "#7A1F1F"],
      ["Darjeeling Mist", "#9AA7B0"],
      ["Sonar Bangla", "#C9A227"],
    ]),
  },
  {
    id: "karnataka",
    name: "Karnataka",
    racecourse: "Bangalore Turf Club",
    theme: "garden-city",
    horses: field([
      ["Mysore Majesty", "#4B2E1E"],
      ["Silicon Sprint", "#5B5B66"],
      ["Kaveri Current", "#2E5E4E"],
      ["Hampi Hero", "#A0522D"],
      ["Coorg Coffee", "#3E2723"],
      ["Jog Falls Jet", "#B0BEC5"],
    ]),
  },
  {
    id: "tamil-nadu",
    name: "Tamil Nadu",
    racecourse: "Guindy Race Course, Chennai",
    theme: "temple-gold",
    horses: field([
      ["Marina Breeze", "#6D4C41"],
      ["Chola Chariot", "#8D2A1A"],
      ["Nilgiri Thunder", "#37474F"],
      ["Madurai Meteor", "#C9A227"],
      ["Kanyakumari Wave", "#4E6E81"],
      ["Pongal Power", "#D7A86E"],
    ]),
  },
  {
    id: "telangana",
    name: "Telangana",
    racecourse: "Hyderabad Race Club, Malakpet",
    theme: "deccan-dusk",
    horses: field([
      ["Charminar Charge", "#5D4037"],
      ["Golconda Gold", "#C9A227"],
      ["Nizami Nawab", "#2F2F3A"],
      ["Musi Missile", "#78552B"],
      ["Biryani Bolt", "#A3541E"],
      ["Pearl City Pace", "#CFD8DC"],
    ]),
  },
  {
    id: "delhi",
    name: "Delhi",
    racecourse: "Delhi Race Club",
    theme: "imperial-red",
    horses: field([
      ["Rajpath Racer", "#4E342E"],
      ["Qutub Qadam", "#8B0000"],
      ["Yamuna Yodha", "#455A64"],
      ["Chandni Chamak", "#BDBDBD"],
      ["Purani Dilli", "#7B3F00"],
      ["Lal Qila Lightning", "#B71C1C"],
    ]),
  },
  {
    id: "punjab",
    name: "Punjab",
    racecourse: "Ludhiana Race Track",
    theme: "wheat-gold",
    horses: field([
      ["Punjab Da Sher", "#5C4033"],
      ["Bhangra Beat", "#C98910"],
      ["Sutlej Sarpat", "#37474F"],
      ["Patiala Shahi", "#7A1F3D"],
      ["Amritsari Josh", "#8B5A2B"],
      ["Sarson Da Sitara", "#D4B106"],
    ]),
  },
];

export function getRaceState(stateId: string): RaceStateDef | undefined {
  return RACE_STATES.find((s) => s.id === stateId);
}

/** Legacy single-field export (kept for tests); Maharashtra's field. */
export const HORSES = RACE_STATES[0].horses;

/**
 * Multiplier in integer hundredths (e.g. 323 = 3.23x), derived purely with
 * integer arithmetic to avoid binary floating-point truncation artifacts
 * (0.97/0.10 === 9.699999... would floor to 9.69 instead of 9.70).
 */
export function horseMultiplierHundredths(
  winProbPct: number,
  houseEdge: number,
): number {
  const rtpBp = Math.round((1 - houseEdge) * 10_000); // e.g. 9700 bp
  return Math.floor(rtpBp / winProbPct); // (rtpBp/100) / (pct/100) / 100
}

export function horseMultiplier(winProbPct: number, houseEdge: number): number {
  return horseMultiplierHundredths(winProbPct, houseEdge) / 100;
}

/**
 * Derive the winner from the committed seeds: a uniform roll in [0,1) picks
 * the winner from the cumulative win-probability table. Deterministic, so
 * anyone holding (serverSeed, clientSeed) can recompute the result.
 */
export function deriveHorseWinner(
  serverSeed: string,
  clientSeed: string,
  stateId: string = RACE_STATES[0].id,
): { roll: number; winnerId: number } {
  const state = getRaceState(stateId);
  if (!state) throw new Error("INVALID_STATE");
  const h = sha256Hex(`horse-racing:${stateId}:${serverSeed}:${clientSeed}`);
  const roll = parseInt(h.slice(0, 13), 16) / 0x10000000000000; // 52 bits
  // Integer cumulative table — the roll is scaled to [0,100) so state fields
  // with integer percentages need no float accumulation.
  const scaled = roll * 100;
  let cum = 0;
  for (const horse of state.horses) {
    cum += horse.winProbPct;
    if (scaled < cum) return { roll, winnerId: horse.id };
  }
  return { roll, winnerId: state.horses[state.horses.length - 1].id };
}

/**
 * Commit phase of the provably-fair lifecycle: generate and persist the
 * server seed BEFORE any bet is accepted, and hand the player only its hash
 * (plus the client seed used). The reveal happens in the play response.
 */
export async function createHorseRound(opts: {
  clientSeed?: string;
}): Promise<{ roundId: string; serverSeedHash: string; clientSeed: string }> {
  const cfg = await requireGameConfig(HORSE_RACING_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  const serverSeed = generateSeed();
  const clientSeed = (opts.clientSeed ?? "").trim() || generateSeed(8);
  const [round] = await db
    .insert(gameRoundsTable)
    .values({
      gameCode: HORSE_RACING_GAME_CODE,
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed,
      nonce: 0,
      crashPoint: 0,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
    })
    .returning();
  return {
    roundId: round.id,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
  };
}

export interface HorseRaceResult {
  betId: string;
  roundId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  stateId: string;
  horses: Array<{ id: number; name: string; color: string; multiplier: number }>;
  pickedHorseId: number;
  winnerId: number;
  didWin: boolean;
  multiplier: number;
  stakeAmount: string;
  payoutAmount: string;
  houseEdge: number;
}

export async function runHorseRace(input: {
  userId: string;
  stakeAmount: bigint;
  horseId: number;
  roundId: string;
  stateId: string;
}): Promise<HorseRaceResult> {
  const raceState = getRaceState(input.stateId);
  if (!raceState) throw new Error("INVALID_STATE");
  const horse = raceState.horses.find((h) => h.id === input.horseId);
  if (!horse) throw new Error("INVALID_HORSE");
  const cfg = await requireGameConfig(HORSE_RACING_GAME_CODE);
  if (!cfg.enabled) throw new Error("GAME_DISABLED");
  if (input.stakeAmount <= 0n) throw new Error("INVALID_STAKE");
  if (input.stakeAmount > cfg.maxStakePaise) throw new Error("STAKE_TOO_LARGE");

  // Load the pre-committed round. The hash was issued before the stake, so
  // the server cannot pick a different seed after seeing the bet.
  const [round] = await db
    .select()
    .from(gameRoundsTable)
    .where(
      and(
        eq(gameRoundsTable.id, input.roundId),
        eq(gameRoundsTable.gameCode, HORSE_RACING_GAME_CODE),
      ),
    )
    .limit(1);
  if (!round) throw new Error("ROUND_NOT_FOUND");
  // One bet per committed round — a reused seed would let a player bet again
  // on a race whose outcome they already know.
  const [existingBet] = await db
    .select({ id: betsTable.id })
    .from(betsTable)
    .where(eq(betsTable.roundId, round.id))
    .limit(1);
  if (existingBet) throw new Error("ROUND_ALREADY_USED");

  // 1) Debit stake / create bet row on the horse-racing wallet scope,
  //    linked to the committed round.
  const bet = await placeBet({
    userId: input.userId,
    gameCode: HORSE_RACING_GAME_CODE,
    roundId: round.id,
    stakeAmount: input.stakeAmount,
  });

  // 2) Bind the wager immutably to its state + horse for durable audit /
  //    provably-fair verification, then derive the outcome from the committed
  //    seeds. Any throw between placeBet and settlement refunds the stake and
  //    voids the bet.
  let winnerId: number;
  let didWin: boolean;
  let multiplier: number;
  try {
    await db
      .update(betsTable)
      .set({ metadata: { stateId: raceState.id, horseId: horse.id } })
      .where(eq(betsTable.id, bet.id));
    const outcome = deriveHorseWinner(
      round.serverSeed,
      round.clientSeed,
      raceState.id,
    );
    winnerId = outcome.winnerId;
    didWin = winnerId === horse.id;
    multiplier = didWin
      ? horseMultiplier(horse.winProbPct, round.houseEdge)
      : 0;
  } catch (err) {
    await voidAndRefund(bet.id, input.userId, input.stakeAmount);
    throw err;
  }

  // 3) Settle through the shared bets service (house_edge mode → instant).
  let payoutAmount = 0n;
  try {
    if (multiplier > 0) {
      const settled = await cashOutBet({
        betId: bet.id,
        userId: input.userId,
        multiplier,
        maxMultiplierCap: cfg.maxMultiplier,
      });
      payoutAmount = settled.payoutAmount;
    } else {
      await settleLoss(bet.id, input.userId, 0);
    }
  } catch (err) {
    await voidAndRefund(bet.id, input.userId, input.stakeAmount);
    throw err;
  }

  // 4) Audit: record outcome + totals on the round row. Failure is non-fatal
  //    (the bet row is already the settlement of record).
  try {
    await db
      .update(gameRoundsTable)
      .set({
        crashPoint: winnerId,
        totalStake: input.stakeAmount,
        totalPayout: payoutAmount,
        playerCount: 1,
      })
      .where(eq(gameRoundsTable.id, round.id));
  } catch (err) {
    console.error("[horse-racing] failed to record round outcome", err);
  }

  return {
    betId: bet.id,
    roundId: round.id,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    stateId: raceState.id,
    horses: raceState.horses.map((h) => ({
      id: h.id,
      name: h.name,
      color: h.color,
      multiplier: horseMultiplier(h.winProbPct, round.houseEdge),
    })),
    pickedHorseId: horse.id,
    winnerId,
    didWin,
    multiplier,
    stakeAmount: input.stakeAmount.toString(),
    payoutAmount: payoutAmount.toString(),
    houseEdge: round.houseEdge,
  };
}

async function voidAndRefund(
  betId: string,
  userId: string,
  stakeAmount: bigint,
): Promise<void> {
  try {
    await refundStake(betId, userId, stakeAmount);
    await db
      .update(betsTable)
      .set({ status: "voided", settledAt: new Date() })
      .where(eq(betsTable.id, betId));
  } catch (refundErr) {
    console.error(
      "[horse-racing] refund after settlement failure failed",
      refundErr,
    );
  }
}
