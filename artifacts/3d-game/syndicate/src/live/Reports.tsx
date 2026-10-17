"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  FileText,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Badge, Empty, Panel } from "../App";
import { BANKS } from "./banks";
import { dayIST, inr, type Snapshot } from "./types";
import {
  rangeFor,
  selectEntries,
  totals,
  groups,
  financialSheets,
  excel,
  pdf,
} from "./reporting";
export default function Reports({
  state,
  notify,
  wallet = false,
  operating = false,
  uploadReceipt,
}: {
  state: Snapshot;
  notify: (s: string) => void;
  wallet?: boolean;
  operating?: boolean;
  uploadReceipt?: (entry: string, file: File) => Promise<void>;
}) {
  const [period, setPeriod] = useState("This month");
  const [range, setRange] = useState(() => rangeFor("This month"));
  const [bank, setBank] = useState("All banks");
  const [groupBy, setGroupBy] = useState<"day" | "month">("day");
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState("");
  const entries = useMemo(
    () =>
      selectEntries(
        operating
          ? state.entries.filter(
              (e) => e.kind === "Expense" || e.source === "Allowance",
            )
          : state.entries,
        range,
        bank,
        state.members,
      ),
    [state.entries, state.members, range, bank, operating],
  );
  const summary = totals(entries);
  const allTime = totals(state.entries);
  const grouped = groups(entries, (e) =>
    groupBy === "day" ? e.date : e.date.slice(0, 7),
  );
  const accounts = state.members.flatMap((m) => m.profile.accounts || []);
  const invalid = range.from > range.to;
  const subtitle = `${range.from} to ${range.to} · ${bank} · Asia/Kolkata`;
  async function download(format: "excel" | "pdf") {
    if (invalid) return notify("Start date must be before end date.");
    setExporting(true);
    try {
      const sheets = financialSheets(entries, state.members, groupBy);
      if (format === "excel")
        await excel(sheets, "syndicate-report-" + dayIST());
      else
        await pdf(
          "Financial activity report",
          subtitle,
          sheets,
          "syndicate-report-" + dayIST(),
        );
      notify(`${format === "excel" ? "Excel" : "PDF"} report downloaded.`);
    } catch {
      notify("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      {wallet && (
        <div className="wallet-hero">
          <span className="wallet-hero-icon">
            <Wallet size={28} />
          </span>
          <div>
            <div className="eyebrow">OPERATING LEDGER BALANCE · ALL TIME</div>
            <strong>{inr(allTime.net)}</strong>
            <p>
              Approved income minus approved expenses. Recorded bookkeeping
              balance, not a bank balance.
            </p>
          </div>
          <Badge>
            {state.rewards?.plan.enabled
              ? "Commission ledger separate"
              : "Commission plan draft"}
          </Badge>
        </div>
      )}
      {wallet && state.rewards && (
        <div className="summary-pills">
          <span>
            Commission entitlement{" "}
            <strong>{inr(state.rewards.earnings.commission)}</strong>
          </span>
          <span>
            Approved task incentives{" "}
            <strong>{inr(state.rewards.earnings.taskBonus)}</strong>
          </span>
          <span>
            Separate from operating ledger · see Commissions &amp; rewards
          </span>
        </div>
      )}
      <div className="report-filters panel">
        <div className="filter-presets">
          {[
            "Today",
            "Yesterday",
            "This month",
            "Last month",
            "All time",
            "Custom",
          ].map((p) => (
            <button
              className={period === p ? "active" : ""}
              key={p}
              onClick={() => {
                setPeriod(p);
                if (p !== "Custom") setRange(rangeFor(p));
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="report-filter-fields">
          <label>
            From
            <input
              aria-label="Report from date"
              type="date"
              value={range.from}
              onChange={(e) => {
                setPeriod("Custom");
                setRange({ ...range, from: e.target.value });
              }}
            />
          </label>
          <label>
            To
            <input
              aria-label="Report to date"
              type="date"
              value={range.to}
              onChange={(e) => {
                setPeriod("Custom");
                setRange({ ...range, to: e.target.value });
              }}
            />
          </label>
          <label>
            Bank
            <select
              aria-label="Report bank"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            >
              <option>All banks</option>
              {BANKS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label>
            Group
            <select
              aria-label="Report grouping"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as "day" | "month")}
            >
              <option value="day">Day wise</option>
              <option value="month">Month wise</option>
            </select>
          </label>
          <div className="report-export-buttons">
            <button
              className="btn secondary"
              disabled={exporting || invalid}
              onClick={() => void download("excel")}
            >
              <Download size={15} /> Excel .xlsx
            </button>
            <button
              className="btn primary"
              disabled={exporting || invalid}
              onClick={() => void download("pdf")}
            >
              <FileText size={15} /> Download PDF
            </button>
          </div>
        </div>
        {invalid && (
          <p role="alert" className="error">
            Start date must not be after the end date.
          </p>
        )}
      </div>
      <div className="stats-grid live-report-stats">
        {[
          {
            label: "Approved turnover",
            value: summary.turnover,
            note: "Volume processed · not income",
            icon: RefreshCw,
          },
          {
            label: "Approved income",
            value: summary.income,
            note: "Recognized operating income",
            icon: ArrowDownLeft,
          },
          {
            label: "Approved expenses",
            value: summary.expense,
            note: "Reviewed operating costs",
            icon: ArrowUpRight,
          },
          {
            label: "Net income",
            value: summary.net,
            note: "Income minus expenses",
            icon: Wallet,
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <s.icon size={18} />
            </div>
            <div className="stat-main">
              <div>
                <strong>{inr(s.value)}</strong>
                <small>{s.note}</small>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="summary-pills">
        <span>
          Approved records <strong>{summary.approved}</strong>
        </span>
        <span>
          Awaiting review <strong>{summary.pending}</strong>
        </span>
        <span>
          Account references{" "}
          <strong>
            {
              accounts.filter((a) => bank === "All banks" || a.bank === bank)
                .length
            }
          </strong>
        </span>
      </div>
      <Panel
        title={groupBy === "day" ? "Daily breakdown" : "Monthly breakdown"}
        action={<Badge>IST · approved amounts</Badge>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Turnover</th>
                <th>Income</th>
                <th>Expense</th>
                <th>Net income</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td>{inr(g.turnover)}</td>
                  <td className="green-text">{inr(g.income)}</td>
                  <td>{inr(g.expense)}</td>
                  <td className="amount">{inr(g.net)}</td>
                  <td>{g.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!grouped.length && (
            <Empty
              title="No records for this period"
              detail="Choose another date range or record your first transaction."
            />
          )}
        </div>
      </Panel>
      <Panel
        title="Transactions in this report"
        className="spaced"
        action={<Badge>{entries.length} records</Badge>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / reference</th>
                <th>Member</th>
                <th>Bank</th>
                <th>Kind</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Source</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.date}
                    <small className="table-sub">{e.reference}</small>
                  </td>
                  <td>
                    {state.members.find((m) => m.id === e.member_id)?.name}
                  </td>
                  <td>
                    {accounts.find((a) => a.id === e.account_id)?.bank ||
                      "Company ledger"}
                  </td>
                  <td>{e.kind}</td>
                  <td className="amount">{inr(e.amount_paise)}</td>
                  <td>
                    <Badge
                      tone={
                        e.status === "Approved"
                          ? "green"
                          : e.status === "Rejected"
                            ? "red"
                            : "gold"
                      }
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td>{e.source}</td>
                  <td>
                    {e.kind === "Expense" ? (
                      <div className="receipt-actions">
                        {state.documents
                          .filter((d) => d.kind === "Expense receipt:" + e.id)
                          .map((d) => (
                            <a href={"/api/documents/" + d.id} key={d.id}>
                              Download receipt
                            </a>
                          ))}
                        {e.status === "Pending" && uploadReceipt ? (
                          <label className="upload-button">
                            Upload receipt
                            <input
                              type="file"
                              aria-label={"Upload receipt for " + e.reference}
                              disabled={!!uploading}
                              accept=".pdf,.png,.jpg,.jpeg"
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (!file) return;
                                setUploading(e.id);
                                try {
                                  await uploadReceipt(e.id, file);
                                } finally {
                                  setUploading("");
                                }
                              }}
                            />
                          </label>
                        ) : !state.documents.some(
                            (d) => d.kind === "Expense receipt:" + e.id,
                          ) ? (
                          "Not attached"
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <Empty
              title="Your report is empty"
              detail="No transactions match these filters."
            />
          )}
        </div>
      </Panel>
    </>
  );
}
