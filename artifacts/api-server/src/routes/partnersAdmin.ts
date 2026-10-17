import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, count } from "drizzle-orm";
import {
  db,
  partnersTable,
  partnerApiKeysTable,
  webhookDeliveriesTable,
  webhookDeliveryAttemptsTable,
  partnerRequestLogsTable,
  betsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { requireStepUp } from "../middlewares/stepUp";
import { recordAuditFromReq } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import {
  issueApiKey,
  generateWebhookSecret,
  ensurePartnerWallet,
  adjustPartnerWallet,
} from "../services/partners";
import {
  enqueueWebhook,
  replayDelivery,
} from "../services/webhookDispatcher";
import { issueLaunchToken } from "../services/launcherSession";

const router: IRouter = Router();
const adminOnly = requireRole("admin", "super_admin", "support");
const adminWrite = requireRole("admin", "super_admin");

router.get("/partners", adminOnly, async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(partnersTable)
      .orderBy(desc(partnersTable.createdAt));
    res.json({
      partners: rows.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        contactEmail: p.contactEmail,
        status: p.status,
        walletMode: p.walletMode,
        allowedGames: p.allowedGames,
        webhookUrl: p.webhookUrl,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const CreatePartnerBody = z.object({
  displayName: z.string().min(1).max(120),
  contactEmail: z.string().email().optional(),
  allowedGames: z.array(z.string()).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  walletMode: z.enum(["local-credits", "remote-wallet"]).optional(),
  status: z.enum(["active", "suspended", "disabled"]).optional(),
  webhookUrl: z.string().url().optional(),
  walletCallbackUrl: z.string().url().optional(),
  rtpOverrides: z.record(z.string(), z.number().min(0).max(1)).optional(),
});

router.post("/partners", adminWrite, requireStepUp, async (req, res, next) => {
  try {
    const input = CreatePartnerBody.parse(req.body);
    const webhookSecret = generateWebhookSecret();
    const [row] = await db
      .insert(partnersTable)
      .values({
        displayName: input.displayName,
        contactEmail: input.contactEmail ?? null,
        allowedGames: input.allowedGames ?? [],
        allowedOrigins: input.allowedOrigins ?? [],
        walletMode: input.walletMode ?? "local-credits",
        status: input.status ?? "active",
        webhookUrl: input.webhookUrl ?? null,
        webhookSecret,
        walletCallbackUrl: input.walletCallbackUrl ?? null,
        rtpOverrides: input.rtpOverrides ?? null,
      })
      .returning();
    await ensurePartnerWallet(row!.id);
    await recordAuditFromReq(req, {
      action: "partner.create",
      targetType: "partner",
      targetId: row!.id,
      after: { displayName: row!.displayName, walletMode: row!.walletMode },
    });
    res.json({
      id: row!.id,
      displayName: row!.displayName,
      walletMode: row!.walletMode,
      status: row!.status,
      webhookSecret,
    });
  } catch (err) {
    next(err);
  }
});

const UpdatePartnerBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  contactEmail: z.string().email().nullable().optional(),
  allowedGames: z.array(z.string()).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  walletMode: z.enum(["local-credits", "remote-wallet"]).optional(),
  status: z.enum(["active", "suspended", "disabled"]).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  walletCallbackUrl: z.string().url().nullable().optional(),
  rtpOverrides: z.record(z.string(), z.number().min(0).max(1)).nullable().optional(),
});

router.patch(
  "/partners/:id",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const input = UpdatePartnerBody.parse(req.body);
      const before = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, id))
        .limit(1);
      if (!before[0]) throw notFound("Partner not found");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(input) as (keyof typeof input)[]) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      const [updated] = await db
        .update(partnersTable)
        .set(patch)
        .where(eq(partnersTable.id, id))
        .returning();
      await recordAuditFromReq(req, {
        action: "partner.update",
        targetType: "partner",
        targetId: id,
        before: before[0],
        after: updated,
      });
      if (input.status === "suspended" && before[0].status !== "suspended") {
        void enqueueWebhook({
          partnerId: id,
          eventType: "partner.suspended",
          payload: { partnerId: id, suspendedAt: new Date().toISOString() },
          eventId: `partner.suspended.${id}.${Date.now()}`,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/partners/:id", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, id))
      .limit(1);
    if (!rows[0]) throw notFound("Partner not found");
    const wallet = await ensurePartnerWallet(id);
    const totalBetsRow = await db
      .select({ c: count() })
      .from(betsTable)
      .where(eq(betsTable.partnerId, id));
    res.json({
      partner: {
        ...rows[0],
        createdAt: rows[0].createdAt.toISOString(),
        updatedAt: rows[0].updatedAt.toISOString(),
      },
      walletBalance: wallet.balancePaise.toString(),
      totalBets: Number(totalBetsRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

const TopupBody = z.object({
  amountPaise: z.string().regex(/^-?\d{1,18}$/),
});
router.post(
  "/partners/:id/topup",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const input = TopupBody.parse(req.body);
      const delta = BigInt(input.amountPaise);
      const newBalance = await adjustPartnerWallet(id, delta);
      await recordAuditFromReq(req, {
        action: "partner.topup",
        targetType: "partner",
        targetId: id,
        after: { delta: delta.toString(), newBalance: newBalance.toString() },
      });
      res.json({ balance: newBalance.toString() });
    } catch (err) {
      next(err);
    }
  },
);

// API keys
router.get("/partners/:id/api-keys", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(partnerApiKeysTable)
      .where(eq(partnerApiKeysTable.partnerId, id))
      .orderBy(desc(partnerApiKeysTable.createdAt));
    res.json({
      keys: rows.map((k) => ({
        id: k.id,
        keyId: k.keyId,
        label: k.label,
        status: k.status,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const IssueKeyBody = z.object({ label: z.string().max(64).optional() });
router.post(
  "/partners/:id/api-keys",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const input = IssueKeyBody.parse(req.body ?? {});
      const partner = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, id))
        .limit(1);
      if (!partner[0]) throw notFound("Partner not found");
      const issued = await issueApiKey(id, input.label ?? null);
      await recordAuditFromReq(req, {
        action: "partner.api_key.issue",
        targetType: "partner_api_key",
        targetId: issued.apiKey.id,
        after: { keyId: issued.keyId },
      });
      res.json({
        id: issued.apiKey.id,
        keyId: issued.keyId,
        secret: issued.secret,
        label: issued.apiKey.label,
        warning: "Secret shown once — store it securely.",
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/partners/:id/api-keys/:keyId/revoke",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const partnerId = String(req.params.id);
      const keyId = String(req.params.keyId);
      const [updated] = await db
        .update(partnerApiKeysTable)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(partnerApiKeysTable.id, keyId),
            eq(partnerApiKeysTable.partnerId, partnerId),
          ),
        )
        .returning();
      if (!updated) throw notFound("API key not found");
      await recordAuditFromReq(req, {
        action: "partner.api_key.revoke",
        targetType: "partner_api_key",
        targetId: keyId,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/partners/:id/api-keys/:keyId/rotate",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const partnerId = String(req.params.id);
      const keyId = String(req.params.keyId);
      const [old] = await db
        .update(partnerApiKeysTable)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(partnerApiKeysTable.id, keyId),
            eq(partnerApiKeysTable.partnerId, partnerId),
          ),
        )
        .returning();
      if (!old) throw notFound("API key not found");
      const issued = await issueApiKey(partnerId, old.label);
      await recordAuditFromReq(req, {
        action: "partner.api_key.rotate",
        targetType: "partner_api_key",
        targetId: issued.apiKey.id,
        before: { keyId: old.keyId },
        after: { keyId: issued.keyId },
      });
      res.json({
        id: issued.apiKey.id,
        keyId: issued.keyId,
        secret: issued.secret,
        warning: "Secret shown once — store it securely.",
      });
    } catch (err) {
      next(err);
    }
  },
);

// Webhook deliveries — supports filter by eventType and status for log triage.
router.get("/partners/:id/webhooks", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
      500,
    );
    const conds = [eq(webhookDeliveriesTable.partnerId, id)];
    const eventType = req.query.eventType
      ? String(req.query.eventType)
      : null;
    const status = req.query.status ? String(req.query.status) : null;
    if (eventType) {
      conds.push(eq(webhookDeliveriesTable.eventType, eventType as never));
    }
    if (status) {
      conds.push(eq(webhookDeliveriesTable.status, status as never));
    }
    const rows = await db
      .select()
      .from(webhookDeliveriesTable)
      .where(and(...conds))
      .orderBy(desc(webhookDeliveriesTable.createdAt))
      .limit(limit);
    res.json({
      deliveries: rows.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
        lastResponseStatus: d.lastResponseStatus,
        lastResponseBody: d.lastResponseBody,
        nextAttemptAt: d.nextAttemptAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Single delivery + per-attempt history. Used by the admin UI's "Inspect"
// drawer to debug why a partner endpoint is rejecting a webhook.
router.get(
  "/partners/:id/webhooks/:deliveryId",
  adminOnly,
  async (req, res, next) => {
    try {
      const partnerId = String(req.params.id);
      const deliveryId = String(req.params.deliveryId);
      const [delivery] = await db
        .select()
        .from(webhookDeliveriesTable)
        .where(
          and(
            eq(webhookDeliveriesTable.id, deliveryId),
            eq(webhookDeliveriesTable.partnerId, partnerId),
          ),
        )
        .limit(1);
      if (!delivery) throw notFound("Delivery not found");
      const attempts = await db
        .select()
        .from(webhookDeliveryAttemptsTable)
        .where(eq(webhookDeliveryAttemptsTable.deliveryId, deliveryId))
        .orderBy(desc(webhookDeliveryAttemptsTable.attemptNumber));
      res.json({
        delivery: {
          id: delivery.id,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          status: delivery.status,
          attempts: delivery.attempts,
          payload: delivery.payload,
          lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
          lastResponseStatus: delivery.lastResponseStatus,
          lastResponseBody: delivery.lastResponseBody,
          nextAttemptAt: delivery.nextAttemptAt.toISOString(),
          createdAt: delivery.createdAt.toISOString(),
        },
        attempts: attempts.map((a) => ({
          id: a.id,
          attemptNumber: a.attemptNumber,
          statusCode: a.statusCode,
          responseBody: a.responseBody,
          requestHeaders: a.requestHeaders,
          requestBody: a.requestBody,
          errorMessage: a.errorMessage,
          durationMs: a.durationMs,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/partners/:id/webhooks/:deliveryId/replay",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const partnerId = String(req.params.id);
      const deliveryId = String(req.params.deliveryId);
      const ok = await replayDelivery(deliveryId, partnerId);
      if (!ok) throw notFound("Delivery not found");
      await recordAuditFromReq(req, {
        action: "partner.webhook.replay",
        targetType: "webhook_delivery",
        targetId: String(req.params.deliveryId),
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Admin-only convenience: mint a launch token for any partner without
 * having to sign a request with the partner's secret. Used by the
 * Integration Demo page in the operator console for end-to-end smoke
 * tests; not exposed publicly.
 */
router.post(
  "/partners/:id/demo-session",
  adminWrite,
  async (req, res, next) => {
    try {
      const partnerId = String(req.params.id);
      const body = z
        .object({
          playerRef: z.string().min(1).max(128),
          gameCode: z.enum([
            "lunar",
            "mines",
            "plinko",
            "dice",
            "aviator",
            "jetx",
            "fury",
          ]),
          currency: z.string().min(3).max(8).optional(),
        })
        .parse(req.body ?? {});
      const [partner] = await db
        .select()
        .from(partnersTable)
        .where(eq(partnersTable.id, partnerId))
        .limit(1);
      if (!partner) throw notFound("Partner not found");
      if (
        partner.allowedGames.length > 0 &&
        !partner.allowedGames.includes(body.gameCode)
      ) {
        throw badRequest("Game not allowed for this partner");
      }
      const ps = await issueLaunchToken({
        partnerId,
        playerRef: body.playerRef,
        gameCode: body.gameCode,
        currency: body.currency,
      });
      const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
      const host = req.headers.host;
      const base = process.env.LAUNCH_BASE_URL ?? `${proto}://${host}`;
      const launchUrl = `${base}/launch?token=${encodeURIComponent(
        ps.token,
      )}&gameCode=${encodeURIComponent(body.gameCode)}`;
      await recordAuditFromReq(req, {
        action: "partner.demo_session.create",
        targetType: "partner",
        targetId: partnerId,
        after: { gameCode: body.gameCode, playerRef: body.playerRef },
      });
      res.json({
        token: ps.token,
        launchUrl,
        expiresAt: ps.expiresAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/partners/:id/webhooks/test",
  adminWrite,
  requireStepUp,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      void enqueueWebhook({
        partnerId: id,
        eventType: "bet.placed",
        payload: { test: true, ts: Date.now() },
        eventId: `test.${id}.${Date.now()}`,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/partners/:id/logs", adminOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
      500,
    );
    const rows = await db
      .select()
      .from(partnerRequestLogsTable)
      .where(eq(partnerRequestLogsTable.partnerId, id))
      .orderBy(desc(partnerRequestLogsTable.createdAt))
      .limit(limit);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        method: r.method,
        path: r.path,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        ip: r.ip,
        errorCode: r.errorCode,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
