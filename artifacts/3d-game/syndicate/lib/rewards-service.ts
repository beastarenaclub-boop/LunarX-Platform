import { env } from "cloudflare:workers";
import {
  calculate,
  defaultPlan,
  rankFor,
  validatePlan,
  type CommissionPlan,
  type CommissionRun,
  type RewardClaim,
} from "../src/live/commissions";
import {
  amountPaise,
  dayIST,
  type LiveMember,
  type LiveTask,
} from "../src/live/types";
export class RewardError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const reject = (status: number, message: string): never => {
  throw new RewardError(status, message);
};
const statement = (sql: string, ...args: unknown[]) =>
  env.DB!.prepare(sql).bind(...args);
const rows = async <T = any>(sql: string, ...args: unknown[]) =>
  (await statement(sql, ...args).all<T>()).results;
const first = (sql: string, ...args: unknown[]) =>
  statement(sql, ...args).first<any>();
const now = () => new Date().toISOString();
function note(v: unknown) {
  if (typeof v !== "string" || !v.trim() || v.length > 500)
    reject(400, "Add a review/evidence note of 1–500 characters.");
  return (v as string).trim();
}
async function plan() {
  const r = await first(
    "SELECT * FROM reward_plans ORDER BY version DESC LIMIT 1",
  );
  return r
    ? (JSON.parse(r.config) as CommissionPlan)
    : structuredClone(defaultPlan);
}
async function runs() {
  return (
    await rows("SELECT * FROM commission_runs ORDER BY created_at DESC")
  ).map((r) => ({
    ...r,
    allocations: JSON.parse(r.allocations),
  })) as CommissionRun[];
}
async function reserveBalance() {
  const r = await first(
    "SELECT COALESCE((SELECT SUM(reserve) FROM commission_runs WHERE status='Posted'),0)-COALESCE((SELECT SUM(amount) FROM reward_claims WHERE status='Approved'),0) balance",
  );
  return r.balance as number;
}
export async function rewardSnapshot(me: LiveMember, all: LiveMember[]) {
  const p = await plan(),
    allRuns = await runs(),
    claims = await rows<RewardClaim>(
      "SELECT * FROM reward_claims ORDER BY created_at DESC",
    ),
    tasks = await rows<LiveTask>("SELECT * FROM tasks");
  const admin = me.role === "admin";
  const ownClaims = claims.filter((c) => c.member_id === me.id);
  const commission = allRuns
    .filter((r) => r.status === "Posted")
    .flatMap((r) => r.allocations)
    .filter((a) => a.member === me.id)
    .reduce((n, a) => n + a.amount, 0);
  const taskBonus = ownClaims
    .filter((c) => c.status === "Approved" && c.kind === "Task")
    .reduce((n, c) => n + c.amount, 0);
  return {
    plan: p,
    versions: admin
      ? (
          await rows(
            "SELECT version,config,created_at FROM reward_plans ORDER BY version DESC",
          )
        ).map((v) => ({
          version: v.version,
          created_at: v.created_at,
          enabled: JSON.parse(v.config).enabled,
        }))
      : [],
    runs: admin
      ? allRuns
      : allRuns
          .filter((r) => r.allocations.some((a) => a.member === me.id))
          .map((r) => ({
            ...r,
            allocations: r.allocations.filter((a) => a.member === me.id),
            fee: 0,
            reserve: 0,
            company: 0,
            turnover: 0,
            transactions: 0,
            note: "",
          })),
    claims: admin ? claims : ownClaims.map(({ criteria, ...c }: any) => c),
    reserveBalance: admin ? await reserveBalance() : null,
    rank: rankFor(me.id, all, allRuns, tasks, p),
    earnings: { commission, taskBonus, total: commission + taskBonus },
    companyTotal: admin
      ? allRuns
          .filter((r) => r.status === "Posted")
          .reduce((n, r) => n + r.company, 0)
      : null,
  };
}
export async function rewardAction(
  path: string,
  b: any,
  actor: LiveMember,
  all: LiveMember[],
  audit: (action: string, subject: string, detail: string) => Promise<void>,
) {
  if (!path.startsWith("rewards/")) return null;
  const p = await plan();
  const admin = () => {
    if (actor.role !== "admin") reject(403, "Administrator access required.");
  };
  const done = (value: unknown = { ok: true }) =>
    Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
  if (path === "rewards/plan") {
    admin();
    if (b.version !== p.version)
      reject(409, "The commission plan changed. Refresh before editing.");
    const next = { ...b.plan, version: p.version + 1 } as CommissionPlan;
    try {
      validatePlan(next);
    } catch (e) {
      reject(400, (e as Error).message);
    }
    if (next.enabled && b.verified !== true)
      reject(
        400,
        "Confirm the fee basis and service-revenue policy before activation.",
      );
    await statement(
      "INSERT INTO reward_plans(version,config,created_by,created_at) VALUES(?,?,?,?)",
      next.version,
      JSON.stringify(next),
      actor.id,
      now(),
    ).run();
    await audit(
      "Commission plan saved",
      actor.id,
      `Version ${next.version}; ${next.enabled ? "active" : "draft"}; ${next.basis}; ${next.mode}. Existing settlements remain unchanged.`,
    );
    return done();
  }
  if (path === "rewards/settle") {
    admin();
    if (!p.enabled || p.basis === "pending")
      reject(409, "Activate a confirmed commission plan first.");
    if (b.version !== p.version)
      reject(409, "Plan changed. Refresh before posting.");
    if (b.verified !== true)
      reject(
        400,
        "Confirm successful service transactions and earned company fee.",
      );
    const entry = await first(
      "SELECT * FROM entries WHERE id=? AND kind='Turnover' AND status='Approved'",
      b.entry,
    );
    if (!entry) reject(400, "Choose approved turnover.");
    if (entry.date > dayIST())
      reject(400, "Future business activity cannot be settled.");
    if (
      await first("SELECT id FROM commission_runs WHERE entry_id=?", entry.id)
    )
      reject(409, "This turnover record is already settled or reversed.");
    const owner = all.find((m) => m.id === entry.member_id);
    if (!owner || owner.status !== "Approved")
      reject(400, "Member onboarding is not approved.");
    const fee = amountPaise(b.fee);
    let result: ReturnType<typeof calculate>;
    try {
      result = calculate(
        p,
        owner!,
        all,
        Number(b.transactions),
        entry.amount_paise,
        fee,
      );
    } catch (e) {
      return reject(400, (e as Error).message);
    }
    const proof = note(b.note);
    await statement(
      "INSERT INTO commission_runs(id,entry_id,member_id,member_name,plan_version,transactions,turnover,fee,reserve,company,allocations,status,date,created_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      crypto.randomUUID(),
      entry.id,
      owner!.id,
      owner!.name,
      p.version,
      Number(b.transactions),
      entry.amount_paise,
      fee,
      result.reserve,
      result.company,
      JSON.stringify(result.allocations),
      "Posted",
      entry.date,
      now(),
      proof,
    ).run();
    await audit(
      "Commission posted",
      owner!.id,
      `Source ${entry.reference}; plan v${p.version}; earned fee ${fee} paise; distributed ${result.paid} paise.`,
    );
    return done();
  }
  if (path === "rewards/reverse") {
    admin();
    const reason = note(b.note);
    const r = await statement(
      "UPDATE commission_runs SET status='Reversed',note=? WHERE id=? AND status='Posted'",
      reason,
      b.id,
    ).run();
    if (r.meta.changes !== 1)
      reject(409, "Settlement is missing or already reversed.");
    await audit("Commission reversed", String(b.id), reason);
    return done();
  }
  if (path === "rewards/claim") {
    if (!p.enabled) reject(409, "Rewards are not active.");
    if (actor.status !== "Approved")
      reject(403, "Approved onboarding is required.");
    const period = dayIST().slice(0, 7);
    let kind: string,
      title: string,
      amount: number,
      taskId: string | null = null,
      rank: string | null = null,
      key: string;
    if (b.task) {
      const t = await first(
        "SELECT * FROM tasks WHERE id=? AND assignee=? AND status='Complete'",
        b.task,
        actor.id,
      );
      if (
        !t ||
        !t.completed_at ||
        dayIST(t.completed_at).slice(0, 7) !== period
      )
        reject(400, "Choose your task approved this month.");
      if (p.taskBonus <= 0) reject(400, "Task incentives are disabled.");
      kind = "Task";
      title = t.title;
      amount = p.taskBonus;
      taskId = t.id;
      key = "task:" + t.id;
      const total = await first(
        "SELECT COALESCE(SUM(amount),0) total FROM reward_claims WHERE member_id=? AND kind='Task' AND period=? AND status IN ('Pending','Approved')",
        actor.id,
        period,
      );
      if (total.total + amount > p.taskMonthlyCap)
        reject(400, "Monthly task incentive cap reached.");
    } else {
      const reward = p.rewards.find((r) => r.id === b.reward && r.enabled);
      if (!reward) reject(400, "Benefit is unavailable.");
      const current = rankFor(
        actor.id,
        all,
        await runs(),
        await rows<LiveTask>("SELECT * FROM tasks"),
        p,
      );
      if (
        current.tier === "member" ||
        (reward!.rank === "pro" && current.tier !== "pro")
      )
        reject(403, "Required performance rank has not been reached.");
      kind = "Benefit";
      title = reward!.title;
      amount = reward!.cost;
      rank = reward!.rank;
      key = actor.id + ":" + reward!.id + ":" + period;
    }
    try {
      const inserted = await statement(
        "INSERT INTO reward_claims(id,member_id,kind,title,amount,status,task_id,rank,period,claim_key,criteria,created_at,note) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ?='Benefit' OR (COALESCE((SELECT SUM(amount) FROM reward_claims WHERE member_id=? AND kind='Task' AND period=? AND status IN ('Pending','Approved')),0)+?)<=?",
        crypto.randomUUID(),
        actor.id,
        kind,
        title,
        amount,
        "Pending",
        taskId,
        rank,
        period,
        key,
        JSON.stringify(p),
        now(),
        "Awaiting funded administrator approval.",
        kind,
        actor.id,
        period,
        amount,
        p.taskMonthlyCap,
      ).run();
      if (inserted.meta.changes !== 1)
        reject(409, "Monthly task incentive cap reached in another request.");
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        reject(409, "This task or monthly benefit has already been requested.");
      throw e;
    }
    await audit(
      "Reward requested",
      actor.id,
      `${kind}: ${title}; ${amount} paise pending review.`,
    );
    return done();
  }
  if (path === "rewards/review") {
    admin();
    const reviewNote = note(b.note);
    if (!["Approved", "Rejected"].includes(b.status))
      reject(400, "Choose an approval decision.");
    const claim = await first("SELECT * FROM reward_claims WHERE id=?", b.id);
    if (!claim || claim.status !== "Pending")
      reject(409, "Request is not pending.");
    if (b.status === "Approved") {
      const owner = all.find((m) => m.id === claim.member_id);
      if (!owner || owner.status !== "Approved")
        reject(400, "Member approval is required.");
      const criteria = JSON.parse(claim.criteria) as CommissionPlan;
      if (claim.kind === "Benefit") {
        const current = rankFor(
          owner!.id,
          all,
          await runs(),
          await rows<LiveTask>("SELECT * FROM tasks"),
          criteria,
        );
        if (
          current.tier === "member" ||
          (claim.rank === "pro" && current.tier !== "pro")
        )
          reject(409, "Performance rank no longer meets this request.");
      }
      const result = await statement(
        "UPDATE reward_claims SET status='Approved',note=? WHERE id=? AND status='Pending' AND amount <= (COALESCE((SELECT SUM(reserve) FROM commission_runs WHERE status='Posted'),0)-COALESCE((SELECT SUM(amount) FROM reward_claims WHERE status='Approved'),0))",
        reviewNote,
        claim.id,
      ).run();
      if (result.meta.changes !== 1)
        reject(
          409,
          "Reserve has insufficient funds or this request was already reviewed.",
        );
    } else {
      const result = await statement(
        "UPDATE reward_claims SET status='Rejected',note=? WHERE id=? AND status='Pending'",
        reviewNote,
        claim.id,
      ).run();
      if (result.meta.changes !== 1) reject(409, "Request already reviewed.");
    }
    await audit(
      "Reward " + b.status,
      claim.member_id,
      `${claim.title}: ${reviewNote}`,
    );
    return done();
  }
  return reject(404, "Reward endpoint not found.");
}
