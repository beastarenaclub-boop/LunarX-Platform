"use client";
import { useState, type FormEvent } from "react";
import {
  Award,
  Calculator,
  CheckCircle2,
  Download,
  Gem,
  GitBranch,
  Plane,
  Plus,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { Badge, Panel, Empty } from "../App";
import {
  calculate,
  commissionAmount,
  maxLevels,
  type CommissionPlan,
  type CommissionRun,
} from "./commissions";
import { dayIST, inr, type LiveMember, type Snapshot } from "./types";
import { excel, pdf, type ExportSheet } from "./reporting";
import CommissionChart from "./CommissionChart";
import TreeCalculator from "./TreeCalculator";
type Props = {
  state: Snapshot;
  busy: boolean;
  act: (path: string, payload: unknown) => Promise<any>;
  notify: (s: string) => void;
};
export default function Rewards(props: Props) {
  const [tab, setTab] = useState<
    "earnings" | "chart" | "calculator" | "tree" | "admin"
  >("earnings");
  const { state, busy, act, notify } = props,
    r = state.rewards;
  if (!r)
    return (
      <Empty
        title="Rewards are loading"
        detail="Refresh the workspace to load the commission plan."
      />
    );
  const me = state.me!,
    admin = me.role === "admin",
    p = r.plan;
  const rankName =
    r.rank.tier === "pro"
      ? p.pro.name
      : r.rank.tier === "gold"
        ? p.gold.name
        : "Member";
  async function exportLedger(format: string) {
    const sheets: ExportSheet[] = [
      {
        name: "Commission allocations",
        headings: [
          "Date",
          "Source member",
          "Plan",
          "Beneficiary",
          "Share",
          "Level",
          "INR",
          "Status",
        ],
        rows: r!.runs.flatMap((run) =>
          run.allocations.map((a) => [
            run.date,
            run.member_name,
            run.plan_version,
            a.name,
            a.type,
            a.depth,
            a.amount / 100,
            run.status,
          ]),
        ),
      },
      {
        name: "Incentive requests",
        headings: ["Title", "Kind", "INR", "Status", "Period", "Review note"],
        rows: r!.claims.map((c) => [
          c.title,
          c.kind,
          c.amount / 100,
          c.status,
          c.period,
          c.note,
        ]),
      },
    ];
    try {
      if (format === "excel") await excel(sheets, "commission-register");
      else
        await pdf(
          "Commission & incentive register",
          `${me.name} · ${dayIST()} · booked entitlements`,
          sheets,
          "commission-register",
        );
    } catch {
      notify("Export failed. Please retry.");
    }
  }
  return (
    <>
      <div className="reward-banner">
        <div className="reward-emblem">
          <Gem size={31} />
        </div>
        <div>
          <div className="eyebrow">EARNED THROUGH VERIFIED WORK</div>
          <h2>Your work. Your progress.</h2>
          <p>
            Own activity, team service commissions and funded rewards in one
            place.
          </p>
        </div>
        <Badge tone={p.enabled ? "green" : "gold"}>
          {p.enabled ? `Active · v${p.version}` : "Draft · payouts inactive"}
        </Badge>
      </div>
      <div className="reward-tabs">
        <button
          className={tab === "chart" ? "active" : ""}
          onClick={() => setTab("chart")}
        >
          <Calculator size={16} /> Commission chart
        </button>
        <button
          className={tab === "earnings" ? "active" : ""}
          onClick={() => setTab("earnings")}
        >
          <Wallet size={16} /> Earnings & membership
        </button>
        <button
          className={tab === "tree" ? "active" : ""}
          onClick={() => setTab("tree")}
        >
          <GitBranch size={16} /> Tree calculator
        </button>
        <button
          className={tab === "calculator" ? "active" : ""}
          onClick={() => setTab("calculator")}
        >
          <Calculator size={16} /> Distribution calculator
        </button>
        {admin && (
          <button
            className={tab === "admin" ? "active" : ""}
            onClick={() => setTab("admin")}
          >
            <ShieldCheck size={16} /> Plan & approvals
          </button>
        )}
      </div>
      {tab === "chart" && (
        <CommissionChart key={`${p.version}-${p.basis}`} plan={p} />
      )}
      {tab === "tree" && (
        <TreeCalculator
          key={`${p.version}-${p.basis}`}
          plan={p}
          notify={notify}
        />
      )}
      {tab === "earnings" && (
        <>
          <div className="stats-grid live-report-stats">
            {[
              {
                label: "My commission entitlement",
                value: inr(r.earnings.commission),
                note: "Posted settlements, net of reversals",
              },
              {
                label: "Approved task incentives",
                value: inr(r.earnings.taskBonus),
                note: "Funded cash incentives",
              },
              {
                label: "Total booked earnings",
                value: inr(r.earnings.total),
                note: "Recorded entitlement · not bank funds",
              },
              {
                label: "Performance membership",
                value: rankName,
                note: "Rolling 30 days · recalculated",
              },
            ].map((x) => (
              <div className="stat-card" key={x.label}>
                <div className="stat-top">{x.label}</div>
                <div className="stat-main">
                  <div>
                    <strong>{x.value}</strong>
                    <small>{x.note}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="live-two-col">
            <Panel
              title="Your next membership"
              eyebrow="PERFORMANCE, NOT SIGNUP COUNTS"
            >
              <div className="live-form-pad">
                <p className="small muted">
                  From {r.rank.windowStart}:{" "}
                  {r.rank.transactions.toLocaleString("en-IN")} verified service
                  transactions in your branch and {r.rank.tasks} approved
                  personal tasks.
                </p>
                {[p.gold, p.pro].map((t) => (
                  <div className="rank-progress" key={t.name}>
                    <div>
                      <strong>
                        <Award size={17} />
                        {t.name}
                      </strong>
                      <span>
                        {Math.min(
                          100,
                          Math.floor(
                            Math.min(
                              r.rank.transactions / t.transactions,
                              t.tasks ? r.rank.tasks / t.tasks : 1,
                            ) * 100,
                          ),
                        )}
                        %
                      </span>
                    </div>
                    <div className="live-progress">
                      <i
                        style={{
                          width:
                            Math.min(
                              100,
                              Math.min(
                                r.rank.transactions / t.transactions,
                                t.tasks ? r.rank.tasks / t.tasks : 1,
                              ) * 100,
                            ) + "%",
                        }}
                      />
                    </div>
                    <small>
                      {t.transactions.toLocaleString("en-IN")} successful
                      service transactions + {t.tasks} approved tasks
                    </small>
                  </div>
                ))}
                <p className="subtle-note no-pad">
                  Ranks do not increase commission rates or guarantee a trip.
                  Reward approval depends on eligibility and available reserve.
                  Joining or submitting bank/SIM details earns no commission.
                </p>
              </div>
            </Panel>
            <Panel
              title="Current commission structure"
              action={
                <Badge>
                  {p.basis === "pending"
                    ? "Basis unconfirmed"
                    : p.basis === "transaction"
                      ? "Per successful transaction"
                      : "Per ₹100 turnover"}
                </Badge>
              }
            >
              <div className="live-form-pad split-list">
                {[
                  ["Gross fee budget", p.gross],
                  ["Own activity share", p.self],
                  ["Direct agent share", p.direct],
                  [
                    p.mode === "pool"
                      ? "Total indirect upline pool"
                      : `Each indirect agent · max ${p.levels} levels`,
                    p.indirect,
                  ],
                  ["Reward reserve", p.reserve],
                  [
                    "Company retention · all shares eligible",
                    p.gross -
                      p.self -
                      p.direct -
                      p.indirect * (p.mode === "pool" ? 1 : p.levels) -
                      p.reserve,
                  ],
                  ["Minimum company margin", p.minimumCompany],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{inr(Number(value))}</strong>
                  </div>
                ))}
                <p className="subtle-note no-pad">
                  A transaction belongs to one source member. It pays that
                  member’s direct agent once; left and right members generate
                  separate source transactions.{" "}
                  {p.indirect === 0
                    ? "This plan funds only the source member and eligible direct parent; indirect commission is zero."
                    : p.mode === "pool"
                      ? `${inr(p.indirect)} is one total pool shared by all eligible indirect upper agents. More agents divide the same pool.`
                      : "Indirect eligibility uses actual ancestry without skipping levels."}{" "}
                  Company retention is before operating costs and tax.
                </p>
              </div>
            </Panel>
          </div>
          <Panel
            title="Trips & achievement benefits"
            className="spaced"
            action={<Badge>One request per benefit / month</Badge>}
          >
            <div className="reward-catalog">
              {p.rewards
                .filter((x) => x.enabled)
                .map((x) => {
                  const eligible =
                    r.rank.tier === "pro" ||
                    (r.rank.tier === "gold" && x.rank === "gold");
                  return (
                    <article key={x.id}>
                      <Plane size={25} />
                      <Badge tone="gold">
                        {x.rank === "pro" ? p.pro.name : p.gold.name}
                      </Badge>
                      <h3>{x.title}</h3>
                      <strong>{inr(x.cost)}</strong>
                      <p>
                        Benefit budget, subject to funded administrator
                        approval. No automatic travel booking.
                      </p>
                      <button
                        className="btn secondary"
                        disabled={
                          busy ||
                          !p.enabled ||
                          !eligible ||
                          r.claims.some(
                            (c) =>
                              c.member_id === me.id &&
                              c.kind === "Benefit" &&
                              c.title === x.title &&
                              c.period === dayIST().slice(0, 7),
                          )
                        }
                        onClick={() =>
                          void act("rewards/claim", { reward: x.id })
                        }
                      >
                        {eligible
                          ? "Request benefit"
                          : "Reach required membership"}
                      </button>
                    </article>
                  );
                })}
            </div>
          </Panel>
          <Panel
            title="Approved-task incentives"
            className="spaced"
            action={
              <Badge>
                {inr(p.taskBonus)} / task · {inr(p.taskMonthlyCap)} monthly cap
              </Badge>
            }
          >
            <div className="live-form-pad">
              <p className="small muted">
                Only tasks approved this month qualify. Each task can be claimed
                once; requests must be reviewed and funded.
              </p>
              <div className="incentive-task-list">
                {state.tasks
                  .filter(
                    (t) =>
                      t.assignee === me.id &&
                      t.status === "Complete" &&
                      t.completed_at &&
                      dayIST(t.completed_at).slice(0, 7) ===
                        dayIST().slice(0, 7),
                  )
                  .map((t) => (
                    <div key={t.id}>
                      <CheckCircle2 size={18} />
                      <strong>{t.title}</strong>
                      <button
                        className="btn secondary small"
                        disabled={
                          busy ||
                          !p.enabled ||
                          r.claims.some((c) => c.task_id === t.id)
                        }
                        onClick={() =>
                          void act("rewards/claim", { task: t.id })
                        }
                      >
                        {r.claims.some((c) => c.task_id === t.id)
                          ? "Requested"
                          : "Request incentive"}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </Panel>
          <Panel
            title="Commission ledger"
            className="spaced"
            action={
              <div className="page-actions">
                <button
                  className="btn secondary small"
                  onClick={() => void exportLedger("excel")}
                >
                  <Download size={14} /> Excel
                </button>
                <button
                  className="btn secondary small"
                  onClick={() => void exportLedger("pdf")}
                >
                  PDF
                </button>
              </div>
            }
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date / source</th>
                    <th>Beneficiary</th>
                    <th>Share / depth</th>
                    <th>Amount</th>
                    <th>Plan</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.runs.flatMap((run) =>
                    run.allocations.map((a) => (
                      <tr key={run.id + a.member}>
                        <td>
                          {run.date}
                          <small className="table-sub">{run.member_name}</small>
                        </td>
                        <td>{a.name}</td>
                        <td>
                          {a.type} · {a.depth}
                        </td>
                        <td>{inr(a.amount)}</td>
                        <td>v{run.plan_version}</td>
                        <td>
                          <Badge
                            tone={run.status === "Posted" ? "green" : "red"}
                          >
                            {run.status}
                          </Badge>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              {!r.runs.length && (
                <Empty
                  title="No commission settlements yet"
                  detail="Approved business activity must be reconciled with verified earned fees before commissions are posted."
                />
              )}
            </div>
          </Panel>
          <ClaimList {...props} />
        </>
      )}
      {tab === "calculator" && <Simulator plan={p} />}
      {tab === "admin" && admin && (
        <>
          <PlanEditor key={p.version} {...props} />
          <SettlementForm {...props} />
          <div className="stats-grid spaced live-report-stats">
            <div className="stat-card">
              <div className="stat-top">Available reward reserve</div>
              <div className="stat-main">
                <strong>{inr(r.reserveBalance || 0)}</strong>
              </div>
              <small>
                {(r.reserveBalance || 0) < 0
                  ? "Reversal shortfall — new approvals blocked"
                  : "Funded by posted commission settlements"}
              </small>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                Company contribution after allocations
              </div>
              <div className="stat-main">
                <strong>{inr(r.companyTotal || 0)}</strong>
              </div>
              <small>
                Before tax and operating expenses; not guaranteed profit
              </small>
            </div>
          </div>
          <ClaimList {...props} review />
          <Panel title="Settlement controls & reversals" className="spaced">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Source / date</th>
                    <th>Plan</th>
                    <th>Earned fee</th>
                    <th>Reserved</th>
                    <th>Company</th>
                    <th>Status / action</th>
                  </tr>
                </thead>
                <tbody>
                  {r.runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        {run.member_name}
                        <small className="table-sub">{run.date}</small>
                      </td>
                      <td>v{run.plan_version}</td>
                      <td>{inr(run.fee)}</td>
                      <td>{inr(run.reserve)}</td>
                      <td>{inr(run.company)}</td>
                      <td>
                        {run.status === "Posted" ? (
                          <Reverse run={run} act={act} busy={busy} />
                        ) : (
                          <Badge tone="red">Reversed</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle-note">
              Reversal removes the original entitlements and reserve. Previously
              approved benefits remain a cost; a reserve shortfall blocks
              further approvals. Source records cannot be paid twice.
            </p>
          </Panel>
        </>
      )}
    </>
  );
}
function Simulator({ plan }: { plan: CommissionPlan }) {
  const [basis, setBasis] = useState<"transaction" | "per100">(
      plan.basis === "pending" ? "transaction" : plan.basis,
    ),
    [ancestors, setAncestors] = useState(12),
    [transactions, setTransactions] = useState(100),
    [turnover, setTurnover] = useState(100000);
  const p = { ...plan, basis };
  const all: LiveMember[] = Array.from({ length: ancestors + 1 }, (_, i) => ({
    id: "n" + i,
    name: i ? "Upper agent " + i : "Source member",
    parent: i < ancestors ? "n" + (i + 1) : null,
    role: "user",
    status: "Approved",
    position: "left",
    profile: {},
    city: "",
    ref: "",
    revision: 0,
    created_at: "",
  }));
  for (let i = 1; i <= ancestors; i++)
    all.push({
      ...all[0],
      id: "s" + i,
      name: "Other branch",
      parent: "n" + i,
      position: "right",
    });
  let fee = 0;
  let result: ReturnType<typeof calculate> | null = null,
    error = "";
  try {
    fee = commissionAmount(
      basis,
      p.gross,
      transactions,
      Math.round(turnover * 100),
    );
    result = calculate(
      p,
      all[0],
      all,
      transactions,
      Math.round(turnover * 100),
      fee,
    );
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Panel
      title="See where every paisa goes"
      eyebrow="ILLUSTRATION · DOES NOT CREDIT THE LEDGER"
    >
      <div className="live-form-pad">
        <div className="form-columns simulator-inputs">
          <label>
            Illustration basis
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value as typeof basis)}
            >
              <option value="transaction">
                Fixed amount per successful transaction
              </option>
              <option value="per100">Amount per ₹100 verified turnover</option>
            </select>
          </label>
          <label>
            Eligible upper agents
            <input
              type="number"
              min={0}
              max={100}
              value={ancestors}
              onChange={(e) =>
                setAncestors(Math.max(0, Math.min(100, Number(e.target.value))))
              }
            />
          </label>
          <label>
            Successful transaction count
            <input
              type="number"
              min={1}
              max={10000000}
              value={transactions}
              onChange={(e) => setTransactions(Number(e.target.value))}
            />
          </label>
          <label>
            Verified turnover (INR)
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={turnover}
              onChange={(e) => setTurnover(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="info-banner spaced">
          <Calculator />
          <div>
            <strong>
              {!plan.indirect
                ? "Source member + one eligible direct upper agent"
                : plan.mode === "pool"
                  ? "Indirect share is one total pool"
                  : `Indirect share pays up to ${plan.levels} physical levels`}
            </strong>
            <p>
              {!plan.indirect
                ? "The configured indirect pool is zero. Deeper uplines do not receive a share from this source record."
                : plan.mode === "pool"
                  ? "Every eligible indirect agent shares the pool. Each gets less as the upline grows."
                  : "Levels beyond the configured cap receive no share for this source transaction."}{" "}
              Fractions are settled in whole paise; rounding remainder goes to
              nearest eligible agents or stays with the company.
            </p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {result && (
          <>
            <div className="summary-pills">
              <span>
                Earned fee <strong>{inr(fee)}</strong>
              </span>
              <span>
                Member allocations <strong>{inr(result.paid)}</strong>
              </span>
              <span>
                Reward reserve <strong>{inr(result.reserve)}</strong>
              </span>
              <span>
                Company retained <strong>{inr(result.company)}</strong>
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Depth</th>
                    <th>Share</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.allocations.map((a) => (
                    <tr key={a.member}>
                      <td>{a.name}</td>
                      <td>{a.depth}</td>
                      <td>{a.type}</td>
                      <td>{inr(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="subtle-note spaced">
          {basis === "per100"
            ? `All of a member's accounts contribute verified turnover. Each ₹100 funds ${inr(p.gross)} in fees: ${inr(p.self)} self and ${inr(p.direct)} direct. Transaction count is recorded for reporting; it does not multiply these turnover rates.`
            : "This illustration uses fixed amounts per successful transaction, independent of its value."}{" "}
          {p.indirect
            ? `The configured reserve and protected company share allow up to ${maxLevels(p)} fixed indirect levels; pool mode divides one funded pool.`
            : "No indirect share is funded in this plan."}{" "}
          Rounding is per settled record in whole paise. Missing or ineligible
          shares stay with the company. A deeper network creates no extra fee
          for the same turnover.
        </p>
      </div>
    </Panel>
  );
}
function PlanEditor({ state, act, busy }: Props) {
  const original = state.rewards!.plan;
  const [p, setP] = useState<CommissionPlan>(structuredClone(original));
  const [verified, setVerified] = useState(false);
  const edit = (value: Partial<CommissionPlan>) => setP({ ...p, ...value });
  const fields: [keyof CommissionPlan, string][] = [
    ["gross", "Gross company fee budget"],
    ["self", "Own activity share"],
    ["direct", "Direct agent share"],
    [
      "indirect",
      p.mode === "pool" ? "Total indirect pool" : "Each indirect agent share",
    ],
    ["reserve", "Trip / incentive reserve"],
    ["minimumCompany", "Minimum company retention"],
    ["taskBonus", "Bonus per approved task"],
    ["taskMonthlyCap", "Monthly task bonus cap / member"],
  ];
  return (
    <Panel
      title="Edit the commission & membership plan"
      eyebrow="ADMINISTRATOR / VERSIONED POLICY"
    >
      <form
        className="form live-form-pad"
        onSubmit={(e) => {
          e.preventDefault();
          void act("rewards/plan", {
            version: original.version,
            plan: p,
            verified,
          });
        }}
      >
        <div className="info-banner compact-info">
          New versions affect future settlements and new reward requests.
          Existing earnings keep their original amounts and plan version. Values
          below are INR, stored as integer paise.
        </div>
        <p className="subtle-note no-pad">
          {p.basis === "per100"
            ? "Turnover basis: fee and commission fields below are rupees per ₹100 turnover. ₹1.20 means 1.2%; ₹0.20 means 0.2%; ₹0.50 means 0.5%. With the current default, ₹1 lakh gives ₹200 to the direct agent and the remaining ₹1,000 funds ₹500 member, ₹100 shared indirect pool and ₹400 company."
            : "Select a rate basis before setting fee and commission amounts."}{" "}
          Task bonus and monthly cap are fixed rupee budgets. Any new indirect
          pool or reward reserve must fit inside the earned fee and protected
          company share.
        </p>
        <div className="form-columns">
          <label>
            Rate basis
            <select
              value={p.basis}
              onChange={(e) =>
                edit({ basis: e.target.value as CommissionPlan["basis"] })
              }
            >
              <option value="pending">Unconfirmed — keep in draft</option>
              <option value="transaction">
                Fixed amount per successful transaction
              </option>
              <option value="per100">Amount per ₹100 verified turnover</option>
            </select>
          </label>
          <label>
            Indirect distribution
            <select
              value={p.mode}
              onChange={(e) =>
                edit({ mode: e.target.value as CommissionPlan["mode"] })
              }
            >
              <option value="pool">
                One pool shared by all eligible indirect agents
              </option>
              <option value="levels">
                Fixed share per agent, capped physical levels
              </option>
            </select>
          </label>
          {fields.map(([key, label]) => (
            <label key={key}>
              {label} (₹
              {p.basis === "per100" &&
              key !== "taskBonus" &&
              key !== "taskMonthlyCap"
                ? " per ₹100 turnover"
                : ""}
              )
              <input
                type="number"
                min={0}
                step="0.01"
                value={Number(p[key]) / 100}
                required
                onChange={(e) =>
                  edit({ [key]: Math.round(Number(e.target.value) * 100) })
                }
              />
            </label>
          ))}
          <label>
            Maximum indirect physical levels
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={p.levels}
              disabled={p.mode === "pool"}
              onChange={(e) => edit({ levels: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="subtle-note no-pad">
          Indirect depth starts at the grandparent. Missing/unqualified agents
          do not cause deeper agents to move up. Both modes preserve the fee
          budget.
        </p>
        <h3>Performance memberships · rolling 30 days</h3>
        <div className="form-columns">
          {(["gold", "pro"] as const).map((t) => (
            <div className="panel live-form-pad form" key={t}>
              <label>
                Membership name
                <input
                  maxLength={30}
                  value={p[t].name}
                  required
                  onChange={(e) =>
                    edit({ [t]: { ...p[t], name: e.target.value } })
                  }
                />
              </label>
              <label>
                Verified service transactions in branch
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={p[t].transactions}
                  required
                  onChange={(e) =>
                    edit({
                      [t]: { ...p[t], transactions: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Approved personal tasks
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={p[t].tasks}
                  required
                  onChange={(e) =>
                    edit({ [t]: { ...p[t], tasks: Number(e.target.value) } })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <h3>Benefit catalog</h3>
        {p.rewards.map((reward, i) => (
          <div className="reward-edit-row" key={reward.id}>
            <label>
              Benefit name
              <input
                required
                value={reward.title}
                maxLength={100}
                onChange={(e) =>
                  edit({
                    rewards: p.rewards.map((r, n) =>
                      n === i ? { ...r, title: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <label>
              Budget (₹)
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={reward.cost / 100}
                onChange={(e) =>
                  edit({
                    rewards: p.rewards.map((r, n) =>
                      n === i
                        ? {
                            ...r,
                            cost: Math.round(Number(e.target.value) * 100),
                          }
                        : r,
                    ),
                  })
                }
              />
            </label>
            <label>
              Rank
              <select
                value={reward.rank}
                onChange={(e) =>
                  edit({
                    rewards: p.rewards.map((r, n) =>
                      n === i
                        ? { ...r, rank: e.target.value as "gold" | "pro" }
                        : r,
                    ),
                  })
                }
              >
                <option value="gold">{p.gold.name}</option>
                <option value="pro">{p.pro.name}</option>
              </select>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={reward.enabled}
                onChange={(e) =>
                  edit({
                    rewards: p.rewards.map((r, n) =>
                      n === i ? { ...r, enabled: e.target.checked } : r,
                    ),
                  })
                }
              />
              Enabled
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={"Remove " + reward.title}
              onClick={() =>
                edit({ rewards: p.rewards.filter((_, n) => n !== i) })
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          className="btn secondary"
          type="button"
          disabled={p.rewards.length >= 10}
          onClick={() =>
            edit({
              rewards: [
                ...p.rewards,
                {
                  id: "benefit-" + crypto.randomUUID().slice(0, 8),
                  title: "New achievement benefit",
                  cost: 10000,
                  rank: "gold",
                  enabled: true,
                },
              ],
            })
          }
        >
          <Plus size={16} /> Add benefit
        </button>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />
          Activate this policy for future verified business settlements and
          reward requests.
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            required={p.enabled}
          />
          I have confirmed the rate unit and company-earned service revenue.
          Rewards are paid for verified business/work, not enrollment, account
          opening or recruitment.
        </label>
        <button className="btn primary" disabled={busy}>
          Save plan version {original.version + 1}
        </button>
        <p className="small muted">
          Saved versions:{" "}
          {state
            .rewards!.versions.map(
              (v) =>
                `v${v.version} (${v.enabled ? "active at creation" : "draft"})`,
            )
            .join(", ") || "No policy saved yet"}
        </p>
      </form>
    </Panel>
  );
}
function SettlementForm({ state, act, busy }: Props) {
  const [selectedEntry, setSelectedEntry] = useState("");
  const r = state.rewards!,
    p = r.plan,
    eligible = state.entries.filter(
      (e) =>
        e.kind === "Turnover" &&
        e.status === "Approved" &&
        !r.runs.some((run) => run.entry_id === e.id),
    );
  const selected = eligible.find((e) => e.id === selectedEntry);
  return (
    <Panel
      title="Post a verified commission settlement"
      className="spaced"
      eyebrow="ACTUAL EARNED FEE / NO DUPLICATE PAYOUTS"
    >
      <form
        className="form live-form-pad"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act("rewards/settle", {
            ...Object.fromEntries(f),
            version: p.version,
            transactions: Number(f.get("transactions")),
            verified: f.get("verified") === "on",
          });
        }}
      >
        <label>
          Approved turnover record
          <select
            name="entry"
            required
            value={selectedEntry}
            onChange={(e) => setSelectedEntry(e.target.value)}
          >
            <option value="">Select unprocessed approved activity</option>
            {eligible.map((e) => (
              <option key={e.id} value={e.id}>
                {e.reference} ·{" "}
                {state.members.find((m) => m.id === e.member_id)?.name} ·{" "}
                {inr(e.amount_paise)}
              </option>
            ))}
          </select>
        </label>
        {p.basis === "per100" && selected && (
          <p className="info-banner compact-info">
            {inr(selected.amount_paise)} verified turnover × {p.gross / 100}% ={" "}
            {inr(commissionAmount("per100", p.gross, 0, selected.amount_paise))}{" "}
            fee budget. Enter the actual reconciled fee below. All accounts use
            this same rate; each approved source record is settled only once.
          </p>
        )}
        <div className="form-columns">
          <label>
            Verified successful transaction count
            <input
              name="transactions"
              type="number"
              min={1}
              step={1}
              required
            />
          </label>
          <label>
            Actual company-earned fee (₹)
            <input
              name="fee"
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,2})?"
              required
              placeholder="Fee earned, not customer turnover"
            />
          </label>
        </div>
        <label>
          Provider reconciliation / evidence note
          <textarea name="note" required maxLength={500} />
        </label>
        <label className="inline-check">
          <input name="verified" type="checkbox" required />I verified
          successful service transactions and company-earned fees for this
          source record. These are not deposits or recruitment payments.
        </label>
        <button
          className="btn primary"
          disabled={busy || !p.enabled || !eligible.length}
        >
          Post commission using plan v{p.version}
        </button>
        <p className="small muted">
          The server recalculates all shares from the current plan and eligible
          ancestry. No bank transfer is executed. Rewards are reserved from the
          verified fee; turnover itself is never treated as earnings.
        </p>
      </form>
    </Panel>
  );
}
function ClaimList({
  state,
  act,
  busy,
  review = false,
}: Props & { review?: boolean }) {
  const claims = state.rewards!.claims;
  return (
    <Panel
      title={review ? "Reward approval queue" : "Incentive & benefit requests"}
      className="spaced"
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Member / request</th>
              <th>Kind</th>
              <th>Budget</th>
              <th>Status</th>
              <th>Note / decision</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.title}
                  <small className="table-sub">
                    {state.members.find((m) => m.id === c.member_id)?.name}
                  </small>
                </td>
                <td>{c.kind}</td>
                <td>{inr(c.amount)}</td>
                <td>
                  <Badge
                    tone={
                      c.status === "Approved"
                        ? "green"
                        : c.status === "Rejected"
                          ? "red"
                          : "gold"
                    }
                  >
                    {c.status}
                  </Badge>
                </td>
                <td>
                  {review && c.status === "Pending" ? (
                    <form
                      className="form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const note = new FormData(e.currentTarget).get("note");
                        const status = (
                          e.nativeEvent as SubmitEvent
                        ).submitter?.getAttribute("value");
                        void act("rewards/review", { id: c.id, note, status });
                      }}
                    >
                      <input
                        name="note"
                        required
                        maxLength={500}
                        aria-label={"Review note for " + c.title}
                        placeholder="Review / fulfillment note"
                      />
                      <div className="page-actions">
                        <button
                          value="Approved"
                          className="btn primary small"
                          disabled={busy}
                        >
                          Approve from reserve
                        </button>
                        <button
                          value="Rejected"
                          className="btn secondary small"
                          disabled={busy}
                        >
                          Reject
                        </button>
                      </div>
                    </form>
                  ) : (
                    c.note
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!claims.length && (
          <Empty
            title="No reward requests"
            detail="Eligible members can request a task incentive or membership benefit."
          />
        )}
      </div>
    </Panel>
  );
}
function Reverse({
  run,
  act,
  busy,
}: {
  run: CommissionRun;
  act: Props["act"];
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void act("rewards/reverse", {
          id: run.id,
          note: new FormData(e.currentTarget).get("note"),
        });
      }}
    >
      <input
        name="note"
        required
        maxLength={500}
        placeholder="Refund / correction reason"
        aria-label="Reversal reason"
      />
      <button disabled={busy} className="btn secondary small">
        Confirm reversal
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  ) : (
    <button className="btn secondary small" onClick={() => setOpen(true)}>
      Reverse settlement
    </button>
  );
}
