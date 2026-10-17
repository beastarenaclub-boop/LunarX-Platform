import { Router, type IRouter } from "express";
import {
  db,
  paymentRequestsTable,
  withdrawalsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getPaymentProvider } from "../services/payment-gateway";
import { postEntry, publishWalletBalance, toWalletScope } from "../services/wallet";
import { bus } from "../realtime/eventBus";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/payment", async (req, res): Promise<void> => {
  try {
    const provider = getPaymentProvider();
    const rawBody =
      (req as unknown as Record<string, unknown>).rawBody as string | undefined ??
      (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    const payload = await provider.verifyWebhook({
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: rawBody,
    });

    if (payload.type === "deposit") {
      const rows = await db
        .select()
        .from(paymentRequestsTable)
        .where(eq(paymentRequestsTable.gatewayOrderId, payload.gatewayOrderId))
        .limit(1);
      const dep = rows[0];

      if (!dep) {
        logger.warn({ gatewayOrderId: payload.gatewayOrderId }, "Deposit webhook: no matching request");
        res.json({ ok: true });
        return;
      }

      if (dep.status === "approved" || dep.status === "cancelled") {
        res.json({ ok: true });
        return;
      }

      if (payload.status === "paid") {
        // Capture the post-credit balance from inside the tx so we can push
        // it on the wallet topic AFTER the transaction commits. We must not
        // publish from inside the tx because a rollback would otherwise leak
        // a balance the depositor never actually received.
        const credited = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(paymentRequestsTable)
            .set({
              status: "approved",
              gatewayStatus: payload.status,
              gatewayRaw: JSON.stringify(payload.raw),
              processedAt: new Date(),
            })
            .where(
              and(
                eq(paymentRequestsTable.id, dep.id),
                eq(paymentRequestsTable.status, dep.status),
              ),
            )
            .returning();

          if (!updated) return null;

          const { entry } = await postEntry({
            userId: dep.userId,
            type: "deposit",
            amount: dep.amount,
            scope: toWalletScope(dep.game),
            memo: `Gateway deposit ${dep.id} confirmed`,
            refType: "payment_request",
            refId: dep.id,
            enforceNonNegative: false,
          }, tx);

          await tx
            .update(paymentRequestsTable)
            .set({ ledgerEntryId: entry.id })
            .where(eq(paymentRequestsTable.id, dep.id));

          return { balanceAfter: entry.balanceAfter };
        });

        if (credited) {
          publishWalletBalance({
            userId: dep.userId,
            scope: toWalletScope(dep.game),
            balance: credited.balanceAfter,
            entryType: "deposit",
            amount: dep.amount,
          });
          try {
            bus.publish({
              topic: "admin:metrics",
              type: "bump",
              reason: "deposit_decided",
              ts: Date.now(),
            });
          } catch {
            // best-effort
          }
        }

        await recordAudit({
          action: "payment.deposit_gateway_confirmed",
          targetType: "payment_request",
          targetId: dep.id,
          after: {
            status: "approved",
            amount: dep.amount.toString(),
            gatewayOrderId: payload.gatewayOrderId,
            utr: payload.utr,
            // Reconciliation needs to know what was actually bought and which
            // per-game wallet it credited. Legacy rows carry nulls here.
            game: dep.game,
            packageSku: dep.packageSku ?? null,
            coinQuantity: dep.coinQuantity ?? null,
          },
        });
      } else if (
        payload.status === "failed" ||
        payload.status === "expired"
      ) {
        const [updated] = await db
          .update(paymentRequestsTable)
          .set({
            status: "cancelled",
            gatewayStatus: payload.status,
            gatewayRaw: JSON.stringify(payload.raw),
            rejectionReason: `Gateway: ${payload.status}`,
          })
          .where(
            and(
              eq(paymentRequestsTable.id, dep.id),
              eq(paymentRequestsTable.status, dep.status),
            ),
          )
          .returning();

        if (updated) {
          await recordAudit({
            action: "payment.deposit_gateway_failed",
            targetType: "payment_request",
            targetId: dep.id,
            after: {
              status: "cancelled",
              gatewayStatus: payload.status,
            },
          });
        }
      } else {
        await db
          .update(paymentRequestsTable)
          .set({
            gatewayStatus: payload.status,
            gatewayRaw: JSON.stringify(payload.raw),
          })
          .where(eq(paymentRequestsTable.id, dep.id));
      }
    } else if (payload.type === "payout") {
      const rows = await db
        .select()
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.gatewayPayoutId, payload.gatewayOrderId))
        .limit(1);
      const wd = rows[0];

      if (!wd) {
        logger.warn({ gatewayOrderId: payload.gatewayOrderId }, "Payout webhook: no matching withdrawal");
        res.json({ ok: true });
        return;
      }

      if (wd.status === "paid" || wd.status === "failed") {
        res.json({ ok: true });
        return;
      }

      if (payload.status === "completed") {
        const [updated] = await db
          .update(withdrawalsTable)
          .set({
            status: "paid",
            gatewayStatus: payload.status,
            utr: payload.utr ?? null,
            paidAt: new Date(),
          })
          .where(
            and(
              eq(withdrawalsTable.id, wd.id),
              eq(withdrawalsTable.status, wd.status),
            ),
          )
          .returning();

        if (updated) {
          try {
            bus.publish({
              topic: "withdrawals:admin",
              type: "decided",
              id: wd.id,
              userId: wd.userId,
              amount: wd.amount.toString(),
              status: "paid",
              ts: Date.now(),
            });
            bus.publish({
              topic: "admin:metrics",
              type: "bump",
              reason: "withdrawal_decided",
              ts: Date.now(),
            });
          } catch {
            // best-effort
          }
          await recordAudit({
            action: "payment.payout_gateway_confirmed",
            targetType: "withdrawal",
            targetId: wd.id,
            after: {
              status: "paid",
              amount: wd.amount.toString(),
              utr: payload.utr,
            },
          });
        }
      } else if (
        payload.status === "failed" ||
        payload.status === "reversed"
      ) {
        const refunded = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(withdrawalsTable)
            .set({
              status: "pending",
              gatewayStatus: payload.status,
              gatewayPayoutId: null,
              rejectionReason: `Gateway payout ${payload.status} — requeued`,
              reviewedBy: null,
              reviewedAt: null,
            })
            .where(
              and(
                eq(withdrawalsTable.id, wd.id),
                eq(withdrawalsTable.status, wd.status),
              ),
            )
            .returning();

          if (!updated) return null;

          const { entry } = await postEntry({
            userId: wd.userId,
            type: "refund",
            amount: wd.amount,
            scope: "lunar",
            memo: `Payout ${wd.id} ${payload.status} — refund & requeue`,
            refType: "withdrawal",
            refId: wd.id,
            enforceNonNegative: false,
          }, tx);

          return { balanceAfter: entry.balanceAfter };
        });

        if (refunded) {
          publishWalletBalance({
            userId: wd.userId,
            scope: "lunar",
            balance: refunded.balanceAfter,
            entryType: "refund",
            amount: wd.amount,
          });
          try {
            bus.publish({
              topic: "withdrawals:admin",
              type: "decided",
              id: wd.id,
              userId: wd.userId,
              amount: wd.amount.toString(),
              status: "pending",
              ts: Date.now(),
            });
            bus.publish({
              topic: "admin:metrics",
              type: "bump",
              reason: "withdrawal_decided",
              ts: Date.now(),
            });
          } catch {
            // best-effort
          }
        }

        await recordAudit({
          action: "payment.payout_gateway_failed",
          targetType: "withdrawal",
          targetId: wd.id,
          after: {
            status: "pending",
            gatewayStatus: payload.status,
            refunded: true,
            requeued: true,
          },
        });
      } else {
        await db
          .update(withdrawalsTable)
          .set({ gatewayStatus: payload.status })
          .where(eq(withdrawalsTable.id, wd.id));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Webhook processing error");
    res.status(400).json({ ok: false, error: "Invalid webhook" });
  }
});

export default router;
