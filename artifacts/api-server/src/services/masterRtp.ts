import { db, networkNodesTable, usersTable, auditLogTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getGameConfig, sha256Hex } from "./rtp";
import { networkIdentity } from "./network";
import { conflict, forbidden, notFound } from "../lib/errors";

// Requested games with player-specific, snapshotted pricing. Ludo uses pool commission.
export const MASTER_RTP_GAMES = ["jetx", "fury", "mines", "plinko", "dice", "ludo", "lucky-7-live", "wheel-2-live", "poker-20-20", "crazy-time", "chicken-road", "7up7down", "coin-flip", "wingo"] as const;
export const masterRtpInput = z.object({
  playerRtpBps: z.number().int().min(100).max(10000).nullable(),
  revision: z.number().int().min(0),
}).strict();

export async function masterRtpAccess(user: User, masterId: string) {
  const actor = await networkIdentity(user);
  if (actor.role !== "admin" && (actor.role !== "master" || actor.node.id !== masterId))
    throw forbidden("Only admin or this master can manage this RTP policy");
  return actor;
}

export async function updateMasterRtp(user: User, masterId: string, body: unknown) {
  await masterRtpAccess(user, masterId);
  const input = masterRtpInput.parse(body);
  return db.transaction(async tx => {
    const [before] = await tx.select().from(networkNodesTable).where(eq(networkNodesTable.id, masterId)).for("update");
    if (!before || before.kind !== "master") throw notFound("Master not found");
    if (before.rtpRevision !== input.revision) throw conflict("RTP changed. Reload the policy before saving.");
    if (before.playerRtpBps === input.playerRtpBps) return before;
    const [after] = await tx.update(networkNodesTable).set({ playerRtpBps: input.playerRtpBps,
      rtpRevision: before.rtpRevision + 1, updatedAt: new Date() }).where(eq(networkNodesTable.id, masterId)).returning();
    await tx.insert(auditLogTable).values({ actorId: user.id, actorRole: user.role,
      action: "network.rtp_update", targetType: "network", targetId: masterId,
      before: { playerRtpBps: before.playerRtpBps, revision: before.rtpRevision },
      after: { playerRtpBps: after.playerRtpBps, revision: after.rtpRevision, games: MASTER_RTP_GAMES } });
    return after;
  });
}

export async function getPlayerGameConfig(gameCode: string, userId?: string) {
  const base = await getGameConfig(gameCode);
  if (!base) return null;
  const master = await playerMaster(gameCode, userId);
  const bps = master?.playerRtpBps ?? null;
  const houseEdge = bps === null ? base.houseEdge : (10000 - bps) / 10000;
  // Never mutate the shared company-config cache. No player P&L is consulted.
  const rtpPolicy = { source: bps === null ? "company" : "master", revision: master?.rtpRevision ?? 0,
    playerRtpBps: Math.round((1 - houseEdge) * 10000) };
  const pricingVersion = sha256Hex(JSON.stringify([gameCode, houseEdge, base.maxMultiplier,
    master?.id ?? null, rtpPolicy.revision])).slice(0, 32);
  return { ...base, houseEdge, ...(bps === null ? {} : { rtpMin: bps / 100, rtpMax: bps / 100 }), rtpPolicy, pricingVersion };
}

export async function requirePlayerGameConfig(gameCode: string, userId?: string, pricingVersion?: string, checkQuote = false) {
  const cfg = await getPlayerGameConfig(gameCode, userId);
  if (!cfg) throw new Error(`GAME_NOT_FOUND:${gameCode}`);
  // A changed policy (including reverting to company rules) cannot silently
  // reprice a stale player screen. A rejected request never debits the wallet.
  if (checkQuote && (pricingVersion !== undefined || cfg.rtpPolicy.revision > 0) && pricingVersion !== cfg.pricingVersion)
    throw conflict("Payout rules changed. Refresh the game, review the new RTP and place your bet again.");
  return cfg;
}

/** Public shared-round outcomes stay global; only the accepted prices vary. */
export async function playerTableConfig<T extends { houseEdge: number; maxMultiplier: number }>(base: T, gameCode: string, userId?: string, reader: Pick<typeof db, "select"> = db) {
  const policy = await playerMasterPolicy(gameCode, userId, reader);
  const custom = policy.masterRtpBps !== null;
  const houseEdge = custom ? (10000 - policy.masterRtpBps!) / 10000 : base.houseEdge;
  return { ...base, ...(custom ? { houseEdge, masterRtpBps: policy.masterRtpBps!,
    ...(gameCode === "coin-flip" ? { coinPayoutVersion: 1 as const } : {}),
    ...(gameCode === "7up7down" ? { sevenPayoutVersion: 1 as const } : {}),
  } : {}), rtpPolicy: { ...policy.rtpPolicy, source: custom ? "master" : "company", playerRtpBps: Math.round((1-houseEdge)*10000) },
    pricingVersion: sha256Hex(JSON.stringify([policy.pricingVersion, base])).slice(0,32) };
}

export function assertTablePricing(cfg: { pricingVersion: string; rtpPolicy: { revision: number } }, supplied?: string) {
  if ((supplied !== undefined || cfg.rtpPolicy.revision > 0) && supplied !== cfg.pricingVersion)
    throw conflict("Payout rules changed. Review the current rates and place your bet again.");
}

async function playerMaster(gameCode: string, userId?: string, reader: Pick<typeof db, "select"> = db) {
  let master: typeof networkNodesTable.$inferSelect | undefined;
  if (userId && (MASTER_RTP_GAMES as readonly string[]).includes(gameCode)) {
    const [user] = await reader.select().from(usersTable).where(eq(usersTable.id, userId));
    if (user?.role === "player" && user.channel === "b2b" && user.b2bAgentId) {
      const [agent] = await reader.select().from(networkNodesTable).where(eq(networkNodesTable.id, user.b2bAgentId));
      if (agent?.kind === "agent" && agent.parentId) {
        [master] = await reader.select().from(networkNodesTable).where(eq(networkNodesTable.id, agent.parentId));
        if (master?.kind !== "master") master = undefined;
      }
    }
  }
  return master;
}

export async function playerMasterPolicy(gameCode: string, userId?: string, reader: Pick<typeof db, "select"> = db) {
  const master = await playerMaster(gameCode, userId, reader);
  return { masterRtpBps: master?.playerRtpBps ?? null,
    rtpPolicy: { revision: master?.rtpRevision ?? 0 },
    pricingVersion: sha256Hex(JSON.stringify([gameCode, master?.id ?? null, master?.rtpRevision ?? 0, master?.playerRtpBps ?? null])).slice(0,32) };
}
