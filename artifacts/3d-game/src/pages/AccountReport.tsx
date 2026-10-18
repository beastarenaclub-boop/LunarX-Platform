import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useInfiniteQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RefreshCw, Search } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ACCOUNT_OPTIONS } from "@/components/site/AccountOptions";
import { useAuth } from "@/lib/auth";

type Row = {
  id: string;
  at: string;
  type?: string;
  amount?: string;
  balance?: string;
  memo?: string;
  reference?: string;
  game?: string;
  stake?: string;
  payout?: string | null;
  status?: string;
  action?: string;
  ip?: string;
  device?: string;
};
type Page = { items: Row[]; nextCursor: string | null };
export function accountDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}
export function accountMoney(value?: string | null) {
  if (value == null) return "—";
  const amount = BigInt(value);
  const abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${(abs / 100n).toLocaleString("en-IN")}.${(abs % 100n).toString().padStart(2, "0")}`;
}
const label = (text = "") => text.replace(/[._-]/g, " ");
export default function AccountReport({ kind }: { kind: string }) {
  const { user } = useAuth();
  const option = ACCOUNT_OPTIONS.find((o) => o.href === `/report/${kind}`)!;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState({ from: "", to: "" });
  const [error, setError] = useState("");
  const report = useInfiniteQuery({
    queryKey: ["account-report", user?.id, kind, filter],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (filter.from) params.set("from", filter.from);
      if (filter.to) params.set("to", filter.to);
      if (pageParam) params.set("cursor", pageParam);
      return customFetch<Page>(`/api/reports/${kind}?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
    retry: false,
    enabled: !!user,
  });
  const rows = report.data?.pages.flatMap((p) => p.items) ?? [];
  const statement = kind === "accountstatement",
    activity = kind === "activity";
  function apply(event: FormEvent) {
    event.preventDefault();
    if (from && to && from > to) {
      setError("From date must be before the to date.");
      return;
    }
    setError("");
    setFilter({ from, to });
  }
  return (
    <SiteLayout title={option.label} description={option.description}>
      <Link href="/profile" className="account-back">
        ← Profile options
      </Link>
      {kind === "sportbookresult" && (
        <p className="account-notice">
          This platform currently offers virtual sports and racing. These
          records are simulated games, not real-world sporting events.
        </p>
      )}
      {user?.isDemo && (
        <p className="account-notice">
          Practice records only. This history expires with your demo session.
        </p>
      )}
      <section className="account-panel" aria-label={option.label}>
        <form className="account-filters" onSubmit={apply}>
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              max={to || undefined}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={from || undefined}
            />
          </label>
          <button className="account-primary" type="submit">
            <Search size={16} /> Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setFilter({ from: "", to: "" });
              setError("");
            }}
          >
            Reset
          </button>
          <button
            type="button"
            aria-label="Refresh report"
            disabled={report.isFetching}
            onClick={() => void report.refetch()}
          >
            <RefreshCw size={16} />
          </button>
        </form>
        <p className="account-hint">
          Amounts in INR · Times in IST · Newest first
        </p>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        {report.isError && (
          <div className="account-error" role="alert">
            Could not load this report.{" "}
            <button
              onClick={() =>
                void (report.isFetchNextPageError
                  ? report.fetchNextPage()
                  : report.refetch())
              }
            >
              Try again
            </button>
          </div>
        )}
        {report.isPending ? (
          <p className="account-empty" role="status">
            Loading your records…
          </p>
        ) : !rows.length && !report.isError ? (
          <div className="account-empty">
            <option.icon size={32} />
            <strong>No records found</strong>
            <p>
              {kind === "currentbets"
                ? "You have no pending bets for this period."
                : "Your activity will appear here. Try another date range if needed."}
            </p>
          </div>
        ) : (
          rows.length > 0 && (
            <div
              className="account-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${option.label} records`}
            >
              <table className="account-table">
                <thead>
                  <tr>
                    <th>Date & time</th>
                    {statement ? (
                      <>
                        <th>Transaction</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Balance</th>
                        <th>Reference</th>
                      </>
                    ) : activity ? (
                      <>
                        <th>Activity</th>
                        <th>IP address</th>
                        <th>Device / browser</th>
                      </>
                    ) : (
                      <>
                        <th>Game / round</th>
                        <th>Stake</th>
                        <th>Return</th>
                        <th>Profit / loss</th>
                        <th>Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{accountDate(row.at)}</td>
                      {statement ? (
                        <>
                          <td className="account-capitalize">
                            {label(row.type)}
                            <small>{row.memo}</small>
                          </td>
                          <td>
                            {BigInt(row.amount || "0") < 0n
                              ? accountMoney((-BigInt(row.amount!)).toString())
                              : "—"}
                          </td>
                          <td>
                            {BigInt(row.amount || "0") > 0n
                              ? accountMoney(row.amount)
                              : "—"}
                          </td>
                          <td>{accountMoney(row.balance)}</td>
                          <td className="account-reference">
                            {row.reference || row.id}
                          </td>
                        </>
                      ) : activity ? (
                        <>
                          <td className="account-capitalize">
                            {label(row.action)}
                          </td>
                          <td>{row.ip || "—"}</td>
                          <td className="account-device">
                            {row.device || "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="account-capitalize">
                            {label(row.game)}
                            <small className="account-reference">
                              {row.reference || row.id}
                            </small>
                          </td>
                          <td>{accountMoney(row.stake)}</td>
                          <td>
                            {row.status === "placed"
                              ? "Pending"
                              : accountMoney(row.payout ?? "0")}
                          </td>
                          <td>
                            {row.status === "placed"
                              ? "—"
                              : accountMoney(
                                  (
                                    BigInt(row.payout || "0") -
                                    BigInt(row.stake || "0")
                                  ).toString(),
                                )}
                          </td>
                          <td>
                            <span
                              className={`account-status account-status-${row.status}`}
                            >
                              {row.status === "placed"
                                ? "Pending"
                                : label(row.status)}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {rows.length > 0 && (
          <div className="account-pagination">
            <span>{rows.length} records loaded</span>
            {report.hasNextPage && (
              <button
                disabled={report.isFetching}
                onClick={() => void report.fetchNextPage()}
              >
                {report.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </section>
    </SiteLayout>
  );
}
