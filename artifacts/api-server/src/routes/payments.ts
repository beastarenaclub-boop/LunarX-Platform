import { Router, type IRouter } from "express";
import {
  db,
  kycSubmissionsTable,
  paymentRequestsTable,
  walletsTable,
  walletLedgerTable,
  upiAccountsTable,
} from "@workspace/db";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {paymentHistory,paymentHistoryCsv} from '../services/paymentHistory';
import {
  createPaymentRequest,
  listPaymentRequests,
  getDepositSettings,
  getWithdrawLimits,
} from "../services/payments";
import { paymentRequest, publicUpiAccount } from "../lib/serialize";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { recordAudit, recordAuditFromReq } from "../lib/audit";
import { createNotification } from "../services/notifications";
import { publishWalletBalance, toWalletScope } from "../services/wallet";
import { listCoinPacks, resolveCoinPack, serializeCoinPack } from "../services/coinPacks";
import { bus } from "../realtime/eventBus";
import { writeAppLog } from "../services/appLog";
import { readUpiQrObject } from "../services/upiQrStorage";
import { getPaymentProvider } from "../services/payment-gateway";
import { applyDepositBonus } from "../services/promotions";
import { logger } from "../lib/logger";
import { z } from "zod";
import { createMasterDeposit, playerCollectionAccounts } from "../services/masterManualPayments";

const router: IRouter = Router();

const AmountStr = z
  .string()
  .regex(/^\d{1,18}$/u, "amount must be a positive integer string in paise");

// Which per-game wallet a deposit/withdraw targets. Each game's wallet is
// fully separate — money deposited to one game never appears in another.
const GameScope = z
  .enum([
    "lunar",
    "mines",
    "plinko",
    "dice",
    "aviator",
    "jetx",
    "fury",
    "horse-racing",
  "bike-racing",
    "roulette",
    "baccarat",
    "blackjack",
    "teen-patti",
    "teen-patti-live",
    "sic-bo",
    "andar-bahar",
    "lucky-7",
    "lucky-7-live",
  "wheel-2-live", "teen-patti-joker",
  ])
  .default("lunar");

// Optional coin-pack identity. The client picks a pack and echoes its SKU (and
// optionally the coin count); the server re-derives the price from its own
// catalog and rejects anything that does not line up. A missing SKU means a
// custom amount, which stays allowed.
const PackageSku = z.string().min(3).max(64).optional();
const CoinQuantity = z.number().int().positive().max(10_000_000).optional();

const ManualDepositInput = z.object({
  amount: AmountStr,
  upiRef: z.string().trim().min(4).max(64),
  notes: z.string().max(200).optional(),
  game: GameScope,
  packageSku: PackageSku,
  coinQuantity: CoinQuantity,
  accountId: z.string().min(1).max(100).optional(),
  accountVersion: z.number().int().positive().optional(),
});

const AutoDepositInput = z.object({
  amount: AmountStr,
  notes: z.string().max(200).optional(),
  game: GameScope,
  packageSku: PackageSku,
  coinQuantity: CoinQuantity,
});

const WithdrawInput = z.object({
  amount: AmountStr,
  upiId: z.string().min(4).max(64),
  notes: z.string().max(200).optional(),
  game: GameScope,
});

router.get('/history',requireAuth,async(req,res,next)=>{
  try{
    const result=await paymentHistory(req.user!,req.query,true);
    res.set('Cache-Control','no-store');
    if(result.format==='csv')res.type('text/csv').attachment('my-payment-history.csv').send(paymentHistoryCsv(result.items,true));
    else res.json(result);
  }catch(e){next(e);}
});

