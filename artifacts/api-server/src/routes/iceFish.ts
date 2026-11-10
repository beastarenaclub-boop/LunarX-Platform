import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import {
  ICE_FISH_SPOTS,
  ICE_FISH_WHEEL,
  ICE_FISH_LABELS,
  settleIceFish,
  type IceFishOutcome,
} from "@workspace/api-zod/ice-fish";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  getTableRoundSnapshot,
  placeTableBets,
  isOutcomeDisclosed,
  type RoundConfigSnapshot,
} from "../services/tableRounds";
import { getPlayerGameConfig } from "../services/masterRtp";
import { deriveIceFish } from "../services/iceFish";
import { assertTableGameAllowed } from "../services/handoffGames";
import { badRequest, notFound, conflict } from "../lib/errors";
import { sha256Hex } from "../services/rtp";
import { isDeepStrictEqual } from "node:util";
const code = "ice-fish",
  router = Router();
router.use(requireAuth, async (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  try {
    await assertTableGameAllowed(req.session, code);
    next();
  } catch (error) {
    next(error);
  }
});
router.get("/config", async (req, res, next) => {
  try {
    const cfg = await getPlayerGameConfig(code, req.user!.id);
    if (!cfg) throw notFound("Ice Fish is unavailable");
    res.json({
      enabled: cfg.enabled,
      minStakePaise: String(cfg.minStakePaise),
      maxStakePaise: String(cfg.maxStakePaise),
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      rtpPolicy: cfg.rtpPolicy,
      bettingWindowMs: cfg.bettingWindowMs,
      revealDurationMs: cfg.revealDurationMs,
      settleDurationMs: cfg.settleDurationMs,
      wheel: ICE_FISH_WHEEL,
      spots: ICE_FISH_LABELS,
      rulesVersion: 1,
    });
  } catch (error) {
    next(error);
  }
});
router.get("/round", async (req, res, next) => {
  try {
    res.json(await getTableRoundSnapshot(code, req.user!.id));
  } catch (error) {
    next(error);
  }
});
router.post(
  "/bet",
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const body = z
        .object({
          roundId: z.string().min(1).max(128),
          idempotencyKey: z.string().uuid(),
          pricingVersion: z.string().max(100).optional(),
          bets: z
            .array(
              z
                .object({
                  type: z.enum(ICE_FISH_SPOTS),
                  amountPaise: z.string().regex(/^\d{1,12}$/),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict()
        .parse(req.body);
      res.json(
        await placeTableBets({
          ...body,
          gameCode: code,
          userId: req.user!.id,
          partnerId: req.session?.partnerId,
          partnerPlayerRef: req.session?.partnerPlayerRef,
        }),
      );
    } catch (error) {
      const messages: Record<string, string> = {
        BETTING_CLOSED: "Betting is closed. Join the next round.",
        INSUFFICIENT_FUNDS: "Insufficient wallet balance.",
        GAME_DISABLED: "Ice Fish is paused.",
        STAKE_TOO_LARGE: "Your bet exceeds the round limit.",
        STAKE_TOO_SMALL: "Your bet is below the table minimum.",
        INVALID_ICE_FISH_BET: "Choose a valid fish or anchor bet.",
        IDEMPOTENCY_KEY_REUSED:
          "That request was already used for a different bet.",
        ROULETTE_BET_IN_PROGRESS:
          "Your previous bet is still being processed. Retry the same request.",
      };
      next(
        messages[(error as Error).message]
          ? badRequest(messages[(error as Error).message])
          : error,
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
        eq(tableRoundsTable.id, tableRoundBetsTable.roundId),
      )
      .where(
        and(
          eq(tableRoundBetsTable.userId, req.user!.id),
          eq(tableRoundBetsTable.gameCode, code),
          eq(tableRoundBetsTable.status, "settled"),
        ),
      )
      .orderBy(desc(tableRoundBetsTable.createdAt))
      .limit(30);
    res.json(
      rows.map(({ slip, round }) => ({
        roundId: round.id,
        bets: slip.bets,
        totalStake: String(slip.totalStake),
        payoutAmount: String(slip.payoutAmount),
        outcome: round.outcome,
        resultSource: round.resultSource,
        createdAt: slip.createdAt,
      })),
    );
  } catch (error) {
    next(error);
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
    if (!round || !isOutcomeDisclosed(round))
      throw notFound("The round is not yet revealed");
    if (round.resultSource !== "drawn")
      throw conflict(
        "This round used a configured result mode; a seed-only proof does not apply.",
      );
    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, round.id),
          eq(tableRoundBetsTable.userId, req.user!.id),
        ),
      );
    const cfg = (slip?.pricingConfig ??
      round.config) as unknown as RoundConfigSnapshot;
    const outcome = deriveIceFish(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
    );
    const payout = slip
      ? settleIceFish(
          slip.bets,
          outcome,
          cfg.houseEdge,
          cfg.maxMultiplier,
        ).totalPayout.toString()
      : null;
    res.json({
      verified:
        sha256Hex(round.serverSeed) === round.serverSeedHash &&
        isDeepStrictEqual(outcome, round.outcome),
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      outcome: outcome as IceFishOutcome,
      payoutAmount: payout,
      rulesVersion: 1,
    });
  } catch (error) {
    next(error);
  }
});
export default router;
