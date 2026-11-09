import { db, b2cRtpPoliciesTable, auditLogTable, gameConfigTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { badRequest, conflict, forbidden } from "../lib/errors";
import { RTP_POLICY_GAMES } from "./rtpPolicyGames";
import { defaultRtpDisplay } from "./gameRtpDisplay";

const inputSchema = z.object({ playerRtpBps: z.number().int().min(100).max(10000).nullable(), revision: z.number().int().min(0) }).strict();
function admin(user: User) { if (user.role !== "admin" && user.role !== "super_admin") throw forbidden("Only admin can manage B2C RTP"); }
export async function listB2cRtp(user: User) {
  admin(user);
  const rows = await db.select().from(b2cRtpPoliciesTable);
  const configs = await db.select().from(gameConfigTable);
  return RTP_POLICY_GAMES.map(gameCode => {
    const row = rows.find(item => item.gameCode === gameCode);
    return { gameCode, playerRtpBps: row?.playerRtpBps ?? null, revision: row?.revision ?? 0,
      defaultRtp: defaultRtpDisplay(gameCode, configs.find(config => config.gameCode === gameCode)) };
  });
}
export async function updateB2cRtp(user: User, gameCode: string, body: unknown) {
  admin(user);
  if (!(RTP_POLICY_GAMES as readonly string[]).includes(gameCode)) throw badRequest("This game does not support B2C RTP settings");
  const input = inputSchema.parse(body);
  return db.transaction(async tx => {
    // Insert before locking handles concurrent first edits without lost updates.
    await tx.insert(b2cRtpPoliciesTable).values({ gameCode }).onConflictDoNothing();
    const [before] = await tx.select().from(b2cRtpPoliciesTable).where(eq(b2cRtpPoliciesTable.gameCode,gameCode)).for("update");
    if (before.revision !== input.revision) throw conflict("B2C RTP changed. Reload the policy before saving.");
    if (before.playerRtpBps === input.playerRtpBps) return before;
    const [after] = await tx.update(b2cRtpPoliciesTable).set({ playerRtpBps:input.playerRtpBps, revision:before.revision+1, updatedBy:user.id, updatedAt:new Date() }).where(eq(b2cRtpPoliciesTable.gameCode,gameCode)).returning();
    await tx.insert(auditLogTable).values({ actorId:user.id,actorRole:user.role,action:"b2c.rtp_update",targetType:"game",targetId:gameCode,
      before:{playerRtpBps:before.playerRtpBps,revision:before.revision},after:{playerRtpBps:after.playerRtpBps,revision:after.revision} });
    return after;
  });
}
