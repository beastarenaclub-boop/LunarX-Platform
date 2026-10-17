import { browserConnected } from "./location-fixture";
import { connectedAuth, browserLocation } from "./location-fixture";
import { test, expect } from "@playwright/test";
import {
  calculate,
  defaultPlan,
  validatePlan,
  maxLevels,
  rankFor,
  type CommissionPlan,
} from "../src/live/commissions";
import { dayIST, type LiveMember } from "../src/live/types";
// Explicit saved legacy policy: changing the default must not reinterpret it.
const legacyPlan: CommissionPlan = {
  ...defaultPlan,
  basis: "transaction",
  indirect: 10,
  levels: 2,
  reserve: 10,
  minimumCompany: 20,
};
const directOnlyPlan = { ...defaultPlan, indirect: 0, minimumCompany: 50 };
function chain(depth: number) {
  const all: LiveMember[] = Array.from({ length: depth + 1 }, (_, i) => ({
    id: "m" + i,
    name: "Member " + i,
    parent: i < depth ? "m" + (i + 1) : null,
    status: "Approved",
    role: "user",
    position: "left",
    city: "",
    ref: "",
    profile: {},
    revision: 0,
    created_at: "",
  }));
  for (let i = 1; i <= depth; i++)
    all.push({ ...all[0], id: "s" + i, parent: "m" + i, position: "right" });
  return all;
}
test("previous direct-only policy still splits one lakh into 500 member, 200 direct and 500 company", () => {
  expect(directOnlyPlan).toMatchObject({
    enabled: true,
    basis: "per100",
    gross: 120,
    self: 50,
    direct: 20,
    indirect: 0,
    reserve: 0,
    minimumCompany: 50,
  });
  const all = chain(100);
  const result = calculate(directOnlyPlan, all[0], all, 100, 10000000, 120000);
  expect(result.allocations.map((a) => [a.type, a.member, a.amount])).toEqual([
    ["Self", "m0", 50000],
    ["Direct", "m1", 20000],
  ]);
  expect(result.company).toBe(50000);
  expect(result.reserve).toBe(0);
  expect(result.paid + result.company).toBe(120000);
  for (const count of [1, 1000, 1000000])
    expect(
      calculate(directOnlyPlan, all[0], all, count, 10000000, 120000),
    ).toEqual(result);
  const fiveAccounts = Array.from({ length: 5 }, (_, i) =>
    calculate(directOnlyPlan, all[0], all, i + 1, 2000000, 24000),
  );
  expect(fiveAccounts.reduce((n, r) => n + r.paid, 0)).toBe(result.paid);
  expect(fiveAccounts.reduce((n, r) => n + r.company, 0)).toBe(result.company);
  // A deeper hierarchy cannot charge the same source fee repeatedly.
  expect(result.allocations.some((a) => a.type === "Indirect")).toBe(false);
  expect(() => validatePlan({ ...directOnlyPlan, indirect: 10 })).toThrow(
    "exceeds",
  );
  expect(() =>
    calculate(directOnlyPlan, all[0], all, 100, 10000000, 119999),
  ).toThrow("below");
  all[1].status = "Draft";
  const ineligible = calculate(
    directOnlyPlan,
    all[0],
    all,
    100,
    10000000,
    120000,
  );
  expect(ineligible.allocations).toHaveLength(1);
  expect(ineligible.company).toBe(70000);
});
test("turnover rounds per record and two one-lakh direct members pay 400 rupees total", () => {
  const all = chain(2);
  const left = all[0],
    right = all.find((m) => m.id === "s1")!;
  const results = [left, right].map((member) =>
    calculate(defaultPlan, member, all, 100, 10000000, 120000),
  );
  expect(
    results
      .flatMap((r) => r.allocations)
      .filter((a) => a.member === "m1")
      .reduce((n, a) => n + a.amount, 0),
  ).toBe(40000);
  for (const turnover of [100, 199, 9999, 1234567, 10000001]) {
    const fee = Math.floor((turnover * 120) / 10000);
    const r = calculate(defaultPlan, left, all, 1, turnover, fee);
    expect(r.paid + r.reserve + r.company).toBe(fee);
    expect(r.allocations.every((a) => Number.isSafeInteger(a.amount))).toBe(
      true,
    );
    expect(r.company).toBeGreaterThanOrEqual(
      Math.floor((turnover * 40) / 10000),
    );
  }
});
test("legacy fixed transaction policy retains its original allocations and shared pool", () => {
  expect(legacyPlan.enabled).toBe(true);
  expect(legacyPlan.basis).toBe("transaction");
  expect(legacyPlan.mode).toBe("pool");
  const all = chain(4);
  const one = calculate(legacyPlan, all[0], all, 1, 10000, 120);
  expect(one.allocations.map((a) => a.amount)).toEqual([50, 20, 4, 3, 3]);
  const batch = calculate(legacyPlan, all[0], all, 100, 1000000, 12000);
  expect(batch.allocations.map((a) => a.amount)).toEqual([
    5000, 2000, 334, 333, 333,
  ]);
  expect(batch.reserve).toBe(1000);
  expect(batch.company).toBe(3000);
  expect(batch.paid + batch.reserve + batch.company).toBe(12000);
  // Transaction value changes do not change fixed per-transaction earnings.
  expect(calculate(legacyPlan, all[0], all, 100, 50000000, 12000)).toEqual(
    batch,
  );
  const noUpline = calculate(legacyPlan, all[4], all, 1, 10000, 120);
  expect(noUpline.paid).toBe(50);
  expect(noUpline.company).toBe(60);
});
test("deep network conserves revenue, pools whole paise and never multiplies a fixed budget", () => {
  const p = { ...legacyPlan, basis: "transaction" } as CommissionPlan;
  const members = chain(100);
  const r = calculate(p, members[0], members, 1, 10000, 120);
  expect(r.paid).toBe(80);
  expect(r.reserve).toBe(10);
  expect(r.company).toBe(30);
  expect(
    r.allocations
      .filter((a) => a.type === "Indirect")
      .reduce((n, a) => n + a.amount, 0),
  ).toBe(10);
  expect(r.allocations.every((a) => Number.isSafeInteger(a.amount))).toBe(true);
  expect(r.allocations.find((a) => a.type === "Direct")!.amount).toBe(20);
  expect(maxLevels(p)).toBe(2);
  expect(() => validatePlan({ ...p, mode: "levels", levels: 5 })).toThrow(
    "exceeds",
  );
  const capped = calculate(
    { ...p, mode: "levels", levels: 2 },
    members[0],
    members,
    1,
    10000,
    120,
  );
  expect(capped.allocations.map((a) => a.depth)).toEqual([0, 1, 2, 3]);
  expect(capped.paid + capped.reserve + capped.company).toBe(120);
  members[1].status = "Draft";
  const noDirect = calculate(p, members[0], members, 1, 10000, 120);
  expect(noDirect.allocations.some((a) => a.type === "Direct")).toBe(false);
  expect(noDirect.company).toBe(50);
  expect(() => calculate(p, members[0], members, 1, 10000, 119)).toThrow(
    "below",
  );
});
test("per-100 basis, cycles, pending policies and rank reversals are handled", () => {
  const all = chain(3);
  const p = { ...legacyPlan, basis: "per100" } as CommissionPlan;
  const r = calculate(p, all[0], all, 37, 1000000, 12000);
  expect(r.allocations.find((a) => a.type === "Self")!.amount).toBe(5000);
  expect(r.company).toBe(3000);
  expect(() =>
    calculate(
      { ...legacyPlan, enabled: false, basis: "pending" },
      all[0],
      all,
      1,
      10000,
      120,
    ),
  ).toThrow("basis");
  all[3].parent = all[0].id;
  expect(() => calculate(p, all[0], all, 1, 10000, 120)).toThrow("cycle");
  all[3].parent = null;
  const rankPlan = {
    ...p,
    gold: { name: "Gold", transactions: 10, tasks: 0 },
    pro: { name: "Pro", transactions: 100, tasks: 0 },
  };
  const run = {
    member_id: "m0",
    status: "Posted",
    date: dayIST(),
    transactions: 20,
  } as any;
  expect(rankFor("m1", all, [run], [], rankPlan).tier).toBe("gold");
  expect(
    rankFor("m1", all, [{ ...run, status: "Reversed" }], [], rankPlan).tier,
  ).toBe("member");
});
test("admin policies, verified settlements, privacy, funded claims, reversal and screens", async ({
  request,
  page,
}) => {
  test.setTimeout(90000);
  const auth = (id: string) =>
    connectedAuth(request, {
      "oai-authenticated-user-id": id,
      "oai-authenticated-user-email": id + "@test.invalid",
    });
  const admin = "qa-admin";
  async function state(id: string) {
    const r = await request.get("/api/state", { headers: await auth(id) });
    expect(r.status()).toBe(200);
    return r.json();
  }
  async function post(id: string, path: string, data: any, status = 200) {
    const r = await request.post("/api/" + path, {
      headers: await auth(id),
      data,
      timeout: 10000,
    });
    expect(r.status(), await r.text()).toBe(status);
    return r.json();
  }
  let s = await state(admin);
  const original = s.rewards.plan;
  const source = s.members.find(
    (m: any) =>
      m.role !== "admin" &&
      m.status === "Approved" &&
      m.profile.accounts?.length === 7,
  );
  expect(
    source,
    "Run live.spec.ts first to create approved QA-only merchant fixtures.",
  ).toBeTruthy();
  const actor = source.name,
    tag = Date.now().toString(36);
  const plan = {
    ...legacyPlan,
    basis: "transaction",
    enabled: true,
    taskBonus: 100,
    taskMonthlyCap: 10000,
    gold: { name: "Gold", transactions: 1, tasks: 0 },
    pro: { name: "Pro Gold", transactions: 1000000, tasks: 0 },
    rewards: [
      {
        id: "qa-benefit-" + tag,
        title: "QA funded travel benefit",
        cost: 250,
        rank: "gold",
        enabled: true,
      },
    ],
  };
  await post(
    actor,
    "rewards/plan",
    { version: original.version, plan, verified: true },
    403,
  );
  await post(
    admin,
    "rewards/plan",
    {
      version: original.version,
      plan: { ...plan, mode: "levels", levels: 100 },
      verified: true,
    },
    400,
  );
  await post(admin, "rewards/plan", {
    version: original.version,
    plan,
    verified: true,
  });
  s = await state(admin);
  const version = s.rewards.plan.version;
  await post(
    admin,
    "rewards/plan",
    { version: original.version, plan, verified: true },
    409,
  );
  const record = await post(admin, "entries", {
    member: source.id,
    account: source.profile.accounts[0].id,
    kind: "Turnover",
    date: dayIST(),
    amount: "10000",
    reference: "rewards-" + tag,
    description: "QA verified payment service volume",
  });
  await post(admin, "review-entry", { id: record.id, status: "Approved" });
  await post(
    actor,
    "rewards/settle",
    {
      entry: record.id,
      version,
      transactions: 100,
      fee: "120",
      note: "Reconciled test service fee",
      verified: true,
    },
    403,
  );
  await post(
    admin,
    "rewards/settle",
    {
      entry: record.id,
      version,
      transactions: 100,
      fee: "1",
      note: "Insufficient fee",
      verified: true,
    },
    400,
  );
  await post(admin, "rewards/settle", {
    entry: record.id,
    version,
    transactions: 100,
    fee: "120",
    note: "QA fee reconciliation",
    verified: true,
  });
  await post(
    admin,
    "rewards/settle",
    {
      entry: record.id,
      version,
      transactions: 100,
      fee: "120",
      note: "Duplicate QA source",
      verified: true,
    },
    409,
  );
  s = await state(admin);
  const run = s.rewards.runs.find((x: any) => x.entry_id === record.id);
  expect(run.fee).toBe(12000);
  expect(run.allocations.find((x: any) => x.type === "Self").amount).toBe(5000);
  expect(
    run.allocations.reduce((n: number, x: any) => n + x.amount, 0) +
      run.reserve +
      run.company,
  ).toBe(12000);
  const own = await state(actor);
  expect(
    own.rewards.runs.every((x: any) =>
      x.allocations.every((a: any) => a.member === source.id),
    ),
  ).toBe(true);
  expect(own.rewards.reserveBalance).toBe(null);
  expect(own.rewards.runs.every((x: any) => x.fee === 0)).toBe(true);
  expect(own.rewards.rank.tier).toBe("gold");
  await post(actor, "rewards/claim", { reward: "qa-benefit-" + tag });
  await post(actor, "rewards/claim", { reward: "qa-benefit-" + tag }, 409);
  s = await state(admin);
  const claim = s.rewards.claims.find(
    (x: any) =>
      x.member_id === source.id &&
      x.title === "QA funded travel benefit" &&
      x.period === dayIST().slice(0, 7) &&
      x.status === "Pending",
  );
  const reserve = s.rewards.reserveBalance;
  await post(
    actor,
    "rewards/review",
    { id: claim.id, status: "Approved", note: "Unauthorized approval" },
    403,
  );
  await post(admin, "rewards/review", {
    id: claim.id,
    status: "Approved",
    note: "QA benefit authorized",
  });
  expect((await state(admin)).rewards.reserveBalance).toBe(reserve - 250);
  await post(
    admin,
    "rewards/review",
    { id: claim.id, status: "Approved", note: "Duplicate" },
    409,
  );
  await post(admin, "tasks", {
    title: "Reward QA task " + tag,
    description: "Verified reconciliation work",
    assignee: source.id,
    due: dayIST(),
  });
  let task = (await state(actor)).tasks.find(
    (t: any) => t.title === "Reward QA task " + tag,
  );
  await post(actor, "task-status", { id: task.id, status: "In progress" });
  await post(actor, "task-status", { id: task.id, status: "In review" });
  await post(admin, "task-status", { id: task.id, status: "Complete" });
  await post(actor, "rewards/claim", { task: task.id });
  s = await state(admin);
  const taskClaim = s.rewards.claims.find((c: any) => c.task_id === task.id);
  await post(admin, "rewards/review", {
    id: taskClaim.id,
    status: "Approved",
    note: "QA task incentive approved",
  });
  await post(actor, "rewards/claim", { task: task.id }, 409);
  await browserConnected(page, await auth(admin));
  await page.route("http://127.0.0.1:5201/**", async (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...(await auth(admin)) },
    }),
  );
  await page.addInitScript(() =>
    sessionStorage.setItem("syndicate-live-entry", "1"),
  );
  await page.goto("/admin/dashboard");
  await page
    .getByRole("button", { name: "Commissions & rewards", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your work. Your progress." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Distribution calculator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "See where every paisa goes" }),
  ).toBeVisible();
  await page.getByLabel("Eligible upper agents").fill("100");
  await page.screenshot({
    path: "test-results/commission-calculator.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Plan & approvals", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save plan version " + (version + 1) }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/rewards-admin-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await post(admin, "rewards/reverse", {
    id: run.id,
    note: "QA reversal of reconciled source",
  });
  expect(
    (await state(admin)).rewards.runs.find((x: any) => x.id === run.id).status,
  ).toBe("Reversed");
  await post(
    admin,
    "rewards/reverse",
    { id: run.id, note: "Duplicate reverse" },
    409,
  );
  expect(
    (await state(actor)).rewards.runs.find((x: any) => x.id === run.id).status,
  ).toBe("Reversed");
  const newest = (await state(admin)).rewards.plan;
  await post(admin, "rewards/plan", {
    version: newest.version,
    plan: { ...original, enabled: false },
    verified: false,
  });
});
test("concurrent reward approvals cannot spend the reserve twice; policy edits preserve history", async ({
  request,
}) => {
  const auth = (id: string) =>
    connectedAuth(request, {
      "oai-authenticated-user-id": id,
      "oai-authenticated-user-email": id + "@test.invalid",
    });
  const get = async () => {
    const r = await request.get("/api/state", {
      headers: await auth("qa-admin"),
    });
    return r.json();
  };
  const post = async (id: string, path: string, data: any) =>
    request.post("/api/" + path, {
      headers: await auth(id),
      data,
      timeout: 10000,
    });
  let s = await get();
  const original = s.rewards.plan;
  const source = s.members.find(
    (m: any) =>
      m.role !== "admin" &&
      m.status === "Approved" &&
      m.profile.accounts?.length === 7,
  );
  const stamp = Date.now().toString(36);
  const available = s.rewards.reserveBalance + 10000;
  expect(available).toBeGreaterThan(0);
  const cost = Math.floor(available * 0.6);
  const policy = {
    ...legacyPlan,
    basis: "transaction",
    enabled: true,
    gold: { name: "Gold", transactions: 1, tasks: 0 },
    pro: { name: "Pro Gold", transactions: 100000000, tasks: 0 },
    rewards: ["a", "b"].map((id) => ({
      id: "concurrent-" + stamp + "-" + id,
      title: "Budget claim " + id + " " + stamp,
      cost,
      rank: "gold",
      enabled: true,
    })),
  };
  expect(
    (
      await post("qa-admin", "rewards/plan", {
        version: original.version,
        plan: policy,
        verified: true,
      })
    ).status(),
  ).toBe(200);
  s = await get();
  const version = s.rewards.plan.version;
  const entryResponse = await post("qa-admin", "entries", {
    member: source.id,
    account: source.profile.accounts[0].id,
    kind: "Turnover",
    date: dayIST(),
    amount: "100000",
    reference: "concurrent-" + stamp,
    description: "QA reconciled service revenue",
  });
  const entry = await entryResponse.json();
  expect(
    (
      await post("qa-admin", "review-entry", {
        id: entry.id,
        status: "Approved",
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await post("qa-admin", "rewards/settle", {
        entry: entry.id,
        version,
        transactions: 1000,
        fee: "1200",
        note: "QA earned fee verified",
        verified: true,
      })
    ).status(),
  ).toBe(200);
  for (const benefit of policy.rewards)
    expect(
      (
        await post(source.name, "rewards/claim", { reward: benefit.id })
      ).status(),
    ).toBe(200);
  s = await get();
  const claims = s.rewards.claims.filter((c: any) => c.title.includes(stamp));
  expect(claims).toHaveLength(2);
  const decisions = await Promise.all(
    claims.map((c: any) =>
      post("qa-admin", "rewards/review", {
        id: c.id,
        status: "Approved",
        note: "QA concurrent reserve check",
      }),
    ),
  );
  expect(decisions.map((r) => r.status()).sort()).toEqual([200, 409]);
  s = await get();
  expect(s.rewards.reserveBalance).toBe(available - cost);
  const pending = s.rewards.claims.find(
    (c: any) => c.title.includes(stamp) && c.status === "Pending",
  );
  expect(
    (
      await post("qa-admin", "rewards/review", {
        id: pending.id,
        status: "Rejected",
        note: "QA unfunded claim rejected",
      })
    ).status(),
  ).toBe(200);
  const run = s.rewards.runs.find((r: any) => r.entry_id === entry.id);
  expect(
    (
      await post("qa-admin", "rewards/plan", {
        version,
        plan: { ...policy, self: 1, enabled: false },
        verified: false,
      })
    ).status(),
  ).toBe(200);
  s = await get();
  expect(s.rewards.runs.find((r: any) => r.id === run.id).allocations).toEqual(
    run.allocations,
  );
  expect(
    (
      await post("qa-admin", "rewards/plan", {
        version: s.rewards.plan.version,
        plan: { ...original, enabled: false },
        verified: false,
      })
    ).status(),
  ).toBe(200);
});
