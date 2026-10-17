import { Router, type IRouter } from "express";
import {
  db,
  ticketsTable,
  ticketMessagesTable,
  usersTable,
  walletsTable,
  withdrawalsTable,
} from "@workspace/db";
import { and, desc, eq, count, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth";
import { recordAuditFromReq } from "../lib/audit";
import { notFound, badRequest } from "../lib/errors";
import { createNotification } from "../services/notifications";

const router: IRouter = Router();

const CATEGORIES = ["deposit", "withdrawal", "kyc", "game", "account", "other"] as const;
const STATUSES = ["open", "awaiting_reply", "resolved", "closed"] as const;

const CreateTicketBody = z.object({
  category: z.enum(CATEGORIES),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  attachmentUrl: z.string().max(500).optional(),
});

const ReplyBody = z.object({
  message: z.string().min(1).max(5000),
  attachmentUrl: z.string().max(500).optional(),
});

const UpdateStatusBody = z.object({
  status: z.enum(STATUSES),
});

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? def), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function serializeTicket(t: typeof ticketsTable.$inferSelect) {
  return {
    id: t.id,
    userId: t.userId,
    category: t.category,
    subject: t.subject,
    status: t.status,
    assigneeId: t.assigneeId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serializeMessage(m: typeof ticketMessagesTable.$inferSelect) {
  return {
    id: m.id,
    ticketId: m.ticketId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    body: m.body,
    attachmentUrl: m.attachmentUrl,
    createdAt: m.createdAt.toISOString(),
  };
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const input = CreateTicketBody.parse(req.body);
    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        userId: req.user!.id,
        category: input.category,
        subject: input.subject,
        status: "open",
      })
      .returning();

    await db.insert(ticketMessagesTable).values({
      ticketId: ticket!.id,
      senderId: req.user!.id,
      senderRole: req.user!.role,
      body: input.message,
      attachmentUrl: input.attachmentUrl ?? null,
    });

    await recordAuditFromReq(req, {
      action: "ticket.create",
      targetType: "ticket",
      targetId: ticket!.id,
      after: { category: input.category, subject: input.subject },
    });

    res.status(201).json(serializeTicket(ticket!));
  } catch (err) {
    next(err);
  }
});

router.get("/my", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, req.user!.id))
      .orderBy(desc(ticketsTable.updatedAt));
    res.json(rows.map(serializeTicket));
  } catch (err) {
    next(err);
  }
});

router.get("/my/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, id), eq(ticketsTable.userId, req.user!.id)))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, id))
      .orderBy(ticketMessagesTable.createdAt);

    res.json({
      ticket: serializeTicket(ticket),
      messages: messages.map(serializeMessage),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/my/:id/reply", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = ReplyBody.parse(req.body);

    const rows = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.id, id), eq(ticketsTable.userId, req.user!.id)))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");
    if (ticket.status === "closed") throw badRequest("Ticket is closed");

    const [msg] = await db
      .insert(ticketMessagesTable)
      .values({
        ticketId: id,
        senderId: req.user!.id,
        senderRole: req.user!.role,
        body: input.message,
        attachmentUrl: input.attachmentUrl ?? null,
      })
      .returning();

    await db
      .update(ticketsTable)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(ticketsTable.id, id));

    res.status(201).json(serializeMessage(msg!));
  } catch (err) {
    next(err);
  }
});

const supportOnly = requireRole("admin", "super_admin", "support");

router.get("/queue", supportOnly, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    const conds = [] as ReturnType<typeof eq>[];

    if (typeof req.query.status === "string" && req.query.status) {
      conds.push(eq(ticketsTable.status, req.query.status as never));
    }
    if (typeof req.query.category === "string" && req.query.category) {
      conds.push(eq(ticketsTable.category, req.query.category as never));
    }
    if (typeof req.query.assigneeId === "string" && req.query.assigneeId) {
      conds.push(eq(ticketsTable.assigneeId, req.query.assigneeId));
    }

    const where = conds.length ? and(...conds) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(ticketsTable)
        .where(where)
        .orderBy(desc(ticketsTable.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ c: count() }).from(ticketsTable).where(where),
    ]);

    res.json({
      tickets: rows.map(serializeTicket),
      total: Number(totalRow[0]?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/queue/:id", supportOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, id))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const [messages, userRows, walletRows, withdrawalRows] = await Promise.all([
      db
        .select()
        .from(ticketMessagesTable)
        .where(eq(ticketMessagesTable.ticketId, id))
        .orderBy(ticketMessagesTable.createdAt),
      db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, ticket.userId))
        .limit(1),
      db
        .select()
        .from(walletsTable)
        .where(and(eq(walletsTable.userId, ticket.userId), eq(walletsTable.scope, "lunar")))
        .limit(1),
      db
        .select()
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.userId, ticket.userId))
        .orderBy(desc(withdrawalsTable.requestedAt))
        .limit(5),
    ]);

    res.json({
      ticket: serializeTicket(ticket),
      messages: messages.map(serializeMessage),
      context: {
        user: userRows[0]
          ? {
              id: userRows[0].id,
              email: userRows[0].email,
              displayName: userRows[0].displayName,
              status: userRows[0].status,
              role: userRows[0].role,
            }
          : null,
        wallet: walletRows[0]
          ? { id: walletRows[0].id, currency: walletRows[0].currency }
          : null,
        recentWithdrawals: withdrawalRows.map((w) => ({
          id: w.id,
          amount: w.amount.toString(),
          status: w.status,
          requestedAt: w.requestedAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/queue/:id/reply", supportOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = ReplyBody.parse(req.body);

    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, id))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const [msg] = await db
      .insert(ticketMessagesTable)
      .values({
        ticketId: id,
        senderId: req.user!.id,
        senderRole: req.user!.role,
        body: input.message,
        attachmentUrl: input.attachmentUrl ?? null,
      })
      .returning();

    await db
      .update(ticketsTable)
      .set({ status: "awaiting_reply", updatedAt: new Date() })
      .where(eq(ticketsTable.id, id));

    await recordAuditFromReq(req, {
      action: "ticket.reply",
      targetType: "ticket",
      targetId: id,
    });

    await createNotification({
      userId: ticket.userId,
      type: "ticket_reply",
      title: "New reply on your ticket",
      message: `Support has replied to your ticket: "${ticket.subject}"`,
      linkUrl: "/help",
    });

    res.status(201).json(serializeMessage(msg!));
  } catch (err) {
    next(err);
  }
});

router.post("/queue/:id/status", supportOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = UpdateStatusBody.parse(req.body);

    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, id))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const [updated] = await db
      .update(ticketsTable)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(ticketsTable.id, id))
      .returning();

    await recordAuditFromReq(req, {
      action: `ticket.status.${input.status}`,
      targetType: "ticket",
      targetId: id,
      before: { status: ticket.status },
      after: { status: input.status },
    });

    res.json(serializeTicket(updated!));
  } catch (err) {
    next(err);
  }
});

router.post("/queue/:id/assign", supportOnly, async (req, res, next) => {
  try {
    const id = String(req.params.id);

    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, id))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) throw notFound("Ticket not found");

    const [updated] = await db
      .update(ticketsTable)
      .set({ assigneeId: req.user!.id, updatedAt: new Date() })
      .where(eq(ticketsTable.id, id))
      .returning();

    await recordAuditFromReq(req, {
      action: "ticket.assign",
      targetType: "ticket",
      targetId: id,
      before: { assigneeId: ticket.assigneeId },
      after: { assigneeId: req.user!.id },
    });

    res.json(serializeTicket(updated!));
  } catch (err) {
    next(err);
  }
});

export default router;
