import { dayIST, type LiveMember, type LiveTask } from "./types";
export type CommissionPlan = {
  version: number;
  enabled: boolean;
  basis: "pending" | "transaction" | "per100";
  mode: "pool" | "levels";
  gross: number;
  self: number;
  direct: number;
  indirect: number;
  levels: number;
  reserve: number;
  minimumCompany: number;
  taskBonus: number;
  taskMonthlyCap: number;
  gold: { name: string; transactions: number; tasks: number };
  pro: { name: string; transactions: number; tasks: number };
  rewards: {
    id: string;
    title: string;
    cost: number;
    rank: "gold" | "pro";
    enabled: boolean;
  }[];
};
export const defaultPlan: CommissionPlan = {
  version: 0,
  enabled: true,
  basis: "per100",
  mode: "pool",
  gross: 120,
  self: 50,
  direct: 20,
  indirect: 10,
  levels: 0,
  reserve: 0,
  minimumCompany: 40,
  taskBonus: 500,
  taskMonthlyCap: 50000,
  gold: { name: "Gold", transactions: 1000, tasks: 20 },
  pro: { name: "Pro Gold", transactions: 5000, tasks: 50 },
  rewards: [
    {
      id: "gold-voucher",
      title: "Gold achievement voucher",
      cost: 50000,
      rank: "gold",
      enabled: true,
    },
    {
      id: "pro-trip",
      title: "Pro Gold travel allowance",
      cost: 1000000,
      rank: "pro",
      enabled: true,
    },
  ],
};
export type Allocation = {
  member: string;
  name: string;
  type: "Self" | "Direct" | "Indirect";
  depth: number;
  amount: number;
};
export type CommissionRun = {
  id: string;
  entry_id: string;
  member_id: string;
  member_name: string;
  plan_version: number;
  transactions: number;
  turnover: number;
  fee: number;
  reserve: number;
  company: number;
  allocations: Allocation[];
  status: "Posted" | "Reversed";
  date: string;
  created_at: string;
  note: string;
};
export type RewardClaim = {
  id: string;
  member_id: string;
  kind: "Task" | "Benefit";
  title: string;
  amount: number;
  status: "Pending" | "Approved" | "Rejected";
  task_id: string | null;
  rank: "gold" | "pro" | null;
  period: string;
  created_at: string;
  note: string;
};
export type RewardState = {
  plan: CommissionPlan;
  versions: { version: number; created_at: string; enabled: boolean }[];
  runs: CommissionRun[];
  claims: RewardClaim[];
  reserveBalance: number | null;
  rank: {
    tier: "member" | "gold" | "pro";
    transactions: number;
    tasks: number;
    windowStart: string;
  };
  earnings: { commission: number; taskBonus: number; total: number };
  companyTotal: number | null;
};
export function validatePlan(p: CommissionPlan) {
  if (
    !p ||
    !["pending", "transaction", "per100"].includes(p.basis) ||
    !["pool", "levels"].includes(p.mode) ||
    typeof p.enabled !== "boolean"
  )
    throw Error("Choose a valid commission basis and distribution mode.");
  for (const key of [
    "gross",
    "self",
    "direct",
    "indirect",
    "reserve",
    "minimumCompany",
    "taskBonus",
    "taskMonthlyCap",
  ] as const)
    if (!Number.isSafeInteger(p[key]) || p[key] < 0 || p[key] > 100000000)
      throw Error("Rates and reward budgets must be non-negative whole paise.");
  if (
    p.gross < 1 ||
    !Number.isInteger(p.levels) ||
    p.levels < 0 ||
    p.levels > 100
  )
    throw Error("Enter a positive fee budget and 0–100 indirect levels.");
  const committed =
    p.self +
    p.direct +
    p.indirect * (p.mode === "pool" ? 1 : p.levels) +
    p.reserve +
    p.minimumCompany;
  if (committed > p.gross)
    throw Error(
      `Plan exceeds the fee budget by ${committed - p.gross} paisa per unit. Reduce shares/levels or reserves.`,
    );
  if (p.enabled && p.basis === "pending")
    throw Error("Confirm the rate basis before activating the plan.");
  for (const tier of [p.gold, p.pro]) {
    if (
      !tier ||
      typeof tier.name !== "string" ||
      !tier.name.trim() ||
      tier.name.length > 30 ||
      !Number.isSafeInteger(tier.transactions) ||
      tier.transactions < 1 ||
      !Number.isInteger(tier.tasks) ||
      tier.tasks < 0 ||
      tier.tasks > 100000
    )
      throw Error(
        "Complete the rank name, positive transaction target and task target.",
      );
  }
  if (p.pro.transactions < p.gold.transactions || p.pro.tasks < p.gold.tasks)
    throw Error("Pro Gold targets must be at least the Gold targets.");
  if (!Array.isArray(p.rewards) || p.rewards.length > 10)
    throw Error("A plan can contain up to 10 benefits.");
  const ids = new Set<string>();
  for (const reward of p.rewards) {
    if (
      !/^[a-z0-9-]{1,50}$/.test(reward.id) ||
      ids.has(reward.id) ||
      typeof reward.title !== "string" ||
      !reward.title.trim() ||
      reward.title.length > 100 ||
      !Number.isSafeInteger(reward.cost) ||
      reward.cost <= 0 ||
      reward.cost > 100000000 ||
      !["gold", "pro"].includes(reward.rank) ||
      typeof reward.enabled !== "boolean"
    )
      throw Error("Invalid or duplicate benefit.");
    ids.add(reward.id);
  }
  return p;
}
export function maxLevels(p: CommissionPlan) {
  return p.indirect
    ? Math.max(
        0,
        Math.floor(
          (p.gross - p.self - p.direct - p.reserve - p.minimumCompany) /
            p.indirect,
        ),
      )
    : 100;
}
export function agentEligible(m: LiveMember, all: LiveMember[]) {
  return (
    m.role !== "admin" &&
    m.status === "Approved" &&
    all.filter((c) => c.parent === m.id && c.status === "Approved").length === 2
  );
}
// Amounts and turnover are integer paise; per100 means per INR 100 turnover.
// Keep illustrations and booked settlements on the same rounding rule.
export function commissionAmount(
  basis: "transaction" | "per100",
  rate: number,
  transactions: number,
  turnover: number,
) {
  const numerator = BigInt(basis === "transaction" ? transactions : turnover);
  const denominator = BigInt(basis === "transaction" ? 1 : 10000);
  const n = (BigInt(rate) * numerator) / denominator;
  if (n > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Calculation exceeds supported amount.");
  return Number(n);
}
export function calculate(
  p: CommissionPlan,
  source: LiveMember,
  all: LiveMember[],
  transactions: number,
  turnover: number,
  fee: number,
) {
  validatePlan(p);
  if (p.basis === "pending")
    throw Error("Choose a rate basis for this calculation.");
  if (
    !Number.isSafeInteger(transactions) ||
    transactions < 1 ||
    transactions > 100000000 ||
    !Number.isSafeInteger(turnover) ||
    turnover < 1 ||
    !Number.isSafeInteger(fee) ||
    fee < 1
  )
    throw Error(
      "Enter positive verified transactions, turnover and earned fee.",
    );
  const basis = p.basis;
  const scale = (rate: number) =>
    commissionAmount(basis, rate, transactions, turnover);
  const budget = scale(p.gross);
  if (budget > fee)
    throw Error(
      "Verified earned fee is below the configured commission budget.",
    );
  const allocations: Allocation[] = [];
  const add = (
    m: LiveMember,
    type: Allocation["type"],
    depth: number,
    amount: number,
  ) => {
    if (amount > 0)
      allocations.push({ member: m.id, name: m.name, type, depth, amount });
  };
  add(source, "Self", 0, scale(p.self));
  // Index once: traversing a deep upline must not scan the entire network
  // for every ancestor and each eligibility check.
  const membersById = new Map(all.map((m) => [m.id, m]));
  const approvedChildren = new Map<string, number>();
  for (const m of all)
    if (m.parent && m.status === "Approved")
      approvedChildren.set(m.parent, (approvedChildren.get(m.parent) || 0) + 1);
  let parent = source.parent;
  const seen = new Set([source.id]);
  const indirect: { member: LiveMember; depth: number }[] = [];
  let depth = 1;
  while (parent) {
    if (seen.has(parent)) throw Error("Network cycle detected.");
    seen.add(parent);
    const m = membersById.get(parent);
    if (!m) break;
    if (
      m.role !== "admin" &&
      m.status === "Approved" &&
      approvedChildren.get(m.id) === 2
    ) {
      if (depth === 1) add(m, "Direct", depth, scale(p.direct));
      else if (p.mode === "pool" || depth <= p.levels + 1)
        indirect.push({ member: m, depth });
    }
    parent = m.parent;
    depth++;
  }
  if (p.mode === "pool" && indirect.length) {
    const pool = scale(p.indirect);
    const each = Math.floor(pool / indirect.length),
      extra = pool % indirect.length;
    indirect.forEach((x, i) =>
      add(x.member, "Indirect", x.depth, each + (i < extra ? 1 : 0)),
    );
  } else if (p.mode === "levels")
    indirect.forEach((x) =>
      add(x.member, "Indirect", x.depth, scale(p.indirect)),
    );
  const paid = allocations.reduce((n, a) => n + a.amount, 0);
  const reserve = scale(p.reserve);
  const company = fee - paid - reserve;
  if (company < scale(p.minimumCompany) || paid + reserve > fee)
    throw Error("Distribution exceeds available fee.");
  return {
    allocations,
    paid,
    reserve,
    company,
    budget,
    unpaidSlots:
      "Unqualified or missing shares remain with company; positions are not compressed.",
  };
}
export function rankFor(
  member: string,
  all: LiveMember[],
  runs: CommissionRun[],
  tasks: LiveTask[],
  p: CommissionPlan,
  today = new Date(),
) {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 29);
  const windowStart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  const scope = new Set([member]);
  for (let i = 0; i < all.length; i++) {
    let changed = false;
    for (const m of all)
      if (m.parent && scope.has(m.parent) && !scope.has(m.id)) {
        scope.add(m.id);
        changed = true;
      }
    if (!changed) break;
  }
  const transactions = runs
    .filter(
      (r) =>
        r.status === "Posted" &&
        scope.has(r.member_id) &&
        r.date >= windowStart,
    )
    .reduce((n, r) => n + r.transactions, 0);
  const complete = tasks.filter(
    (t) =>
      t.assignee === member &&
      t.status === "Complete" &&
      !!t.completed_at &&
      dayIST(t.completed_at) >= windowStart,
  ).length;
  const qualifies = (t: CommissionPlan["gold"]) =>
    transactions >= t.transactions && complete >= t.tasks;
  const tier = qualifies(p.pro) ? "pro" : qualifies(p.gold) ? "gold" : "member";
  return {
    tier,
    transactions,
    tasks: complete,
    windowStart,
  } as RewardState["rank"];
}
