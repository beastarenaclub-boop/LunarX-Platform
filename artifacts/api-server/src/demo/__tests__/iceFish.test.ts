import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { DemoSessions } from "../sessions";
import { ICE_FISH_SPOTS, settleIceFish } from "@workspace/api-zod/ice-fish";

test(
  "Ice Fish built worker: private seed, isolated wallet, exactly-once bet and complete settlement",
  { timeout: 90000 },
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
              gameCode: "ice-fish",
              enabled: true,
              houseEdge: 0.045,
              bettingWindowMs: 8000,
              revealDurationMs: 5000,
              settleDurationMs: 8000,
            },
          ],
        },
      },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Startup timeout")), 40000);
        worker.once("error", reject);
        worker.on("message", (m) => {
          if (m.ready) {
            clearTimeout(timer);
            resolve(m.port);
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        const requestId = randomUUID(),
          timer = setTimeout(
            () => reject(Error("Registration timeout")),
            10000,
          );
        worker.on("message", (m) => {
          if (m.reply === requestId) {
            clearTimeout(timer);
            m.ok ? resolve() : reject(Error("Registration failed"));
          }
        });
        worker.postMessage({ requestId, action: "register", session });
      });
      const request = async (path: string, body?: unknown) => {
        const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            "content-type": "application/json",
            "x-demo-worker-key": secret,
            "x-demo-token": session.token,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15000),
        });
        return { status: r.status, data: (await r.json()) as any };
      };
      const cfg = await request("ice-fish/config");
      assert.equal(cfg.status, 200);
      assert.equal(cfg.data.houseEdge, 0.045);
      const wallet = async () =>
        BigInt((await request("wallet/balance")).data.balance);
      const getRound = async () => {
        const r = await request("ice-fish/round");
        assert.equal(r.status, 200);
        return r.data;
      };
      let round = await getRound();
      const until = Date.now() + 30000;
      while (
        (!round ||
          round.phase !== "betting" ||
          round.bettingEndsAt - round.now < 4500) &&
        Date.now() < until
      ) {
        await new Promise((r) => setTimeout(r, 250));
        round = await getRound();
      }
      assert.equal(round.gameCode, "ice-fish");
      assert.equal(round.phase, "betting");
      assert.equal(round.outcome, null);
      assert.equal(round.serverSeed, null);
      const before = await wallet(),
        bets = ICE_FISH_SPOTS.map((type) => ({ type, amountPaise: "1000" }));
      const body = {
        roundId: round.roundId,
        idempotencyKey: randomUUID(),
        pricingVersion: round.config.pricingVersion,
        bets,
      };
      const receipt = await request("ice-fish/bet", body);
      assert.equal(receipt.status, 200, JSON.stringify(receipt.data));
      assert.equal(receipt.data.totalStake, "5000");
      assert.equal(
        (await request("ice-fish/bet", body)).data.slipId,
        receipt.data.slipId,
      );
      // Demo displays an unlimited balance; verify its isolated ledger instead.
      assert.equal(await wallet(), before);
      const debits = (await request("wallet/transactions")).data.entries.filter(
        (entry: any) => entry.type === "bet",
      );
      assert.equal(debits.length, 1);
      assert.equal(debits[0].amount, "-5000");
      assert.equal(
        (
          await request(`bets/${receipt.data.betId}/cashout`, {
            multiplier: 5000,
          })
        ).status,
        400,
      );
      const untilSettled = Date.now() + 30000;
      let settled;
      while (Date.now() < untilSettled) {
        round = await getRound();
        settled = round?.myBets.find(
          (b: any) =>
            b.slipId === receipt.data.slipId && b.status === "settled",
        );
        if (settled) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(settled, "Scheduler must settle the accepted slip");
      const expected = settleIceFish(bets, round.outcome, 0.045).totalPayout;
      assert.equal(BigInt(settled.payoutAmount), expected);
      assert.equal(await wallet(), before);
      const ledger = (await request("wallet/transactions")).data.entries;
      assert.equal(
        ledger.filter((entry: any) => entry.type === "bet").length,
        1,
      );
      assert.equal(
        ledger
          .filter((entry: any) => entry.type === "win")
          .reduce((sum: bigint, entry: any) => sum + BigInt(entry.amount), 0n),
        expected,
      );
      assert.equal(
        (await request(`ice-fish/${body.roundId}/verify`)).data.verified,
        true,
      );
      assert.equal(
        (await request("ice-fish/bet", body)).data.slipId,
        receipt.data.slipId,
      );
      assert.equal(
        (await request("wallet/transactions")).data.entries.length,
        ledger.length,
      );
      assert.equal((await request("ice-fish/recent")).data.length, 1);
    } finally {
      await worker.terminate();
    }
  },
);
