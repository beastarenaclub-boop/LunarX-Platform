import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, usersTable, betsTable, gameConfigTable, walletLedgerTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ready, memory } from "../../demo/database";
import { instantConfig, instantState, placeInstant, moveInstant } from "../instantCollection";
import { placeBet } from "../bets";
import { updateGameConfig } from "../rtp";
import { postEntry, getBalanceByUser } from "../wallet";
import { INSTANT_COLLECTION, collectionGame, collectionMultiplier, collectionPayout } from "@workspace/api-zod/instant-collection";
const code = "chicken-road-2", options = { difficulty: "easy" as const, mines: 3, choice: "heads" };
before(async () => { await ready; });
after(async () => { await memory.close(); });

test("removed game rejects new play even if its saved configuration is enabled", async () => {
  await db.insert(gameConfigTable).values({ gameCode: code, enabled: true }).onConflictDoNothing();
  assert.equal(collectionGame(code), undefined);
  assert(!INSTANT_COLLECTION.some(g => String(g.code) === code));
  assert(collectionGame("chicken-road-pirate"));
  assert.equal((await instantConfig(code)).enabled, false);
  const userId = randomUUID();
  await assert.rejects(placeInstant(userId, code, { requestId: randomUUID(), stakeAmount: "100", clientSeed: "retirement-test", options }), /no longer available/);
  for (const funding of [{}, { useBonus: true }, { useFreeBet: true }])
    await assert.rejects(placeBet({ userId, gameCode: code, stakeAmount: 100n, ...funding }), /no longer available/);
  await assert.rejects(updateGameConfig(code, { enabled: true }, userId), /no longer available/);
});

test("old rounds retain history and cash out once without permitting another move", async () => {
  const userId = randomUUID();
  await db.insert(usersTable).values({ id: userId, email: `${userId}@test.invalid`, emailNormalized: `${userId}@test.invalid`, passwordHash: "test-only", displayName: "Retired game test" });
  for (const step of [0, 3]) {
    const [bet] = await db.insert(betsTable).values({
      userId, gameCode: code, status: "placed", stakeAmount: 100n, payoutAmount: 0n,
      metadata: { version: 1, requestId: randomUUID(), options, step, revealed: [], outcome: [], serverSeed: "saved-server-seed", clientSeed: "saved-client-seed", rtp: .97, maxMultiplier: 1000 },
    }).returning();
    const state = await instantState(userId, code);
    assert.equal(state.round?.id, bet.id);
    assert.equal(state.round?.serverSeed, null);
    await assert.rejects(moveInstant(userId, code, bet.id, { action: "reveal", expectedStep: step, cell: 0, actionId: randomUUID() }), /has been removed/);
    await assert.rejects(moveInstant(randomUUID(), code, bet.id, { action: "cashout", expectedStep: step, cell: 0, actionId: randomUUID() }), /Round not found/);
    await postEntry({ userId, type: "adjustment", amount: 1000n });
    const before = (await getBalanceByUser(userId)).balance;
    const input = { action: "cashout" as const, expectedStep: step, cell: 0, actionId: randomUUID() };
    const [a, b] = await Promise.all([moveInstant(userId, code, bet.id, input), moveInstant(userId, code, bet.id, input)]);
    const expected = collectionPayout(100n, collectionMultiplier("road", step, options));
    assert.equal(a.payoutAmount, String(expected));
    assert.equal(b.payoutAmount, a.payoutAmount);
    assert.equal((await getBalanceByUser(userId)).balance, before + expected);
    const credits = await db.select().from(walletLedgerTable).where(and(eq(walletLedgerTable.refId, bet.id), eq(walletLedgerTable.type, "win")));
    assert.equal(credits.length, 1);
    const history = await instantState(userId, code);
    assert.equal(history.round, null);
    assert.equal(history.history.find(r => r.id === bet.id)?.serverSeed, "saved-server-seed");
  }
});
