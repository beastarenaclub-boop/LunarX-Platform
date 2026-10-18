import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {TransactionFilters,TransactionPagination,useTransactionFilters,type TransactionPageInfo} from './transaction-filters';
export type WeeklyStatus = {
  locked: boolean;
  overduePaise: string;
  duePaise: string;
  startedAt: string;
  weekStart: string;
  nextDeadline: string;
};
type Payment = {
  id: string;
  amount: string;
  reference: string;
  status: string;
  review_note: string | null;
  created_at: string;
};
type Weekly = WeeklyStatus & {
  masterId: string;
  weeks: {
    start: string;
    end: string;
    commission: string;
    stake: string;
    payout: string;
  }[];
  payments: Payment[];
  paymentTotal:number;
  paymentSummary:TransactionPageInfo['summary'];
};
const money = (v: string) => {
  const n = BigInt(v);
  return `${n < 0n ? "-" : ""}₹${((n < 0n ? -n : n) / 100n).toLocaleString("en-IN")}.${((n < 0n ? -n : n) % 100n).toString().padStart(2, "0")}`;
};
const date = (v: string) =>
  new Date(v).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
const api = <T,>(path: string, body?: unknown) =>
  customFetch<T>(
    `/api/network/weekly${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
export function NetworkWeekly({
  masterId,
  admin,
  canSubmit = true,
}: {
  masterId: string;
  admin: boolean;
  canSubmit?: boolean;
}) {
  const qc = useQueryClient(),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const filters=useTransactionFilters();
  const params=new URLSearchParams({...filters.query,masterId});
  const data = useQuery({
    queryKey: ["network", "weekly", masterId,params.toString()],
    queryFn: () => api<Weekly>(`?${params}`),
    refetchInterval: 30_000,
  });
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
      setNotice(message);
      await qc.invalidateQueries({ queryKey: ["network"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (data.isPending) return <p>Loading weekly account…</p>;
  if (data.isError)
    return (
      <p className="net-error" role="alert">
        {data.error.message}
      </p>
    );
  const w = data.data;
  return (
    <section className="net-card" aria-label="Weekly commission account">
      <h2>Weekly account · Monday to Monday</h2>
      <p>
        India time: Monday 00:00 to the next Monday 00:00. Pay during Monday;
        unpaid commission locks new gameplay and branch management from Tuesday
        00:00. Payment is counted after the platform confirms receipt.
      </p>
      <p>
        Collection active from {date(w.startedAt)}. Losses and refunds carry
        forward. Existing rounds can settle while a branch is locked.
      </p>
      <div className="net-stats">
        <article>
          <span>Closed-week amount unpaid</span>
          <strong>{money(w.duePaise)}</strong>
        </article>
        <article>
          <span>Overdue after Monday grace</span>
          <strong>{money(w.overduePaise)}</strong>
        </article>
        <article>
          <span>Branch</span>
          <strong>{w.locked ? "Locked" : "Active"}</strong>
        </article>
      </div>
      {w.locked && (
        <p className="net-error" role="alert">
          Branch locked. Submit payment details below; the platform must confirm
          receipt to unlock it.
        </p>
      )}
      <h3>Weekly company commission</h3>
      <div className="net-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week (India time)</th>
              <th>Company commission</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {w.weeks.map((week) => (
              <tr key={week.start}>
                <td>
                  {date(week.start)}
                  <br />
                  to {date(week.end)}
                </td>
                <td>{money(week.commission)}</td>
                <td>
                  {new Date(week.end) > new Date(w.weekStart)
                    ? "In progress"
                    : "Closed"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!w.weeks.length && <p>No commission recorded since activation.</p>}
      {canSubmit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!/^\d+(\.\d{1,2})?$/.test(amount))
                throw Error(
                  "Enter a valid rupee amount with up to 2 decimal places.",
                );
              const [r, p = ""] = amount.split(".");
              const amountPaise = (
                BigInt(r!) * 100n +
                BigInt(p.padEnd(2, "0"))
              ).toString();
              await api("/payments", {
                masterId,
                amountPaise,
                reference,
                requestId,
              });
              setAmount("");
              setReference("");
              setRequestId(crypto.randomUUID());
            }, "Payment details submitted for confirmation.");
          }}
        >
          <h3>Submit payment details</h3>
          <p>
            Send payment through your agreed payment method, then enter its
            transaction reference here.
          </p>
          <label className="net-field">
            <span>Amount paid (INR)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="net-field">
            <span>Payment reference / UTR</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              minLength={3}
              maxLength={200}
            />
          </label>
          <button
            className="net-primary"
            disabled={busy || BigInt(w.duePaise) === 0n}
          >
            Submit for confirmation
          </button>
        </form>
      )}
      <h3 style={{ marginTop: 24 }}>Payment history</h3>
      <TransactionFilters state={filters} direction={false} statuses={['pending','confirmed','rejected']}/>
      {w.payments.map((p) => (
        <article className="net-website-row" key={p.id}>
          <div>
            <strong>
              {money(p.amount)} · {p.status}
            </strong>
            <span>
              {p.reference} · {date(p.created_at)}
            </span>
            {p.review_note && <p>{p.review_note}</p>}
          </div>
          {admin && p.status === "pending" && (
            <div className="net-actions">
              <button
                disabled={busy}
                onClick={() => {
                  const note = window.prompt(
                    "Payment received confirmation / bank reference",
                  );
                  if (note)
                    void run(
                      () =>
                        api(`/payments/${p.id}/review`, {
                          status: "confirmed",
                          note,
                        }),
                      "Payment confirmed. Branch status updated.",
                    );
                }}
              >
                Confirm received
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const note = window.prompt("Reason for rejection");
                  if (note)
                    void run(
                      () =>
                        api(`/payments/${p.id}/review`, {
                          status: "rejected",
                          note,
                        }),
                      "Payment rejected.",
                    );
                }}
              >
                Reject
              </button>
            </div>
          )}
        </article>
      ))}
      {!w.payments.length && <p>No payment submissions match these filters.</p>}
      <TransactionPagination state={filters} data={{total:w.paymentTotal??w.payments.length,summary:w.paymentSummary}} signed={false} loading={data.isFetching}/>
      {error && (
        <p className="net-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="net-success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
