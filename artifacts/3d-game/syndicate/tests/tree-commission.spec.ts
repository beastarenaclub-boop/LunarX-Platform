import { test, expect } from "@playwright/test";
import { calculate, defaultPlan } from "../src/live/commissions";
import { projectTree } from "../src/live/tree-projection";
import { treePerformance } from "../src/live/tree-performance";
import type { LiveMember, Entry } from "../src/live/types";
import type { CommissionRun } from "../src/live/commissions";

const scenario = { depth: 5, turnover: 10000000, transactions: 100, above: 0 };
test("funded shared pool shows exact level payouts and reconciles the whole binary tree", () => {
  expect(defaultPlan).toMatchObject({
    basis: "per100",
    mode: "pool",
    self: 50,
    direct: 20,
    indirect: 10,
    minimumCompany: 40,
    reserve: 0,
  });
  const r = projectTree(defaultPlan, scenario);
  expect(r.levels.map((l) => l.count)).toEqual([1, 2, 4, 8, 16, 32]);
  expect(r.levels.map((l) => l.observerPerSource)).toEqual([
    50000, 20000, 10000, 5000, 3333, 2500,
  ]);
  expect(r.levels.map((l) => l.observerShare)).toEqual([
    50000, 40000, 40000, 40000, 53328, 80000,
  ]);
  expect(r.total).toMatchObject({
    members: 63,
    fee: 7560000,
    selfPaid: 3150000,
    directPaid: 1240000,
    indirectPaid: 600000,
    company: 2570000,
    observerShare: 303328,
  });
  expect(
    r.levels[4].distribution.allocations
      .filter((a) => a.type === "Indirect")
      .map((a) => a.amount),
  ).toEqual([3334, 3333, 3333]);
  expect(r.levels[0].distribution.company).toBe(70000); // no eligible upline
  expect(r.levels[1].distribution.company).toBe(50000); // no indirect upline
  expect(r.levels[2].distribution.company).toBe(40000);
  expect(
    projectTree(defaultPlan, { ...scenario, transactions: 1000000 }).total,
  ).toEqual(r.total);
  const higher = projectTree(defaultPlan, { ...scenario, above: 1 });
  expect(higher.levels[2].observerPerSource).toBe(5000);
  expect(higher.total.observerShare).toBeLessThan(r.total.observerShare);
  expect(
    projectTree(defaultPlan, { ...scenario, depth: 20, above: 1000 }).total
      .members,
  ).toBe(2097151);
  for (const row of higher.levels)
    expect(
      row.selfPaid +
        row.directPaid +
        row.indirectPaid +
        row.reserve +
        row.company,
    ).toBe(row.fee);
});

function member(
  id: string,
  parent: string | null,
  position: "left" | "right" = "left",
): LiveMember {
  return {
    id,
    name: id,
    parent,
    position,
    role: "user",
    status: "Approved",
    ref: id,
    city: "",
    profile: {},
    revision: 0,
    created_at: "",
  };
}
test("projection matches independently enumerated source settlements", () => {
  const all = [member("0", null)];
  for (let i = 1; i < 31; i++)
    all.push(
      member(
        String(i),
        String(Math.floor((i - 1) / 2)),
        i % 2 ? "left" : "right",
      ),
    );
  const records = all.map((source) =>
    calculate(defaultPlan, source, all, 100, 10000000, 120000),
  );
  const observer = records
    .flatMap((r) => r.allocations)
    .filter((a) => a.member === "0")
    .reduce((n, a) => n + a.amount, 0);
  const r = projectTree(defaultPlan, { ...scenario, depth: 4 });
  expect(r.total.observerShare).toBe(observer);
  expect(r.total.company).toBe(records.reduce((n, r) => n + r.company, 0));
  expect(() => projectTree(defaultPlan, { ...scenario, depth: 21 })).toThrow(
    "1–20",
  );
  expect(() => projectTree({ ...defaultPlan, indirect: 20 }, scenario)).toThrow(
    "exceeds",
  );
});

test("actual level and branch totals exclude reversals, preserve booked shares and enforce own-only scope", () => {
  const all = [
    member("root", null),
    member("left", "root"),
    member("right", "root", "right"),
    member("deep", "left"),
    member("other", "left", "right"),
  ];
  const runs = [
    {
      member_id: "left",
      turnover: 10000000,
      transactions: 100,
      status: "Posted",
      allocations: [{ member: "root", type: "Direct", amount: 20000 }],
    },
    {
      member_id: "deep",
      turnover: 10000000,
      transactions: 100,
      status: "Posted",
      allocations: [{ member: "root", type: "Indirect", amount: 10000 }],
    },
    {
      member_id: "right",
      turnover: 99000000,
      transactions: 900,
      status: "Reversed",
      allocations: [{ member: "root", type: "Direct", amount: 198000 }],
    },
  ] as CommissionRun[];
  const entries = runs.map((r) => ({
    member_id: r.member_id,
    status: "Approved",
    kind: "Turnover",
    amount_paise: r.turnover,
  })) as Entry[];
  const r = treePerformance("root", "root", all, entries, runs, true);
  expect(
    r.levels.map((l) => [l.depth, l.members, l.commissionToSelected]),
  ).toEqual([
    [0, 1, 0],
    [1, 2, 20000],
    [2, 2, 10000],
  ]);
  expect(r.branches[0]).toMatchObject({
    side: "left",
    members: 3,
    turnover: 20000000,
    settledTurnover: 20000000,
    direct: 20000,
    indirect: 10000,
    commissionToSelected: 30000,
  });
  expect(r.branches[1]).toMatchObject({
    side: "right",
    turnover: 99000000,
    settledTurnover: 0,
    commissionToSelected: 0,
  });
  const own = treePerformance("left", "left", all, entries, runs, false);
  expect(own.levels).toHaveLength(1);
  expect(own.levels[0].members).toBe(1);
  expect(own.branches).toEqual([]);
  all[0].parent = "deep"; // corrupt ancestry must terminate without duplicate records
  expect(
    treePerformance("root", "root", all, entries, runs, true).levels.reduce(
      (n, l) => n + l.members,
      0,
    ),
  ).toBe(5);
});
