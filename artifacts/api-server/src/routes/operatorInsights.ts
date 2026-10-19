import { Router } from "express";
import { db } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import {
  insightFilter,
  insightRange,
} from "../services/operatorInsightFilters";
import {
  insightScope,
  livePlayers,
  accountReport,
  accountLedger,
  commissionEntries,
  bettingReport,
  bettingEntries,
  bettingEvidence,
} from "../services/operatorInsights";
import {
  exportInsights,
  type ReportSheet,
} from "../services/operatorInsightExport";
import { recordAuditFromReq } from "../lib/audit";

export const operatorInsightsRouter = Router();
export const adminBettingInsightsRouter = Router();
// Enforce on the server, including exports and direct URLs.
adminBettingInsightsRouter.use(requireRole("admin", "super_admin"));
operatorInsightsRouter.get("/live", async (req, res, next) => {
  try {
    const filter = insightFilter.parse(req.query);
    res
      .set("Cache-Control", "no-store")
      .json(await livePlayers(await insightScope(req.user!, filter), filter));
  } catch (error) {
    next(error);
  }
});
for (const [router, mode] of [
  [operatorInsightsRouter, "accounts"],
  [adminBettingInsightsRouter, "bets"],
] as const) {
  router.get(
    mode === "accounts" ? "/accounts" : "/",
    async (req, res, next) => {
      try {
        const filter = insightFilter.parse(req.query);
        const range = insightRange(filter);
        const scope = await insightScope(req.user!, filter);
        const exporting = !!filter.format;
        const result = await db.transaction(
          async (tx) => {
            const report =
              mode === "accounts"
                ? await accountReport(tx, scope, filter, exporting)
                : await bettingReport(tx, scope, filter, exporting);
            const entries =
              mode === "accounts"
                ? await accountLedger(tx, scope, filter, exporting)
                : await bettingEntries(tx, scope, filter, exporting);
            const evidence =
              mode === "bets" ? await bettingEvidence(tx, scope, filter) : [];
            const commissions =
              exporting && mode === "accounts"
                ? await commissionEntries(tx, scope, filter)
                : [];
            return { ...report, entries, evidence, commissions };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        );
        res.set("Cache-Control", "no-store");
        if (!filter.format) {
          res.json(result);
          return;
        }
        const sheets: ReportSheet[] = [
          {
            name: "Report details",
            rows: [
              {
                generated_at: result.generatedAt,
                from: range.from,
                to: range.to,
                timezone: range.timezone,
                role: scope.actor.role,
                channel: scope.channel,
                filters: filter,
                note:
                  mode === "accounts"
                    ? "Opening + credits - debits = closing. Cash and commission ledgers are separate. All wallet scopes included. Balance checks group equal timestamps; no records are changed."
                    : "Placed-date cohort. Pending and voided bets excluded from settled profit. Review signals are not proof of cheating. Existing flags are current, irrespective of date filters.",
              },
            ],
          },
          { name: "Totals", rows: [result.totals] },
          {
            name: mode === "accounts" ? "Wallet tally" : "Player rankings",
            rows: result.items.map((row) =>
              mode === "accounts"
                ? Object.fromEntries(
                    Object.entries(row).map(([key, value]) => [
                      key === "wins" ? "wins_amount" : key,
                      value,
                    ]),
                  )
                : row,
            ),
          },
          {
            name: mode === "accounts" ? "Wallet ledger" : "Bets",
            rows: result.entries.items,
          },
          {
            name: mode === "accounts" ? "Commission ledger" : "Review evidence",
            rows: mode === "accounts" ? result.commissions : result.evidence,
          },
        ];
        const buffer = await exportInsights(filter.format, sheets);
        await recordAuditFromReq(req, {
          action: `reports.${mode}.export`,
          targetType: "report",
          after: {
            filter,
            rows: result.items.length,
            entries: result.entries.total,
          },
        });
        res
          .type(
            filter.format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/pdf",
          )
          .attachment(
            `lunarx-${mode}-${range.from}-${range.to}.${filter.format}`,
          )
          .send(buffer);
      } catch (error) {
        next(error);
      }
    },
  );
}
