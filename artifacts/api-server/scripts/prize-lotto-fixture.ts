// Only creates users/funds/deterministic draws inside an explicitly isolated test DB.
import { db, usersTable, prizeDrawsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { PRIZE_DEFAULTS } from "@workspace/api-zod/prize-lotto";
import app from "../src/app";
import { hashPassword } from "../src/lib/password";
import { ensureGameConfigDefaults, seedRoles } from "../src/lib/bootstrap";
import { postEntry } from "../src/services/wallet";
import {
  buyPrizeTicket,
  startPrizeLottoEngine,
  tickPrizeLotto,
  prizeAdminState,
  updatePrizeSettings,
} from "../src/services/prizeLotto";
import { prizeCommitment, prizeResult } from "../src/services/prizeLottoMath";
import { attachRealtime } from "../src/realtime/gateway";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_prize_lotto_test"))
  throw new Error("Use an isolated _prize_lotto_test database.");
await seedRoles();
await ensureGameConfigDefaults();
for (const [id, role] of [
  ["prize-browser", "player"],
  ["prize-browser-admin", "admin"],
] as const) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!existing) {
    await db
      .insert(usersTable)
      .values({
        id,
        email: `${id}@example.test`,
        emailNormalized: `${id}@example.test`,
        role,
        displayName: role === "admin" ? "Prize operator" : "Prize player",
        passwordHash: await hashPassword("PrizeBrowser@12345"),
      });
    await postEntry({
      userId: id,
      type: "adjustment",
      amount: 10000000n,
      memo: "Isolated browser test funds",
    });
  }
}
// Integration tests intentionally move a cutoff far ahead of its result to test
// lock contention. Retire those isolated test draws before browser scenarios.
await db.update(prizeDrawsTable).set({ ends: Date.now() - 1, closes: Date.now() - 5001 }).where(eq(prizeDrawsTable.status, "open"));
const config = await prizeAdminState();
await updatePrizeSettings("prize-browser-admin", {
  version: config.version,
  settings: { ...PRIZE_DEFAULTS, intervalSeconds: 300 },
});
const ends = Date.now() + 120000,
  id = `PRIZE-${ends}`;
let seed = "",
  n = 0;
do {
  seed = `browser-${n++}`;
} while (prizeResult(seed, id, 85) !== "travel");
await db
  .insert(prizeDrawsTable)
  .values({
    id,
    ends,
    closes: ends - 5000,
    seed,
    config: PRIZE_DEFAULTS,
    commitment: prizeCommitment(seed, id, PRIZE_DEFAULTS),
  });
await buyPrizeTicket(
  "prize-browser",
  { drawId: id, reward: "travel", amount: 1000 },
  crypto.randomUUID(),
);
await db
  .update(prizeDrawsTable)
  .set({ ends: Date.now() - 1, closes: Date.now() - 5001 })
  .where(eq(prizeDrawsTable.id, id));
await tickPrizeLotto();
startPrizeLottoEngine();
const port = Number(process.env.PRIZE_TEST_PORT || 5216);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Prize Lotto test API ready on ${port}`),
);
attachRealtime(server);
