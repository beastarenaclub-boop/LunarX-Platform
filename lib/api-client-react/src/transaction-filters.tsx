import { useState, type ReactNode } from "react";

type Values = {
  period: string;
  from: string;
  to: string;
  q: string;
  min: string;
  max: string;
  direction: string;
  type: string;
  status: string;
  game: string;
  accountKind: string;
};
const empty: Values = {
  period: "all",
  from: "",
  to: "",
  q: "",
  min: "",
  max: "",
  direction: "all",
  type: "",
  status: "",
  game: "",
  accountKind: "",
};
const paise = (value: string) => {
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(value))
    throw Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
};
export function transactionMoney(value: string) {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}₹${(a / 100n).toLocaleString("en-IN")}.${String(a % 100n).padStart(2, "0")}`;
}
export function useTransactionFilters() {
  const [draft, setDraft] = useState<Values>(empty),
    [applied, setApplied] = useState<Values>(empty),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  function apply(values = draft) {
    try {
      if (values.period === "custom") {
        if (!values.from || !values.to)
          throw Error("Choose both start and end dates.");
        if (values.from > values.to)
          throw Error("Start date must precede end date.");
        if ((Date.parse(values.to) - Date.parse(values.from)) / 86400000 >= 366)
          throw Error("Choose up to 366 days.");
      }
      const min = values.min ? paise(values.min) : null,
        max = values.max ? paise(values.max) : null;
      if (min && max && BigInt(min) > BigInt(max))
        throw Error("Minimum amount must not exceed maximum amount.");
      setError("");
      setApplied(values);
      setOffset(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const query: Record<string, string> = {
    period: applied.period,
    limit: "50",
    offset: String(offset),
  };
  if (applied.period === "custom") {
    query.from = applied.from;
    query.to = applied.to;
  }
  if (applied.q.trim()) query.q = applied.q.trim();
  if (applied.min) query.minAmount = paise(applied.min);
  if (applied.max) query.maxAmount = paise(applied.max);
  for (const key of ["type", "status", "game", "accountKind"] as const)
    if (applied[key]) query[key] = applied[key];
  if (applied.direction !== "all") query.direction = applied.direction;
  return {
    draft,
    setDraft,
    applied,
    apply,
    query,
    offset,
    setOffset,
    error,
    reset: () => {
      setDraft(empty);
      setApplied(empty);
      setOffset(0);
      setError("");
    },
  };
}
export const walletTypes = [
  "deposit",
  "withdraw",
  "bet",
  "win",
  "bonus",
  "adjustment",
  "refund",
  "commission",
];
export function TransactionFilters({
  state,
  types,
  statuses,
  direction = true,
  dates = true,
  commission = false,
  children,
}: {
  state: ReturnType<typeof useTransactionFilters>;
  types?: string[];
  statuses?: string[];
  direction?: boolean;
  dates?: boolean;
  commission?: boolean;
  children?: ReactNode;
}) {
  const { draft, setDraft } = state;
  const field = (key: keyof Values, value: string) =>
    setDraft({ ...draft, [key]: value });
  return (
    <section className="transaction-filters" aria-label="Transaction filters">
      <style>{styles}</style>
      {dates && (
        <div className="tf-presets" aria-label="Transaction period">
          {[
            ["all", "All time"],
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
            ["custom", "Custom"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={draft.period === value}
              onClick={() => {
                const today = new Date(Date.now() + 330 * 60000)
                  .toISOString()
                  .slice(0, 10);
                const next = {
                  ...draft,
                  period: value!,
                  ...(value === "custom"
                    ? { from: draft.from || today, to: draft.to || today }
                    : {}),
                };
                setDraft(next);
                state.apply(next);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          state.apply();
        }}
      >
        {dates && draft.period === "custom" && (
          <>
            <label>
              From (IST)
              <input
                type="date"
                value={draft.from}
                onChange={(e) => field("from", e.target.value)}
                required
              />
            </label>
            <label>
              To (IST)
              <input
                type="date"
                value={draft.to}
                onChange={(e) => field("to", e.target.value)}
                required
              />
            </label>
          </>
        )}
        <label className="tf-search">
          Search transactions
          <input
            type="search"
            maxLength={100}
            placeholder="Account, reference / UTR, ID or memo"
            value={draft.q}
            onChange={(e) => field("q", e.target.value)}
          />
        </label>
        {types && (
          <label>
            Transaction type
            <select
              aria-label="Transaction type"
              value={draft.type}
              onChange={(e) => field("type", e.target.value)}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {statuses && (
          <label>
            Payment status
            <select
              aria-label="Payment status"
              value={draft.status}
              onChange={(e) => field("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {direction && (
          <label>
            Credit / debit
            <select
              aria-label="Credit / debit"
              value={draft.direction}
              onChange={(e) => field("direction", e.target.value)}
            >
              <option value="all">All amounts</option>
              <option value="credit">Credit / positive</option>
              <option value="debit">Debit / negative</option>
            </select>
          </label>
        )}
        <label>
          Minimum amount (₹)
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={draft.min}
            onChange={(e) => field("min", e.target.value)}
          />
        </label>
        <label>
          Maximum amount (₹)
          <input
            inputMode="decimal"
            placeholder="No limit"
            value={draft.max}
            onChange={(e) => field("max", e.target.value)}
          />
        </label>
        {commission && (
          <>
            <label>
              Game code
              <input
                placeholder="e.g. dice"
                maxLength={80}
                value={draft.game}
                onChange={(e) => field("game", e.target.value)}
              />
            </label>
          </>
        )}
        {children}
        <div className="tf-actions">
          <button type="submit">Apply filters</button>
          <button type="button" onClick={state.reset}>
            Reset filters
          </button>
        </div>
      </form>
      <p>
        Times in IST · Amount range uses absolute value ·{" "}
        {dates
          ? state.applied.period === "all"
            ? "All dates"
            : state.applied.period === "custom"
              ? `${state.applied.from} to ${state.applied.to}, inclusive`
              : state.applied.period === "weekly"
                ? "Current Monday–Sunday"
                : state.applied.period === "monthly"
                  ? "Current calendar month"
                  : state.applied.period
          : "Dates follow the commission summary above"}
      </p>
      {state.error && (
        <p role="alert" className="tf-error">
          {state.error}
        </p>
      )}
    </section>
  );
}
export type TransactionPageInfo = {
  total: number;
  summary?: { credit: string; debit: string; net: string };
};
export function TransactionPagination({
  state,
  data,
  signed = true,
  loading = false,
}: {
  state: ReturnType<typeof useTransactionFilters>;
  data?: TransactionPageInfo;
  signed?: boolean;
  loading?: boolean;
}) {
  const total = data?.total ?? 0;
  return (
    <div className="transaction-filters tf-footer">
      <style>{styles}</style>
      {data?.summary && (
        <p>
          {signed
            ? `Credits ${transactionMoney(data.summary.credit)} · Debits ${transactionMoney(data.summary.debit)} · Net ${transactionMoney(data.summary.net)}`
            : `Matching amount ${transactionMoney(data.summary.net)}`}
        </p>
      )}
      <div className="tf-pager">
        <span>
          {data
            ? total
              ? `${state.offset + 1}–${Math.min(state.offset + 50, total)} of ${total} transactions`
              : "0 matching transactions"
            : "Loading transactions…"}
        </span>
        <button
          type="button"
          disabled={loading || state.offset === 0}
          onClick={() => state.setOffset(Math.max(0, state.offset - 50))}
        >
          Previous transactions
        </button>
        <button
          type="button"
          disabled={loading || state.offset + 50 >= total}
          onClick={() => state.setOffset(state.offset + 50)}
        >
          Next transactions
        </button>
      </div>
    </div>
  );
}
const styles = `.transaction-filters{color:#234638;font:13px/1.5 system-ui,sans-serif;border:1px solid #d7e5dc;background:#f8fbf9;padding:15px;border-radius:10px;margin:14px 0;min-width:0}.transaction-filters *{box-sizing:border-box}.transaction-filters form,.tf-presets,.tf-actions,.tf-pager{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.tf-presets{margin-bottom:14px}.transaction-filters label{display:flex;flex:1 1 140px;flex-direction:column;gap:5px;color:#4c6959;font-size:12px;min-width:0;max-width:230px}.transaction-filters label.tf-search{flex-basis:260px;max-width:420px}.transaction-filters input,.transaction-filters select{font:14px system-ui,sans-serif;color:#234638;background:#fff;padding:10px;border:1px solid #cbdcd0;border-radius:6px;width:100%;min-width:0;height:41px}.transaction-filters button{font:600 12px system-ui,sans-serif;border:1px solid #cbdcd0;background:white;color:#1d6447;padding:10px 12px;border-radius:6px;cursor:pointer;white-space:normal}.transaction-filters button[aria-pressed=true],.transaction-filters button[type=submit]{background:#137451;color:white;border-color:#137451}.transaction-filters button:disabled{opacity:.45;cursor:default}.transaction-filters p{font-size:11px;color:#6f8577;margin:10px 0 0}.transaction-filters .tf-error{color:#b33846}.tf-pager{align-items:center;margin-top:8px}.tf-pager span{margin-right:auto}.transaction-filters :focus-visible{outline:2px solid #1f9976;outline-offset:2px}.tf-footer{background:white}@media(max-width:600px){.transaction-filters label{flex-basis:calc(50% - 10px);max-width:none}.transaction-filters label.tf-search{flex-basis:100%}.tf-actions{width:100%}.tf-pager button{flex:1}}`;
