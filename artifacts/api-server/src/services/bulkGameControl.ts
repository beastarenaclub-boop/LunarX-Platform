import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, gameConfigTable, gameEngineConfigTable, engineBankBudgetTable, b2cRtpPoliciesTable, networkNodesTable, auditLogTable, type User } from "@workspace/db";
import { badRequest, conflict, forbidden } from "../lib/errors";
import { isRetiredGame } from "../lib/retiredGames";
import { RTP_POLICY_GAMES } from "./rtpPolicyGames";
import { RESULT_ENGINE_GAMES } from "./resultEngine/scope";
import { paramsToJson, resolveParams } from "./resultEngine/params";
import { defaultRtpDisplay } from "./gameRtpDisplay";
import { sha256Hex } from "./rtp";

const percent = z.number().int().min(100).max(10000);
export const bulkControlInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rtp"), channel: z.enum(["b2c", "b2b", "both"]), playerRtpBps: percent, includeTables: z.boolean() }).strict(),
  z.object({ kind: z.literal("table-mode"), mode: z.enum(["normal", "collect", "distribute", "auto", "rtp"]), targetRtpBps: percent.optional() }).strict(),
  z.object({ kind: z.literal("budget"), mode: z.enum(["per_game", "same_each", "combined"]), budgetPaise: z.string().regex(/^\d{1,15}$/).optional() }).strict(),
]).superRefine((input, context) => {
  if (input.kind === "table-mode" && ["rtp", "auto"].includes(input.mode) && input.targetRtpBps === undefined)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a target RTP for RTP or Auto mode", path: ["targetRtpBps"] });
  if (input.kind === "budget" && input.mode !== "per_game" && input.budgetPaise === undefined)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the loss budget", path: ["budgetPaise"] });
});
export type BulkControlInput = z.infer<typeof bulkControlInput>;
const applyInput = z.object({ operation: bulkControlInput, previewToken: z.string().min(1).max(4096), requestId: z.string().uuid() }).strict();
type Reader = Pick<typeof db, "select">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const localEngines = and(isNull(gameEngineConfigTable.partnerId), inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES]));
const secret = randomBytes(32);
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
const hash = (value: unknown) => sha256Hex(json(value));
function admin(user: User) { if (!["admin", "super_admin"].includes(user.role)) throw forbidden("Only admin can change all-game controls"); }

