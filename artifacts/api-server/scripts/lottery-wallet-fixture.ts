// Local browser-test fixture. Refuses every database except an explicit test DB.
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { hashPassword } from "../src/lib/password";
import { postEntry } from "../src/services/wallet";
import { startLotteryEngine } from "../src/services/lottery";
import { attachRealtime } from "../src/realtime/gateway";

if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_lottery_test")) throw new Error("An isolated _lottery_test database is required.");
for (const [id, email, role] of [["lottery-browser", "lottery.browser@example.test", "player"],
  ["lottery-browser-admin", "lottery.admin@example.test", "admin"]] as const) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    await db.insert(usersTable).values({ id, email, emailNormalized: email, role,
      displayName: role === "admin" ? "Lottery operator" : "Lottery player", passwordHash: await hashPassword("LotteryTest@12345") });
    await postEntry({ userId: id, type: "adjustment", amount: 2000000n, memo: "Isolated browser test funds" });
  }
}
startLotteryEngine();
const port = Number(process.env.LOTTERY_TEST_PORT || 5206);
const server = app.listen(port, "127.0.0.1", () => console.log(`Lottery test API ready on ${port}`));
attachRealtime(server);
