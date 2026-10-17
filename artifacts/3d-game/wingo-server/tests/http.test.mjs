import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWinGoServer } from "../server.mjs";

test("HTTP sessions, JSON validation, CSRF protection, settlement and session isolation", async (t) => {
  let time = 1801000;
  const { server } = createWinGoServer({
    filename: ":memory:",
    now: () => time,
    draw: () => 5,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie, headers = {}) =>
    fetch(`${base}/api/wingo/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(`${base}/api/wingo/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/wingo/state`)).status, 401);
  const session = await post("session", {}),
    cookie = session.headers.get("set-cookie").split(";")[0];
  assert.match(session.headers.get("set-cookie"), /HttpOnly/);
  assert.match(session.headers.get("set-cookie"), /SameSite=Strict/);
  const initial = await session.json();
  assert.equal(initial.round.number, undefined);
  assert.equal(initial.round.secret, undefined);
  assert.equal(
    (await post("bets", {}, cookie, { Origin: "https://unrelated.example" }))
      .status,
    403,
  );
  assert.equal(
    (await post("bets", {}, cookie, { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal((await post("bets", null, cookie)).status, 400);
  assert.equal((await post("bets", {}, cookie)).status, 400);
  const input = {
    duration: 30,
    period: initial.round.period,
    pick: "5",
    stake: 1000,
    request: randomUUID(),
  };
  const replies = await Promise.all([
    post("bets", input, cookie),
    post("bets", input, cookie),
  ]);
  for (const response of replies) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).player.balance, 999000);
  }
  const stranger = await post("session", {});
  const strangerState = await stranger.json();
  assert.equal(strangerState.bets.length, 0);
  assert.equal(strangerState.player.balance, 1000000);
  time = initial.round.ends;
  const settled = await (
    await fetch(`${base}/api/wingo/state?duration=30`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(settled.bets.length, 1);
  assert.equal(settled.bets[0].payout, 9000);
  assert.equal(settled.player.balance, 1008000);
  assert.equal(settled.history[0].number, 5);
  const resume = await post("session", {}, cookie);
  assert.equal((await resume.json()).player.id, initial.player.id);
});
