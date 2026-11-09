import { RESULT_ENGINE_GAMES, usesResultEngine } from "../services/resultEngine/scope";
import { rummyOutcomeSpace } from "../games/rummy/sim";
import type { OutcomeSpace } from "../services/tableAdapter";
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  gameConfigTable,
  gameEngineConfigTable,
  gameBankLedgerTable,
  roundDecisionTable,
  auditLogTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { ADAPTERS, type RoundConfigSnapshot } from "../services/tableRounds";
import { tableOutcomeSpace } from "../services/resultEngine/tableSpace";
import {
  engineStateFor,
  setForcedResult,
  clearForcedResult,
  peekForcedResult,
  ForceRefused,
} from "../services/resultEngine/engine";
import {
  bankBudgetView,
  writeBankBudget,
  BankBudgetError,
  withEffectiveFloor,
} from "../services/resultEngine/bankBudget";
import { invalidateConfigCache } from "../services/rtp";
import {
  DEFAULT_PARAMS,
  ENGINE_MODES,
  PARAM_BOUNDS,
  RTP_HISTORY_SCOPES,
  paramsToJson,
  resolveParams,
} from "../services/resultEngine/params";

const router = Router();
router.use(requireAuth, requireRole("admin", "super_admin"));
const wire = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)),
  );
const money = z.string().regex(/^-?\d{1,18}$/);
const paramFields: Record<string, z.ZodType> = {};
for (const [key, bounds] of Object.entries(PARAM_BOUNDS)) {
  let field = z.number().finite().min(bounds.min).max(bounds.max);
  if (bounds.integer) field = field.int();
  paramFields[key] = field.optional();
}
for (const [key, value] of Object.entries(DEFAULT_PARAMS))
  if (typeof value === "boolean") paramFields[key] = z.boolean().optional();
Object.assign(paramFields, {
  targetBankPaise: money.nullable().optional(),
  partyBalanceMode: z.enum(["rtpBand", "noLoser"]).optional(),
  rtpHistoryScope: z.enum(RTP_HISTORY_SCOPES).optional(),
  partyHistoryScope: z.enum(RTP_HISTORY_SCOPES).optional(),
  rtpRecoveryMode: z.enum(["target", "recover"]).optional(),
});
export const engineConfigInput = z
  .object({
    mode: z
      .enum(ENGINE_MODES as ["normal", "collect", "distribute", "auto", "rtp"])
      .optional(),
    params: z.object(paramFields).strict().optional(),
    budgetPaise: money.optional(),
    maxPerSpotPaise: z
      .string()
      .regex(/^\d{1,11}$/)
      .refine((v) => BigInt(v) > 0n)
      .optional(),
    digitReturn: z.number().min(1).max(10).multipleOf(0.01).optional(),
    revision: z.string(),
  })
  .strict();

