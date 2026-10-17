import { test, expect } from "@playwright/test";
import { agentEligible, defaultPlan } from "../src/live/commissions";
import { dayIST, type Snapshot } from "../src/live/types";
import { connectedAuth } from "./location-fixture";

test("five account settlements post turnover shares, preserve history and reject duplicate sources", async ({
  request,
}) => {
  test.setTimeout(90000);
  const headers = await connectedAuth(request, {
    "oai-authenticated-user-id": "qa-admin",
    "oai-authenticated-user-email": "qa-admin@test.invalid",
  });
  const state = async () => {
    const response = await request.get("/api/state", { headers });
    expect(response.status()).toBe(200);
    return (await response.json()) as Snapshot;
  };
  const post = async (path: string, data: unknown, status = 200) => {
    const response = await request.post("/api/" + path, { headers, data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const before = await state();
  const original = before.rewards!.plan;
  const source = before.members.find(
    (m) =>
      m.status === "Approved" &&
      m.role !== "admin" &&
      (m.profile.accounts?.length || 0) >= 5 &&
      before.members.some(
        (p) => p.id === m.parent && agentEligible(p, before.members),
      ),
  );
  expect(
    source,
    "Approved QA member and direct agent fixtures required",
  ).toBeTruthy();
  const stamp = Date.now().toString(36);
  const entries: string[] = [];
  // Preserve a saved direct-only policy as well as the new pooled default.
  const directOnlyPlan = { ...defaultPlan, indirect: 0, minimumCompany: 50 };
  await post("rewards/plan", {
    version: original.version,
    plan: directOnlyPlan,
    verified: true,
  });
  try {
    const version = (await state()).rewards!.plan.version;
    for (let index = 0; index < 5; index++) {
      const record = await post("entries", {
        member: source!.id,
        account: source!.profile.accounts![index].id,
        kind: "Turnover",
        date: dayIST(),
        amount: "20000",
        reference: `turnover-${stamp}-${index}`,
        description: "QA verified account turnover",
      });
      entries.push(record.id);
      await post("review-entry", { id: record.id, status: "Approved" });
      const settlement = {
        entry: record.id,
        version,
        transactions: index + 1,
        fee: "240",
        note: "QA reconciled turnover fee",
        verified: true,
      };
      if (index === 0)
        await post("rewards/settle", { ...settlement, fee: "239.99" }, 400);
      await post("rewards/settle", settlement);
      if (index === 0) await post("rewards/settle", settlement, 409);
    }
    const after = await state();
    const runs = after.rewards!.runs.filter((r) =>
      entries.includes(r.entry_id),
    );
    expect(runs).toHaveLength(5);
    expect(runs.reduce((n, r) => n + r.turnover, 0)).toBe(10000000);
    expect(runs.reduce((n, r) => n + r.fee, 0)).toBe(120000);
    expect(runs.reduce((n, r) => n + r.company, 0)).toBe(50000);
    expect(runs.reduce((n, r) => n + r.reserve, 0)).toBe(0);
    const allocations = runs.flatMap((r) => r.allocations);
    expect(
      allocations
        .filter((a) => a.type === "Self")
        .reduce((n, a) => n + a.amount, 0),
    ).toBe(50000);
    expect(
      allocations
        .filter((a) => a.member === source!.parent && a.type === "Direct")
        .reduce((n, a) => n + a.amount, 0),
    ).toBe(20000);
    expect(allocations.filter((a) => a.type === "Indirect")).toEqual([]);
    for (const old of before.rewards!.runs)
      expect(after.rewards!.runs.find((r) => r.id === old.id)).toEqual(old);
    const report = await request.get(
      `/api/members/${source!.id}/performance?from=${dayIST()}&to=${dayIST()}`,
      { headers },
    );
    expect(report.status()).toBe(200);
    expect((await report.json()).own.turnover).toBeGreaterThanOrEqual(10000000);
  } finally {
    const latest = await state();
    for (const run of latest.rewards!.runs.filter(
      (r) => entries.includes(r.entry_id) && r.status === "Posted",
    ))
      await post("rewards/reverse", {
        id: run.id,
        note: "QA fixture cleanup after turnover verification",
      });
    await post("rewards/plan", {
      version: latest.rewards!.plan.version,
      plan: original,
      verified: true,
    });
  }
});
