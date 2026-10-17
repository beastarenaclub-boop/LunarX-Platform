"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Download, RefreshCw } from "lucide-react";
import { Badge, Empty, Panel } from "../App";
import { dayIST, inr, type Snapshot } from "./types";
import { excel, pdf, rangeFor, type ExportSheet } from "./reporting";
import type { MemberPerformance } from "./performance";

export default function TeamPerformance({
  state,
  memberId,
  select,
  notify,
}: {
  state: Snapshot;
  memberId: string;
  select: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [period, setPeriod] = useState("This month");
  const [custom, setCustom] = useState({
    from: dayIST().slice(0, 7) + "-01",
    to: dayIST(),
  });
  const [data, setData] = useState<MemberPerformance | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const range = period === "Custom" ? custom : rangeFor(period);
  const visible =
    state.me!.role === "user"
      ? state.members.filter((m) => m.id === state.me!.id)
      : state.members;
  const id = visible.some((m) => m.id === memberId) ? memberId : state.me!.id;
  useEffect(() => {
    const abort = new AbortController();
    let loading = false;
    setData(null);
    setError("");
    if (!range.from || !range.to || range.from > range.to) {
      setError("Choose a valid performance date range.");
      return;
    }
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(
          `/api/members/${encodeURIComponent(id)}/performance?${new URLSearchParams(range)}`,
          { cache: "no-store", signal: abort.signal },
        );
        const body = (await response.json()) as MemberPerformance & {
          error?: string;
        };
        if (!response.ok)
          throw Error(body.error || "Performance report unavailable.");
        if (!abort.signal.aborted) {
          setData(body);
          setError("");
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError((cause as Error).message);
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [id, range.from, range.to, refresh]);
  const report =
    data?.member.id === id &&
    data.range.from === range.from &&
    data.range.to === range.to
      ? data
      : null;
  async function download(format: "excel" | "pdf") {
    if (!report) return;
    setExporting(true);
    const sheets: ExportSheet[] = [
      {
        name: "Member performance",
        headings: ["Metric", "Value"],
        rows: [
          ["Member", report.member.name],
          ["Referral ID", report.member.ref],
          ["From", range.from],
          ["To", range.to],
          ["Approved turnover INR", report.own.turnover / 100],
          ["Settled successful transactions", report.own.transactions],
          ["Own commission INR", report.own.self / 100],
          ["Direct commission INR", report.own.direct / 100],
          ["Indirect commission INR", report.own.indirect / 100],
          ["Total booked commission INR", report.own.commission / 100],
          [
            "Your commission from branch INR",
            report.team.viewerCommission / 100,
          ],
          ["Operating income INR", report.own.income / 100],
          ["Operating expense INR", report.own.expense / 100],
        ],
      },
      {
        name: "Daily performance",
        headings: [
          "Date",
          "Own turnover INR",
          "Own successful transactions",
          "Member commission INR",
          "Your branch commission INR",
        ],
        rows: report.days.map((d) => [
          d.date,
          d.turnover / 100,
          d.transactions,
          d.commission / 100,
          d.viewerCommission / 100,
        ]),
      },
      {
        name: "Bank performance",
        headings: [
          "Bank",
          "Own turnover INR",
          "Successful transactions",
          "Own commission INR",
          "Income INR",
          "Expense INR",
        ],
        rows: report.banks.map((b) => [
          b.bank,
          b.turnover / 100,
          b.transactions,
          b.self / 100,
          b.income / 100,
          b.expense / 100,
        ]),
      },
      {
        name: "Tree levels",
        headings: [
          "Level",
          "Members",
          "Eligible agents",
          "Approved turnover INR",
          "Settled turnover INR",
          "Transactions",
          "Member direct INR",
          "Member indirect INR",
          "Member total INR",
          "Your commission INR",
        ],
        rows: report.levels.map((r) => [
          r.depth,
          r.members,
          r.eligibleAgents,
          r.turnover / 100,
          r.settledTurnover / 100,
          r.transactions,
          r.direct / 100,
          r.indirect / 100,
          r.commissionToSelected / 100,
          r.viewerCommission / 100,
        ]),
      },
      {
        name: "Whole branches",
        headings: [
          "Side",
          "Members",
          "Approved turnover INR",
          "Settled turnover INR",
          "Direct INR",
          "Indirect INR",
          "Member total INR",
        ],
        rows: report.branches.map((r) => [
          r.side,
          r.members,
          r.turnover / 100,
          r.settledTurnover / 100,
          r.direct / 100,
          r.indirect / 100,
          r.commissionToSelected / 100,
        ]),
      },
    ];
    try {
      if (format === "excel") await excel(sheets, "member-performance");
      else
        await pdf(
          "Member performance proforma",
          `${report.member.name} · ${range.from} to ${range.to} · posted entitlements`,
          sheets,
          "member-performance",
        );
    } catch {
      notify("Performance export failed. Please retry.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <Panel
        title="Member performance proforma"
        eyebrow="LIVE BUSINESS RECORDS · REFRESHES EVERY 15 SECONDS"
      >
        <div className="live-form-pad">
          <div className="performance-filters form">
            <label>
              View member
              <select value={id} onChange={(e) => select(e.target.value)}>
                {visible.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.ref}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Performance period
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {[
                  "Today",
                  "Yesterday",
                  "This month",
                  "Last month",
                  "All time",
                  "Custom",
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {period === "Custom" && (
              <>
                <label>
                  From
                  <input
                    type="date"
                    value={custom.from}
                    onChange={(e) =>
                      setCustom({ ...custom, from: e.target.value })
                    }
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={custom.to}
                    onChange={(e) =>
                      setCustom({ ...custom, to: e.target.value })
                    }
                  />
                </label>
              </>
            )}
          </div>
          <div className="page-actions">
            <button
              className="btn secondary small"
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={15} />
              Refresh performance
            </button>
            <button
              className="btn secondary small"
              disabled={!report || exporting}
              onClick={() => void download("excel")}
            >
              <Download size={15} />
              Performance Excel
            </button>
            <button
              className="btn secondary small"
              disabled={!report || exporting}
              onClick={() => void download("pdf")}
            >
              <Download size={15} />
              Performance PDF
            </button>
          </div>
          <p className="subtle-note no-pad">
            Successful transaction count aur commission posted settlements se
            hain. Pending / reversed settlement earning mein nahi judta.
            Turnover paison ka volume hai; commission alag hai. All dates
            Asia/Kolkata.
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
      </Panel>
      {!report && !error && <p role="status">Loading performance…</p>}
      {report && (
        <>
          <div className="performance-heading">
            <h2>{report.member.name}</h2>
            <Badge>{report.member.ref}</Badge>
            <Badge
              tone={report.member.status === "Approved" ? "green" : "gold"}
            >
              {report.member.status} · {report.member.role}
            </Badge>
          </div>
          <div className="stats-grid live-report-stats">
            {[
              ["Own approved turnover", inr(report.own.turnover)],
              [
                "Own successful transactions",
                report.own.transactions.toLocaleString("en-IN"),
              ],
              ["Own commission", inr(report.own.self)],
              ["Direct commission", inr(report.own.direct)],
              ["Indirect commission", inr(report.own.indirect)],
              ["Total booked commission", inr(report.own.commission)],
              [
                "Your commission from this branch",
                inr(report.team.viewerCommission),
              ],
              ["Pending turnover", inr(report.own.pendingTurnover)],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-top">{label}</div>
                <div className="stat-value">
                  <strong>{value}</strong>
                </div>
              </div>
            ))}
          </div>
          {report.canExploreTeam && (
            <Panel
              title="Left / right direct members"
              className="spaced"
              action={<Badge>Click a member to open their report</Badge>}
            >
              <div className="performance-directs">
                {["left", "right"].map((side) => {
                  const m = report.directs.find((d) => d.position === side);
                  return m ? (
                    <button
                      className="performance-direct"
                      key={side}
                      onClick={() => select(m.id)}
                      disabled={state.me!.role === "user"}
                    >
                      <span>
                        {side.toUpperCase()} · {m.agent ? "AGENT" : "MEMBER"}
                      </span>
                      <h3>
                        {m.name} <ArrowUpRight size={18} />
                      </h3>
                      <small>
                        {m.ref} · {m.status} · {m.accounts} accounts
                      </small>
                      <dl>
                        <div>
                          <dt>Own turnover</dt>
                          <dd>{inr(m.turnover)}</dd>
                        </div>
                        <div>
                          <dt>Successful transactions</dt>
                          <dd>{m.transactions.toLocaleString("en-IN")}</dd>
                        </div>
                        <div>
                          <dt>Direct commission to {report.member.name}</dt>
                          <dd>{inr(m.commissionToSelected)}</dd>
                        </div>
                      </dl>
                    </button>
                  ) : (
                    <div className="performance-direct empty" key={side}>
                      <span>{side.toUpperCase()}</span>
                      <h3>Position available</h3>
                      <p>No member assigned yet.</p>
                    </div>
                  );
                })}
              </div>
              <p className="subtle-note">
                Direct cards show each child's own activity. Deeper activity
                contributes through the indirect pool. Joining alone earns no
                commission.
              </p>
            </Panel>
          )}
          {report.canExploreTeam && (
            <div className="summary-pills spaced">
              <span>
                Downline <strong>{report.team.members} members</strong>
              </span>
              <span>
                Branch turnover incl. own{" "}
                <strong>{inr(report.team.turnover)}</strong>
              </span>
              <span>
                Branch successful transactions{" "}
                <strong>{report.team.transactions}</strong>
              </span>
              <span>
                Account references <strong>{report.member.accounts}</strong>
              </span>
            </div>
          )}
          {report.canExploreTeam && (
            <Panel
              title="Actual tree commission by level"
              className="spaced"
              eyebrow="BOOKED ALLOCATIONS · SELECTED DATE RANGE"
            >
              <div className="live-form-pad">
                <div className="tree-branch-totals">
                  {report.branches.map((branch) => (
                    <article key={branch.side}>
                      <h3>
                        {branch.side === "left"
                          ? "Poora left branch"
                          : "Poora right branch"}
                      </h3>
                      <p>
                        {branch.members} members · {inr(branch.turnover)}{" "}
                        approved turnover
                      </p>
                      <strong>{inr(branch.commissionToSelected)}</strong>
                      <small>{report.member.name} ko booked commission</small>
                      <p>
                        Direct {inr(branch.direct)} + indirect{" "}
                        {inr(branch.indirect)}
                      </p>
                    </article>
                  ))}
                </div>
                <p className="subtle-note no-pad">
                  Har source member ek level aur ek branch mein count hota hai.
                  Neeche amounts {report.member.name} ke booked shares hain;
                  current rates se purani earning dobara calculate nahi hoti.
                  Pending / reversed settlements earning mein include nahi hain.
                </p>
                <div className="table-scroll">
                  <table className="actual-tree-levels">
                    <thead>
                      <tr>
                        <th>Source level</th>
                        <th>Members / agents</th>
                        <th>Approved turnover</th>
                        <th>Settled turnover</th>
                        <th>Transactions</th>
                        <th>Direct to member</th>
                        <th>Indirect to member</th>
                        <th>Total to member</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.levels.map((level) => (
                        <tr key={level.depth}>
                          <td>
                            {level.depth === 0
                              ? "Own activity"
                              : `Level ${level.depth}`}
                          </td>
                          <td>
                            {level.members} / {level.eligibleAgents}
                          </td>
                          <td>{inr(level.turnover)}</td>
                          <td>{inr(level.settledTurnover)}</td>
                          <td>{level.transactions.toLocaleString("en-IN")}</td>
                          <td>{inr(level.direct)}</td>
                          <td>{inr(level.indirect)}</td>
                          <td>
                            <strong>{inr(level.commissionToSelected)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="subtle-note no-pad">
                  Agent/date upar select karein. Kisi direct member ka card
                  kholkar uski poori branch drill down karein. Tree levels aur
                  whole-branch totals Performance Excel / PDF mein bhi milenge.
                </p>
              </div>
            </Panel>
          )}
          <div className="summary-pills spaced">
            <span>
              Operating income <strong>{inr(report.own.income)}</strong>
            </span>
            <span>
              Operating expense <strong>{inr(report.own.expense)}</strong>
            </span>
            <span>
              Period operating net{" "}
              <strong>{inr(report.own.income - report.own.expense)}</strong>
            </span>
          </div>
          <Panel title="Work status · all assigned tasks" className="spaced">
            <div className="summary-pills live-form-pad">
              <span>
                To do <strong>{report.tasks.todo}</strong>
              </span>
              <span>
                In progress <strong>{report.tasks.progress}</strong>
              </span>
              <span>
                In review <strong>{report.tasks.review}</strong>
              </span>
              <span>
                Complete{" "}
                <strong>
                  {report.tasks.complete}/{report.tasks.total}
                </strong>
              </span>
            </div>
          </Panel>
          <Panel title="Bank-wise own performance" className="spaced">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Turnover</th>
                    <th>Successful transactions</th>
                    <th>Own commission</th>
                    <th>Income</th>
                    <th>Expense</th>
                  </tr>
                </thead>
                <tbody>
                  {report.banks.map((b) => (
                    <tr key={b.bank}>
                      <td>{b.bank}</td>
                      <td>{inr(b.turnover)}</td>
                      <td>{b.transactions}</td>
                      <td>{inr(b.self)}</td>
                      <td>{inr(b.income)}</td>
                      <td>{inr(b.expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.banks.length && (
              <Empty
                title="No bank activity in this period"
                detail="Approved records and posted settlements will appear here."
              />
            )}
          </Panel>
          <Panel title="Day-wise performance" className="spaced">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Own turnover</th>
                    <th>Own successful transactions</th>
                    <th>Member's total commission</th>
                    <th>Your branch commission</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{inr(d.turnover)}</td>
                      <td>{d.transactions}</td>
                      <td>{inr(d.commission)}</td>
                      <td>{inr(d.viewerCommission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.days.length && (
              <Empty
                title="No activity in this period"
                detail="Try another date range or check after settlements are posted."
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}
