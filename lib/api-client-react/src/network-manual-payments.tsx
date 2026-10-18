import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type Account = {
  label: string;
  upiId: string;
  qrData: string | null;
  active: boolean;
  version: number;
};
type Deposit = {
  id: string;
  customer: string;
  amount: string;
  upiRef: string;
  upiId: string;
  status: string;
  createdAt: string;
  rejectionReason: string | null;
};
const money = (value: string) =>
  `₹${(Number(value) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const api = <T,>(path: string, body?: unknown, method = "POST") =>
  customFetch<T>(
    `/api/network/manual-payments${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );

async function qrImage(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5_000_000
  )
    throw Error("Choose a PNG, JPEG or WebP QR under 5 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / bitmap.width, 640 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL("image/png");
  if (data.length > 85000)
    throw Error(
      "Crop the image to just the QR and try again (maximum saved size 64 KB).",
    );
  return data;
}

function AccountForm({
  masterId,
  account,
  saved,
}: {
  masterId: string;
  account: Account | null;
  saved: () => void;
}) {
  const [label, setLabel] = useState(account?.label ?? "");
  const [upiId, setUpiId] = useState(account?.upiId ?? "");
  const [qrData, setQrData] = useState(account?.qrData ?? null);
  const [active, setActive] = useState(account?.active ?? true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(`/${masterId}`, { label, upiId, qrData, active }, "PUT");
          saved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="net-field">
        <span>Payment receiver name</span>
        <input
          required
          minLength={2}
          maxLength={80}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="net-field">
        <span>UPI ID</span>
        <input
          required
          placeholder="yourname@upi"
          value={upiId}
          maxLength={320}
          onChange={(e) => setUpiId(e.target.value)}
        />
      </label>
      <label className="net-field">
        <span>Upload your payment QR (optional)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              setQrData(await qrImage(file));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {qrData && (
        <div className="net-actions">
          <img
            src={qrData}
            alt="Payment QR preview"
            style={{
              width: 200,
              maxWidth: "100%",
              height: 200,
              objectFit: "contain",
              background: "white",
            }}
          />
          <button type="button" disabled={busy} onClick={() => setQrData(null)}>
            Remove uploaded QR
          </button>
        </div>
      )}
      <p>
        Use a QR for the UPI ID above. Without an uploaded image, a QR is
        generated from your UPI ID. Only customers under your agents see these
        details.
      </p>
      <label className="net-actions" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          style={{ width: 16, height: 16, padding: 0, flexShrink: 0 }}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />{" "}
        Accept manual payments
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="net-primary" disabled={busy}>
        {busy ? "Saving…" : "Save payment details"}
      </button>
    </form>
  );
}

export function NetworkManualPayments({ masterId }: { masterId: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending"),
    [offset, setOffset] = useState(0);
  const [review, setReview] = useState<{
    deposit: Deposit;
    decision: "approve" | "reject";
  } | null>(null);
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const account = useQuery({
    queryKey: ["network", "manual-account", masterId],
    queryFn: () => api<Account | null>(`/${masterId}`),
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const deposits = useQuery({
    queryKey: ["network", "manual-deposits", masterId, status, offset],
    queryFn: () =>
      api<{ items: Deposit[]; hasMore: boolean }>(
        `/${masterId}/deposits?limit=25&offset=${offset}${status ? `&status=${status}` : ""}`,
      ),
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 15000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["network"] });
  return (
    <>
      <section className="net-card" aria-label="Manual payment settings">
        <h2>Your manual payment QR</h2>
        <p>
          Receive customer payments in your own UPI account. Verify the bank
          credit and UTR before approving a deposit.
        </p>
        {account.isPending ? (
          <p>Loading payment details…</p>
        ) : account.isError ? (
          <p role="alert">
            {account.error.message}{" "}
            <button onClick={() => void account.refetch()}>Retry</button>
          </p>
        ) : (
          <AccountForm
            key={`${masterId}:${account.data?.version ?? 0}`}
            masterId={masterId}
            account={account.data}
            saved={() => {
              setNotice("Payment details saved.");
              refresh();
            }}
          />
        )}
      </section>
      <section className="net-card" aria-label="Manual deposit requests">
        <h2>Customer deposit requests</h2>
        <p>
          Approval transfers the deposit amount from the master's available
          wallet balance to the customer's wallet. Rejection does not move
          funds.
        </p>
        <div className="net-actions">
          <label className="net-field">
            <span>Deposit status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="">All</option>
            </select>
          </label>
          <button onClick={refresh}>Refresh requests</button>
        </div>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        {deposits.isPending ? (
          <p>Loading deposits…</p>
        ) : deposits.isError ? (
          <p role="alert">
            {deposits.error.message}{" "}
            <button onClick={() => void deposits.refetch()}>Retry</button>
          </p>
        ) : (
          <>
            {!deposits.data.items.length && (
              <p>No {status || "matching"} deposits.</p>
            )}
            {deposits.data.items.map((deposit) => (
              <article
                key={deposit.id}
                style={{
                  borderTop: "1px solid #d9e2e0",
                  padding: "16px 0",
                  overflowWrap: "anywhere",
                }}
              >
                <strong>
                  {money(deposit.amount)} · {deposit.status}
                </strong>
                <p>
                  {deposit.customer}
                  <br />
                  UTR: <b>{deposit.upiRef}</b>
                  <br />
                  Paid to: {deposit.upiId}
                  <br />
                  {new Date(deposit.createdAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </p>
                {deposit.rejectionReason && <p>{deposit.rejectionReason}</p>}
                {deposit.status === "pending" && (
                  <div className="net-actions">
                    {(["approve", "reject"] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={busy}
                        onClick={() => {
                          setReview({ deposit, decision });
                          setReason("");
                          setConfirmed(false);
                          setError("");
                          setNotice("");
                        }}
                      >
                        {decision === "approve" ? "Review & approve" : "Reject"}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            <div className="net-actions">
              <button
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                Previous
              </button>
              <span>Page {offset / 25 + 1}</span>
              <button
                disabled={!deposits.data.hasMore || busy}
                onClick={() => setOffset(offset + 25)}
              >
                Next
              </button>
            </div>
          </>
        )}
        {review && (
          <section className="net-fund-summary" aria-label="Review deposit">
            <h3>
              {review.decision === "approve"
                ? "Confirm received payment"
                : "Reject deposit"}
            </h3>
            <p>
              {review.deposit.customer} · {money(review.deposit.amount)}
              <br />
              UTR: {review.deposit.upiRef}
              <br />
              UPI: {review.deposit.upiId}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api(
                    `/${masterId}/deposits/${review.deposit.id}/decision`,
                    { decision: review.decision, reason: reason || undefined },
                  );
                  setNotice(
                    review.decision === "approve"
                      ? "Deposit approved and customer wallet credited."
                      : "Deposit rejected.",
                  );
                  setReview(null);
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {review.decision === "approve" ? (
                <label className="net-actions">
                  <input
                    type="checkbox"
                    style={{ width: 16, height: 16, padding: 0, flexShrink: 0 }}
                    required
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  I checked my bank account and received this amount with this
                  UTR.
                </label>
              ) : (
                <label className="net-field">
                  <span>Rejection reason</span>
                  <input
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <div className="net-actions">
                <button
                  className="net-primary"
                  disabled={
                    busy || (review.decision === "approve" && !confirmed)
                  }
                >
                  {busy
                    ? "Processing…"
                    : review.decision === "approve"
                      ? "Confirm received & credit"
                      : "Confirm rejection"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Cancel review
                </button>
              </div>
            </form>
          </section>
        )}
      </section>
    </>
  );
}