async function snapshot(reader: Reader) {
  const configs = await reader.select().from(gameConfigTable).orderBy(gameConfigTable.gameCode);
  const engines = await reader.select().from(gameEngineConfigTable).where(localEngines).orderBy(gameEngineConfigTable.streamKey);
  const policies = await reader.select().from(b2cRtpPoliciesTable).orderBy(b2cRtpPoliciesTable.gameCode);
  const masters = await reader.select({ id: networkNodesTable.id, name: networkNodesTable.name, status: networkNodesTable.status,
    playerRtpBps: networkNodesTable.playerRtpBps, revision: networkNodesTable.rtpRevision }).from(networkNodesTable)
    .where(eq(networkNodesTable.kind, "master")).orderBy(networkNodesTable.id);
  const [budget] = await reader.select().from(engineBankBudgetTable).where(eq(engineBankBudgetTable.scope, "local"));
  return { configs, engines, policies, masters, budget };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function revision(state: Snapshot) {
  // Settled bank movements do not invalidate a preview. Floors are computed
  // against locked, current banks on Apply, never against the preview balance.
  return hash({ configs: state.configs,
    engines: RESULT_ENGINE_GAMES.map(gameCode => {
      const row = state.engines.find(e => e.streamKey === gameCode);
      return { gameCode, mode: row?.mode ?? "normal", params: paramsToJson(resolveParams(row?.params)),
        floor: row?.minBankFloorPaise ?? 0n, revision: row?.updatedAt.toISOString() ?? null };
    }), policies: state.policies.map(p => ({ gameCode: p.gameCode, playerRtpBps: p.playerRtpBps, revision: p.revision })),
    masters: state.masters, budget: state.budget ? { mode: state.budget.mode, floor: state.budget.floorPaise, revision: state.budget.updatedAt } : null });
}

function overview(state: Snapshot) {
  const tableCodes = [...RESULT_ENGINE_GAMES].filter(code => state.configs.some(g => g.gameCode === code));
  const games = [...new Set([...state.configs.map(g => g.gameCode), ...RTP_POLICY_GAMES])].sort().map(code => {
    const config = state.configs.find(g => g.gameCode === code), policy = state.policies.find(p => p.gameCode === code);
    const engine = state.engines.find(e => e.streamKey === code), params = resolveParams(engine?.params), mode = engine?.mode ?? "normal";
    return { code, enabled: config?.enabled ?? true, retired: isRetiredGame(code), playerRtp: RTP_POLICY_GAMES.includes(code as typeof RTP_POLICY_GAMES[number]),
      tableModes: tableCodes.includes(code as typeof RESULT_ENGINE_GAMES[number]), defaultRtp: defaultRtpDisplay(code, config),
      b2cRtpBps: policy?.playerRtpBps ?? null, mode,
      tableTargetRtpBps: mode === "rtp" ? 10000 - params.rtpHoldBps : mode === "auto" ? Math.round((1 - params.targetHoldPct) * 10000) : null,
    };
  });
  const combinedBank = state.engines.reduce((sum, e) => sum + e.bankPaise, 0n);
  return { games, masters: state.masters, playerRtpGames: [...RTP_POLICY_GAMES], tableGames: tableCodes,
    budget: { scope: "B2B + B2C shared tables", mode: state.budget?.mode ?? "per_game", combinedBankPaise: combinedBank.toString(),
      floorPaise: (state.budget?.floorPaise ?? 0n).toString(),
      remainingPaise: state.budget?.mode === "combined" ? (combinedBank - state.budget.floorPaise).toString() : null,
      sameEachPaise: state.budget?.mode === "same_each" ? state.budget.floorPaise.toString() : null },
  };
}
export async function listBulkControls(user: User) {
  admin(user);
  return db.transaction(async tx => overview(await snapshot(tx)), { isolationLevel: "repeatable read", accessMode: "read only" });
}
function plan(operation: BulkControlInput, state: Snapshot) {
  const view = overview(state);
  const b2cGames = operation.kind === "rtp" && operation.channel !== "b2b" ? view.playerRtpGames : [];
  const masters = operation.kind === "rtp" && operation.channel !== "b2c" ? state.masters : [];
  const tableGames = operation.kind !== "rtp" || operation.includeTables ? view.tableGames : [];
  if (!b2cGames.length && !masters.length && !tableGames.length) throw badRequest("No matching games or current B2B master accounts");
  const covered = new Set<string>([...b2cGames, ...(masters.length ? view.playerRtpGames : []), ...tableGames]);
  return { operation, b2cGames, masters, tableGames,
    excludedGames: view.games.filter(g => !covered.has(g.code)).map(g => ({ code: g.code, reason: g.retired ? "Withdrawn game" : operation.kind === "budget" ? "Outside the shared table result-engine budget" : "Not included in this operation; retains its existing rules" })),
    budget: view.budget,
    changes: [
      ...b2cGames.map(code => ({ target: `B2C / ${code}`, before: state.policies.find(p => p.gameCode === code)?.playerRtpBps ?? null, after: operation.kind === "rtp" ? operation.playerRtpBps : null, unit: "rtp-bps" })),
      ...masters.map(master => ({ target: `B2B master / ${master.name}`, before: master.playerRtpBps, after: operation.kind === "rtp" ? operation.playerRtpBps : null, unit: "rtp-bps" })),
      ...tableGames.map(code => ({ target: `Shared table / ${code}`, before: operation.kind === "budget" ? state.budget?.mode ?? "per_game" : state.engines.find(e => e.streamKey === code)?.mode ?? "normal",
        after: operation.kind === "rtp" ? "rtp" : operation.kind === "table-mode" ? operation.mode : operation.mode, unit: operation.kind === "budget" ? "budget-policy" : "mode" })),
    ],
  };
}
function sign(payload: object) {
  const encoded = Buffer.from(json(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
function verify(token: string): { actorId: string; revision: string; operationHash: string; expiresAt: number } {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw conflict("Preview is invalid. Review the changes again.");
  const actual = Buffer.from(signature, "base64url"), expected = createHmac("sha256", secret).update(encoded).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw conflict("Preview expired or changed. Review the changes again.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}
export async function previewBulkControls(user: User, body: unknown) {
  admin(user);
  const operation = bulkControlInput.parse(body);
  return db.transaction(async tx => {
    const state = await snapshot(tx), expiresAt = Date.now() + 10 * 60_000;
    return { ...plan(operation, state), expiresAt,
      previewToken: sign({ actorId: user.id, revision: revision(state), operationHash: hash(operation), expiresAt }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function lockSettings(tx: Transaction) {
  // Same engine -> config order as individual Game Control edits. Only existing
  // rows are locked here; creating defaults before revision comparison would
  // turn an otherwise unchanged first preview into a false conflict.
  await tx.select({ key: gameEngineConfigTable.streamKey }).from(gameEngineConfigTable).where(localEngines).orderBy(gameEngineConfigTable.streamKey).for("update");
  await tx.select({ code: gameConfigTable.gameCode }).from(gameConfigTable).orderBy(gameConfigTable.gameCode).for("update");
  await tx.select({ code: b2cRtpPoliciesTable.gameCode }).from(b2cRtpPoliciesTable).orderBy(b2cRtpPoliciesTable.gameCode).for("update");
  await tx.select({ id: networkNodesTable.id }).from(networkNodesTable).where(eq(networkNodesTable.kind, "master")).orderBy(networkNodesTable.id).for("update");
  await tx.select({ scope: engineBankBudgetTable.scope }).from(engineBankBudgetTable).where(eq(engineBankBudgetTable.scope, "local")).for("update");
}
export async function applyBulkControls(user: User, body: unknown) {
  admin(user);
  const input = applyInput.parse(body), operationHash = hash(input.operation), id = `bulk-game-control:${input.requestId}`;
  return db.transaction(async tx => {
    // A unique audit row also serializes identical retries, including concurrent
    // first requests. Failure rolls this reservation back with all setting edits.
    const [reserved] = await tx.insert(auditLogTable).values({ id, actorId: user.id, actorRole: user.role,
      action: "engine.bulk", targetType: "game_control", targetId: "b2b+b2c", after: { operationHash } })
      .onConflictDoNothing({ target: auditLogTable.id }).returning({ id: auditLogTable.id });
    const [audit] = await tx.select().from(auditLogTable).where(eq(auditLogTable.id, id)).for("update");
    const previous = audit.after as { operationHash: string; receipt?: Record<string, unknown> };
    if (audit.actorId !== user.id || previous.operationHash !== operationHash) throw conflict("Request ID was already used for a different change");
    if (!reserved && previous.receipt) return previous.receipt;
    const token = verify(input.previewToken);
    if (token.actorId !== user.id || token.operationHash !== operationHash || token.expiresAt <= Date.now()) throw conflict("Preview expired or changed. Review the changes again.");
    await lockSettings(tx);
    const before = await snapshot(tx);
    if (revision(before) !== token.revision) throw conflict("Game or master settings changed after preview. Review the changes again.");
    const reviewed = plan(input.operation, before), operation = input.operation, now = new Date();
    for (const code of reviewed.b2cGames) {
      if (operation.kind !== "rtp") continue;
      const previousPolicy = before.policies.find(p => p.gameCode === code);
      if (previousPolicy?.playerRtpBps === operation.playerRtpBps) continue;
      const fields = { playerRtpBps: operation.playerRtpBps, revision: (previousPolicy?.revision ?? 0) + 1, updatedBy: user.id, updatedAt: now };
      if (previousPolicy) await tx.update(b2cRtpPoliciesTable).set(fields).where(eq(b2cRtpPoliciesTable.gameCode, code));
      else {
        const [inserted] = await tx.insert(b2cRtpPoliciesTable).values({ gameCode: code, ...fields }).onConflictDoNothing().returning({ code: b2cRtpPoliciesTable.gameCode });
        if (!inserted) throw conflict("A B2C policy changed after preview. Review the changes again.");
      }
    }
    for (const master of reviewed.masters) {
      if (operation.kind !== "rtp" || master.playerRtpBps === operation.playerRtpBps) continue;
      await tx.update(networkNodesTable).set({ playerRtpBps: operation.playerRtpBps, rtpRevision: master.revision + 1, updatedAt: now }).where(eq(networkNodesTable.id, master.id));
    }
    for (const code of reviewed.tableGames) {
      const [inserted] = await tx.insert(gameEngineConfigTable).values({ streamKey: code, gameCode: code }).onConflictDoNothing().returning({ code: gameEngineConfigTable.gameCode });
      if (!inserted && !before.engines.some(e => e.streamKey === code)) {
        const [current] = await tx.select().from(gameEngineConfigTable).where(eq(gameEngineConfigTable.streamKey, code)).for("update");
        if (current.updatedBy !== null || current.mode !== "normal" || current.minBankFloorPaise !== 0n)
          throw conflict("A table setting changed after preview. Review the changes again.");
      }
      if (operation.kind === "budget") continue;
      const params = resolveParams(before.engines.find(e => e.streamKey === code)?.params);
      const mode = operation.kind === "rtp" ? "rtp" : operation.mode;
      const bps = operation.kind === "rtp" ? operation.playerRtpBps : operation.targetRtpBps;
      if (mode === "rtp") params.rtpHoldBps = 10000 - bps!;
      if (mode === "auto") params.targetHoldPct = (10000 - bps!) / 10000;
      await tx.update(gameEngineConfigTable).set({ mode, params: paramsToJson(params), updatedAt: now, updatedBy: user.id }).where(eq(gameEngineConfigTable.streamKey, code));
    }
    if (operation.kind === "budget") {
      const rows = await tx.select().from(gameEngineConfigTable).where(localEngines).orderBy(gameEngineConfigTable.streamKey).for("update");
      const budget = BigInt(operation.budgetPaise ?? "0");
      const floorPaise = operation.mode === "combined" ? rows.reduce((sum, row) => sum + row.bankPaise, 0n) - budget
        : operation.mode === "same_each" ? budget : before.budget?.floorPaise ?? 0n;
      const fields = { mode: operation.mode, floorPaise, updatedAt: now, updatedBy: user.id };
      await tx.insert(engineBankBudgetTable).values({ scope: "local", ...fields }).onConflictDoUpdate({ target: engineBankBudgetTable.scope, set: fields });
      if (operation.mode === "same_each") for (const row of rows) await tx.update(gameEngineConfigTable)
        .set({ minBankFloorPaise: row.bankPaise - budget, updatedAt: now, updatedBy: user.id }).where(eq(gameEngineConfigTable.streamKey, row.streamKey));
    }
    const after = overview(await snapshot(tx));
    const receipt = { requestId: input.requestId, appliedAt: now.toISOString(), operation,
      b2cGames: reviewed.b2cGames, masters: reviewed.masters.map(m => ({ id: m.id, name: m.name })), tableGames: reviewed.tableGames,
      excludedGames: reviewed.excludedGames, budget: after.budget };
    await tx.update(auditLogTable).set({ before: { revision: token.revision, changes: reviewed.changes, budget: reviewed.budget },
      after: { operationHash, receipt } }).where(eq(auditLogTable.id, id));
    return receipt;
  });
}