router.get("/deposit-limits", requireAuth, async (_req, res, next) => {
  try {
    const settings = await getDepositSettings();
    res.json({
      minAmountPaise: settings.minAmountPaise.toString(),
      maxAmountPaise: settings.maxAmountPaise.toString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/deposit-settings", requireAuth, async (req, res, next) => {
  try {
    const settings = await getDepositSettings();
    res.json({
      manualEnabled: settings.manualEnabled,
      autoEnabled: req.user!.channel === "b2b" ? false : settings.autoEnabled,
      minAmountPaise: settings.minAmountPaise.toString(),
      maxAmountPaise: settings.maxAmountPaise.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// Server-owned coin-pack catalog for one game. Ten fixed packs; the client
// never invents a price, it selects a SKU and the server prices it.
router.get("/coin-packs", requireAuth, async (req, res, next) => {
  try {
    const game = GameScope.parse(req.query.game ?? undefined);
    res.json(listCoinPacks(game).map(serializeCoinPack));
  } catch (err) {
    next(err);
  }
});

router.get("/deposits", requireAuth, async (req, res, next) => {
  try {
    const rows = await listPaymentRequests(req.user!.id, "deposit");
    res.json(rows.map(paymentRequest));
  } catch (err) {
    next(err);
  }
});

router.post("/deposits", requireAuth, async (req, res, next) => {
  try {
    const settings = await getDepositSettings();
    if (!settings.manualEnabled) {
      throw forbidden("Manual deposits are currently disabled");
    }
    const input = ManualDepositInput.parse(req.body);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("Amount must be greater than zero");
    if (amount < settings.minAmountPaise) {
      throw badRequest(
        `Minimum deposit is ₹${(Number(settings.minAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }
    if (amount > settings.maxAmountPaise) {
      throw badRequest(
        `Maximum deposit is ₹${(Number(settings.maxAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }
    // Coin-pack purchases must match the catalog exactly; the submitted price
    // is only ever compared against the server-owned one, never trusted.
    const pack = resolveCoinPack({
      sku: input.packageSku,
      game: input.game,
      amount,
      coinQuantity: input.coinQuantity,
    });
    const requestInput = {
      userId: req.user!.id,
      kind: "deposit" as const,
      method: "manual" as const,
      amount,
      game: input.game,
      upiRef: input.upiRef,
      notes: input.notes ?? null,
      packageSku: pack?.sku ?? null,
      coinQuantity: pack?.coins ?? null,
    };
    const created = req.user!.channel === "b2b"
      ? await createMasterDeposit(req.user!, requestInput, input.accountId, input.accountVersion)
      : await createPaymentRequest(requestInput);
    await recordAuditFromReq(req, {
      action: "payment.deposit_request",
      targetType: "payment_request",
      targetId: created.id,
      after: {
        amount: amount.toString(),
        upiRef: input.upiRef,
        method: "manual",
        game: input.game,
        packageSku: pack?.sku ?? null,
        coinQuantity: pack?.coins ?? null,
      },
    });
    res.json(paymentRequest(created));
  } catch (err) {
    next(err);
  }
});

router.post("/deposits/auto", requireAuth, async (req, res, next) => {
  try {
    if (req.user!.channel === "b2b") throw forbidden("Use your website's manual payment option");
    const settings = await getDepositSettings();
    if (!settings.autoEnabled) {
      throw forbidden("Automatic deposits are currently disabled");
    }
    const input = AutoDepositInput.parse(req.body);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("Amount must be greater than zero");
    if (amount < settings.minAmountPaise) {
      throw badRequest(
        `Minimum deposit is ₹${(Number(settings.minAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }
    if (amount > settings.maxAmountPaise) {
      throw badRequest(
        `Maximum deposit is ₹${(Number(settings.maxAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }

    const pack = resolveCoinPack({
      sku: input.packageSku,
      game: input.game,
      amount,
      coinQuantity: input.coinQuantity,
    });

    // Reserve a payment id locally so the gateway order is associated up-front.
    const paymentId = nanoid();

    // Call the gateway BEFORE persisting the request. This guarantees we never
    // leave an orphan pending row in payment_requests if the provider call
    // fails (network/config/etc).
    const provider = getPaymentProvider();
    let order;
    try {
      order = await provider.createDepositOrder({
        orderId: paymentId,
        amount,
        currency: "INR",
        game: input.game,
        packageSku: pack?.sku ?? null,
        coinQuantity: pack?.coins ?? null,
      });
    } catch (gatewayErr) {
      logger.error(
        { err: gatewayErr, userId: req.user!.id },
        "Auto-deposit gateway createDepositOrder failed",
      );
      throw badRequest(
        "Could not initiate the gateway payment. Please try again or use the manual UPI flow.",
      );
    }

    // Now persist with the gateway order already linked, in gateway_pending
    // state to make the lifecycle clear to admins/players.
    const [created] = await db
      .insert(paymentRequestsTable)
      .values({
        id: paymentId,
        userId: req.user!.id,
        kind: "deposit",
        method: "auto",
        amount,
        game: input.game,
        packageSku: pack?.sku ?? null,
        coinQuantity: pack?.coins ?? null,
        notes: input.notes ?? null,
        status: "gateway_pending",
        gatewayOrderId: order.gatewayOrderId,
        gatewayStatus: order.status,
      })
      .returning();

    await recordAuditFromReq(req, {
      action: "payment.deposit_request_auto",
      targetType: "payment_request",
      targetId: paymentId,
      after: {
        amount: amount.toString(),
        method: "auto",
        gatewayOrderId: order.gatewayOrderId,
        game: input.game,
        packageSku: pack?.sku ?? null,
        coinQuantity: pack?.coins ?? null,
      },
    });

    res.json({
      ...paymentRequest(created!),
      upiDeepLink: order.upiDeepLink ?? null,
      qrData: order.qrData ?? null,
      gatewayOrderId: order.gatewayOrderId,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/upi-accounts", requireAuth, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const branchAccounts = await playerCollectionAccounts(req.user!);
    if (branchAccounts !== null) { res.json(branchAccounts); return; }
    const rows = await db
      .select()
      .from(upiAccountsTable)
      .where(eq(upiAccountsTable.active, true))
      .orderBy(asc(upiAccountsTable.sortOrder), asc(upiAccountsTable.createdAt));
    res.json(rows.map(publicUpiAccount));
  } catch (err) {
    next(err);
  }
});

router.get(
  "/upi-accounts/qr/:prefix/:name",
  requireAuth,
  async (req, res, next) => {
    try {
      const key = `${req.params.prefix}/${req.params.name}`;
      const obj = await readUpiQrObject(key);
      if (!obj) throw notFound("QR image not found");
      res.setHeader("Content-Type", obj.contentType);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(obj.body);
    } catch (err) {
      next(err);
    }
  },
);

function getGatewaySecret(): string | null {
  const secret = process.env["GATEWAY_WEBHOOK_SECRET"];
  if (secret) return secret;
  if (process.env["NODE_ENV"] === "development") return "stub-secret";
  return null;
}

const GatewayWebhookBody = z.object({
  paymentId: z.string().min(1),
  status: z.enum(["success", "failed"]),
  gatewayRef: z.string().min(1),
  signature: z.string().min(1),
});

router.post("/gateway-webhook", async (req, res, next) => {
  try {
    const secret = getGatewaySecret();
    if (!secret) {
      logger.warn("Gateway webhook called but GATEWAY_WEBHOOK_SECRET not configured; auto deposits disabled");
      res.status(503).json({
        error: { code: "GATEWAY_DISABLED", message: "Auto deposits gateway not configured" },
      });
      return;
    }
    const body = GatewayWebhookBody.parse(req.body);

    const expectedSig = Buffer.from(
      `${body.paymentId}:${body.status}:${secret}`,
    ).toString("base64");
    if (body.signature !== expectedSig) {
      logger.warn({ paymentId: body.paymentId }, "Gateway webhook: invalid signature");
      res.status(401).json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });
      return;
    }

    if (body.status !== "success") {
      const [transitioned] = await db
        .update(paymentRequestsTable)
        .set({
          status: "rejected",
          rejectionReason: "Gateway payment failed",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(paymentRequestsTable.id, body.paymentId),
            eq(paymentRequestsTable.kind, "deposit"),
            eq(paymentRequestsTable.method, "auto"),
            sql`${paymentRequestsTable.status} IN ('pending','gateway_pending')`,
          ),
        )
        .returning();

      if (transitioned) {
        await recordAudit({
          actorId: null,
          actorRole: null,
          action: "payment.gateway_webhook_reject",
          targetType: "payment_request",
          targetId: transitioned.id,
          after: { status: "rejected", gatewayRef: body.gatewayRef },
        });
        await createNotification({
          userId: transitioned.userId,
          type: "deposit_rejected",
          title: "Deposit Rejected",
          message: `Your auto-deposit of ${transitioned.amount.toString()} was rejected by the payment gateway.`,
          linkUrl: "/wallet",
        });
        await writeAppLog({
          kind: "payment",
          message: `Auto-deposit ${transitioned.id} rejected via gateway`,
        });
      }

      res.json({ received: true });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(paymentRequestsTable)
        .where(
          and(
            eq(paymentRequestsTable.id, body.paymentId),
            eq(paymentRequestsTable.kind, "deposit"),
            eq(paymentRequestsTable.method, "auto"),
          ),
        )
        .for("update")
        .limit(1);
      const dep = rows[0];
      if (!dep) return null;
      if (dep.status !== "pending" && dep.status !== "gateway_pending") {
        return null;
      }

      // Credit the wallet SCOPE this deposit targeted (per-game wallets).
      // Without the scope filter, an arbitrary wallet row could be credited.
      const depScope = toWalletScope(dep.game ?? "lunar");
      const walletRows = await tx
        .select()
        .from(walletsTable)
        .where(
          and(
            eq(walletsTable.userId, dep.userId),
            eq(walletsTable.currency, "INR"),
            eq(walletsTable.scope, depScope),
          ),
        )
        .for("update")
        .limit(1);
      let wallet = walletRows[0];
      if (!wallet) {
        const [created] = await tx
          .insert(walletsTable)
          .values({ userId: dep.userId, currency: "INR", scope: depScope })
          .onConflictDoNothing({
            target: [
              walletsTable.userId,
              walletsTable.currency,
              walletsTable.scope,
            ],
          })
          .returning();
        wallet =
          created ??
          (
            await tx
              .select()
              .from(walletsTable)
              .where(
                and(
                  eq(walletsTable.userId, dep.userId),
                  eq(walletsTable.currency, "INR"),
                  eq(walletsTable.scope, depScope),
                ),
              )
              .limit(1)
          )[0]!;
      }

      const sumRows = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${walletLedgerTable.amount}), 0)::text`,
        })
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.walletId, wallet.id));
      const current = BigInt(sumRows[0]?.total ?? "0");
      const next = current + dep.amount;

      const [entry] = await tx
        .insert(walletLedgerTable)
        .values({
          walletId: wallet.id,
          userId: dep.userId,
          type: "deposit" as const,
          amount: dep.amount,
          balanceAfter: next,
          refType: "deposit",
          refId: dep.id,
          memo: `Auto-deposit ${dep.id} via gateway`,
        })
        .returning();

      const [updated] = await tx
        .update(paymentRequestsTable)
        .set({
          status: "approved",
          processedAt: new Date(),
          ledgerEntryId: entry!.id,
          upiRef: body.gatewayRef,
        })
        .where(eq(paymentRequestsTable.id, dep.id))
        .returning();

      return { dep, updated: updated!, balanceAfter: next };
    });

    if (result) {
      // Post-commit: push the new balance to the depositor's open WS sessions
      // so their wallet UI updates immediately on auto-gateway credits, just
      // like the manual admin-approval path does.
      publishWalletBalance({
        userId: result.dep.userId,
        scope: toWalletScope(result.dep.game ?? "lunar"),
        balance: result.balanceAfter,
        entryType: "deposit",
        amount: result.dep.amount,
      });
      try {
        await applyDepositBonus({
          paymentRequestId: result.dep.id,
          userId: result.dep.userId,
          amountPaise: result.dep.amount,
        });
      } catch (e) {
        // best-effort
      }
      await recordAudit({
        actorId: null,
        actorRole: null,
        action: "payment.gateway_webhook_approve",
        targetType: "payment_request",
        targetId: result.dep.id,
        after: {
          status: "approved",
          gatewayRef: body.gatewayRef,
          amount: result.dep.amount.toString(),
          userId: result.dep.userId,
          // What was bought, and into which per-game wallet. Null for legacy
          // rows and custom (non-pack) amounts.
          game: result.dep.game,
          packageSku: result.dep.packageSku ?? null,
          coinQuantity: result.dep.coinQuantity ?? null,
        },
      });
      await createNotification({
        userId: result.dep.userId,
        type: "deposit_approved",
        title: "Deposit Approved",
        message: `Your deposit of ${result.dep.amount.toString()} has been automatically approved and credited.`,
        linkUrl: "/wallet",
      });
      await writeAppLog({
        kind: "payment",
        message: `Auto-deposit ${result.dep.id} credited via gateway`,
      });
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/deposits/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(paymentRequestsTable)
        .where(
          and(
            eq(paymentRequestsTable.id, id),
            eq(paymentRequestsTable.kind, "deposit"),
          ),
        )
        .for("update")
        .limit(1);
      const dep = rows[0];
      if (!dep) throw notFound("Deposit request not found");
      if (dep.userId !== req.user!.id) {
        throw forbidden("You can only cancel your own deposit requests");
      }
      if (dep.status !== "pending" && dep.status !== "gateway_pending") {
        throw badRequest(
          `Cannot cancel a deposit that is already ${dep.status}`,
        );
      }
      const [next] = await tx
        .update(paymentRequestsTable)
        .set({ status: "cancelled", processedAt: new Date() })
        .where(eq(paymentRequestsTable.id, id))
        .returning();
      return { before: dep, after: next! };
    });

    await recordAuditFromReq(req, {
      action: "payment.deposit_cancel",
      targetType: "payment_request",
      targetId: id,
      before: { status: updated.before.status },
      after: { status: "cancelled" },
    });
    await writeAppLog({
      kind: "payment",
      message: `Player ${req.user!.id} cancelled deposit ${id}`,
    });

    res.json(paymentRequest(updated.after));
  } catch (err) {
    next(err);
  }
});

router.get("/withdrawals", requireAuth, async (req, res, next) => {
  try {
    const rows = await listPaymentRequests(req.user!.id, "withdraw");
    res.json(rows.map(paymentRequest));
  } catch (err) {
    next(err);
  }
});

router.delete("/withdrawals/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(paymentRequestsTable)
        .where(
          and(
            eq(paymentRequestsTable.id, id),
            eq(paymentRequestsTable.kind, "withdraw"),
          ),
        )
        .for("update")
        .limit(1);
      const wd = rows[0];
      if (!wd) throw notFound("Withdrawal request not found");
      if (wd.userId !== req.user!.id) {
        throw forbidden("You can only cancel your own withdrawal requests");
      }
      if (wd.status !== "pending") {
        throw badRequest(
          `Cannot cancel a withdrawal that is already ${wd.status}`,
        );
      }
      const [next] = await tx
        .update(paymentRequestsTable)
        .set({ status: "cancelled", processedAt: new Date() })
        .where(eq(paymentRequestsTable.id, id))
        .returning();
      return { before: wd, after: next! };
    });

    await recordAuditFromReq(req, {
      action: "payment.withdraw_cancel",
      targetType: "payment_request",
      targetId: id,
      before: { status: updated.before.status },
      after: { status: "cancelled" },
    });
    await writeAppLog({
      kind: "payment",
      message: `Player ${req.user!.id} cancelled withdrawal ${id}`,
    });

    res.json(paymentRequest(updated.after));
  } catch (err) {
    next(err);
  }
});

router.get("/withdraw-limits", requireAuth, async (_req, res, next) => {
  try {
    const limits = await getWithdrawLimits();
    res.json({
      minAmountPaise: limits.minAmountPaise.toString(),
      maxAmountPaise: limits.maxAmountPaise.toString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/withdrawals", requireAuth, async (req, res, next) => {
  try {
    const input = WithdrawInput.parse(req.body);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("Amount must be greater than zero");
    const limits = await getWithdrawLimits();
    if (amount < limits.minAmountPaise) {
      throw badRequest(
        `Minimum withdrawal is ₹${(Number(limits.minAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }
    if (amount > limits.maxAmountPaise) {
      throw badRequest(
        `Maximum withdrawal is ₹${(Number(limits.maxAmountPaise) / 100).toLocaleString("en-IN")}`,
      );
    }

    // Enforce KYC approved.
    const kycRows = await db
      .select()
      .from(kycSubmissionsTable)
      .where(eq(kycSubmissionsTable.userId, req.user!.id))
      .orderBy(desc(kycSubmissionsTable.submittedAt))
      .limit(1);
    const latestKyc = kycRows[0];
    if (!latestKyc || latestKyc.status !== "approved") {
      throw forbidden("KYC must be approved before requesting a withdrawal");
    }

    // Enforce daily caps and create the withdrawal atomically. We use
    // transaction-scoped pg advisory locks to serialize concurrent
    // requests so two simultaneous calls cannot both pass the cap check
    // and overshoot the limit. The per-user lock keys off a stable hash
    // of the user id; the platform lock uses a fixed namespace key.
    // Statuses counted against caps: pending + approved (committed but
    // not yet rejected/cancelled/failed/paid-out-and-finalized).
    const PLATFORM_LOCK_KEY = 781234001; // arbitrary stable namespace
    const created = await db.transaction(async (tx) => {
      if (limits.dailyPlatformPaise > 0n) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLATFORM_LOCK_KEY})`);
      }
      if (limits.dailyPerUserPaise > 0n) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${req.user!.id}))`,
        );
      }

      if (limits.dailyPerUserPaise > 0n || limits.dailyPlatformPaise > 0n) {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const committedStatuses = sql`${paymentRequestsTable.status} IN ('pending','approved')`;

        if (limits.dailyPerUserPaise > 0n) {
          const userSumRows = await tx
            .select({
              total: sql<string>`COALESCE(SUM(${paymentRequestsTable.amount}), 0)::text`,
            })
            .from(paymentRequestsTable)
            .where(
              and(
                eq(paymentRequestsTable.userId, req.user!.id),
                eq(paymentRequestsTable.kind, "withdraw"),
                committedStatuses,
                sql`${paymentRequestsTable.createdAt} >= ${dayStart}`,
              ),
            );
          const userToday = BigInt(userSumRows[0]?.total ?? "0");
          if (userToday + amount > limits.dailyPerUserPaise) {
            const remaining = limits.dailyPerUserPaise - userToday;
            const cap = (Number(limits.dailyPerUserPaise) / 100).toLocaleString("en-IN");
            if (remaining <= 0n) {
              throw badRequest(
                `You have reached your daily withdrawal cap of ₹${cap}. Please try again tomorrow.`,
              );
            }
            throw badRequest(
              `This withdrawal would exceed your daily cap of ₹${cap}. You can withdraw up to ₹${(Number(remaining) / 100).toLocaleString("en-IN")} more today.`,
            );
          }
        }

        if (limits.dailyPlatformPaise > 0n) {
          const platformSumRows = await tx
            .select({
              total: sql<string>`COALESCE(SUM(${paymentRequestsTable.amount}), 0)::text`,
            })
            .from(paymentRequestsTable)
            .where(
              and(
                eq(paymentRequestsTable.kind, "withdraw"),
                committedStatuses,
                sql`${paymentRequestsTable.createdAt} >= ${dayStart}`,
              ),
            );
          const platformToday = BigInt(platformSumRows[0]?.total ?? "0");
          if (platformToday + amount > limits.dailyPlatformPaise) {
            throw badRequest(
              "The platform has reached today's payout cap. Please try again later or contact support.",
            );
          }
        }
      }

      const [row] = await tx
        .insert(paymentRequestsTable)
        .values({
          userId: req.user!.id,
          kind: "withdraw",
          method: "manual",
          amount,
          upiId: input.upiId,
          notes: input.notes ?? null,
          status: "pending",
        })
        .returning();
      return row!;
    });
    // Post-commit: notify the operator console in real time so the
    // withdrawals queue and admin dashboard counters update immediately.
    try {
      bus.publish({
        topic: "withdrawals:admin",
        type: "created",
        id: created.id,
        userId: created.userId,
        amount: created.amount.toString(),
        status: "pending",
        ts: Date.now(),
      });
      bus.publish({
        topic: "admin:metrics",
        type: "bump",
        reason: "withdrawal_created",
        ts: Date.now(),
      });
    } catch {
      // best-effort
    }
    await recordAuditFromReq(req, {
      action: "payment.withdraw_request",
      targetType: "payment_request",
      targetId: created.id,
      after: { amount: amount.toString(), upiId: input.upiId },
    });
    res.json(paymentRequest(created));
  } catch (err) {
    next(err);
  }
});

export default router;
