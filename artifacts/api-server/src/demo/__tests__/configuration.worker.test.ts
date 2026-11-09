import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { DemoSessions } from "../sessions";

test("built worker applies startup and refreshed B2C policy to real Dice bets", { timeout: 60000 }, async () => {
  const secret = randomUUID();
  const configuration = { configs: [{ gameCode: "dice", enabled: true, houseEdge: .15 }],
    policies: [{ gameCode: "dice", playerRtpBps: 8800 as number | null, revision: 1 }] };
  const worker = new Worker(new URL("../../../dist/demo-worker.mjs", import.meta.url), {
    env: { NODE_ENV: "production", LOG_LEVEL: "silent", DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden" },
    execArgv: [], workerData: { secret, configuration },
  });
  const callbacks = new Map<string, (message: any) => void>();
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Demo startup timed out")), 30000);
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.on("message", message => {
        if (message.ready) { clearTimeout(timer); resolve(message.port); }
        else if (message.reply) { callbacks.get(message.reply)?.(message); callbacks.delete(message.reply); }
      });
    });
    async function command(data: object) {
      const requestId = randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Demo command timed out")), 10000);
        callbacks.set(requestId, message => { clearTimeout(timer); message.ok ? resolve() : reject(new Error("Demo command failed")); });
        worker.postMessage({ ...data, requestId });
      });
    }
    const session = new DemoSessions().create();
    await command({ action: "register", session });
    async function request(path: string, body?: object) {
      const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
        method: body ? "POST" : "GET", headers: { "x-demo-worker-key": secret, "x-demo-token": session.token, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
      });
      const bodyText = await response.text();
      const data: any = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bodyText) : bodyText;
      return { status: response.status, data };
    }
    const first = await request("dice/config");
    assert.equal(first.status, 200); assert.equal(first.data.houseEdge, .12);
    assert.equal(first.data.rtpPolicy.source, "b2c");
    const bet = { stakeAmount: "10000", target: 50, direction: "under", pricingVersion: first.data.pricingVersion };
    const roll = await request("dice/roll", bet);
    assert.equal(roll.status, 200); assert.equal(roll.data.houseEdge, .12);
    configuration.policies[0] = { gameCode: "dice", playerRtpBps: 9200, revision: 2 };
    await command({ action: "configure", configuration });
    assert.equal((await request("dice/roll", bet)).status, 409);
    const refreshed = await request("dice/config");
    assert.equal(refreshed.data.houseEdge, .08);
    assert.notEqual(refreshed.data.pricingVersion, first.data.pricingVersion);
    const next = await request("dice/roll", { ...bet, pricingVersion: refreshed.data.pricingVersion });
    assert.equal(next.status, 200); assert.equal(next.data.houseEdge, .08);
    configuration.policies[0] = { gameCode: "dice", playerRtpBps: null, revision: 3 };
    await command({ action: "configure", configuration });
    const reverted = await request("dice/config");
    assert.equal(reverted.data.houseEdge, .15); assert.equal(reverted.data.rtpPolicy.revision, 3);
    assert.equal((await request("admin/game-control")).status, 403);
  } finally { await worker.terminate(); }
});
