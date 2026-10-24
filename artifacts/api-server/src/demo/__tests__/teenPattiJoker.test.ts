import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { DemoSessions } from "../sessions";
import { jokerPayout, JOKER_SPOTS, type JokerHistory, type JokerSpot } from "@workspace/api-zod/teenpatti-joker";
import type { TableRoundSnapshot } from "../../services/tableRounds";
import type { placeJokerBets, verifyJokerRound } from "../../services/teenPattiJoker";

type JokerResponse<Path extends string> =
  Path extends "teen-patti-joker/config" ? { payouts: Record<JokerSpot, number> } :
  Path extends "teen-patti-joker/round" ? TableRoundSnapshot :
  Path extends "teen-patti-joker/bet" ? Awaited<ReturnType<typeof placeJokerBets>> :
  Path extends "teen-patti-joker/history" ? JokerHistory[] :
  Awaited<ReturnType<typeof verifyJokerRound>>;

test(
  "Joker HTTP rounds hide cards, confirm once, settle exactly and replay the committed deck",
  { timeout: 65000 },
  async () => {
    const secret = randomUUID();
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
              gameCode: "teen-patti-joker",
              enabled: true,
              bettingWindowMs: 8000,
              revealDurationMs: 2000,
              settleDurationMs: 1000,
            },
          ],
        },
      },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Worker startup timed out")),
          30000,
        );
        worker.once("error", reject);
        worker.on("message", (m) => {
          if (m.ready) {
            clearTimeout(timer);
            resolve(m.port);
          }
        });
      });
      const sessions = new DemoSessions();
      async function visitor() {
        const session = sessions.create(),
          requestId = randomUUID();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Registration timed out")),
            10000,
          );
          const done = (m: any) => {
            if (m.reply === requestId) {
              clearTimeout(timer);
              worker.off("message", done);
              m.ok ? resolve() : reject(new Error("Register failed"));
            }
          };
          worker.on("message", done);
          worker.postMessage({ action: "register", requestId, session });
        });
        return session;
      }
      const a = await visitor(),
        b = await visitor();
      async function request<Path extends string>(path: Path, body?: unknown, session = a) {
        const res = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            "x-demo-worker-key": secret,
            "x-demo-token": session.token,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(8000),
        });
        return { status: res.status, data: await res.json() as JokerResponse<Path> };
      }
      async function ok<Path extends string>(path: Path, body?: unknown, session = a) {
        const r = await request(path, body, session);
        assert.equal(r.status, 200, JSON.stringify(r.data));
        return r.data;
      }
      const config = await ok("teen-patti-joker/config");
      assert.equal(config.payouts.playerA, 1.98);
      assert.equal(config.payouts.even, 2.1);
      let round: any;
      const until = Date.now() + 20000;
      do {
        round = await ok("teen-patti-joker/round");
        if (
          round?.phase === "betting" &&
          round.bettingEndsAt - round.now > 3000
        )
          break;
        await new Promise((r) => setTimeout(r, 200));
      } while (Date.now() < until);
      assert.equal(round.phase, "betting");
      assert.equal(round.outcome, null);
      assert.equal(round.serverSeed, null);
      assert.match(round.serverSeedHash, /^[a-f0-9]{64}$/);
      assert.equal(
        (await request(`teen-patti-joker/${round.roundId}/verify`)).status,
        400,
      );
      const bets = JOKER_SPOTS.map((spot) => ({ spot, amountPaise: "1001" })),
        payload = { roundId: round.roundId, bets };
      const receipts = await Promise.all([
        ok("teen-patti-joker/bet", payload),
        ok("teen-patti-joker/bet", { ...payload, bets: [...bets].reverse() }),
      ]);
      assert.equal(receipts[0].slipId, receipts[1].slipId);
      assert.equal((await ok("teen-patti-joker/round")).myBets.length, 1);
      assert.equal(
        (await ok("teen-patti-joker/round", undefined, b)).myBets.length,
        0,
      );
      assert.equal(
        (
          await request("teen-patti-joker/bet", {
            roundId: round.roundId,
            bets: [{ spot: "odd", amountPaise: "2000" }],
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            "teen-patti-joker/bet",
            {
              roundId: round.roundId,
              bets: [{ spot: "even", amountPaise: "-1000" }],
            },
            b,
          )
        ).status,
        400,
      );
      assert.equal((await ok("teen-patti-joker/history"))[0].outcome, null);
      const historyDeadline = Date.now() + 20000;
      let history: JokerHistory[] = [];
      do {
        history = await ok("teen-patti-joker/history");
        if (history[0]?.status === "settled") break;
        await new Promise((r) => setTimeout(r, 250));
      } while (Date.now() < historyDeadline);
      assert.equal(history[0].status, "settled");
      assert.equal(history.length, 1);
      assert.ok(history[0].outcome);
      assert.equal(
        history[0].payoutAmount,
        String(jokerPayout(bets, history[0].outcome)),
      );
      assert.equal(
        (await request("teen-patti-joker/bet", payload, b)).status,
        400,
      );
      // Slip settlement precedes the end of the result-display window.
      let verification = await request(
        `teen-patti-joker/${round.roundId}/verify`,
      );
      const verifyDeadline = Date.now() + 5000;
      while (verification.status === 400 && Date.now() < verifyDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        verification = await request(
          `teen-patti-joker/${round.roundId}/verify`,
        );
      }
      assert.equal(verification.status, 200, JSON.stringify(verification.data));
      const verified = verification.data;
      assert.equal(verified.verified, true);
      assert.equal(verified.serverSeedHash, round.serverSeedHash);
      assert.deepEqual(verified.derived, history[0].outcome);
      assert.equal(
        (await ok("teen-patti-joker/history", undefined, b)).length,
        0,
      );
      assert.equal(
        (await ok("teen-patti-joker/bet", payload)).slipId,
        receipts[0].slipId,
      );
    } finally {
      await worker.terminate();
    }
  },
);
