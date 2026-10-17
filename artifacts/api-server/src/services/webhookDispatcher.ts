import {
  db,
  partnersTable,
  webhookDeliveriesTable,
  webhookDeliveryAttemptsTable,
  type WebhookDelivery,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { signHmac } from "./partners";
import { logger } from "../lib/logger";

const BACKOFF_MS = [
  30 * 1000, // attempt 1 → 30s
  2 * 60 * 1000, // 2 min
  10 * 60 * 1000, // 10 min
  60 * 60 * 1000, // 1h
  6 * 60 * 60 * 1000, // 6h
];
const MAX_ATTEMPTS = BACKOFF_MS.length;

export type WebhookEventType =
  | "bet.placed"
  | "bet.settled"
  | "round.completed"
  | "partner.suspended";

export interface EnqueueInput {
  partnerId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  /** Caller-supplied event id for idempotency. */
  eventId?: string;
}

export async function enqueueWebhook(input: EnqueueInput): Promise<void> {
  const eventId = input.eventId ?? crypto.randomUUID();
  try {
    await db
      .insert(webhookDeliveriesTable)
      .values({
        partnerId: input.partnerId,
        eventId,
        eventType: input.eventType,
        payload: input.payload,
        status: "pending",
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing({
        target: webhookDeliveriesTable.eventId,
      });
  } catch (err) {
    logger.warn({ err, eventId }, "webhook enqueue failed");
  }
}

async function deliverOne(d: WebhookDelivery): Promise<void> {
  const partnerRows = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, d.partnerId))
    .limit(1);
  const partner = partnerRows[0];
  if (!partner || !partner.webhookUrl || !partner.webhookSecret) {
    // No URL/secret configured — mark failed permanently.
    await db
      .update(webhookDeliveriesTable)
      .set({
        status: "failed",
        attempts: d.attempts + 1,
        lastAttemptAt: new Date(),
        lastResponseStatus: 0,
        lastResponseBody: "no webhook url/secret configured",
      })
      .where(eq(webhookDeliveriesTable.id, d.id));
    return;
  }

  const ts = Date.now().toString();
  const body = JSON.stringify({
    id: d.eventId,
    type: d.eventType,
    createdAt: new Date().toISOString(),
    data: d.payload,
  });
  const sig = signHmac({ secret: partner.webhookSecret, timestamp: ts, body });
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-partner-event-id": d.eventId,
    "x-partner-event-type": d.eventType,
    "x-partner-timestamp": ts,
    "x-partner-signature": sig,
  };

  let statusCode = 0;
  let responseSnippet = "";
  let networkError: string | null = null;
  const startedAt = Date.now();
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const resp = await fetch(partner.webhookUrl, {
      method: "POST",
      headers: requestHeaders,
      body,
      signal: ac.signal,
    });
    clearTimeout(t);
    statusCode = resp.status;
    const text = await resp.text();
    responseSnippet = text.slice(0, 2000);
  } catch (err) {
    statusCode = 0;
    networkError = (err as Error).message.slice(0, 500);
    responseSnippet = `network: ${networkError}`;
  }
  const durationMs = Date.now() - startedAt;

  const delivered = statusCode >= 200 && statusCode < 300;
  const nextAttempts = d.attempts + 1;

  // Record per-attempt history so admins can audit each individual try
  // (timing, full response body, error). Best-effort: a missing attempt row
  // never blocks delivery accounting.
  try {
    await db.insert(webhookDeliveryAttemptsTable).values({
      deliveryId: d.id,
      attemptNumber: nextAttempts,
      statusCode,
      responseBody: responseSnippet,
      requestHeaders,
      requestBody: body,
      errorMessage: networkError,
      durationMs,
    });
  } catch (err) {
    logger.warn({ err, id: d.id }, "webhook attempt history insert failed");
  }
  if (delivered) {
    await db
      .update(webhookDeliveriesTable)
      .set({
        status: "delivered",
        attempts: nextAttempts,
        lastAttemptAt: new Date(),
        lastResponseStatus: statusCode,
        lastResponseBody: responseSnippet,
      })
      .where(eq(webhookDeliveriesTable.id, d.id));
    return;
  }

  if (nextAttempts >= MAX_ATTEMPTS) {
    await db
      .update(webhookDeliveriesTable)
      .set({
        status: "failed",
        attempts: nextAttempts,
        lastAttemptAt: new Date(),
        lastResponseStatus: statusCode,
        lastResponseBody: responseSnippet,
      })
      .where(eq(webhookDeliveriesTable.id, d.id));
    return;
  }

  const backoff = BACKOFF_MS[nextAttempts - 1] ?? BACKOFF_MS.at(-1)!;
  await db
    .update(webhookDeliveriesTable)
    .set({
      status: "pending",
      attempts: nextAttempts,
      lastAttemptAt: new Date(),
      lastResponseStatus: statusCode,
      lastResponseBody: responseSnippet,
      nextAttemptAt: new Date(Date.now() + backoff),
    })
    .where(eq(webhookDeliveriesTable.id, d.id));
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Atomically claim up to N due 'pending' rows using SKIP LOCKED so
    // concurrent dispatchers (multi-instance deployments) never claim the
    // same row twice. Rows transition pending → delivering in one statement.
    const claimed = await db.execute<WebhookDelivery>(sql`
      UPDATE webhook_deliveries
         SET status = 'delivering'
       WHERE id IN (
         SELECT id FROM webhook_deliveries
          WHERE status = 'pending'
            AND next_attempt_at <= now()
          ORDER BY next_attempt_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 20
       )
       RETURNING *
    `);
    const rows = (claimed as unknown as { rows?: WebhookDelivery[] }).rows
      ?? (claimed as unknown as WebhookDelivery[]);
    for (const d of rows) {
      try {
        await deliverOne(d);
      } catch (err) {
        logger.warn({ err, id: d.id }, "webhook delivery error");
      }
    }
  } catch (err) {
    logger.warn({ err }, "webhook dispatcher tick failed");
  } finally {
    running = false;
  }
}

let interval: NodeJS.Timeout | null = null;
export function startWebhookDispatcher(): void {
  if (interval) return;
  interval = setInterval(() => void tick(), 10_000);
  logger.info("Webhook dispatcher started (10s tick)");
}

export async function replayDelivery(
  deliveryId: string,
  partnerId?: string,
): Promise<boolean> {
  // Always scope by partnerId when the route knows it, so an admin
  // hitting partner A's URL with partner B's deliveryId returns 404
  // instead of silently replaying the wrong webhook.
  const where = partnerId
    ? and(
        eq(webhookDeliveriesTable.id, deliveryId),
        eq(webhookDeliveriesTable.partnerId, partnerId),
      )
    : eq(webhookDeliveriesTable.id, deliveryId);
  const [updated] = await db
    .update(webhookDeliveriesTable)
    .set({ status: "pending", nextAttemptAt: new Date(), attempts: 0 })
    .where(where)
    .returning();
  if (!updated) return false;
  // Kick the loop opportunistically.
  void tick();
  return true;
}
