import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, drawResults, sha, SERIES_PRICES } from "../store.mjs";

const ids = {
  admin: "ADM-1001",
  agent: "AGT-2001",
  shop: "SHP-3001",
  user: "USR-4001",
};
function setup(t) {
  let clock = Date.parse("2026-10-02T08:01:00Z");
  const store = createStore(":memory:", { now: () => clock });
  t.after(() => store.close());
  const actors = Object.fromEntries(
    Object.entries(ids).map(([role, id]) => [
      role,
      store.login(role, id, "Lottery@123").account,
    ]),
  );
  const next = () =>
    store
      .bootstrap(actors.shop)
      .draws.find((d) => d.status === "open" && d.closes > clock);
  const body = (overrides = {}) => ({
    drawId: next().id,
    game: "2D",
    lines: [{ series: "JP10", number: "07", quantity: 10 }],
    ...overrides,
  });
  const balance = (actor) => store.bootstrap(actor).account.balance;
  return {
    store,
    ...actors,
    next,
    body,
    balance,
    setTime: (t) => {
      clock = t;
    },
  };
}
test("distinct role logins cannot authenticate another portal", (t) => {
  const s = setup(t);
  assert.throws(
    () => s.store.login("admin", ids.shop, "Lottery@123"),
    /incorrect/,
  );
  const login = s.store.login("shop", ids.shop, "Lottery@123");
  assert.equal(s.store.authenticate(login.token, "admin"), null);
  assert.equal(s.store.authenticate(login.token, "shop").id, ids.shop);
});

test("fixed series prices ignore client prices and settle the actual winning series stake", (t) => {
  const s = setup(t),
    d = s.next();
  assert.deepEqual(d.config.seriesPrices, SERIES_PRICES);
  const seed = s.store.db
    .prepare("SELECT seed FROM draws WHERE id=?")
    .get(d.id).seed;
  const results = drawResults(seed);
  const ticket = s.store.sell(
    s.shop,
    s.body({
      lines: [
        {
          series: "JP10",
          number: results.JP10["2D"],
          quantity: 2,
          unitPrice: 1,
        },
        {
          series: "JP19",
          number: results.JP19["2D"],
          quantity: 1,
          unitPrice: 1,
        },
      ],
    }),
    "mixed-series-prices",
  );
  assert.equal(ticket.total, 10200);
  assert.deepEqual(
    ticket.lines.map((line) => line.unitPrice),
    [100, 10000],
  );
  assert.equal(s.balance(s.shop), 14800);
  const receipt = s.store.receipt(s.shop, ticket.id);
  assert.equal(
    receipt.lines.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0,
    ),
    receipt.total,
  );
  s.setTime(d.ends);
  s.store.tick();
  assert.equal(s.store.bootstrap(s.shop).tickets[0].payout, 816000);
  assert.equal(s.balance(s.agent), 100510);
});

test("series prices require all ten integer rates between 100 and 10000", (t) => {
  const s = setup(t),
    config = s.store.bootstrap(s.admin).settings;
  for (const price of [99, 10001, 100.5, "100", null]) {
    assert.throws(
      () =>
        s.store.updateSettings(s.admin, {
          ...config,
          seriesPrices: { ...SERIES_PRICES, JP19: price },
        }),
      /Irland Lotto 19 price/,
    );
  }
  assert.throws(
    () =>
      s.store.updateSettings(s.admin, {
        ...config,
        seriesPrices: { JP10: 100 },
      }),
    /Irland Lotto 11 price/,
  );
  assert.deepEqual(
    s.store.bootstrap(s.admin).settings.seriesPrices,
    SERIES_PRICES,
  );
});

