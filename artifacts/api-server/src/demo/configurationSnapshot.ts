import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, gameConfigTable, gameEngineConfigTable, engineBankBudgetTable, b2cRtpPoliciesTable } from "@workspace/db";
import { RESULT_ENGINE_GAMES } from "../services/resultEngine/scope";
import { paramsToJson, resolveParams } from "../services/resultEngine/params";

export type DemoConfiguration = {
  configs: Omit<typeof gameConfigTable.$inferInsert, "id" | "updatedBy">[];
  policies?: Pick<typeof b2cRtpPoliciesTable.$inferSelect, "gameCode" | "playerRtpBps" | "revision">[];
  engines?: {
    gameCode: string; revision: string; mode: string; params: Record<string, unknown>;
    remainingBudgetPaise: bigint; targetDeltaPaise: bigint | null;
  }[];
  budget?: { revision: string; mode: string; amountPaise: bigint };
};

/** Only operator configuration crosses into the volatile worker, never accounts,
 * forced results, production balances, seeds, or settlement/history records. */
export async function captureDemoConfiguration(): Promise<DemoConfiguration> {
  return db.transaction(async tx => {
    const configs = await tx.select().from(gameConfigTable);
    const policies = await tx.select({ gameCode: b2cRtpPoliciesTable.gameCode,
      playerRtpBps: b2cRtpPoliciesTable.playerRtpBps, revision: b2cRtpPoliciesTable.revision }).from(b2cRtpPoliciesTable);
    const engines = await tx.select().from(gameEngineConfigTable).where(and(
      isNull(gameEngineConfigTable.partnerId), inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES])));
    const [budget] = await tx.select().from(engineBankBudgetTable).where(eq(engineBankBudgetTable.scope, "local"));
    const combinedBank = engines.reduce((sum, row) => sum + row.bankPaise, 0n);
    return {
      configs: configs.map(({ id: _id, updatedBy: _actor, ...fields }) => fields),
      policies,
      engines: RESULT_ENGINE_GAMES.map(gameCode => {
        const row = engines.find(item => item.streamKey === gameCode);
        const params = resolveParams(row?.params);
        const bank = row?.bankPaise ?? 0n;
        return { gameCode, revision: row?.updatedAt.toISOString() ?? "default", mode: row?.mode ?? "normal",
          params: paramsToJson({ ...params, targetBankPaise: null }),
          remainingBudgetPaise: bank - (row?.minBankFloorPaise ?? 0n),
          targetDeltaPaise: params.targetBankPaise === null ? null : params.targetBankPaise - bank };
      }),
      budget: { revision: budget?.updatedAt.toISOString() ?? "default", mode: budget?.mode ?? "per_game",
        amountPaise: budget?.mode === "combined" ? combinedBank - budget.floorPaise : budget?.floorPaise ?? 0n },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
