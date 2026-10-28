import { Router, type IRouter } from "express";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import {
  MEGA_BALL_PAYTABLE,
  MEGA_BALL_MAX_RETURN,
} from "@workspace/api-zod/mega-ball";
import { requireAuth } from "../middlewares/auth";
import {
  bettingIpRateLimiter,
  bettingRateLimiter,
} from "../middlewares/rateLimit";
import { requireGameConfig, sha256Hex } from "../services/rtp";
import {
  getTableRoundSnapshot,
  isOutcomeDisclosed,
  placeTableBets,
} from "../services/tableRounds";
import {
  deriveMegaBallOutcome,
  megaBallCards,
  settleMegaBallCards,
} from "../services/megaBallMath";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();
const code = "mega-ball";
const bodySchema = z
  .object({
    roundId: z.string().min(1).max(100),
    count: z.number().int().min(1).max(100),
    amountPaise: z
      .string()
      .regex(/^\d{1,7}$/)
      .refine((value) => BigInt(value) >= 100n && BigInt(value) <= 1_000_000n),
  })
  .strict();
const slots: Promise<unknown>[] = [
  Promise.resolve(),
  Promise.resolve(),
  Promise.resolve(),
];
let nextSlot = 0;
function admission<T>(work: () => Promise<T>) {
  const slot = nextSlot++ % slots.length;
  const pending = slots[slot].then(work);
  slots[slot] = pending.catch(() => undefined);
  return pending;
}
router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig(code);
    res.json({
      enabled: cfg.enabled,
      minStakePaise: cfg.minStakePaise.toString(),
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxCards: 100,
      maxMultiplier: MEGA_BALL_MAX_RETURN,
      paytable: MEGA_BALL_PAYTABLE,
      bettingWindowMs: cfg.bettingWindowMs,
      revealDurationMs: cfg.revealDurationMs,
      settleDurationMs: cfg.settleDurationMs,
    });
  } catch (e) {
    next(e);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(code, req.user!.id));
  } catch (e) {
    next(e);
  }
});
router.post(
  "/bet",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const body = bodySchema.parse(req.body);
      const accepted = await admission(() =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${code}:${body.roundId}:${req.user!.id}`}, 0))`,
          );
          const [round] = await tx
            .select()
            .from(tableRoundsTable)
            .where(
              and(
                eq(tableRoundsTable.id, body.roundId),
                eq(tableRoundsTable.gameCode, code),
              ),
            );
          if (!round) throw badRequest("This round is no longer available.");
          const cards = megaBallCards(
            round.serverSeedHash,
            req.user!.id,
            body.count,
            body.amountPaise,
          );
          const [existing] = await tx
            .select()
            .from(tableRoundBetsTable)
            .where(
              and(
                eq(tableRoundBetsTable.gameCode, code),
                eq(tableRoundBetsTable.roundId, body.roundId),
                eq(tableRoundBetsTable.userId, req.user!.id),
              ),
            );
          if (existing) {
            if (!isDeepStrictEqual(existing.bets, cards))
              throw badRequest(
                "Your cards are already confirmed for this round.",
              );
            return {
              slipId: existing.id,
              betId: existing.betId,
              roundId: round.id,
              totalStake: existing.totalStake.toString(),
              cards,
              status: existing.status,
            };
          }
          if (!(await requireGameConfig(code)).enabled)
            throw badRequest("Mega Ball is currently paused.");
          const receipt = await placeTableBets({
            gameCode: code,
            userId: req.user!.id,
            roundId: body.roundId,
            bets: cards,
          });
          return { ...receipt, cards };
        }),
      );
      res.json(accepted);
    } catch (e) {
      const message: Record<string, string> = {
        BETTING_CLOSED: "Betting is closed. Join the next round.",
        INSUFFICIENT_FUNDS: "Insufficient wallet balance.",
        STAKE_TOO_SMALL: "The minimum card price is ₹1.",
        STAKE_TOO_LARGE: "Your cards exceed the table limit.",
        INVALID_MEGA_CARDS: "Please choose a valid number of cards and stake.",
      };
      next(
        message[(e as Error).message]
          ? badRequest(message[(e as Error).message])
          : e,
      );
    }
  },
);
router.get("/recent", async (req, res, next) => {
  try {
    const rows = await db
      .select({ slip: tableRoundBetsTable, round: tableRoundsTable })
      .from(tableRoundBetsTable)
      .innerJoin(
        tableRoundsTable,
        eq(tableRoundBetsTable.roundId, tableRoundsTable.id),
      )
      .where(
        and(
          eq(tableRoundBetsTable.gameCode, code),
          eq(tableRoundBetsTable.userId, req.user!.id),
          eq(tableRoundBetsTable.status, "settled"),
        ),
      )
      .orderBy(desc(tableRoundBetsTable.createdAt))
      .limit(20);
    res.json(
      rows.map(({ slip, round }) => ({
        roundId: round.id,
        cards: slip.bets,
        outcome: round.outcome,
        totalStake: slip.totalStake.toString(),
        payoutAmount: slip.payoutAmount.toString(),
        createdAt: slip.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/:id/verify", async (req, res, next) => {
  try {
    const [round] = await db
      .select()
      .from(tableRoundsTable)
      .where(
        and(
          eq(tableRoundsTable.id, String(req.params.id)),
          eq(tableRoundsTable.gameCode, code),
        ),
      );
    if (!round) throw notFound("Round not found.");
    if (!isOutcomeDisclosed(round))
      throw badRequest("Wait for betting to close before verifying the draw.");
    const outcome = deriveMegaBallOutcome(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
    );
    const slips = await db
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, round.id),
          eq(tableRoundBetsTable.userId, req.user!.id),
        ),
      );
    const receipts = slips.map((slip) => ({
      slipId: slip.id,
      payoutMatch:
        slip.status === "settled"
          ? settleMegaBallCards(slip.bets, outcome).totalPayout ===
            slip.payoutAmount
          : null,
    }));
    const verified =
      sha256Hex(round.serverSeed) === round.serverSeedHash &&
      isDeepStrictEqual(outcome, round.outcome) &&
      receipts.every((receipt) => receipt.payoutMatch !== false);
    res.json({
      roundId: round.id,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      outcome,
      receipts,
      verified,
    });
  } catch (e) {
    next(e);
  }
});
export default router;
