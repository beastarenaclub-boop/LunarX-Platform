import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoSessions, DEMO_TTL_MS, DEMO_LIVE_MS, demoPublicUser } from "../sessions";
import { demoRouteAllowed } from "../policy";

test("anonymous presence counts sessions once and expires after an absolute hour", () => {
  let now = 10_000;
  const store = new DemoSessions(() => now);
  const first = store.create();
  const second = store.create();
  assert.notEqual(first.token, second.token);
  for (let tab = 0; tab < 5; tab++) store.touch(first.token);
  assert.equal(store.liveCount(), 2);
  now += DEMO_LIVE_MS;
  assert.equal(store.liveCount(), 0);
  store.touch(first.token);
  assert.equal(store.liveCount(), 1);
  assert.equal(first.expiresAt, first.createdAt + DEMO_TTL_MS);
  now = first.expiresAt - 1;
  assert.ok(store.touch(first.token));
  now++;
  assert.equal(store.get(first.token), undefined);
  assert.equal(store.liveCount(), 0);
  assert.deepEqual(Object.keys(first).sort(), ["createdAt", "expiresAt", "id", "lastSeen", "token"]);
  assert.equal(demoPublicUser(first).email, "");
});

test("logout removes presence immediately and bounded capacity recovers on expiry", () => {
  let now = 1000;
  const store = new DemoSessions(() => now, 1);
  const session = store.create();
  assert.throws(() => store.create(), /DEMO_CAPACITY/);
  store.remove(session.token);
  assert.equal(store.liveCount(), 0);
  store.create();
  now += DEMO_TTL_MS;
  assert.ok(store.create());
});

test("demo allowlist blocks money, identity, admin and partner routes", () => {
  for (const path of ["/api/payments/withdrawals", "/api/payments/deposits", "/api/network/transfer", "/api/admin/users",
    "/api/kyc", "/api/profile", "/api/launcher", "/v1/bets", "/launch", "/api/demo-nudge/events",
    "/api/prize-lotto/tickets/example/claim", "/api/prize-lotto/tickets/example/CLAIM/"]) {
    assert.equal(demoRouteAllowed("POST", path), false, path);
    assert.equal(demoRouteAllowed("GET", path), false, path);
  }
  assert.equal(demoRouteAllowed("POST", "/api/wallet/balances"), false);
  assert.equal(demoRouteAllowed("PUT", "/api/game/config/mines"), false);
  assert.equal(demoRouteAllowed("POST", "/api/mines/place"), true);
  assert.equal(demoRouteAllowed("GET", "/api/wallet/balances"), true);
});
