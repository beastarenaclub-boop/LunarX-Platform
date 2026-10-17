import { useCallback, useEffect, useRef, useState } from "react";
import type { ForexState, Side } from "../../../../../lib/forex/store.mjs";
import type { QuoteSnapshot } from "../../../../../lib/forex/quotes.mjs";
import { forexRequestId } from "../../../../../lib/forex/request-id.mjs";

async function request(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ForexState> {
  const response = await fetch(`/api/forex/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.error?.message === "string" ? data.error.message : "Unable to reach the market.",
    );
  return data;
}

export function useForex(onWalletChange?: () => void) {
  const walletChanged = useRef(onWalletChange);
  walletChanged.current = onWalletChange;
  const lastBalance = useRef<number | undefined>(undefined);
  const [state, setState] = useState<ForexState | null>(null);
  const [quotes, setQuotes] = useState<QuoteSnapshot | null>(null);
  const [quoteConnected, setQuoteConnected] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const inFlight = useRef(false);
  const last = useRef(0);
  const pending = useRef<{
    asset: string;
    side: Side;
    amount: number;
    roundId: number;
    requestId: string;
  } | null>(null);
  const apply = useCallback((next: ForexState) => {
    if (next.serverTime < last.current) return;
    last.current = next.serverTime;
    offset.current = next.serverTime - Date.now();
    setClock(next.serverTime);
    setState(next);
    setConnected(true);
    setConnectionError("");
    if (next.mode === "wallet" && next.account?.balance !== lastBalance.current) {
      lastBalance.current = next.account?.balance;
      walletChanged.current?.();
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function pollQuotes() {
      try {
        const response = await fetch("/api/forex/quotes", {
          credentials: "same-origin", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(28_000)]),
        });
        if (!response.ok) throw new Error("Market quotes unavailable");
        const next: QuoteSnapshot = await response.json();
        if (!next.quotes) throw new Error("Market quotes unavailable");
        if (alive) { setQuotes(next); setQuoteConnected(true); }
      } catch {
        if (alive) setQuoteConnected(false);
      } finally {
        if (alive) timer = setTimeout(pollQuotes, 30_000);
      }
    }
    void pollQuotes();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (inFlight.current) {
        if (alive) timer = setTimeout(poll, 500);
        return;
      }
      try {
        const next = await request("state", undefined, controller.signal);
        if (!alive) return;
        if (next.account) apply(next);
        else apply(await request("session", {}, controller.signal));
      } catch (cause) {
        if (alive) {
          setConnected(false);
          setConnectionError(
            cause instanceof Error
              ? cause.message
              : "Connection lost. Retrying…",
          );
        }
      } finally {
        if (alive) timer = setTimeout(poll, 1000);
      }
    }
    void poll();
    const clockTimer = setInterval(
      () => setClock(Date.now() + offset.current),
      200,
    );
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
      clearInterval(clockTimer);
    };
  }, [apply]);

  async function trade(asset: string, side: Side, amount: number) {
    if (!state || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const previous = pending.current;
      const payload =
      previous &&
      previous.asset === asset &&
      previous.side === side &&
      previous.amount === amount &&
      previous.roundId === state.round.id
        ? previous
        : {
            asset,
            side,
            amount,
            roundId: state.round.id,
            requestId: forexRequestId(),
          };
      pending.current = payload;
      apply(await request("trades", payload));
      pending.current = null;
      setNotice(
        `${side === "buy" ? "BUY" : "SELL"} placed · ${state.mode === "wallet" ? "₹" : ""}${amount.toLocaleString()}${state.mode === "wallet" ? "" : " credits"} · ${state.assets.find((m) => m.id === asset)?.name} · Round #${state.round.id}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Order not confirmed. Retry the same order safely.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refill() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      apply(await request("refill", {}));
      setNotice("Practice wallet refilled to 10,000 credits.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refill.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return {
    state: state ? { ...state, assets: state.assets.map(market => {
      const quote = quotes?.quotes[market.id];
      if (!quote) return market;
      const stale = quote.price !== null && (!quoteConnected || !quote.checkedAt || clock - quote.checkedAt > 90_000 ||
        (quote.quotedAt !== null && clock - quote.quotedAt > (quote.delayMinutes + 5) * 60_000));
      return { ...market, name: quote.name, symbol: quote.symbol,
        quote: { ...quote, status: stale ? "stale" as const : quote.status } };
    }) } : null,
    error: error || connectionError,
    notice,
    connected,
    busy,
    clock,
    trade,
    refill,
    dismiss: () => {
      setError("");
      setNotice("");
    },
  };
}
