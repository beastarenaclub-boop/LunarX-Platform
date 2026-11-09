import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import { HttpError } from "../lib/errors";
import { requireGameConfig } from "../services/rtp";
import { getTableRoundSnapshot, placeTableBets } from "../services/tableRounds";
import { pendingWinFor, takePendingWin } from "../services/pendingWins";
import {
  assertTableGameAllowed,
  HANDOFF_TABLE_CODES,
} from "../services/handoffGames";
import {
  CLASSIC,
  MINI,
  BET_TYPES,
  multiplierFor,
  wheelHouseEdge,
} from "../games/roulette/wheel";
import { payouts } from "../games/fun-target/math";
import {
  ROULETTE_LIMITS,
  withSpotCap,
  limitsForDisplay,
} from "../games/roulette/limits";

const wire = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (k, x) =>
      k === "serverSeed" || k === "clientSeed" || k === "serverSeedHash"
        ? undefined
        : typeof x === "bigint"
          ? String(x)
          : x,
    ),
  );
const router = Router();
for (const code of HANDOFF_TABLE_CODES) {
  const game = Router();
  game.use(requireAuth, async (req, _res, next) => {
    try {
      await assertTableGameAllowed(req.session, code);
      next();
    } catch (e) {
      next(e);
    }
  });
  game.get("/config", async (_req, res, next) => {
    try {
      const cfg = await requireGameConfig(code);
      const wheel = code === "roulette-american" ? CLASSIC : MINI;
      res.json(
        wire({
          ...cfg,
          maxBetsPerSlip: code === "fun-target" ? 10 : 200,
          ...(code === "fun-target"
            ? {
                payouts: payouts(cfg.houseEdge, cfg.maxMultiplier, {
                  ftDigitReturn: cfg.ftDigitReturn,
                }),
                digits: 10,
              }
            : {
                wheel,
                houseEdge: wheelHouseEdge(wheel),
                paytable: Object.fromEntries(
                  BET_TYPES.map((t) => [t, multiplierFor(wheel, t)]),
                ),
                limits: limitsForDisplay(
                  withSpotCap(ROULETTE_LIMITS, cfg.maxPerSpotPaise),
                ),
                maxPerSpotPaise: String(cfg.maxPerSpotPaise),
                maxPerPocket: null,
              }),
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  game.get("/round", async (req, res, next) => {
    try {
      res.json(wire(await getTableRoundSnapshot(code, req.user!.id)));
    } catch (e) {
      next(e);
    }
  });
  game.post(
    "/place",
    bettingIpRateLimiter,
    bettingRateLimiter,
    async (req, res, next) => {
      try {
        const input = z
          .object({
            bets: z
              .array(
                z.object({
                  type: z.string().max(30),
                  selection: z.array(z.number().int().min(0).max(37)).max(2),
                  amountPaise: z.string().regex(/^\d{1,18}$/),
                }),
              )
              .min(1)
              .max(200),
            roundId: z.string().max(128),
            pricingVersion: z.string().max(100).optional(),
            idempotencyKey: z.string().min(1).max(64).optional(),
          })
          .strict()
          .parse(req.body);
        res.json(
          await placeTableBets({
            ...input,
            idempotencyKey: req.get("Idempotency-Key") ?? input.idempotencyKey,
            gameCode: code,
            userId: req.user!.id,
            partnerId: req.session?.partnerId,
            partnerPlayerRef: req.session?.partnerPlayerRef,
          }),
        );
      } catch (e) {
        if (e instanceof Error && /^[A-Z_]+$/.test(e.message)) {
          const code =
            e.message === "SPOT_LIMIT_EXCEEDED"
              ? "ABOVE_MAX_PER_SPOT"
              : e.message;
          const messages: Record<string, string> = {
            ABOVE_MAX_PER_SPOT:
              "The maximum stake on this position has been reached.",
            BETTING_CLOSED: "Betting has closed for this round.",
            STAKE_TOO_SMALL: "Your total bet is below the table minimum.",
            STAKE_TOO_LARGE: "Your total bet exceeds the table maximum.",
            GAME_DISABLED: "This game is currently disabled.",
            INSUFFICIENT_FUNDS: "Insufficient wallet balance.",
          };
          next(new HttpError(400, code, messages[code] ?? code, { code }));
        } else next(e);
      }
    },
  );
  game.get("/win", async (req, res, next) => {
    try {
      const pendingWin = await pendingWinFor(req.user!.id, code);
      let layout = null;
      if (pendingWin?.roundId) {
        const [round] = await db
          .select()
          .from(tableRoundsTable)
          .where(eq(tableRoundsTable.id, pendingWin.roundId));
        const slips = await db
          .select()
          .from(tableRoundBetsTable)
          .where(
            and(
              eq(tableRoundBetsTable.roundId, pendingWin.roundId),
              eq(tableRoundBetsTable.userId, req.user!.id),
            ),
          );
        layout = {
          pocket: (round?.outcome as { pocket?: number })?.pocket ?? null,
          bets: slips.flatMap((s) => s.bets as unknown[]),
        };
      }
      res.json({ pendingWin, layout });
    } catch (e) {
      next(e);
    }
  });
  game.post("/win/take", async (req, res, next) => {
    try {
      const input = z
        .object({ takeKey: z.string().min(1).max(64).optional() })
        .strict()
        .parse(req.body ?? {});
      res.json(
        await takePendingWin({
          userId: req.user!.id,
          gameCode: code,
          ...input,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  game.get("/pockets", async (_req, res, next) => {
    try {
      const rows = await db
        .select()
        .from(tableRoundsTable)
        .where(
          and(
            eq(tableRoundsTable.gameCode, code),
            eq(tableRoundsTable.phase, "settled"),
          ),
        )
        .orderBy(desc(tableRoundsTable.settledAt))
        .limit(30);
      res.json(
        rows.map((r) => ({
          roundId: r.id,
          pocket: (r.outcome as { pocket: number }).pocket,
          settledAt: r.settledAt,
        })),
      );
    } catch (e) {
      next(e);
    }
  });
  game.get("/recent", async (req, res, next) => {
    try {
      res.json(
        wire(
          await db
            .select()
            .from(tableRoundBetsTable)
            .where(
              and(
                eq(tableRoundBetsTable.gameCode, code),
                eq(tableRoundBetsTable.userId, req.user!.id),
              ),
            )
            .orderBy(desc(tableRoundBetsTable.createdAt))
            .limit(30),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  router.use(`/${code}`, game);
}
export default router;
