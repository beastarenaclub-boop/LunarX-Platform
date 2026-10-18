import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialDemo,
  applyDemo,
  collectorFor,
  actor,
  available,
  weeklyLocked,
  dateRange,
  visibleRequests,
  DEMO_CLOCKS,
  type DemoState,
  type ActorId,
  type DemoAction,
} from "./model";
const admin = "demo-admin",
  master = "demo-master-east",
  west = "demo-master-west",
  alpha = "demo-agent-alpha",
  beta = "demo-agent-beta",
  user = "demo-user-asha",
  ravi = "demo-user-ravi",
  neha = "demo-user-neha";
const run = (s: DemoState, id: ActorId, a: DemoAction) => applyDemo(s, id, a);
function delegated() {
  let s = run(initialDemo(), admin, {
    type: "master-mode",
    master,
    mode: "master",
  });
  s = run(s, master, { type: "add-account", slot: "A" });
  s = run(s, master, { type: "agent-mode", agent: alpha, mode: "agent" });
  return run(s, alpha, { type: "add-account", slot: "A" });
}
function deposit(s: DemoState, id: ActorId, amount: number) {
  const owner = collectorFor(s, actor(id)),
    account = s.accounts.find((a) => a.owner === owner && a.active)!;
  return run(s, id, {
    type: "request",
    kind: "deposit",
    amount,
    account: account?.id,
  });
}
function approveLast(s: DemoState) {
  const r = s.requests.at(-1)!;
  return run(s, r.collector, {
    type: "review",
    id: r.id,
    decision: "approved",
  });
}