function capability(code: string) {
  const supported = usesResultEngine(code);
  return {
    supported,
    reason: supported
      ? "Shared table result engine"
      : code === "blackjack" ||
          code === "rummy" ||
          code === "ludo" ||
          code.startsWith("poker-")
        ? "Player decisions determine the result. Use this game's payout and limit settings."
        : "Uses its own draw engine. RTP, payout rules and limits remain in Game Defaults.",
  };
}
async function view(code: string) {
  const [game] = await db
    .select()
    .from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, code));
  if (!game) throw notFound("Game not found");
  const access = capability(code);
  if (!access.supported) return { game, ...access, engine: null };
  const state = await engineStateFor(code, null);
  const [row] = await db
    .select()
    .from(gameEngineConfigTable)
    .where(eq(gameEngineConfigTable.streamKey, code));
  const [floor] = await withEffectiveFloor([
    {
      partnerId: null,
      bankPaise: String(state.bankPaise),
      minBankFloorPaise: String(state.minBankFloorPaise),
    },
  ]);
  return {
    game,
    ...access,
    engine: {
      ...state,
      params: paramsToJson(state.params),
      revision: row.updatedAt.toISOString(),
      floorMode: floor.floorMode,
      effectiveFloorPaise: floor.effectiveFloorPaise,
      effectiveBudgetPaise: String(
        BigInt(floor.effectiveBankPaise) - BigInt(floor.effectiveFloorPaise),
      ),
      budgetPaise: (state.bankPaise - state.minBankFloorPaise).toString(),
      forcedChoice: peekForcedResult(code, null),
    },
  };
}
async function requireEngine(code: string) {
  const result = await view(code);
  if (!result.supported) throw badRequest(result.reason);
  return result;
}
router.get("/", async (_req, res, next) => {
  try {
    const games = await db
      .select({ code: gameConfigTable.gameCode })
      .from(gameConfigTable)
      .orderBy(gameConfigTable.gameCode);
    res.json(
      wire({
        games: await Promise.all(games.map((g) => view(g.code))),
        modes: ENGINE_MODES,
        bounds: PARAM_BOUNDS,
        defaults: paramsToJson({ ...DEFAULT_PARAMS }),
        budget: await bankBudgetView(null),
      }),
    );
  } catch (e) {
    next(e);
  }
});
router.get("/export", async (_req, res, next) => {
  try {
    const games = await db
      .select({ code: gameConfigTable.gameCode })
      .from(gameConfigTable)
      .orderBy(gameConfigTable.gameCode);
    res
      .attachment("game-control-settings.json")
      .json(
        wire({
          exportedAt: new Date().toISOString(),
          games: await Promise.all(games.map((g) => view(g.code))),
          budget: await bankBudgetView(null),
        }),
      );
  } catch (e) {
    next(e);
  }
});
router.put("/budget", async (req, res, next) => {
  try {
    const input = z
      .object({
        mode: z.enum(["per_game", "same_each", "combined"]),
        budgetPaise: money.optional(),
      })
      .strict()
      .parse(req.body);
    for (const code of RESULT_ENGINE_GAMES)
      await engineStateFor(code, null);
    const before = await bankBudgetView(null);
    const after = await writeBankBudget({
      ...input,
      partnerId: null,
      updatedBy: req.user!.id,
    });
    await db
      .insert(auditLogTable)
      .values({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: "engine.budget",
        targetType: "game_engine",
        targetId: "local",
        before,
        after,
      });
    res.json(after);
  } catch (e) {
    next(e);
  }
});
router.put("/:game", async (req, res, next) => {
  try {
    const code = String(req.params.game);
    await requireEngine(code);
    const input = engineConfigInput.parse(req.body);
    if (input.digitReturn !== undefined && code !== "fun-target")
      throw badRequest("Digit return is only available for Fun Target");
    if (
      input.maxPerSpotPaise !== undefined &&
      !["roulette-american", "roulette-mini", "fun-target"].includes(code)
    )
      throw badRequest("Use this game's existing limit settings");
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(gameEngineConfigTable)
        .where(eq(gameEngineConfigTable.streamKey, code))
        .for("update");
      if (before.updatedAt.toISOString() !== input.revision)
        throw conflict("Settings changed. Reload before saving.");
      const params = paramsToJson(
        resolveParams({
          ...paramsToJson(resolveParams(before.params)),
          ...input.params,
        }),
      );
      if (input.maxPerSpotPaise !== undefined) {
        const [previousGame] = await tx
          .select()
          .from(gameConfigTable)
          .where(eq(gameConfigTable.gameCode, code))
          .for("update");
        await tx
          .update(gameConfigTable)
          .set({ maxPerSpotPaise: BigInt(input.maxPerSpotPaise) })
          .where(eq(gameConfigTable.gameCode, code));
        await tx
          .insert(auditLogTable)
          .values({
            actorId: req.user!.id,
            actorRole: req.user!.role,
            action: "game.spot_limit",
            targetType: "game_config",
            targetId: code,
            before: { maxPerSpotPaise: String(previousGame.maxPerSpotPaise) },
            after: { maxPerSpotPaise: input.maxPerSpotPaise },
          });
      }
      if (input.digitReturn !== undefined) {
        const [previousGame] = await tx
          .select()
          .from(gameConfigTable)
          .where(eq(gameConfigTable.gameCode, code))
          .for("update");
        await tx
          .update(gameConfigTable)
          .set({ ftDigitReturn: input.digitReturn })
          .where(eq(gameConfigTable.gameCode, code));
        await tx
          .insert(auditLogTable)
          .values({
            actorId: req.user!.id,
            actorRole: req.user!.role,
            action: "game.paytable",
            targetType: "game_config",
            targetId: code,
            before: { ftDigitReturn: previousGame.ftDigitReturn },
            after: { ftDigitReturn: input.digitReturn },
          });
      }
      const [after] = await tx
        .update(gameEngineConfigTable)
        .set({
          mode: input.mode ?? before.mode,
          params,
          ...(input.budgetPaise === undefined
            ? {}
            : {
                minBankFloorPaise: before.bankPaise - BigInt(input.budgetPaise),
              }),
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(gameEngineConfigTable.streamKey, code))
        .returning();
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "engine.settings",
          targetType: "game_engine",
          targetId: code,
          before: wire(before),
          after: wire(after),
        });
    });
    invalidateConfigCache(code);
    res.json(wire(await view(code)));
  } catch (e) {
    next(e);
  }
});
router.get("/:game/history", async (req, res, next) => {
  try {
    const code = String(req.params.game);
    await requireEngine(code);
    const [decisions, ledger] = await Promise.all([
      db
        .select()
        .from(roundDecisionTable)
        .where(eq(roundDecisionTable.streamKey, code))
        .orderBy(desc(roundDecisionTable.createdAt))
        .limit(50),
      db
        .select()
        .from(gameBankLedgerTable)
        .where(eq(gameBankLedgerTable.streamKey, code))
        .orderBy(desc(gameBankLedgerTable.createdAt))
        .limit(50),
    ]);
    res.json(wire({ decisions, ledger }));
  } catch (e) {
    next(e);
  }
});
router.get("/:game/choices", async (req, res, next) => {
  try {
    const code = String(req.params.game),
      { game } = await requireEngine(code);
    const cfg = {
      ...game,
      maxPerSpotPaise: String(game.maxPerSpotPaise),
      maxStakePaise: String(game.maxStakePaise),
      minStakePaise: String(game.minStakePaise),
    } as RoundConfigSnapshot;
    const adapter = ADAPTERS[code as keyof typeof ADAPTERS];
    res.json(
      (code === "rummy-royale"
        ? rummyOutcomeSpace
        : tableOutcomeSpace(code, (s) =>
            adapter.derive(s.serverSeed, s.clientSeed, s.nonce, cfg),
          )
      ).choices(),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/:game/force", async (req, res, next) => {
  try {
    const code = String(req.params.game),
      { game } = await requireEngine(code);
    const input = z
      .object({ choiceId: z.string().min(1).max(100).nullable() })
      .strict()
      .parse(req.body);
    if (input.choiceId === null) clearForcedResult(code, null);
    else {
      const cfg = {
        ...game,
        maxPerSpotPaise: String(game.maxPerSpotPaise),
        maxStakePaise: String(game.maxStakePaise),
        minStakePaise: String(game.minStakePaise),
      } as RoundConfigSnapshot;
      const adapter = ADAPTERS[code as keyof typeof ADAPTERS];
      await setForcedResult({
        gameCode: code,
        partnerId: null,
        choiceId: input.choiceId,
        space:
          code === "rummy-royale"
            ? rummyOutcomeSpace
            : tableOutcomeSpace(code, (s) =>
                adapter.derive(s.serverSeed, s.clientSeed, s.nonce, cfg),
              ),
      });
    }
    await db
      .insert(auditLogTable)
      .values({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: "engine.force",
        targetType: "game_engine",
        targetId: code,
        after: input,
      });
    res.json({ choiceId: peekForcedResult(code, null), expiresInSeconds: 300 });
  } catch (e) {
    next(e);
  }
});
router.use(
  (
    error: unknown,
    _req: import("express").Request,
    _res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    next(
      error instanceof BankBudgetError || error instanceof ForceRefused
        ? badRequest(error.message)
        : error,
    );
  },
);
export default router;
