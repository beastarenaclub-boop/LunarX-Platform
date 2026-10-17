import { db, notificationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { bus } from "../realtime/eventBus";

type NotificationType =
  | "kyc_approved"
  | "kyc_rejected"
  | "deposit_credited"
  | "deposit_approved"
  | "deposit_rejected"
  | "withdrawal_approved"
  | "withdrawal_rejected"
  | "ticket_reply"
  | "bonus_issued"
  | "custom";

interface CreateNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl?: string | null;
}

export async function createNotification(n: CreateNotification): Promise<void> {
  try {
    const [row] = await db.insert(notificationsTable).values({
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      linkUrl: n.linkUrl ?? null,
    }).returning({ id: notificationsTable.id });
    if (row) {
      bus.publish({
        topic: `notifications:${n.userId}`,
        type: "new",
        id: row.id,
        title: n.title,
        message: n.message,
        ts: Date.now(),
      });
    }

    logger.info(
      { userId: n.userId, type: n.type, title: n.title },
      "Notification created (email stub: would send email here)",
    );
  } catch (err) {
    logger.error({ err, notification: n }, "Failed to create notification");
  }
}

export async function createBulkNotifications(
  notifications: CreateNotification[],
): Promise<number> {
  if (notifications.length === 0) return 0;
  try {
    const values = notifications.map((n) => ({
      userId: n.userId,
      type: n.type as NotificationType,
      title: n.title,
      message: n.message,
      linkUrl: n.linkUrl ?? null,
    }));
    const BATCH = 500;
    let created = 0;
    for (let i = 0; i < values.length; i += BATCH) {
      const batch = values.slice(i, i + BATCH);
      const inserted = await db
        .insert(notificationsTable)
        .values(batch)
        .returning({ id: notificationsTable.id, userId: notificationsTable.userId });
      created += inserted.length;
      for (let j = 0; j < inserted.length; j++) {
        const row = inserted[j]!;
        const src = batch[j]!;
        bus.publish({
          topic: `notifications:${row.userId}`,
          type: "new",
          id: row.id,
          title: src.title,
          message: src.message,
          ts: Date.now(),
        });
      }
    }
    return created;
  } catch (err) {
    logger.error({ err }, "Failed to create bulk notifications");
    return 0;
  }
}
