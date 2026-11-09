import { db, partnersTable, type Session } from "@workspace/db";
import { eq } from "drizzle-orm";
import { forbidden } from "../lib/errors";
import { createSeedStream } from "../lib/seedStream";
import type { TableGameAdapter } from "./tableRounds";
import { CLASSIC, MINI, type Wheel } from "../games/roulette/wheel";
import {
  settleRouletteBets,
  type RouletteBetInput,
} from "../games/roulette/math";
import {
  settleBets,
  validateBets,
  type BetInput,
  type Outcome,
} from "../games/fun-target/math";
import { deriveFunTargetOutcome } from "../games/fun-target/derive";

export const HANDOFF_TABLE_CODES = [
  "roulette-american",
  "roulette-mini",
  "fun-target",
] as const;
export function tableBetPartnerContext(session: Session | null | undefined) {
  return {
    partnerId: session?.partnerId ?? null,
    partnerPlayerRef: session?.partnerPlayerRef ?? null,
  };
}
export async function assertTableGameAllowed(
  session: Session | null | undefined,
  code: string,
) {
  if (!session?.partnerId) return;
  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, session.partnerId));
  if (
    !partner ||
    partner.status !== "active" ||
    (partner.allowedGames.length > 0 && !partner.allowedGames.includes(code))
  )
    throw forbidden("This game is not enabled for your operator");
}
export function handoffInputs<T>(bets: unknown): T[] {
  if (!Array.isArray(bets) || !bets.length || bets.length > 200)
    throw new Error("INVALID_STAKE");
  return bets.map((b) => {
    if (
      !b ||
      typeof b.amountPaise !== "string" ||
      !/^\d{1,18}$/.test(b.amountPaise) ||
      BigInt(b.amountPaise) <= 0n
    )
      throw new Error("INVALID_STAKE");
    return { ...b, amountPaise: BigInt(b.amountPaise) };
  });
}
export function handoffWheelAdapter(wheel: Wheel): TableGameAdapter {
  return {
    validate: (bets, cap) =>
      settleRouletteBets(wheel, handoffInputs<RouletteBetInput>(bets), -1, cap),
    derive: (server, client, nonce) => ({
      pocket: createSeedStream(server, client, nonce).uniform(
        wheel.pocketCount,
      ),
    }),
    settle: (bets, outcome, cap) =>
      settleRouletteBets(
        wheel,
        handoffInputs<RouletteBetInput>(bets),
        (outcome as { pocket: number }).pocket,
        cap,
      ),
    insertAudit: async ({ round }) => round.id,
  };
}
export const handoffAdapters = {
  "roulette-american": handoffWheelAdapter(CLASSIC),
  "roulette-mini": handoffWheelAdapter(MINI),
  "fun-target": {
    validate: (bets: unknown) => ({
      totalStake: validateBets(handoffInputs<BetInput>(bets)),
    }),
    derive: deriveFunTargetOutcome,
    settle: (bets, outcome, cap, edge, cfg) =>
      settleBets(
        handoffInputs<BetInput>(bets),
        outcome as Outcome,
        edge,
        cap,
        cfg.paytable,
      ),
    insertAudit: async ({ round }) => round.id,
  } satisfies TableGameAdapter,
};