test("central collection needs explicit approval, reserves withdrawals and rejects repeated approvals", () => {
  let s = initialDemo();
  assert.equal(collectorFor(s, actor(user)), admin);
  s = deposit(s, user, 500);
  const depositId = s.requests[0]!.id;
  assert.equal(available(s, user), 0);
  assert.throws(
    () =>
      run(s, master, { type: "review", id: depositId, decision: "approved" }),
    /assigned collector/,
  );
  s = approveLast(s);
  assert.equal(available(s, user), 500);
  assert.throws(
    () =>
      run(s, admin, { type: "review", id: depositId, decision: "approved" }),
    /already been processed/,
  );
  s = run(s, user, { type: "request", kind: "withdrawal", amount: 200 });
  assert.equal(s.balances[user], 500);
  assert.equal(available(s, user), 300);
  assert.throws(
    () => run(s, user, { type: "request", kind: "withdrawal", amount: 400 }),
    /Not enough/,
  );
  s = run(s, admin, {
    type: "review",
    id: s.requests.at(-1)!.id,
    decision: "rejected",
  });
  assert.equal(available(s, user), 500);
  s = run(s, user, { type: "request", kind: "withdrawal", amount: 200 });
  s = approveLast(s);
  assert.equal(s.balances[user], 300);
  assert.equal(available(s, user), 300);
});
test("only assigned masters can delegate agents, and scopes cannot cross branches", () => {
  let s = initialDemo();
  assert.throws(
    () => run(s, master, { type: "master-mode", master, mode: "master" }),
    /Only the demo admin/,
  );
  assert.throws(
    () => run(s, master, { type: "agent-mode", agent: alpha, mode: "agent" }),
    /assign master collection first/,
  );
  s = delegated();
  assert.equal(collectorFor(s, actor(user)), alpha);
  assert.equal(collectorFor(s, actor(ravi)), master);
  assert.equal(collectorFor(s, actor(neha)), admin);
  assert.throws(
    () => run(s, west, { type: "agent-mode", agent: alpha, mode: "agent" }),
    /this agent's master/,
  );
  assert.throws(
    () => run(s, alpha, { type: "agent-mode", agent: alpha, mode: "master" }),
    /this agent's master/,
  );
  s = deposit(s, user, 200);
  s = deposit(s, ravi, 300);
  s = deposit(s, neha, 400);
  assert.equal(visibleRequests(s, actor(admin)).length, 3);
  assert.equal(visibleRequests(s, actor(master)).length, 2);
  assert.equal(visibleRequests(s, actor(alpha)).length, 1);
  assert.equal(visibleRequests(s, actor(user)).length, 1);
  assert.throws(
    () =>
      run(s, master, {
        type: "review",
        id: s.requests[0]!.id,
        decision: "approved",
      }),
    /assigned collector/,
  );
  assert.throws(
    () => run(s, alpha, { type: "team-status", agent: beta, active: false }),
    /own demo team/,
  );
});
test("account ownership, mode changes and delegation revocation preserve request ownership", () => {
  let s = delegated();
  const alphaAccount = s.accounts.find((a) => a.owner === alpha)!;
  assert.throws(
    () => run(s, beta, { type: "add-account", slot: "A" }),
    /permission/,
  );
  assert.throws(
    () =>
      run(s, user, {
        type: "request",
        kind: "deposit",
        amount: 50,
        account: "demo-account-admin",
      }),
    /assigned collector/,
  );
  s = deposit(s, user, 50);
  const requestId = s.requests[0]!.id;
  assert.throws(
    () => run(s, master, { type: "agent-mode", agent: alpha, mode: "master" }),
    /pending requests/,
  );
  assert.throws(
    () =>
      run(s, alpha, {
        type: "account-status",
        id: alphaAccount.id,
        active: false,
      }),
    /pending deposits/,
  );
  s = run(s, user, { type: "cancel", id: requestId });
  s = run(s, admin, { type: "master-mode", master, mode: "admin" });
  assert.equal(s.agentModes[alpha], "master");
  assert.equal(s.requests[0]!.collector, alpha);
  s = run(s, admin, { type: "master-mode", master, mode: "master" });
  assert.equal(collectorFor(s, actor(user)), master); // Old delegation is not restored.
  s = approveLast(deposit(s, user, 100));
  assert.throws(
    () => run(s, admin, { type: "master-mode", master, mode: "admin" }),
    /test balances/,
  );
});
test("Monday grace ends exactly Tuesday IST; partial/unconfirmed receipts do not unlock", () => {
  let s = delegated();
  s = approveLast(deposit(s, user, 500));
  assert.equal(weeklyLocked(s, master), false);
  s = {
    ...s,
    clock: new Date(Date.parse(DEMO_CLOCKS.tuesday) - 1).toISOString(),
  };
  assert.equal(weeklyLocked(s, master), false);
  s = { ...s, clock: DEMO_CLOCKS.tuesday };
  assert.equal(weeklyLocked(s, master), true);
  assert.throws(() => deposit(s, user, 100), /branch locked/);
  s = run(s, user, { type: "request", kind: "withdrawal", amount: 100 });
  s = approveLast(s);
  assert.equal(available(s, user), 400);
  s = run(s, master, { type: "submit-settlement", amount: 40 });
  assert.equal(weeklyLocked(s, master), true);
  assert.throws(
    () =>
      run(s, alpha, {
        type: "review-settlement",
        id: s.settlements[0]!.id,
        decision: "confirmed",
      }),
    /Only the demo admin/,
  );
  assert.throws(
    () => run(s, master, { type: "submit-settlement", amount: 100 }),
    /exceeds/,
  );
  s = run(s, admin, {
    type: "review-settlement",
    id: s.settlements[0]!.id,
    decision: "confirmed",
  });
  assert.equal(weeklyLocked(s, master), true);
  assert.throws(
    () =>
      run(s, admin, {
        type: "review-settlement",
        id: s.settlements[0]!.id,
        decision: "confirmed",
      }),
    /already/,
  );
  s = run(s, master, { type: "submit-settlement", amount: 60 });
  s = run(s, admin, {
    type: "review-settlement",
    id: s.settlements[1]!.id,
    decision: "confirmed",
  });
  assert.equal(weeklyLocked(s, master), false);
  assert.equal(s.balances[user], 400);
  assert.doesNotThrow(() => deposit(s, user, 100));
  assert.throws(
    () => run(s, admin, { type: "master-mode", master, mode: "admin" }),
    /receipts/,
  );
  assert.equal(
    weeklyLocked({ ...initialDemo(), clock: DEMO_CLOCKS.tuesday }, master),
    false,
  ); // Admin already retains its share.
});
test("paused teams can unwind withdrawals; rejected operations leave state unchanged", () => {
  let s = approveLast(deposit(delegated(), user, 500));
  s = run(s, master, { type: "team-status", agent: alpha, active: false });
  const before = JSON.stringify(s);
  assert.throws(() => deposit(s, user, 100), /paused/);
  assert.equal(JSON.stringify(s), before);
  for (const value of [-1, 0, 0.5, NaN, Infinity, 1000001])
    assert.throws(
      () =>
        run(s, user, { type: "request", kind: "withdrawal", amount: value }),
      /whole number/,
    );
  s = run(s, user, { type: "request", kind: "withdrawal", amount: 300 });
  assert.equal(available(s, user), 200);
  s = run(s, user, { type: "cancel", id: s.requests.at(-1)!.id });
  assert.equal(available(s, user), 500);
  s = run(s, user, { type: "request", kind: "withdrawal", amount: 500 });
  s = approveLast(s);
  assert.equal(available(s, user), 0);
});
test("date filters use the simulation clock and Monday-based India weeks", () => {
  assert.deepEqual(dateRange(DEMO_CLOCKS.tuesday, "today"), {
    from: "2026-10-20",
    to: "2026-10-20",
  });
  assert.deepEqual(dateRange(DEMO_CLOCKS.tuesday, "yesterday"), {
    from: "2026-10-19",
    to: "2026-10-19",
  });
  assert.deepEqual(dateRange(DEMO_CLOCKS.tuesday, "weekly"), {
    from: "2026-10-19",
    to: "2026-10-20",
  });
  assert.deepEqual(dateRange(DEMO_CLOCKS.monday, "monthly"), {
    from: "2026-10-01",
    to: "2026-10-19",
  });
  assert.throws(
    () => dateRange(DEMO_CLOCKS.monday, "custom", "2026-10-20", "2026-10-19"),
    /precede/,
  );
});