test("series migration preserves legacy tickets, draw snapshots and later admin rates", () => {
  const dir = mkdtempSync(join(tmpdir(), "lottodesk-series-")),
    filename = join(dir, "migration.sqlite");
  const clock = Date.parse("2026-10-02T08:01:00Z");
  let store = createStore(filename, { now: () => clock });
  try {
    const actor = store.login("shop", ids.shop, "Lottery@123").account;
    const admin = store.login("admin", ids.admin, "Lottery@123").account;
    const initial = store.bootstrap(actor),
      open = initial.draws.filter((d) => d.status === "open");
    const legacy = { ...initial.settings };
    delete legacy.seriesPrices;
    store.db.prepare("UPDATE settings SET value=?").run(JSON.stringify(legacy));
    store.db
      .prepare("UPDATE draws SET settings=? WHERE status='open'")
      .run(JSON.stringify(legacy));
    store.db
      .prepare("DELETE FROM migrations WHERE name=?")
      .run("2026-10-nice-series-prices");
    const seed = store.db
      .prepare("SELECT seed FROM draws WHERE id=?")
      .get(open[0].id).seed;
    const ticket = store.sell(
      actor,
      {
        drawId: open[0].id,
        game: "2D",
        lines: [
          { series: "JP19", number: drawResults(seed).JP19["2D"], quantity: 1 },
        ],
      },
      "old-one-rupee-sale",
    );
    store.db
      .prepare("UPDATE tickets SET lines=? WHERE id=?")
      .run(
        JSON.stringify(ticket.lines.map(({ unitPrice, ...line }) => line)),
        ticket.id,
      );
    assert.equal(ticket.total, 1);
    store.close();
    store = createStore(filename, { now: () => clock });
    const migrated = store.bootstrap(actor);
    assert.equal(migrated.account.balance, 24999);
    assert.equal(migrated.tickets[0].lines[0].unitPrice, 1);
    assert.equal(
      migrated.draws.find((d) => d.id === open[0].id).config.seriesPrices,
      undefined,
    );
    assert.deepEqual(
      migrated.draws.find((d) => d.id === open[1].id).config.seriesPrices,
      SERIES_PRICES,
    );
    const fresh = store.sell(
      actor,
      {
        drawId: open[1].id,
        game: "2D",
        lines: [{ series: "JP19", number: "00", quantity: 1 }],
      },
      "new-nice19-sale",
    );
    assert.equal(fresh.total, 10000);
    store.cancel(actor, fresh.id);
    assert.equal(store.bootstrap(actor).account.balance, 24999);
    store.updateSettings(admin, {
      ...migrated.settings,
      seriesPrices: { ...SERIES_PRICES, JP19: 9000 },
    });
    store.close();
    store = createStore(filename, { now: () => open[0].ends });
    const restored = store.bootstrap(actor);
    assert.equal(restored.settings.seriesPrices.JP19, 9000);
    assert.equal(
      restored.draws.find((d) => d.id === open[1].id).config.seriesPrices.JP19,
      10000,
    );
    assert.equal(restored.tickets.find((t) => t.id === ticket.id).payout, 80);
  } finally {
    store.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(filename + suffix, { force: true });
    rmdirSync(dir);
  }
});
test("sale deducts exact integer rupees and preserves leading zeroes", (t) => {
  const s = setup(t);
  const ticket = s.store.sell(s.shop, s.body(), "sale-0001");
  assert.equal(ticket.total, 1000);
  assert.equal(ticket.lines[0].number, "07");
  assert.equal(s.balance(s.shop), 24000);
  assert.equal(s.store.bootstrap(s.shop).stats.sales, 1000);
});
test("idempotent retries issue one ticket and debit once", (t) => {
  const s = setup(t),
    body = s.body();
  const a = s.store.sell(s.shop, body, "sale-retry"),
    b = s.store.sell(s.shop, body, "sale-retry");
  assert.equal(a.id, b.id);
  assert.equal(s.balance(s.shop), 24000);
  assert.equal(s.store.bootstrap(s.shop).tickets.length, 1);
  assert.throws(
    () =>
      s.store.sell(s.shop, { ...body, customer: "different" }, "sale-retry"),
    /different action/,
  );
});
test("rejects invalid quantities, duplicated selections and insufficient balance atomically", (t) => {
  const s = setup(t);
  for (const quantity of [0, -1, 1.5, 501])
    assert.throws(
      () =>
        s.store.sell(
          s.shop,
          s.body({ lines: [{ series: "JP10", number: "07", quantity }] }),
          "bad-qty-" + quantity,
        ),
      /Quantity/,
    );
  assert.throws(
    () =>
      s.store.sell(
        s.shop,
        s.body({ lines: [{ series: "JP10", number: "7", quantity: 1 }] }),
        "badnumber",
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      s.store.sell(
        s.shop,
        s.body({
          lines: [
            { series: "JP10", number: "07", quantity: 10 },
            { series: "JP10", number: "07", quantity: 10 },
          ],
        }),
        "duplicate",
      ),
    /Duplicate/,
  );
  const body = s.body({
    lines: Array.from({ length: 11 }, (_, i) => ({
      series: "JP10",
      number: String(i).padStart(2, "0"),
      quantity: 5,
    })),
  });
  assert.throws(() => s.store.sell(s.user, body, "too-much-1"), /Insufficient/);
  assert.equal(s.balance(s.user), 5000);
  assert.equal(s.store.bootstrap(s.user).tickets.length, 0);
});
test("cutoff prevents sales and refunds from exactly 10 seconds before the draw", (t) => {
  const s = setup(t),
    d = s.next(),
    body = s.body();
  const ticket = s.store.sell(s.shop, body, "before-cut");
  s.setTime(d.closes);
  assert.throws(() => s.store.sell(s.shop, body, "after-cut1"), /closed/);
  assert.throws(() => s.store.cancel(s.shop, ticket.id), /open draw/);
});
test("ticket cancellation refunds exactly once and cannot be printed", (t) => {
  const s = setup(t);
  const ticket = s.store.sell(s.shop, s.body(), "cancel-one");
  s.store.cancel(s.shop, ticket.id);
  s.store.cancel(s.shop, ticket.id);
  assert.equal(s.balance(s.shop), 25000);
  assert.equal(s.store.bootstrap(s.shop).stats.sales, 0);
  assert.throws(() => s.store.receipt(s.shop, ticket.id), /Cancelled/);
});
test("only shop accounts can print their own receipts; reprints preserve the ID", (t) => {
  const s = setup(t);
  const ticket = s.store.sell(s.shop, s.body(), "print-one");
  for (const actor of [s.admin, s.agent, s.user])
    assert.throws(() => s.store.receipt(actor, ticket.id), /role/);
  assert.equal(s.store.receipt(s.shop, ticket.id).print_count, 1);
  assert.equal(s.store.receipt(s.shop, ticket.id).print_count, 2);
  const other = s.store.createAccount(s.agent, {
    role: "shop",
    name: "Other Shop",
    password: "A-long-password",
  });
  assert.throws(() => s.store.receipt(other, ticket.id), /not found/);
});
test("draw seed is hidden before settlement, then verifiable", (t) => {
  const s = setup(t),
    d = s.next();
  assert.equal(d.seed, undefined);
  s.setTime(d.ends);
  s.store.tick();
  const result = s.store.bootstrap(s.shop).draws.find((x) => x.id === d.id);
  assert.equal(result.status, "settled");
  assert.equal(sha(result.seed), d.commitment);
  assert.deepEqual(drawResults(result.seed), result.results);
});
test("winning shop claims credit once; commission settles once and survives tick retries", (t) => {
  const s = setup(t),
    d = s.next();
  const seed = s.store.db
      .prepare("SELECT seed FROM draws WHERE id=?")
      .get(d.id).seed,
    number = drawResults(seed).JP10["2D"];
  const ticket = s.store.sell(
    s.shop,
    s.body({ lines: [{ series: "JP10", number, quantity: 20 }] }),
    "winning-1",
  );
  s.setTime(d.ends);
  s.store.tick();
  s.store.tick();
  const won = s.store.bootstrap(s.shop).tickets[0];
  assert.equal(won.status, "won");
  assert.equal(won.payout, 160000);
  assert.equal(s.balance(s.agent), 100100);
  s.store.claim(s.shop, ticket.id);
  assert.equal(s.balance(s.shop), 183000);
  assert.throws(() => s.store.claim(s.shop, ticket.id), /already claimed/);
  assert.equal(s.balance(s.shop), 183000);
});
test("winning users receive automatic prizes and cannot print or manually claim", (t) => {
  const s = setup(t),
    d = s.next();
  const seed = s.store.db
      .prepare("SELECT seed FROM draws WHERE id=?")
      .get(d.id).seed,
    number = drawResults(seed).JP10["3D"];
  const ticket = s.store.sell(
    s.user,
    s.body({ game: "3D", lines: [{ series: "JP10", number, quantity: 1 }] }),
    "user-win01",
  );
  s.setTime(d.ends);
  s.store.tick();
  assert.equal(s.store.bootstrap(s.user).tickets[0].status, "claimed");
  assert.equal(s.balance(s.user), 84900);
  assert.throws(() => s.store.claim(s.user, ticket.id), /role/);
});
test("cancelled winners do not earn a prize or agent commission", (t) => {
  const s = setup(t),
    d = s.next();
  const seed = s.store.db
    .prepare("SELECT seed FROM draws WHERE id=?")
    .get(d.id).seed;
  const ticket = s.store.sell(
    s.shop,
    s.body({
      lines: [
        { series: "JP10", number: drawResults(seed).JP10["2D"], quantity: 10 },
      ],
    }),
    "cancel-win",
  );
  s.store.cancel(s.shop, ticket.id);
  s.setTime(d.ends);
  s.store.tick();
  assert.equal(s.balance(s.agent), 100000);
  assert.equal(s.balance(s.shop), 25000);
  assert.equal(s.store.bootstrap(s.shop).tickets[0].status, "cancelled");
});
test("settings changes do not retroactively alter sold draw prices or payouts", (t) => {
  const s = setup(t),
    d = s.next();
  const seed = s.store.db
    .prepare("SELECT seed FROM draws WHERE id=?")
    .get(d.id).seed;
  const config = s.store.bootstrap(s.admin).settings;
  s.store.updateSettings(s.admin, {
    ...config,
    unitPrice: 10,
    seriesPrices: { ...SERIES_PRICES, JP10: 500 },
    payouts: { "2D": 2, "3D": 4, Titli: 3 },
  });
  const ticket = s.store.sell(
    s.shop,
    s.body({
      lines: [
        { series: "JP10", number: drawResults(seed).JP10["2D"], quantity: 1 },
      ],
    }),
    "snapshot1",
  );
  assert.equal(ticket.total, 100);
  s.setTime(d.ends);
  s.store.tick();
  assert.equal(s.store.bootstrap(s.shop).tickets[0].payout, 8000);
});
test("agents only see their shops and can fund them, not unrelated accounts", (t) => {
  const s = setup(t);
  const otherAgent = s.store.createAccount(s.admin, {
    role: "agent",
    name: "Other Agent",
    password: "A-long-password",
  });
  const otherShop = s.store.createAccount(otherAgent, {
    role: "shop",
    name: "Other Shop",
    password: "A-long-password",
  });
  assert.ok(
    !s.store.bootstrap(s.agent).accounts.some((a) => a.id === otherShop.id),
  );
  assert.throws(
    () =>
      s.store.transfer(
        s.agent,
        { targetId: otherShop.id, amount: 10, note: "test" },
        "transferx",
      ),
    /own shops/,
  );
  const body = { targetId: s.shop.id, amount: 100, note: "Opening float" };
  s.store.transfer(s.agent, body, "transfer1");
  s.store.transfer(s.agent, body, "transfer1");
  assert.equal(s.balance(s.agent), 99900);
  assert.equal(s.balance(s.shop), 25100);
});
test("failed funding rolls back both sides and cannot create negative balances", (t) => {
  const s = setup(t);
  assert.throws(
    () =>
      s.store.transfer(
        s.agent,
        { targetId: s.shop.id, amount: 100001, note: "too much" },
        "transfer2",
      ),
    /Insufficient/,
  );
  assert.equal(s.balance(s.shop), 25000);
  assert.equal(s.balance(s.agent), 100000);
  assert.throws(
    () =>
      s.store.transfer(
        s.admin,
        { targetId: s.shop.id, amount: -1, note: "negative" },
        "transfer3",
      ),
    /Credits/,
  );
});
test("agents cannot escalate accounts, suspend users or change draw settings", (t) => {
  const s = setup(t);
  assert.throws(
    () =>
      s.store.createAccount(s.agent, {
        role: "admin",
        name: "Not Allowed",
        password: "A-long-password",
      }),
    /cannot create/,
  );
  assert.throws(() => s.store.setActive(s.agent, s.user.id, false), /role/);
  assert.throws(
    () => s.store.updateSettings(s.shop, s.store.bootstrap(s.admin).settings),
    /role/,
  );
  assert.throws(() => s.store.sell(s.admin, s.body(), "adminsale"), /role/);
});
test("suspension revokes sessions and suspended parents block shop sales", (t) => {
  const s = setup(t);
  const login = s.store.login("agent", ids.agent, "Lottery@123");
  s.store.setActive(s.admin, s.agent.id, false);
  assert.equal(s.store.authenticate(login.token, "agent"), null);
  assert.throws(() => s.store.sell(s.shop, s.body(), "suspended"), /suspended/);
});
test("pausing sales does not prevent ticket cancellation refunds", (t) => {
  const s = setup(t);
  const ticket = s.store.sell(s.shop, s.body(), "pause-old");
  s.store.updateSettings(s.admin, {
    ...s.store.bootstrap(s.admin).settings,
    salesEnabled: false,
  });
  assert.throws(() => s.store.sell(s.shop, s.body(), "pause-new"), /paused/);
  s.store.cancel(s.shop, ticket.id);
  assert.equal(s.balance(s.shop), 25000);
});
test("support requests are scoped; only admins can resolve them", (t) => {
  const s = setup(t);
  const request = s.store.complaint(s.shop, {
    subject: "Ticket question",
    message: "Please check my ticket purchase.",
  });
  assert.equal(s.store.bootstrap(s.user).complaints.length, 0);
  assert.equal(s.store.bootstrap(s.admin).complaints.length, 1);
  assert.throws(
    () => s.store.resolveComplaint(s.agent, request.id, "Checked"),
    /role/,
  );
  s.store.resolveComplaint(s.admin, request.id, "Resolved after checking.");
  assert.equal(s.store.bootstrap(s.shop).complaints[0].status, "resolved");
});
test("password changes revoke all sessions and reject old credentials", (t) => {
  const s = setup(t);
  const login = s.store.login("shop", ids.shop, "Lottery@123");
  s.store.changePassword(s.shop, {
    current: "Lottery@123",
    password: "New-Lottery-Password",
  });
  assert.equal(s.store.authenticate(login.token, "shop"), null);
  assert.throws(
    () => s.store.login("shop", ids.shop, "Lottery@123"),
    /incorrect/,
  );
  assert.equal(
    s.store.login("shop", ids.shop, "New-Lottery-Password").account.id,
    ids.shop,
  );
});
test("persistent database recovers tickets and overdue draw settlement on restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "lottodesk-test-")),
    filename = join(dir, "test.sqlite");
  let now = Date.parse("2026-10-02T08:01:00Z");
  let store = createStore(filename, { now: () => now });
  try {
    const actor = store.login("shop", ids.shop, "Lottery@123").account,
      d = store.bootstrap(actor).draws.find((d) => d.status === "open");
    const ticket = store.sell(
      actor,
      {
        drawId: d.id,
        game: "Titli",
        lines: [{ series: "JP10", number: "0", quantity: 1 }],
      },
      "durable-1",
    );
    store.close();
    now = d.ends + 60000;
    store = createStore(filename, { now: () => now });
    const restored = store
      .bootstrap(actor)
      .tickets.find((t) => t.id === ticket.id);
    assert.notEqual(restored.status, "pending");
    assert.ok(
      store.bootstrap(actor).ledger.some((l) => l.reference === ticket.id),
    );
  } finally {
    store.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(filename + suffix, { force: true });
    rmdirSync(dir);
  }
});

