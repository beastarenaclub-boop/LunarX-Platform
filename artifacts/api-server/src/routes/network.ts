import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  networkNodesTable,
  auditLogTable,
  type User,
} from "@workspace/db";
import { nanoid } from "nanoid";
import { requireAuth } from "../middlewares/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { hashPassword } from "../lib/password";
import { networkIdentity } from "../services/network";
import { networkWebsite, masterWebsite } from "../services/networkWebsite";
import { weeklyStatus, assertBranchOperations } from "../services/networkWeekly";
import weeklyRouter from "./networkWeekly";
import brandingRouter from "./networkBranding";
import reportsRouter from "./networkReports";
import { customMaster } from "../middlewares/siteChannel";
import { requestSite } from "../middlewares/siteChannel";
import { postEntry, publishWalletBalance } from "../services/wallet";

const router: IRouter = Router();
router.get('/website',async(req,res,next)=>{
  try { const id=customMaster(req); const website=id?await masterWebsite(id):null;if(id&&!website)throw notFound('Website unavailable');res.set('Cache-Control','no-store').json(website); }
  catch(e){next(e);}
});
// Public branch pages expose only the active master's display name and links.
router.get("/website/:masterId", async (req, res, next) => {
  try {
    if (requestSite(req) !== "b2b") throw notFound();
    const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(req.params.masterId);
    if(customMaster(req) && customMaster(req)!==id)throw notFound();
    const master = await masterWebsite(id);
    if (!master) throw notFound("This branch website is unavailable");
    res.set("Cache-Control", "no-store").json(master);
  } catch (e) { next(e); }
});
router.use(requireAuth);
router.use('/reports',reportsRouter);
router.use('/weekly',weeklyRouter);
router.use(async(req,_res,next)=>{
  try { if(!['GET','HEAD'].includes(req.method) && req.user?.role==='agent')await assertBranchOperations(req.user.id); next(); }
  catch(e){next(e);}
});
router.use('/branding',brandingRouter);
function isDuplicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const databaseError = error as { code?: string; cause?: unknown };
  return databaseError.code === "23505" || isDuplicate(databaseError.cause);
}
const bps = z.number().int().min(0).max(10000);
const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .refine(
      (v) => !v.toLowerCase().endsWith("@demo.lunar.local"),
      "Reserved email",
    ),
  password: z.string().min(10).max(72),
  name: z.string().trim().min(2).max(100),
});
const createNode = credentials
  .extend({ companyFeeBps: bps.default(1000), shareBps: bps.default(10000) })
  .strict();
const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const idBody = z.object({ id: z.string().min(1).max(100) });
const serialize = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  user: User,
  action: string,
  targetId: string,
  after: object,
  before?: object,
) {
  await tx.insert(auditLogTable).values({
    actorId: user.id,
    actorRole: user.role,
    action,
    targetType: "network",
    targetId,
    after,
    before: before ?? null,
  });
}

router.get("/context", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const masterId = actor.node?.kind === "master" ? actor.node.id : actor.node?.parentId;
    const website=masterId?await masterWebsite(masterId):null;
    const weekly=masterId?await weeklyStatus(masterId):null;
    res.json({ ...actor, website, weekly: actor.role==='agent' && weekly ? {locked:weekly.locked} : weekly });
  } catch (e) {
    next(e);
  }
});

