import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createLotteryServer } from "../server.mjs";

test("HTTP authentication, role isolation, receipt access and CSRF protection", async (t) => {
  const { server } = createLotteryServer({ filename: ":memory:" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/lottery`;
  const call = (
    path,
    { role = "shop", cookie = "", body, headers = {} } = {},
  ) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lottery-Request": "1",
        "X-Lottery-Role": role,
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await call("/bootstrap")).status, 401);
  const login = await call("/login", {
    body: { role: "shop", id: "SHP-3001", password: "Lottery@123" },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  const state = await (await call("/bootstrap", { cookie })).json();
  assert.equal(state.account.role, "shop");
  assert.ok(!("password" in state.account));
  assert.ok(
    state.draws.filter((d) => d.status === "open").every((d) => !d.seed),
  );
  assert.equal(
    (await call("/bootstrap", { cookie, role: "admin" })).status,
    401,
  );
  assert.equal(
    (await call("/settings", { cookie, body: state.settings })).status,
    403,
  );
  assert.equal(
    (
      await call("/tickets", {
        cookie,
        body: {},
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/tickets", {
        cookie,
        body: {},
        headers: { "X-Lottery-Request": "" },
      })
    ).status,
    403,
  );
  const draw = state.draws.find(
    (d) => d.status === "open" && d.closes > Date.now(),
  );
  const sale = await call("/tickets", {
    cookie,
    body: {
      drawId: draw.id,
      game: "2D",
      lines: [{ series: "JP10", number: "00", quantity: 1 }],
    },
    headers: { "Idempotency-Key": "http-sale-1" },
  });
  assert.equal(sale.status, 201);
  const ticket = await sale.json();
  assert.equal(
    (await call(`/tickets/${ticket.id}/receipt`, { cookie, body: {} })).status,
    200,
  );
  const userLogin = await call("/login", {
      role: "user",
      body: { role: "user", id: "USR-4001", password: "Lottery@123" },
    }),
    userCookie = userLogin.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await call(`/tickets/${ticket.id}/receipt`, {
        role: "user",
        cookie: userCookie,
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/tickets/${ticket.id}/cancel`, {
        role: "user",
        cookie: userCookie,
        body: {},
      })
    ).status,
    404,
  );
  await call("/logout", { cookie, body: {} });
  assert.equal((await call("/bootstrap", { cookie })).status, 401);
});