test("one-rupee migration preserves sold draws, balances and later admin settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "lottodesk-inr-"));
  const filename = join(dir, "migration.sqlite");
  const clock = Date.parse("2026-10-02T08:01:00Z");
  let store = createStore(filename, { now: () => clock });
  try {
    const actor = store.login("shop", ids.shop, "Lottery@123").account;
    const admin = store.login("admin", ids.admin, "Lottery@123").account;
    const initial = store.bootstrap(actor);
    assert.equal(initial.settings.unitPrice, 1);
    const open = initial.draws.filter((d) => d.status === "open");
    store.db
      .prepare("DELETE FROM migrations WHERE name=?")
      .run("2026-10-inr-one-rupee");
    const legacy = { ...initial.settings, unitPrice: 2 };
    delete legacy.currency;
    delete legacy.seriesPrices;
    store.db.prepare("UPDATE settings SET value=?").run(JSON.stringify(legacy));
    store.db
      .prepare("UPDATE draws SET settings=? WHERE status='open'")
      .run(JSON.stringify(legacy));
    const seed = store.db
      .prepare("SELECT seed FROM draws WHERE id=?")
      .get(open[0].id).seed;
    const ticket = store.sell(
      actor,
      {
        drawId: open[0].id,
        game: "2D",
        lines: [
          { series: "JP10", number: drawResults(seed).JP10["2D"], quantity: 1 },
        ],
      },
      "legacy-priced-ticket",
    );
    assert.equal(ticket.total, 2);
    const balance = store.bootstrap(actor).account.balance;
    store.close();
    store = createStore(filename, { now: () => clock });
    const migrated = store.bootstrap(actor);
    assert.equal(migrated.settings.unitPrice, 1);
    assert.equal(migrated.settings.currency, "INR");
    assert.equal(migrated.account.balance, balance);
    assert.equal(migrated.tickets[0].total, 2);
    assert.equal(
      migrated.draws.find((d) => d.id === open[0].id).config.unitPrice,
      2,
    );
    assert.equal(
      migrated.draws.find((d) => d.id === open[1].id).config.unitPrice,
      1,
    );
    const newTicket = store.sell(
      actor,
      {
        drawId: open[1].id,
        game: "2D",
        lines: [{ series: "JP10", number: "00", quantity: 1 }],
      },
      "new-one-rupee-ticket",
    );
    assert.equal(newTicket.total, 1);
    store.updateSettings(admin, {
      ...migrated.settings,
      unitPrice: 3,
      seriesPrices: SERIES_PRICES,
    });
    store.close();
    store = createStore(filename, { now: () => open[0].ends });
    const settled = store.bootstrap(actor);
    assert.equal(settled.settings.unitPrice, 3, "migration must run only once");
    assert.equal(settled.tickets.find((t) => t.id === ticket.id).payout, 160);
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM migrations WHERE name=?")
        .get("2026-10-inr-one-rupee").n,
      1,
    );
  } finally {
    store.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(filename + suffix, { force: true });
    rmdirSync(dir);
  }
});
