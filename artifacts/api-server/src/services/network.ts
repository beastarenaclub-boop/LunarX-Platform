import { db, networkNodesTable, usersTable, type User } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { forbidden } from "../lib/errors";

export const isNetworkAdmin = (user: Pick<User, "role">) =>
  user.role === "admin" || user.role === "super_admin";

export async function userBelongsToMaster(user:User,masterId:string) {
  if(user.role!=='player' || !user.b2bAgentId)return false;
  const [agent]=await db.select().from(networkNodesTable).where(eq(networkNodesTable.id,user.b2bAgentId));
  return agent?.parentId===masterId;
}

export async function networkIdentity(user: User) {
  if (isNetworkAdmin(user)) return { role: "admin" as const, node: null };
  const [node] = await db
    .select()
    .from(networkNodesTable)
    .where(eq(networkNodesTable.userId, user.id));
  if (!node || user.role !== "agent")
    throw forbidden("This account has no branch panel access");
  await assertNetworkActive(user);
  return { role: node.kind, node };
}

export async function assertNetworkActive(user: User) {
  const [node] = user.b2bAgentId
    ? await db
        .select()
        .from(networkNodesTable)
        .where(eq(networkNodesTable.id, user.b2bAgentId))
    : await db
        .select()
        .from(networkNodesTable)
        .where(eq(networkNodesTable.userId, user.id));
  if (!node) {
    if (user.channel === "b2b") throw forbidden("Agent account is unavailable");
    return;
  }
  const nodes = node.parentId
    ? await db
        .select()
        .from(networkNodesTable)
        .where(inArray(networkNodesTable.id, [node.id, node.parentId]))
    : [node];
  const owners = await db
    .select({ status: usersTable.status })
    .from(usersTable)
    .where(
      inArray(
        usersTable.id,
        nodes.map((n) => n.userId),
      ),
    );
  if (
    nodes.some((n) => n.status !== "active") ||
    owners.some((u) => u.status !== "active")
  ) {
    throw forbidden("Your branch is suspended. Contact your account manager.");
  }
}
