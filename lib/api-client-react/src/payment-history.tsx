import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {
  TransactionFilters,
  TransactionPagination,
  useTransactionFilters,
  transactionMoney,
} from "./transaction-filters";
import type { NetworkNode } from "./network-panel";

type RecordRow = {
  id: string;
  requestId: string;
  type: string;
  userId: string;
  email: string | null;
  masterName: string | null;
  agentName: string | null;
  amount: string;
  currency: string;
  status: string;
  method: string;
  reference: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  reviewer: string | null;
  walletAmount: string;
  walletEntries: number;
  reconciliation: string;
};
type History = {
  items: RecordRow[];
  total: number;
  totals: {
    approvedDeposits: string;
    depositWalletCredits: string;
    recordedPaidWithdrawals: string;
    pending: number;
    needsReview: number;
    requestOnly: number;
  };
};
const date = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
const kinds: Record<string, string> = {
  deposit: "Deposit",
  withdrawal_request: "Withdrawal request",
  payout: "Payout record",
};
const reconciliation: Record<string, string> = {
  matched: "Wallet entries match",
  pending: "Awaiting decision",
  needs_review: "Needs review",
  request_only: "Payout confirmation not linked",
};

export function PaymentHistory({
  role = "customer",
  nodes = [],
  channel = "b2b",
}: {
  role?: "admin" | "master" | "agent" | "customer";
  nodes?: NetworkNode[];
  channel?: string;
}) {
  const customer = role === "customer",
    filters = useTransactionFilters();
  // Never reuse an earlier panel/session's payment data after remounting.
  const [instanceId] = useState(() => crypto.randomUUID());
  const [master, setMaster] = useState(""),
    [agent, setAgent] = useState(""),
    [review, setReview] = useState("all");
  const [method, setMethod] = useState("all");
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const params = new URLSearchParams({
    ...filters.query,
    channel,
    reconciliation: review,
    method,
    ...(!customer && channel === "b2b" && (master || agent)
      ? { nodeId: agent || master }
      : {}),
  });
  const endpoint = customer
    ? "/api/payments/history"
    : "/api/network/payment-history";
  const result = useQuery({
    queryKey: ["network", "payment-history", instanceId, role, params.toString()],
    queryFn: ({ signal }) =>
      customFetch<History>(`${endpoint}?${params}`, { signal }),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
  });
  async function download() {
    setExportError("");
    setExporting(true);
    try {
      const query = new URLSearchParams(params);
      query.set("format", "csv");
      query.delete("offset");
      const blob = await customFetch<Blob>(`${endpoint}?${query}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "payment-history.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const totals = result.isError ? undefined : result.data?.totals;
  return (
    <section className="payment-history" aria-label="Connected payment history">
      <style>{styles}</style>
      <h2>
        {customer
          ? "Payment history"
          : "Customer payment history & reconciliation"}
      </h2>
      <p>
        Deposit requests, withdrawal requests and recorded payouts, with their
        linked wallet entries. Amounts are in INR.
      </p>
      <p className="ph-note">
        Wallet matching checks the recorded entries. It does not confirm money
        received or paid in a bank account. An approved withdrawal is not a paid
        withdrawal.
      </p>
      {!customer && (
        <p>
          Records follow the customer's current branch membership. Commission
          and weekly settlements remain in their own reports.
        </p>
      )}
      {!customer && channel === "b2b" && role !== "agent" && (
        <div className="ph-selectors">
          {role === "admin" && (
            <label>
              Payment master
              <select
                aria-label="Payment master"
                value={master}
                onChange={(e) => {
                  setMaster(e.target.value);
                  setAgent("");
                  filters.setOffset(0);
                }}
              >
                <option value="">All masters</option>
                {nodes
                  .filter((n) => n.kind === "master")
                  .map((n) => (
                    <option value={n.id} key={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Payment agent
            <select
              aria-label="Payment agent"
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
                filters.setOffset(0);
              }}
            >
              <option value="">All agents</option>
              {nodes
                .filter(
                  (n) =>
                    n.kind === "agent" && (!master || n.parent_id === master),
                )
                .map((n) => (
                  <option value={n.id} key={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      <TransactionFilters
        state={filters}
        direction={false}
        types={["deposit", "withdrawal_request", "payout"]}
        statuses={[
          "pending",
          "gateway_pending",
          "approved",
          "rejected",
          "cancelled",
          "paid",
          "failed",
        ]}
      />
      <div className="ph-selectors">
        <label>Deposit method<select aria-label="Deposit method" value={method} onChange={e => { setMethod(e.target.value); filters.setOffset(0); }}><option value="all">All payment records</option><option value="manual">Manual deposits</option><option value="auto">Automatic deposits</option></select></label>
        <label>
          Wallet reconciliation
          <select
            aria-label="Wallet reconciliation"
            value={review}
            onChange={(e) => {
              setReview(e.target.value);
              filters.setOffset(0);
            }}
          >
            <option value="all">All records</option>
            {Object.entries(reconciliation).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void download()}
          disabled={exporting || result.isPending || result.isError}
        >
          {exporting ? "Preparing CSV…" : "Export matching CSV"}
        </button>
      </div>
      <p>
        CSV includes all matching records, up to 10,000. Exported amount columns
        use paise.
      </p>
      {exportError && (
        <p className="ph-error" role="alert">
          {exportError}
        </p>
      )}
      {result.isFetching && <p role="status">Loading payment history…</p>}
      {result.isError && (
        <p className="ph-error" role="alert">
          Payment history could not be loaded. {result.error.message}{" "}
          <button onClick={() => void result.refetch()}>
            Retry payment history
          </button>
        </p>
      )}
      {totals && (
        <div className="ph-totals" aria-label="Matching payment totals">
          {[
            ["Approved deposits", transactionMoney(totals.approvedDeposits)],
            [
              "Linked deposit wallet credits",
              transactionMoney(totals.depositWalletCredits),
            ],
            [
              "Withdrawals marked paid",
              transactionMoney(totals.recordedPaidWithdrawals),
            ],
            ["Pending requests / payouts", String(totals.pending)],
            ["Records needing review", String(totals.needsReview)],
            ["Withdrawal request records", String(totals.requestOnly)],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      )}
      {result.data && !result.isError && (
        <>
          <div className="ph-table">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  {!customer && <th>Customer / branch</th>}
                  <th>Record</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference / details</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{date(row.createdAt)}</td>
                    {!customer && (
                      <td>
                        {row.email}
                        <small>
                          {row.masterName ?? "Direct customer"}
                          {row.agentName ? ` / ${row.agentName}` : ""}
                        </small>
                        <small>User {row.userId}</small>
                      </td>
                    )}
                    <td>
                      {kinds[row.type] ?? row.type}
                      <small>{row.method}</small>
                    </td>
                    <td>{transactionMoney(row.amount)}</td>
                    <td>
                      <strong>{row.status.replaceAll("_", " ")}</strong>
                      <small
                        className={
                          row.reconciliation === "needs_review"
                            ? "ph-error"
                            : ""
                        }
                      >
                        {reconciliation[row.reconciliation] ??
                          row.reconciliation}
                      </small>
                    </td>
                    <td>
                      {row.reference ?? "No reference recorded"}
                      <details>
                        <summary>View record</summary>
                        <p>Request ID: {row.requestId}</p>
                        <p>Record ID: {row.id}</p>
                        <p>Requested: {date(row.createdAt)}</p>
                        {row.reviewedAt && (
                          <p>Reviewed: {date(row.reviewedAt)}</p>
                        )}
                        {row.paidAt && <p>Marked paid: {date(row.paidAt)}</p>}
                        {!customer && row.reviewer && (
                          <p>Reviewed by account: {row.reviewer}</p>
                        )}
                        <p>
                          Linked wallet change:{" "}
                          {transactionMoney(row.walletAmount)} (
                          {row.walletEntries} entries)
                        </p>
                        {row.reconciliation === "request_only" && (
                          <p>
                            This request has no explicit link to a payout
                            confirmation. It is not counted as a paid
                            withdrawal.
                          </p>
                        )}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.data.items.length && (
            <p>No payment records match these filters.</p>
          )}
        </>
      )}
      {result.data && !result.isError && (
        <TransactionPagination
          state={filters}
          data={{ total: result.data.total }}
          signed={false}
          loading={result.isFetching}
        />
      )}
    </section>
  );
}
const styles = `.payment-history{background:#fff;color:#234638;border:1px solid #d7e5dc;border-radius:12px;padding:20px;min-width:0;font:14px/1.5 system-ui,sans-serif}.payment-history h2{font-size:20px;font-weight:700;margin:0 0 10px}.payment-history p{font-size:12px;color:#5c7669;margin:8px 0}.payment-history .ph-note{padding:12px;background:#eff6f2;border-radius:8px}.ph-selectors{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:12px 0}.ph-selectors label{display:flex;flex:1 1 180px;max-width:300px;min-width:0;flex-direction:column;gap:5px;font-size:12px}.ph-selectors select{background:white;color:#234638;border:1px solid #cbdcd0;padding:10px;border-radius:6px;min-width:0}.payment-history button{border:1px solid #cbdcd0;background:white;color:#1d6447;padding:10px;border-radius:6px;cursor:pointer;font-size:13px}.payment-history button:disabled{opacity:.45;cursor:default}.ph-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:18px 0}.ph-totals article{padding:14px;border:1px solid #d7e5dc;border-radius:8px}.ph-totals span{display:block;font-size:11px;color:#5c7669}.ph-totals strong{font-size:21px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.ph-table{overflow:auto;max-width:100%}.ph-table table{border-collapse:collapse;width:100%;font-size:12px}.ph-table th,.ph-table td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #e2ebe6}.ph-table th{font-weight:600;white-space:nowrap}.ph-table td{min-width:125px}.ph-table small{display:block;color:#5c7669;overflow-wrap:anywhere}.ph-table details{min-width:200px;max-width:340px;overflow-wrap:anywhere;margin-top:8px}.ph-table summary{cursor:pointer;color:#137451}.payment-history .ph-error{color:#b33846}.payment-history :focus-visible{outline:2px solid #1f9976;outline-offset:2px}@media(max-width:600px){.payment-history{padding:14px}.ph-selectors label{max-width:none}.ph-totals{grid-template-columns:1fr 1fr}.ph-totals strong{font-size:18px}}`;
