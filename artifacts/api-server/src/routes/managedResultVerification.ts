import { Router } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, tableRoundsTable, tableRoundBetsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { HttpError } from "../lib/errors";

// Existing seed-proof routes remain accurate for natural draws. A selected
// result has an operator decision record, not a seed-only fairness proof.
const router = Router();
router.get("/:game/:id/verify", requireAuth, async (req, _res, next) => {
  try {
    const [row] = await db
      .select({ source: tableRoundsTable.resultSource })
      .from(tableRoundBetsTable)
      .innerJoin(
        tableRoundsTable,
        eq(tableRoundsTable.id, tableRoundBetsTable.roundId),
      )
      .where(
        and(
          eq(tableRoundBetsTable.userId, req.user!.id),
          eq(tableRoundBetsTable.gameCode, String(req.params.game)),
          or(
            eq(tableRoundBetsTable.auditRoundId, String(req.params.id)),
            eq(tableRoundBetsTable.roundId, String(req.params.id)),
          ),
        ),
      )
      .limit(1);
    if (row && row.source !== "drawn")
      return next(
        new HttpError(
          409,
          "MANAGED_RESULT",
          "This round used a configured result engine. A seed-only fairness proof does not apply.",
          { resultSource: row.source },
        ),
      );
    next();
  } catch (e) {
    next(e);
  }
});
export default router;
