import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetWalletBalanceQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Check } from "lucide-react";
import { LudoArtwork } from "./LudoArtwork";
type Daily = {
  day: string;
  amountPaise: string;
  claimed: boolean;
  resetsAt: number;
  history: { id: string; day: string; amountPaise: string; at: number }[];
  credited?: boolean;
  balancePaise?: string;
};
export function LudoDailyReward({
  userId,
  demo,
  onBack,
}: {
  userId: string;
  demo: boolean;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [celebrate, setCelebrate] = useState(false),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["ludo-daily", userId],
    queryFn: () => customFetch<Daily>("/api/ludo/rewards/daily"),
    refetchInterval: 30000,
  });
  const claim = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await customFetch<Daily>("/api/ludo/rewards/daily", {
        method: "POST",
        body: "{}",
      });
      qc.setQueryData(["ludo-daily", userId], next);
      setCelebrate(!!next.credited);
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }),
        qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not claim. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`ld-feature-screen ld-daily-screen ${celebrate ? "ld-reward-collected" : ""}`}
      aria-label="Daily reward"
    >
      <header className="ld-feature-header">
        <button onClick={onBack} aria-label="Back to main menu">
          <ArrowLeft />
        </button>
        <div>
          <strong>DAILY REWARD</strong>
          <small>A little extra for your next game</small>
        </div>
        <LudoArtwork kind="calendar" />
      </header>
      <div className="ld-feature-body ld-daily-body">
        <div className="ld-reward-gift">
          <LudoArtwork kind="gift" />
          {celebrate &&
            Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ "--coin-index": i } as React.CSSProperties}>
                <LudoArtwork kind="coins" />
              </i>
            ))}
        </div>
        <h1>₹100</h1>
        <p>
          {demo
            ? "Practice reward · demo wallet only"
            : "Credited to your shared wallet"}
        </p>
        <button
          className="ld-feature-primary"
          onClick={() => void claim()}
          disabled={busy || !query.data || query.data.claimed}
        >
          {query.data?.claimed ? (
            <>
              <Check /> Claimed today
            </>
          ) : busy ? (
            "Crediting your reward…"
          ) : (
            "Claim ₹100"
          )}
        </button>
        {celebrate && <p role="status">₹100 added successfully.</p>}
        {(error || query.error) && (
          <p role="alert" className="ld-feature-error">
            {error || query.error?.message}
          </p>
        )}
        <p className="ld-reward-reset">
          One claim per active player account each day.
          <br />
          Resets at midnight, India time.
          {query.data?.claimed && (
            <>
              <br />
              Next claim:{" "}
              {new Date(query.data.resetsAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              IST
            </>
          )}
        </p>
        <h2>Recent claims</h2>
        <div className="ld-reward-history">
          {query.data?.history.map((h) => (
            <div key={h.id}>
              <LudoArtwork kind="coins" />
              <span>{h.day}</span>
              <strong>+₹{Number(h.amountPaise) / 100}</strong>
              <Check />
            </div>
          ))}
          {query.data && !query.data.history.length && (
            <p>Your first reward is waiting.</p>
          )}
        </div>
      </div>
    </section>
  );
}