router.get("/nodes", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const condition =
      actor.role === "admin"
        ? sql`true`
        : actor.role === "master"
          ? sql`(n.id = ${actor.node.id} OR n.parent_id = ${actor.node.id})`
          : sql`n.id = ${actor.node.id}`;
    const rows = await db.execute(sql`SELECT n.*, u.email,
      (SELECT name FROM network_nodes parent WHERE parent.id=n.parent_id) AS parent_name,
      (SELECT count(*)::int FROM users p WHERE p.b2b_agent_id = n.id OR p.b2b_agent_id IN (SELECT id FROM network_nodes WHERE parent_id=n.id)) AS players,
      COALESCE((SELECT sum(amount)::text FROM network_ledger l WHERE l.account_id=n.id),'0') AS earned,
      COALESCE((SELECT sum(amount)::text FROM network_settlements s WHERE s.node_id=n.id),'0') AS settled,
      COALESCE((SELECT sum(amount)::text FROM wallet_ledger w WHERE w.user_id=n.user_id),'0') AS float_balance
      FROM network_nodes n JOIN users u ON u.id=n.user_id WHERE ${condition} ORDER BY n.created_at DESC`);
    const websites=await db.execute(sql`SELECT master_id,brand_name,custom_domain,domain_status FROM network_websites`);
    const settings=new Map(websites.rows.map(w=>[String(w.master_id),w]));
    res.json({ nodes: await Promise.all(rows.rows.map(async node => ({ ...node,
      weekly: node.kind==='master' ? await weeklyStatus(String(node.id)) : null,
      website_url: networkWebsite(String(node.kind === "master" ? node.id : node.parent_id),
        String(node.kind === "master" ? node.name : node.parent_name),settings.get(String(node.kind === 'master'?node.id:node.parent_id))).url,
    }))) });
  } catch (e) {
    next(e);
  }
});

router.post("/nodes", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    if (actor.role === "agent")
      throw forbidden("Only admin creates masters; only masters create agents");
    const input = createNode.parse(req.body);
    if (actor.role === "master" && input.companyFeeBps !== 1000)
      throw forbidden("Company fee is controlled by admin");
    const passwordHash = await hashPassword(input.password);
    const node = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.emailNormalized, input.email.toLowerCase()));
      if (existing.length)
        throw conflict("Email is already registered. Use a new account.");
      const [user] = await tx
        .insert(usersTable)
        .values({
          email: input.email,
          emailNormalized: input.email.toLowerCase(),
          passwordHash,
          displayName: input.name,
          role: "agent",
        })
        .returning();
      const [created] = await tx
        .insert(networkNodesTable)
        .values({
          userId: user!.id,
          name: input.name,
          kind: actor.role === "admin" ? "master" : "agent",
          parentId: actor.node?.id ?? null,
          companyFeeBps: actor.node?.companyFeeBps ?? input.companyFeeBps,
          shareBps: input.shareBps,
          createdBy: req.user!.id,
        })
        .returning();
      await audit(tx, req.user!, "network.create", created!.id, {
        ...created!,
        email: input.email,
      });
      return created!;
    });
    res.status(201).json(serialize(node));
  } catch (e) {
    if (isDuplicate(e)) return next(conflict("Email is already registered"));
    next(e);
  }
});

