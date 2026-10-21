import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  getGetWalletBalanceQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  POKER_CONFIG,
  selectionDebit,
  type PokerGame,
  type PokerTable,
  type PokerBetInput,
  type PokerSelection,
} from "@workspace/api-zod/poker";
import { toast } from "sonner";

export function usePokerTable(game: PokerGame, userId?: string) {
  const qc = useQueryClient(),
    key = `poker-pending:${userId}:${game}`;
  const [data, setData] = useState<PokerTable | null>(null),
    latest = useRef<PokerTable | null>(null);
  const [clock, setClock] = useState(performance.now()),
    [offline, setOffline] = useState(false);
  const received = useRef(0),
    generation = useRef(0),
    active = useRef(true),
    sending = useRef(false);
  const [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<PokerSelection[]>([]);
  const pending = useRef<PokerBetInput | null>(null),
    [retry, setRetry] = useState(false);
  const persist = useCallback(
    (value: PokerBetInput | null) => {
      pending.current = value;
      setRetry(!!value);
      try {
        if (value) sessionStorage.setItem(key, JSON.stringify(value));
        else sessionStorage.removeItem(key);
      } catch {
        /* In-memory retry still keeps the same request ID. */
      }
    },
    [key],
  );
  const syncWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
  }, [qc]);
  const accept = useCallback(
    (next: PokerTable) => {
      if (
        !active.current ||
        (latest.current && next.serverNow < latest.current.serverNow)
      )
        return;
      if (
        latest.current?.round.id !== next.round.id ||
        next.round.phase !== "betting"
      )
        setDraft([]);
      const request = pending.current;
      if (
        request &&
        [...next.slips, ...next.recent].some(
          (s) => s.requestId === request.requestId,
        )
      ) {
        persist(null);
        setDraft([]);
        syncWallet();
      }
      latest.current = next;
      received.current = performance.now();
      setData(next);
      setOffline(false);
    },
    [persist, syncWallet],
  );
  useEffect(() => {
    active.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        if (
          value?.requestId &&
          value?.roundId &&
          Array.isArray(value.selections)
        )
          persist(value);
      }
    } catch {
      /* A blocked store does not prevent playing. */
    }
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = generation.current;
      try {
        if (!sending.current) {
          const next = await customFetch<PokerTable>(
            `/api/poker/${game}/table`,
            { signal: AbortSignal.timeout(7000) },
          );
          if (!disposed && revision === generation.current && !sending.current)
            accept(next);
        }
      } catch {
        if (!disposed && revision === generation.current && !sending.current)
          setOffline(true);
      }
      if (!disposed) timer = setTimeout(poll, 800);
    };
    if (userId) void poll();
    const tick = setInterval(() => setClock(performance.now()), 100);
    return () => {
      disposed = true;
      active.current = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [game, userId, key, accept, persist]);
  const serverNow =
    (data?.serverNow ?? 0) + Math.max(0, clock - received.current);
  const connected = !!data && !offline && clock - received.current < 3500;
  const seconds = Math.max(
    0,
    Math.ceil(((data?.round.phaseEndsAt ?? 0) - serverNow) / 1000),
  );
  const canEdit =
    connected &&
    data?.enabled &&
    data.round.phase === "betting" &&
    data.round.closesAt - serverNow > 300 &&
    !busy &&
    !retry;
  const debit = draft.reduce((sum, s) => {
    const q = data?.quotes.find((q) => q.id === s.market);
    return sum + (q ? selectionDebit(BigInt(s.amountPaise), q) : 0n);
  }, 0n);
  const spent =
    data?.slips.reduce((sum, s) => sum + BigInt(s.stakePaise), 0n) ?? 0n;
  const add = (market: string, amount: number) => {
    if (
      !canEdit ||
      !data ||
      !Number.isSafeInteger(amount) ||
      amount < POKER_CONFIG.minStakePaise
    ) {
      toast.error("Enter a stake of at least ₹10.");
      return;
    }
    const quote = data.quotes.find((q) => q.id === market);
    if (!quote) return;
    setDraft((current) => {
      const next = current.some((s) => s.market === market)
        ? current.map((s) =>
            s.market === market
              ? {
                  ...s,
                  amountPaise: String(BigInt(s.amountPaise) + BigInt(amount)),
                }
              : s,
          )
        : [...current, { market, amountPaise: String(amount) }];
      const cost = next.reduce(
        (sum, s) =>
          sum +
          selectionDebit(
            BigInt(s.amountPaise),
            data.quotes.find((q) => q.id === s.market)!,
          ),
        0n,
      );
      if (
        cost + spent > BigInt(POKER_CONFIG.maxStakePaise) ||
        next.some(
          (s) => BigInt(s.amountPaise) > BigInt(POKER_CONFIG.maxStakePaise),
        )
      ) {
        toast.error("Round limit is ₹5,000 including lay liability.");
        return current;
      }
      if (cost > BigInt(data.balancePaise)) {
        toast.error("Not enough wallet balance.");
        return current;
      }
      return next;
    });
  };
  const submit = async () => {
    if (
      sending.current ||
      (!pending.current && (!canEdit || !data || !draft.length))
    )
      return;
    const payload = pending.current ?? {
      roundId: data!.round.id,
      quoteId: data!.quoteId,
      requestId: crypto.randomUUID(),
      selections: draft,
    };
    persist(payload);
    sending.current = true;
    setBusy(true);
    generation.current++;
    try {
      const next = await customFetch<PokerTable>(`/api/poker/${game}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (active.current) {
        persist(null);
        setDraft([]);
        accept(next);
        syncWallet();
        toast.success("Bet confirmed");
      }
    } catch (error) {
      if (active.current) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        ) {
          persist(null);
          const detail = error.data as {
            detail?: string;
            error?: { message?: string };
          };
          toast.error(
            detail?.detail ??
              detail?.error?.message ??
              "Bet rejected. Check the current round and wallet balance.",
          );
        } else {
          setOffline(true);
          toast.error(
            "Confirmation interrupted. Retry uses the same bet, without a second debit.",
          );
        }
      }
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const settlement = data?.slips
    .map((s) => `${s.id}:${s.payoutPaise}`)
    .join("|");
  useEffect(() => {
    if (settlement) syncWallet();
  }, [settlement, syncWallet]);
  return {
    data,
    connected,
    seconds,
    canEdit,
    busy,
    draft,
    debit,
    spent,
    retry,
    add,
    submit,
    clear: () => setDraft([]),
    remove: (market: string) =>
      setDraft((current) => current.filter((s) => s.market !== market)),
  };
}
