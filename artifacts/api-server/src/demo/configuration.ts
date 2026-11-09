import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, gameConfigTable, gameEngineConfigTable, engineBankBudgetTable, b2cRtpPoliciesTable } from "./database";
import { RESULT_ENGINE_GAMES, usesResultEngine } from "../services/resultEngine/scope";
import { invalidateConfigCache } from "../services/rtp";
import type { DemoConfiguration } from "./configurationSnapshot";

/** Each worker has its own revision cursor. Repeating a snapshot must not refill
 * a consumed budget, move a target, or undo that demo engine's Auto handback. */
export function demoConfigurator() {
  const revisions = new Map<string, string>();
  let budgetRevision: string | undefined;
  let pending: Promise<void> = Promise.resolve();
  async function apply(snapshot: DemoConfiguration) {
    await db.transaction(async tx => {
      for (const config of snapshot.configs) {
        // Also strip legacy callers' metadata at the trust boundary.
        const { id: _id, updatedBy: _actor, ...fields } = config as typeof gameConfigTable.$inferSelect;
        await tx.insert(gameConfigTable).values({ ...fields, updatedBy: null })
          .onConflictDoUpdate({ target: gameConfigTable.gameCode, set: { ...fields, updatedBy: null } });
      }
      if (snapshot.policies) {
        await tx.delete(b2cRtpPoliciesTable);
        if (snapshot.policies.length) await tx.insert(b2cRtpPoliciesTable).values(snapshot.policies.map(
          ({ gameCode, playerRtpBps, revision }) => ({ gameCode, playerRtpBps, revision })));
      }
      for (const engine of snapshot.engines ?? []) {
        if (!usesResultEngine(engine.gameCode) || revisions.get(engine.gameCode) === engine.revision) continue;
        await tx.insert(gameEngineConfigTable).values({ streamKey: engine.gameCode, gameCode: engine.gameCode }).onConflictDoNothing();
        const [local] = await tx.select().from(gameEngineConfigTable)
          .where(eq(gameEngineConfigTable.streamKey, engine.gameCode)).for("update");
        await tx.update(gameEngineConfigTable).set({ mode: engine.mode,
          params: { ...engine.params, targetBankPaise: engine.targetDeltaPaise === null ? null : (local.bankPaise + engine.targetDeltaPaise).toString() },
          minBankFloorPaise: local.bankPaise - engine.remainingBudgetPaise, updatedBy: null, updatedAt: new Date(),
        }).where(eq(gameEngineConfigTable.streamKey, engine.gameCode));
      }
      const budget = snapshot.budget;
      if (budget && budgetRevision !== budget.revision) {
        const rows = await tx.select({ bank: gameEngineConfigTable.bankPaise }).from(gameEngineConfigTable)
          .where(and(isNull(gameEngineConfigTable.partnerId), inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES])));
        const floorPaise = budget.mode === "combined" ? rows.reduce((sum, row) => sum + row.bank, 0n) - budget.amountPaise : budget.amountPaise;
        const fields = { mode: budget.mode, floorPaise, updatedBy: null, updatedAt: new Date() };
        await tx.insert(engineBankBudgetTable).values({ scope: "local", ...fields })
          .onConflictDoUpdate({ target: engineBankBudgetTable.scope, set: fields });
      }
    });
    // Advance cursors only after the entire snapshot committed successfully.
    for (const engine of snapshot.engines ?? []) revisions.set(engine.gameCode, engine.revision);
    if (snapshot.budget) budgetRevision = snapshot.budget.revision;
    invalidateConfigCache();
  }
  return (snapshot: DemoConfiguration) => {
    const next = pending.then(() => apply(snapshot));
    pending = next.catch(() => {});
    return next;
  };
}