router.patch("/nodes/:id", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const input = z
      .object({
        shareBps: bps.optional(),
        status: z.enum(["active", "suspended"]).optional(),
        name: z.string().trim().min(2).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(networkNodesTable)
        .where(eq(networkNodesTable.id, String(req.params.id)))
        .for("update");
      if (!node) throw notFound();
      if (
        actor.role !== "admin" &&
        !(actor.role === "master" && node.parentId === actor.node.id)
      )
        throw forbidden("You can manage only your own agents");
      if (
        actor.role === "admin" &&
        node.kind === "agent" &&
        input.shareBps !== undefined
      )
        throw forbidden("Agent share is set by its master");
      await tx
        .update(networkNodesTable)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(networkNodesTable.id, node.id));
      await audit(tx, req.user!, "network.update", node.id, input, node);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

function playerScope(actor: Awaited<ReturnType<typeof networkIdentity>>) {
  return actor.role === "admin"
    ? sql`true`
    : actor.role === "master"
      ? sql`u.b2b_agent_id IN (SELECT id FROM network_nodes WHERE parent_id=${actor.node.id})`
      : sql`u.b2b_agent_id=${actor.node.id}`;
}

router.get("/players", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const { limit, offset } = pagination.parse(req.query);
    const channel = z
      .enum(["b2b", "b2c"])
      .default("b2b")
      .parse(req.query.channel);
    if (actor.role !== "admin" && channel !== "b2b") throw forbidden();
    const q = z.string().max(100).default("").parse(req.query.q);
    const agentId = z
      .string()
      .min(1)
      .max(100)
      .optional()
      .parse(req.query.agentId);
    if (agentId && channel !== "b2b")
      throw badRequest("Agent filters are available only for B2B users");
    const agentFilter = agentId ? sql`u.b2b_agent_id=${agentId}` : sql`true`;
    const condition = sql`u.role='player' AND u.channel=${channel} AND ${playerScope(actor)} AND ${agentFilter} AND (u.email ILIKE ${`%${q}%`} OR u.display_name ILIKE ${`%${q}%`})`;
    const [rows, total] = await Promise.all([
      db.execute(sql`SELECT u.id,u.email,u.display_name,u.status,u.channel,u.created_at,u.b2b_agent_id AS agent_id,a.name AS agent,m.name AS master,
        COALESCE((SELECT sum(amount)::text FROM wallet_ledger WHERE user_id=u.id),'0') AS balance,
        COALESCE((SELECT sum(stake-payout)::text FROM network_wagers WHERE user_id=u.id AND settled),'0') AS net
        FROM users u LEFT JOIN network_nodes a ON a.id=u.b2b_agent_id LEFT JOIN network_nodes m ON m.id=a.parent_id
        WHERE ${condition} ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
      db.execute(
        sql`SELECT count(*)::int AS total FROM users u WHERE ${condition}`,
      ),
    ]);
    res.json({ players: rows.rows, total: total.rows[0]?.total ?? 0 });
  } catch (e) {
    next(e);
  }
});

router.post("/players", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    if (actor.role !== "agent")
      throw forbidden("Only an agent can create a B2B player");
    const input = credentials.strict().parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(usersTable)
        .values({
          email: input.email,
          emailNormalized: input.email.toLowerCase(),
          passwordHash,
          displayName: input.name,
          role: "player",
          channel: "b2b",
          b2bAgentId: actor.node.id,
          referredBy: null,
        })
        .returning();
      await audit(tx, req.user!, "network.player.create", created!.id, {
        email: input.email,
        agentId: actor.node.id,
      });
      return created!;
    });
    res
      .status(201)
      .json({ id: user.id, email: user.email, channel: user.channel });
  } catch (e) {
    if (isDuplicate(e)) return next(conflict("Email is already registered"));
    next(e);
  }
});

router.patch("/players/:id", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const input = z
      .object({ status: z.enum(["active", "suspended"]) })
      .strict()
      .parse(req.body);
    if (actor.role === "master")
      throw forbidden("Player accounts are managed by their agent");
    await db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, String(req.params.id)))
        .for("update");
      if (!user || user.role !== "player" || user.channel !== "b2b")
        throw notFound();
      if (actor.role !== "admin" && user.b2bAgentId !== actor.node.id)
        throw forbidden();
      await tx
        .update(usersTable)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
      await audit(tx, req.user!, "network.player.status", user.id, input);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

async function ledgerFilter(req: Parameters<typeof requireAuth>[0]) {
  const actor = await networkIdentity(req.user!);
  const filter = z
    .object({
      channel: z.enum(["b2b", "b2c"]).default("b2b"),
      nodeId: z.string().max(100).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    })
    .parse(req.query);
  if (actor.role !== "admin" && filter.channel !== "b2b") throw forbidden();
  if (filter.from && filter.to && filter.from > filter.to)
    throw badRequest("Start date must precede end date");
  const parts = [sql`l.channel=${filter.channel}`];
  if (actor.role !== "admin") parts.push(sql`l.account_id=${actor.node.id}`);
  if (filter.nodeId)
    parts.push(
      sql`(l.master_id=${filter.nodeId} OR l.agent_id=${filter.nodeId})`,
    );
  if (filter.from)
    parts.push(
      sql`l.created_at >= (${filter.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    );
  if (filter.to)
    parts.push(
      sql`l.created_at < ((${filter.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
    );
  return { actor, where: sql.join(parts, sql` AND `) };
}

router.get("/ledger", async (req, res, next) => {
  try {
    const { where } = await ledgerFilter(req);
    const { limit, offset } = pagination.parse(req.query);
    const [rows, total, summary] = await Promise.all([
      db.execute(sql`SELECT l.*, u.email AS player_email, COALESCE(n.name,'Company') AS account_name
        FROM network_ledger l JOIN users u ON u.id=l.user_id LEFT JOIN network_nodes n ON n.id=l.account_id
        WHERE ${where} ORDER BY l.id DESC LIMIT ${limit} OFFSET ${offset}`),
      db.execute(
        sql`SELECT count(*)::int AS total FROM network_ledger l WHERE ${where}`,
      ),
      db.execute(sql`SELECT account_kind, sum(amount)::text AS amount, sum(gross_stake)::text AS stake, sum(gross_payout)::text AS payout
        FROM network_ledger l WHERE ${where} GROUP BY account_kind`),
    ]);
    res.json({
      entries: rows.rows,
      total: total.rows[0]?.total ?? 0,
      summary: summary.rows,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/settlements", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const condition =
      actor.role === "admin" ? sql`true` : sql`s.node_id=${actor.node.id}`;
    const rows = await db.execute(
      sql`SELECT s.*,n.name FROM network_settlements s JOIN network_nodes n ON n.id=s.node_id WHERE ${condition} ORDER BY s.created_at DESC LIMIT 200`,
    );
    res.json({ settlements: rows.rows });
  } catch (e) {
    next(e);
  }
});

router.get("/wallet-ledger", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const filter = z
      .object({
        channel: z.enum(["b2b", "b2c"]).default("b2b"),
        nodeId: z.string().max(100).optional(),
      })
      .parse(req.query);
    if (actor.role !== "admin" && filter.channel !== "b2b") throw forbidden();
    let scope =
      actor.role === "admin"
        ? filter.channel === "b2c"
          ? sql`u.channel='b2c' AND u.role='player'`
          : sql`(u.channel='b2b' OR EXISTS(SELECT 1 FROM network_nodes WHERE user_id=u.id))`
        : actor.role === "master"
          ? sql`(u.id=${req.user!.id} OR u.b2b_agent_id IN(SELECT id FROM network_nodes WHERE parent_id=${actor.node.id}) OR u.id IN(SELECT user_id FROM network_nodes WHERE parent_id=${actor.node.id}))`
          : sql`(u.id=${req.user!.id} OR u.b2b_agent_id=${actor.node.id})`;
    if (filter.nodeId)
      scope = sql`${scope} AND (u.b2b_agent_id=${filter.nodeId} OR u.b2b_agent_id IN(SELECT id FROM network_nodes WHERE parent_id=${filter.nodeId}) OR u.id IN(SELECT user_id FROM network_nodes WHERE id=${filter.nodeId} OR parent_id=${filter.nodeId}))`;
    const rows = await db.execute(
      sql`SELECT w.id,w.created_at,u.email,w.type,w.amount::text,w.balance_after::text,w.memo,w.ref_id FROM wallet_ledger w JOIN users u ON u.id=w.user_id WHERE ${scope} ORDER BY w.created_at DESC,w.id DESC LIMIT 200`,
    );
    res.json({ entries: rows.rows });
  } catch (e) {
    next(e);
  }
});

router.post("/settlements", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    if (actor.role !== "admin")
      throw forbidden("Only admin records company settlements");
    const input = z
      .object({
        nodeId: z.string().min(1),
        amountPaise: z.string().regex(/^-?[1-9]\d{0,14}$/),
        reference: z.string().trim().min(3).max(200),
        requestId: z.string().min(16).max(100),
      })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(networkNodesTable)
        .where(eq(networkNodesTable.id, input.nodeId))
        .for("update");
      if (!node) throw notFound();
      const prior = await tx.execute(
        sql`SELECT * FROM network_settlements WHERE request_id=${input.requestId}`,
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (
          row.node_id !== input.nodeId ||
          String(row.amount) !== input.amountPaise ||
          row.reference !== input.reference
        )
          throw conflict("Request ID already used");
        return row;
      }
      const balances = await tx.execute(
        sql`SELECT COALESCE((SELECT sum(amount) FROM network_ledger WHERE account_id=${node.id}),0)-COALESCE((SELECT sum(amount) FROM network_settlements WHERE node_id=${node.id}),0) AS due`,
      );
      const due = BigInt(String(balances.rows[0]!.due));
      const amount = BigInt(input.amountPaise);
      if (
        (due >= 0n && (amount < 0n || amount > due)) ||
        (due < 0n && (amount > 0n || amount < due))
      )
        throw badRequest(
          "Settlement exceeds the outstanding profit/loss balance",
        );
      const id = nanoid();
      const saved = await tx.execute(
        sql`INSERT INTO network_settlements(id,node_id,amount,reference,request_id,created_by) VALUES(${id},${node.id},${amount.toString()}::bigint,${input.reference},${input.requestId},${req.user!.id}) RETURNING *`,
      );
      await audit(tx, req.user!, "network.settle", id, input);
      return saved.rows[0];
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/transfers", async (req, res, next) => {
  try {
    const actor = await networkIdentity(req.user!);
    const input = z
      .object({
        targetId: z.string().min(1),
        amountPaise: z.string().regex(/^[1-9]\d{0,12}$/),
        direction: z.enum(["credit", "debit"]),
        requestId: z.string().min(16).max(100),
        memo: z.string().trim().min(3).max(200),
      })
      .strict()
      .parse(req.body);
    const updates = await db.transaction(async (tx) => {
      const balances: Parameters<typeof publishWalletBalance>[0][] = [];
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`,
      );
      const prior = await tx.execute(
        sql`SELECT after FROM audit_log WHERE action='network.transfer' AND target_id=${input.requestId}`,
      );
      if (prior.rows[0]) {
        const saved = prior.rows[0].after as typeof input & { actorId: string };
        if (
          saved.actorId !== req.user!.id ||
          saved.targetId !== input.targetId ||
          saved.amountPaise !== input.amountPaise ||
          saved.direction !== input.direction
        )
          throw conflict("Request ID already used");
        return balances;
      }
      const [target] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, input.targetId));
      if (!target) throw notFound();
      const [node] = await tx
        .select()
        .from(networkNodesTable)
        .where(eq(networkNodesTable.userId, target.id));
      const allowed =
        actor.role === "admin"
          ? node?.kind === "master"
          : actor.role === "master"
            ? node?.parentId === actor.node.id
            : target.channel === "b2b" && target.b2bAgentId === actor.node.id;
      if (!allowed)
        throw forbidden("Funds can only move to or from your direct downline");
      if (target.status !== "active" || node?.status === "suspended")
        throw badRequest("Target account is suspended");
      const amount =
        BigInt(input.amountPaise) * (input.direction === "credit" ? 1n : -1n);
      // Serialize both account balances in a stable order before posting the pair.
      for (const uid of [req.user!.id, target.id].sort())
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`network-funds:${uid}`},0))`,
        );
      if (actor.role !== "admin") {
        const sender = await postEntry(
          {
            userId: req.user!.id,
            type: "adjustment",
            amount: -amount,
            refType: "network_transfer",
            refId: input.requestId,
            memo: input.memo,
            createdBy: req.user!.id,
          },
          tx,
        );
        balances.push({ userId: req.user!.id, balance: sender.entry.balanceAfter, entryType: "adjustment", amount: -amount });
      }
      const recipient = await postEntry(
        {
          userId: target.id,
          type: "adjustment",
          amount,
          refType: "network_transfer",
          refId: input.requestId,
          memo: input.memo,
          createdBy: req.user!.id,
        },
        tx,
      );
      balances.push({ userId: target.id, balance: recipient.entry.balanceAfter, entryType: "adjustment", amount });
      await audit(tx, req.user!, "network.transfer", input.requestId, {
        ...input,
        actorId: req.user!.id,
      });
      return balances;
    });
    // Publish only committed transfers; failed or repeated requests emit nothing.
    for (const update of updates) publishWalletBalance(update);
    res.json({ ok: true });
  } catch (e) {
    if ((e as Error).message === "INSUFFICIENT_FUNDS")
      return next(badRequest("Insufficient wallet float"));
    next(e);
  }
});

export default router;
