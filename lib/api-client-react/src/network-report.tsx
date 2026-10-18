import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {TransactionFilters,useTransactionFilters} from './transaction-filters';

type Role = "admin" | "master" | "agent";
type Period = "today" | "yesterday" | "weekly" | "monthly" | "custom";
type Choice = { id: string; name: string; parentId: string | null };
type Metrics = {
  stake: string;
  payout: string;
  net: string;
  wagers: number;
  players: number;
  company: string | null;
  master: string | null;
  agent: string | null;
};
type Breakdown = Metrics & {
  id: string;
  name: string;
  masterId?: string;
  masterName?: string | null;
};
type Report = {
  role: Role;
  channel: string;
  range: {
    period: Period;
    from: string;
    to: string;
    today: string;
    timezone: string;
  };
  totals: Metrics;
  options: { masters: Choice[]; agents: Choice[] };
  masters: Breakdown[];
  agents: Breakdown[];
  days: (Metrics & { day: string })[];
};
type Ledger = {
  total: number;
  entries: {
    id: string;
    created_at: string;
    source_id: string;
    revision: number;
    player_email: string;
    game_code: string;
    account_name: string;
    account_kind: string;
    amount: string;
    gross_stake: string;
    gross_payout: string;
    terms: {
      companyFeeBps: number;
      masterShareBps: number;
      agentShareBps: number;
    };
  }[];
};
const periods: [Period, string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["custom", "Custom"],
];
const formatDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const money = (value: string) => {
  const amount = BigInt(value),
    abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${(abs / 100n).toLocaleString("en-IN")}.${String(abs % 100n).padStart(2, "0")}`;
};
const sign = (value: string) =>
  BigInt(value) < 0n ? "nr-negative" : "nr-positive";

export function NetworkReport({
  channel: fixedChannel,
  ledger = false,
}: {
  channel?: string;
  ledger?: boolean;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState("b2b");
  const selectedChannel = fixedChannel ?? channel;
  const [period, setPeriod] = useState<Period>("today");
  const [masterId, setMasterId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [dates, setDates] = useState({ from: "", to: "" });
  const [draft, setDraft] = useState(dates);
  const [validation, setValidation] = useState("");
  const [options, setOptions] = useState<Report["options"]>({
    masters: [],
    agents: [],
  });
  const entryFilters=useTransactionFilters();
  const {offset,setOffset}=entryFilters;
  const branchChannel = selectedChannel === "b2b";
  const params = new URLSearchParams({
    period,
    channel: selectedChannel,
    ...(branchChannel && masterId ? { masterId } : {}),
    ...(branchChannel && agentId ? { agentId } : {}),
    ...(period === "custom" ? dates : {}),
  });
  const filterKey = params.toString();
  const report = useQuery({
    queryKey: ["network", "reports", filterKey],
    queryFn: ({ signal }) =>
      customFetch<Report>(`/api/network/reports?${filterKey}`, { signal }),
    enabled: period !== "custom" || (!!dates.from && !!dates.to),
    refetchInterval: 30_000,
    retry: false,
  });
  useEffect(() => {
    if (report.data) setOptions(report.data.options);
  }, [report.data]);
  useEffect(() => {
    setOffset(0);
  }, [filterKey]);
  const data = report.data;
  // Always use the API's resolved IST dates so summary and entries match.
  const entryParams = new URLSearchParams({
    ...entryFilters.query,
    channel: selectedChannel,
    offset: String(offset),
    ...(data ? { from: data.range.from, to: data.range.to } : {}),
    ...(branchChannel && (agentId || masterId)
      ? { nodeId: agentId || masterId }
      : {}),
  });
  const entries = useQuery({
    queryKey: ["network", "report-entries", filterKey, entryParams.toString()],
    queryFn: ({ signal }) =>
      customFetch<Ledger>(`/api/network/ledger?${entryParams}`, { signal }),
    enabled: ledger && !!data && !report.isError,
    refetchInterval: 30_000,
  });
  const role = data?.role;
  // Keep permissions on screen while a different filter is loading.
  const [knownRole, setKnownRole] = useState<Role>();
  useEffect(() => {
    if (role) setKnownRole(role);
  }, [role]);
  const visibleRole = role ?? knownRole;
  const commissionKey =
    visibleRole === "admin"
      ? "company"
      : visibleRole === "master"
        ? "master"
        : "agent";
  const agentChoices = options.agents.filter(
    (a) => !masterId || a.parentId === masterId,
  );
  function choosePeriod(value: Period) {
    setValidation("");
    if (value === "custom") {
      const next = dates.from
        ? dates
        : { from: data?.range.from ?? "", to: data?.range.to ?? "" };
      setDates(next);
      setDraft(next);
    }
    setPeriod(value);
  }
  function breakdown(
    title: string,
    rows: Breakdown[],
    kind: "master" | "agent",
  ) {
    return (
      <section className="nr-section" aria-label={title}>
        <h3>{title}</h3>
        <div className="nr-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{kind === "master" ? "Master" : "Agent"}</th>
                <th>Settled stake</th>
                <th>Player returns</th>
                <th>Net revenue</th>
                {visibleRole === "admin" && <th>Company commission</th>}
                {visibleRole !== "agent" && <th>Master commission</th>}
                <th>Agent commission</th>
                <th>Players / wagers</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.masterName && <small>{row.masterName}</small>}
                  </td>
                  <td>{money(row.stake)}</td>
                  <td>{money(row.payout)}</td>
                  <td className={sign(row.net)}>{money(row.net)}</td>
                  {visibleRole === "admin" && (
                    <td className={sign(row.company!)}>
                      {money(row.company!)}
                    </td>
                  )}
                  {visibleRole !== "agent" && (
                    <td className={sign(row.master!)}>{money(row.master!)}</td>
                  )}
                  <td className={sign(row.agent!)}>{money(row.agent!)}</td>
                  <td>
                    {row.players} / {row.wagers}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        if (kind === "master") {
                          setMasterId(row.id);
                          setAgentId("");
                        } else setAgentId(row.id);
                      }}
                      aria-label={`View ${row.name} commission`}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="nr-empty">No {kind}s in this selection.</p>
        )}
      </section>
    );
  }
  return (
    <section
      className="net-report"
      aria-label="Commission dashboard"
      data-testid="commission-dashboard"
    >
      <style>{styles}</style>
      <header className="nr-heading">
        <div>
          <span className="nr-eyebrow">PERFORMANCE & EARNINGS</span>
          <h2>Commission summary</h2>
          <p>Choose a period and account to review settled activity.</p>
        </div>
        <button
          type="button"
          onClick={() => void qc.invalidateQueries({ queryKey: ["network"] })}
        >
          Refresh report
        </button>
      </header>
      <div className="nr-presets" aria-label="Report period">
        {periods.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => choosePeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="nr-filters">
        {!fixedChannel && visibleRole === "admin" && (
          <label>
            <span>Business channel</span>
            <select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setMasterId("");
                setAgentId("");
              }}
            >
              <option value="b2b">Branch network</option>
              <option value="b2c">Direct customers</option>
            </select>
          </label>
        )}
        {branchChannel && visibleRole === "admin" && (
          <label>
            <span>Commission master</span>
            <select
              value={masterId}
              onChange={(e) => {
                setMasterId(e.target.value);
                setAgentId("");
              }}
            >
              <option value="">All masters</option>
              {options.masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {branchChannel && visibleRole !== "agent" && visibleRole && (
          <label>
            <span>Commission agent</span>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">All agents</option>
              {agentChoices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {visibleRole === "admin" && !masterId
                    ? ` · ${options.masters.find((m) => m.id === a.parentId)?.name ?? ""}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {visibleRole === "agent" && (
          <p className="nr-scope">Your account only</p>
        )}
      </div>
      {period === "custom" && (
        <form
          className="nr-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.from || !draft.to) {
              setValidation("Choose both start and end dates.");
              return;
            }
            if (draft.from > draft.to) {
              setValidation("Start date must precede end date.");
              return;
            }
            if (
              (Date.parse(draft.to) - Date.parse(draft.from)) / 86_400_000 >=
              366
            ) {
              setValidation("Choose a date range of up to 366 days.");
              return;
            }
            setValidation("");
            setDates(draft);
          }}
        >
          <label>
            <span>From (IST)</span>
            <input
              type="date"
              required
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label>
            <span>To (IST)</span>
            <input
              type="date"
              required
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <button type="submit">Apply dates</button>
          <small>Both dates included · up to 366 days</small>
        </form>
      )}
      {validation && (
        <p className="nr-error" role="alert">
          {validation}
        </p>
      )}
      {report.isError && (
        <p className="nr-error" role="alert">
          {report.error.message}{" "}
          <button onClick={() => void report.refetch()}>Retry report</button>
        </p>
      )}
      {report.isFetching && (
        <p role="status" className="nr-loading">
          Updating report…
        </p>
      )}
      {data && !report.isError && (
        <>
          <p className="nr-period-label" data-testid="commission-date-range">
            {formatDate(data.range.from)} – {formatDate(data.range.to)}{" "}
            <strong>IST</strong>
            {period === "weekly" && " · Monday–Sunday"}
            {period === "monthly" && " · Calendar month"}
            {masterId &&
              ` · ${options.masters.find((m) => m.id === masterId)?.name ?? ""}`}
            {agentId &&
              ` · ${options.agents.find((a) => a.id === agentId)?.name ?? ""}`}
          </p>
          <div className="nr-stats">
            {[
              {
                key: "stake",
                label: "Settled stake",
                value: money(data.totals.stake),
              },
              {
                key: "payout",
                label: "Player returns",
                value: money(data.totals.payout),
              },
              {
                key: "net",
                label: "Net revenue",
                value: money(data.totals.net),
                tone: sign(data.totals.net),
              },
              {
                key: "own",
                label:
                  visibleRole === "admin"
                    ? "Company commission"
                    : "My commission",
                value: money(data.totals[commissionKey] ?? "0"),
                tone: sign(data.totals[commissionKey] ?? "0"),
              },
              ...(visibleRole === "admin" && branchChannel
                ? [
                    {
                      key: "master",
                      label: "Master commission",
                      value: money(data.totals.master!),
                    },
                  ]
                : []),
              ...(visibleRole !== "agent" && branchChannel
                ? [
                    {
                      key: "agent",
                      label: "Agent commission",
                      value: money(data.totals.agent!),
                    },
                  ]
                : []),
              {
                key: "players",
                label: "Active players",
                value: String(data.totals.players),
              },
              {
                key: "wagers",
                label: "Settled wagers",
                value: String(data.totals.wagers),
              },
            ].map((card) => (
              <article key={card.key}>
                <span>{card.label}</span>
                <strong
                  className={card.tone}
                  data-testid={`commission-stat-${card.key}`}
                >
                  {card.value}
                </strong>
              </article>
            ))}
          </div>
          <p className="nr-note">
            Commission includes profit and loss at the percentages saved for
            each wager. Dates use settlement / correction posting time in India.
            Wallet balances and weekly payment dues are separate.
          </p>
          {data.totals.wagers === 0 && (
            <p className="nr-empty" data-testid="commission-empty">
              No settled activity in this period.
            </p>
          )}
          {branchChannel &&
            visibleRole === "admin" &&
            breakdown("Commission by master", data.masters, "master")}
          {branchChannel &&
            visibleRole !== "agent" &&
            breakdown("Commission by agent", data.agents, "agent")}
          {data.days.length > 0 && (
            <section className="nr-section" aria-label="Daily commission">
              <h3>Daily commission</h3>
              <div className="nr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date (IST)</th>
                      <th>Settled stake</th>
                      <th>Player returns</th>
                      <th>Net revenue</th>
                      <th>
                        {visibleRole === "admin"
                          ? "Company commission"
                          : "My commission"}
                      </th>
                      <th>Wagers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr key={day.day}>
                        <td>{formatDate(day.day)}</td>
                        <td>{money(day.stake)}</td>
                        <td>{money(day.payout)}</td>
                        <td className={sign(day.net)}>{money(day.net)}</td>
                        <td className={sign(day[commissionKey] ?? "0")}>
                          {money(day[commissionKey] ?? "0")}
                        </td>
                        <td>{day.wagers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      {ledger && data && !report.isError && (
        <section className="nr-section" aria-label="Commission entries">
          <h3>Commission & profit/loss ledger</h3>
          <p>These filters apply to detailed entries. The commission summary above follows the selected period and account.</p>
          <TransactionFilters state={entryFilters} dates={false} commission />
          <p>
            {visibleRole === "master"
              ? "Your master allocation for the selected agents. Agent allocations appear in the summary above."
              : "Signed allocations for the selected period and accounts."}{" "}
            Corrections have a separate revision.
          </p>
          {entries.isError && (
            <p role="alert" className="nr-error">
              Could not load entries.{" "}
              <button onClick={() => void entries.refetch()}>
                Retry entries
              </button>
            </p>
          )}
          {entries.isFetching && <p role="status">Loading entries…</p>}
          {entries.data && !entries.isError && (
            <>
              <div className="nr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time (IST) / reference</th>
                      <th>Player / game</th>
                      <th>Account</th>
                      <th>Stake / return</th>
                      <th>Commission</th>
                      <th>Saved percentages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {new Date(entry.created_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}
                          <small>
                            {entry.source_id} · rev {entry.revision}
                          </small>
                        </td>
                        <td>
                          {entry.player_email}
                          <small>{entry.game_code}</small>
                        </td>
                        <td>
                          {entry.account_name}
                          <small>{entry.account_kind}</small>
                        </td>
                        <td>
                          {money(entry.gross_stake)}
                          <small>Return {money(entry.gross_payout)}</small>
                        </td>
                        <td className={sign(entry.amount)}>
                          {money(entry.amount)}
                        </td>
                        <td>
                          <small>
                            Company fee {entry.terms.companyFeeBps / 100}%
                          </small>
                          <small>
                            Master {entry.terms.masterShareBps / 100}% · Agent{" "}
                            {entry.terms.agentShareBps / 100}%
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!entries.data.total && (
                <p className="nr-empty">
                  No commission entries in this period.
                </p>
              )}
              <div className="nr-pager">
                <span>
                  {entries.data.total
                    ? `${offset + 1}–${Math.min(offset + 50, entries.data.total)} of ${entries.data.total}`
                    : "0 entries"}
                </span>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous entries
                </button>
                <button
                  disabled={offset + 50 >= entries.data.total}
                  onClick={() => setOffset(offset + 50)}
                >
                  Next entries
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}

const styles = `.net-report{font:14px/1.5 system-ui,sans-serif;color:#18352f;background:#fff;border:1px solid #d9e7e1;border-radius:14px;padding:24px;margin-bottom:24px;min-width:0}.net-report *{box-sizing:border-box}.net-report h2{font-size:23px;letter-spacing:-.5px;margin:3px 0;font-weight:750}.net-report h3{font-size:17px;font-weight:700;margin:0 0 12px}.net-report p{color:#60776e;margin:8px 0 16px}.nr-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.nr-eyebrow{color:#16856c;font-size:10px;font-weight:800;letter-spacing:1.5px}.net-report button{font:600 13px system-ui;border:1px solid #cdded5;background:white;border-radius:7px;padding:9px 13px;color:#245746;cursor:pointer;white-space:normal}.net-report button:hover{background:#eaf8f0;border-color:#318368}.net-report button:disabled{opacity:.45;cursor:default}.net-report button:focus-visible,.net-report select:focus,.net-report input:focus{outline:2px solid #209979;outline-offset:2px}.nr-presets{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}.nr-presets button[aria-pressed=true]{background:#126f55;color:white;border-color:#126f55}.nr-filters,.nr-custom{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:12px 0}.net-report label{display:flex;flex-direction:column;gap:6px;min-width:160px;flex:1;max-width:300px}.net-report label span{font-size:12px;font-weight:650;color:#526f62}.net-report input,.net-report select{font:inherit;color:#18352f;background:#fff;border:1px solid #cdded5;border-radius:7px;padding:10px;min-width:0;width:100%;height:42px}.nr-custom small{font-size:11px;color:#6b8377}.net-report .nr-period-label{background:#eef7f1;padding:10px 13px;border-radius:7px;color:#285f48;font-size:12px;margin-top:18px}.nr-period-label strong{margin-left:5px}.nr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}.nr-stats article{border:1px solid #e1eae5;border-radius:9px;padding:16px;min-width:0}.nr-stats span{display:block;color:#647c6e;font-size:12px}.nr-stats strong{display:block;font-size:23px;letter-spacing:-.7px;margin-top:5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.net-report .nr-note{font-size:12px;max-width:85ch}.nr-section{border-top:1px solid #e1eae5;margin-top:24px;padding-top:22px;min-width:0}.nr-table-wrap{max-width:100%;overflow-x:auto}.net-report table{width:100%;border-collapse:collapse;white-space:nowrap;text-align:left}.net-report th{padding:12px;font-size:11px;color:#688071;background:#f5faf7;text-transform:uppercase;border-bottom:1px solid #dfebe3}.net-report td{padding:13px 12px;border-bottom:1px solid #edf3ef;font-size:13px;font-variant-numeric:tabular-nums}.net-report td small{display:block;color:#7b9185;font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis}.nr-positive{color:#16714d}.nr-negative{color:#b13e49}.net-report .nr-error{padding:12px;border-radius:7px;color:#a52a38;background:#fff0f2}.net-report .nr-empty{padding:20px;text-align:center;color:#698072;background:#f7faf8;border-radius:8px}.nr-pager{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}.nr-pager span{font-size:12px;color:#71877a;margin-right:auto}.net-report .nr-scope{margin:0;color:#25684b}.net-report .nr-loading{font-size:12px;color:#4d7462}@media(max-width:700px){.net-report{padding:15px}.nr-stats{grid-template-columns:1fr 1fr;gap:8px}.nr-stats article{padding:12px}.nr-stats strong{font-size:20px}.net-report label{min-width:120px;max-width:100%}.nr-custom small{width:100%}}`;
