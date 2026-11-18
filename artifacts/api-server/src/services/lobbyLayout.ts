import { db, lobbyLayoutTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  completeLobbyLayout,
  defaultLobbyLayout,
  type LobbyLayout,
  type LobbyLayoutResponse,
} from "@workspace/api-zod/lobby-layout";
import { conflict } from "../lib/errors";
import type { AuditEntry } from "../lib/audit";

export async function getLobbyLayout(): Promise<LobbyLayoutResponse> {
  const [row] = await db
    .select()
    .from(lobbyLayoutTable)
    .where(eq(lobbyLayoutTable.id, "global"));
  return {
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    layout: completeLobbyLayout(row?.layout as LobbyLayout | undefined),
  };
}

export async function saveLobbyLayout(
  revision: number,
  layout: LobbyLayout,
  actor: AuditEntry,
): Promise<LobbyLayoutResponse> {
  return db.transaction(async (tx) => {
    await tx
      .insert(lobbyLayoutTable)
      .values({ id: "global", layout: defaultLobbyLayout() })
      .onConflictDoNothing();
    const [before] = await tx
      .select()
      .from(lobbyLayoutTable)
      .where(eq(lobbyLayoutTable.id, "global"))
      .for("update");
    if (!before || before.revision !== revision)
      throw conflict(
        "Another admin saved changes. Reload the saved layout before editing again.",
      );
    const next = completeLobbyLayout(layout);
    const [row] = await tx
      .update(lobbyLayoutTable)
      .set({
        layout: next,
        revision: revision + 1,
        updatedAt: new Date(),
        updatedBy: actor.actorId,
      })
      .where(eq(lobbyLayoutTable.id, "global"))
      .returning();
    await tx
      .insert(auditLogTable)
      .values({
        ...actor,
        action: "lobby_layout.update",
        targetType: "lobby_layout",
        targetId: "global",
        before: before.layout as object,
        after: next,
      });
    return {
      revision: row!.revision,
      updatedAt: row!.updatedAt.toISOString(),
      layout: next,
    };
  });
}
