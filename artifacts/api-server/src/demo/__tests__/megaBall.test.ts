import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { DemoSessions } from "../sessions";
import { settleMegaBallCards } from "../../services/megaBallMath";

test(
  "Mega Ball: isolated wallet purchase, duplicate retry, server-only settlement, recovery and verification",
  { timeout: 100000 },
  async () => {
    const secret = randomUUID(),
      session = new DemoSessions().create();
    const worker = new Worker(
      new URL("../../../dist/demo-worker.mjs", import.meta.url),
      {
        env: {
          NODE_ENV: "production",
          LOG_LEVEL: "silent",
          DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden",
        },
        execArgv: [],
        workerData: {
          secret,
          configs: [
            {
              gameCode: "mega-ball",
              enabled: true,
              bettingWindowMs: 14000,
              revealDurationMs: 3000,
              settleDurationMs: 8000,
            },
          ],
        },
      },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Worker startup timeout")),
          50000,
        );
        worker.once("error", reject);
        worker.on("message", (m) => {
          if (m.ready) {
            clearTimeout(timer);
            resolve(m.port);
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(
          () => reject(new Error("Registration timeout")),
          10000,
        );
        worker.on("message", (m) => {
          if (m.reply === requestId) {
            clearTimeout(timer);
            m.ok ? resolve() : reject(new Error("Registration failed"));
          }
        });
        worker.postMessage({ requestId, action: "register", session });
      });
      const request = async (path: string, body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            "content-type": "application/json",
            "x-demo-worker-key": secret,
            "x-demo-token": session.token,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15000),
        });
        return {
          status: response.status,
          data: (await response.json()) as any,
        };
      };
      const cfg = await request("mega-ball/config");
      assert.equal(cfg.status, 200);
      assert.equal(cfg.data.maxCards, 100);
      let round;
      const openingDeadline = Date.now() + 30000;
      do {
        round = (await request("mega-ball/round")).data;
        if (
          round?.phase === "betting" &&
          round.bettingEndsAt - round.now > 9000
        )
          break;
        await new Promise((r) => setTimeout(r, 200));
      } while (Date.now() < openingDeadline);
      assert.equal(round.phase, "betting");
      assert.equal(round.outcome, null);
      assert.equal(round.serverSeed, null);
      assert.equal(
        (await request(`mega-ball/${round.roundId}/verify`)).status,
        400,
      );
      assert.equal(
        (
          await request("mega-ball/bet", {
            roundId: round.roundId,
            count: 101,
            amountPaise: "100",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("mega-ball/bet", {
            roundId: round.roundId,
            count: 1,
            amountPaise: "0",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("mega-ball/bet", {
            roundId: round.roundId,
            count: 1,
            amountPaise: "100",
            cards: [],
          })
        ).status,
        400,
      );
      const before = (await request("wallet/balance")).data.balance;
      const body = { roundId: round.roundId, count: 100, amountPaise: "100" };
      const [purchase, retry] = await Promise.all([
        request("mega-ball/bet", body),
        request("mega-ball/bet", body),
      ]);
      assert.equal(purchase.status, 200, JSON.stringify(purchase.data));
      assert.equal(retry.status, 200, JSON.stringify(retry.data));
      assert.equal(purchase.data.slipId, retry.data.slipId);
      assert.equal(purchase.data.cards.length, 100);
      // Demo balances are deliberately unlimited; the ledger still records real debit/credit semantics.
      const debits = (await request("wallet/transactions")).data.entries.filter(
        (e: any) => e.type === "bet",
      );
      assert.equal(debits.length, 1);
      assert.equal(debits[0].amount, "-10000");
      assert.equal(
        (await request("mega-ball/bet", { ...body, count: 1 })).status,
        400,
      );
      const restored = (await request("mega-ball/round")).data;
      assert.deepEqual(restored.myBets[0].bets, purchase.data.cards);
      assert.equal(
        (
          await request(`bets/${purchase.data.betId}/cashout`, {
            multiplier: 100,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request(`bets/${purchase.data.betId}/lose`, { multiplier: 1 }))
          .status,
        400,
      );
      const deadline = Date.now() + 35000;
      let settled;
      do {
        round = (await request("mega-ball/round")).data;
        settled = round?.myBets.find(
          (b: any) =>
            b.slipId === purchase.data.slipId && b.status === "settled",
        );
        if (settled) break;
        await new Promise((r) => setTimeout(r, 200));
      } while (Date.now() < deadline);
      assert.ok(settled, "Confirmed cards must settle automatically");
      const expected = settleMegaBallCards(
        purchase.data.cards,
        round.outcome,
      ).totalPayout;
      assert.equal(BigInt(settled.payoutAmount), expected);
      const settledLedger = (await request("wallet/transactions")).data.entries;
      assert.equal(
        settledLedger.filter((e: any) => e.type === "bet").length,
        1,
      );
      assert.equal(
        settledLedger
          .filter((e: any) => e.type === "win")
          .reduce((sum: bigint, e: any) => sum + BigInt(e.amount), 0n),
        expected,
      );
      const history = await request("mega-ball/recent");
      assert.equal(history.data[0].payoutAmount, expected.toString());
      const verified = await request(`mega-ball/${body.roundId}/verify`);
      assert.equal(verified.status, 200);
      assert.equal(verified.data.verified, true);
      const late = await request("mega-ball/bet", { ...body, count: 2 });
      assert.equal(late.status, 400);
      const repeated = await request("mega-ball/bet", body);
      assert.equal(repeated.data.slipId, purchase.data.slipId);
      assert.equal(
        (await request("wallet/transactions")).data.entries.length,
        settledLedger.length,
      );
    } finally {
      await worker.terminate();
    }
  },
);
