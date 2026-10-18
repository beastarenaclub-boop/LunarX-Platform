import { useEffect, useRef, useState } from "react";
import type { CoinSide } from "@workspace/api-zod/instant-collection";

export type CoinAutoPlan = {
  side: CoinSide;
  stakeAmount: string;
  remaining: number;
  stopLoss: bigint | null;
  profitTarget: bigint | null;
  profit: bigint;
};

/** Only Start arms spending. The in-memory plan cannot resume after reload or unmount. */
export function useCoinAutoBet(input: {
  roundId?: string;
  open: boolean;
  fresh: boolean;
  confirmed: boolean;
  pending: boolean;
  busy: boolean;
  balance?: string;
  enabled: boolean;
  valid: boolean;
  error: boolean;
  submit: (plan: CoinAutoPlan) => Promise<boolean>;
  receipt?: { id: string; stakeAmount: string; payoutAmount: string };
}) {
  const [plan, setPlan] = useState<CoinAutoPlan | null>(null);
  const [message, setMessage] = useState("");
  const current = useRef<CoinAutoPlan | null>(null),
    attempted = useRef<string | null>(null);
  const tracked = useRef(new Set<string>()),
    seen = useRef(new Set<string>());
  const latest = useRef(input);
  latest.current = input;
  const stop = (reason = "Auto-bet stopped.") => {
    current.current = null;
    setPlan(null);
    setMessage(reason);
  };
  const start = (next: CoinAutoPlan) => {
    if (
      current.current ||
      !latest.current.fresh ||
      latest.current.pending ||
      latest.current.busy ||
      !latest.current.enabled ||
      !latest.current.valid ||
      document.hidden ||
      !navigator.onLine
    )
      return;
    attempted.current = null;
    tracked.current.clear();
    seen.current.clear();
    current.current = next;
    setPlan(next);
    setMessage("Auto-bet is on. One bet per round.");
  };
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop("Auto-bet stopped while this tab was hidden.");
    };
    const offline = () => stop("Auto-bet stopped: connection lost.");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("offline", offline);
    return () => {
      current.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("offline", offline);
    };
  }, []);
  useEffect(() => {
    const active = current.current,
      r = input.receipt;
    if (!active || !r || !tracked.current.has(r.id) || seen.current.has(r.id))
      return;
    seen.current.add(r.id);
    const next = {
      ...active,
      profit: active.profit + BigInt(r.payoutAmount) - BigInt(r.stakeAmount),
    };
    current.current = next;
    setPlan(next);
    if (next.stopLoss !== null && next.profit <= -next.stopLoss)
      stop("Auto-bet stopped: loss limit reached.");
    else if (next.profitTarget !== null && next.profit >= next.profitTarget)
      stop("Auto-bet stopped: profit target reached.");
    else if (next.remaining <= 0) stop("Auto-bet completed.");
  }, [input.receipt?.id, input.receipt?.payoutAmount]);
  useEffect(() => {
    const p = current.current;
    if (!p) return;
    if (!input.fresh || !input.enabled || input.error) {
      stop("Auto-bet stopped. Check your connection and game status.");
      return;
    }
    if (
      input.pending ||
      input.busy ||
      !input.open ||
      !input.roundId ||
      input.confirmed ||
      attempted.current === input.roundId ||
      p.remaining <= 0
    )
      return;
    if (
      !input.valid ||
      input.balance === undefined ||
      BigInt(input.balance) < BigInt(p.stakeAmount)
    ) {
      stop("Auto-bet stopped: balance or bet limit reached.");
      return;
    }
    // A previous round must reconcile before the next stake, including delayed settlement.
    if ([...tracked.current].some((id) => !seen.current.has(id))) return;
    if (document.hidden || !navigator.onLine) {
      stop();
      return;
    }
    const id = input.roundId;
    attempted.current = id;
    tracked.current.add(id);
    const next = { ...p, remaining: p.remaining - 1 };
    current.current = next;
    setPlan(next);
    void latest.current.submit(next).then((ok) => {
      if (!ok && current.current)
        stop("Auto-bet stopped. Recover or review the last bet.");
    });
  }, [
    input.roundId,
    input.open,
    input.fresh,
    input.confirmed,
    input.pending,
    input.busy,
    input.balance,
    input.enabled,
    input.valid,
    input.error,
    plan,
  ]);
  return { plan, message, start, stop };
}
