import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  customFetch,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
  useGetWalletBalance,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import {
  fromBets,
  total,
  type Bet,
  type Deal,
  type HistoryRound,
  type Slip,
  type Spot,
  type TableConfig,
} from "./model";

const endpoint = "/api/andar-bahar";
export function useAndarBaharLive() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: ["ab-live", "config"],
    queryFn: () => customFetch<TableConfig>(`${endpoint}/config`),
    enabled: !!user,
    retry: false,
    refetchInterval: 15000,
  });
  const table = useQuery({
    queryKey: ["ab-live", "round", user?.id],
    queryFn: () => customFetch<TableRoundSnapshot | null>(`${endpoint}/round`),
    enabled: !!user,
    retry: false,
    refetchInterval: 500,
  });
  const history = useQuery({
    queryKey: ["ab-live", "history", user?.id],
    queryFn: () => customFetch<HistoryRound[]>(`${endpoint}/recent?limit=30`),
    enabled: !!user,
    retry: false,
    refetchInterval: 4000,
  });
  const balance = useGetWalletBalance(
    { game: "andar-bahar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "andar-bahar" }),
        enabled: !!user,
        retry: false,
        refetchInterval: 3000,
      },
    },
  );
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState<Slip>({}),
    draftRef = useRef<Slip>({});
  const [undo, setUndo] = useState<Slip[]>([]),
    [last, setLast] = useState<Slip>({});
  const [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const [confirmedRound, setConfirmedRound] = useState<string | null>(null);
  const receiptKey = `ab-live:submitted:${user?.id}`;
  const [submittedRound, setSubmittedRound] = useState<string | null>(() => {
    try {
      return localStorage.getItem(receiptKey);
    } catch {
      return null;
    }
  });
  const flight = useRef(false),
    seen = useRef<string | null>(null);
  const snapshot =
    table.data &&
    typeof table.data.roundId === "string" &&
    Array.isArray(table.data.myBets)
      ? table.data
      : null;
  const clock = now + (snapshot ? snapshot.now - table.dataUpdatedAt : 0);
  const fresh =
    !!snapshot && !table.isError && now - table.dataUpdatedAt < 4000;
  const bettingOpen =
    fresh &&
    snapshot.phase === "betting" &&
    snapshot.bettingEndsAt - clock > 500;
  const confirmed =
    !!snapshot?.myBets.length || confirmedRound === snapshot?.roundId;
  const uncertain = submittedRound === snapshot?.roundId && !confirmed;
  const ready =
    !!user &&
    fresh &&
    config.data?.enabled === true &&
    !config.isError &&
    !!balance.data &&
    !balance.isError;
  const locked = !ready || !bettingOpen || confirmed || sending || uncertain;
  const wallet = Number(balance.data?.balance ?? 0);
  // This table's smallest selectable chip is ₹100, even when the shared
  // server configuration permits a zero minimum.
  const min = Math.max(10000, Number(snapshot?.config.minStakePaise ?? 10000));
  const max = Number(
    snapshot?.config.maxStakePaise ?? config.data?.maxStakePaise ?? 20000000,
  );
  const placed = fromBets(
    (snapshot?.myBets ?? []).flatMap((s) => s.bets as Bet[]),
  );
  const shown = Object.keys(placed).length ? placed : draft;
  const deal =
    fresh && snapshot?.phase !== "betting"
      ? (snapshot?.outcome as Deal | null)
      : null;
  const countdown = snapshot
    ? Math.max(0, Math.ceil((snapshot.bettingEndsAt - clock) / 1000))
    : 0;
  function refreshWallet() {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
  }
  function remember(id: string | null) {
    setSubmittedRound(id);
    try {
      if (id) localStorage.setItem(receiptKey, id);
      else localStorage.removeItem(receiptKey);
    } catch {
      /* Optional receipt persistence. */
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!snapshot || seen.current === snapshot.roundId) return;
    seen.current = snapshot.roundId;
    draftRef.current = {};
    setDraft({});
    setUndo([]);
    setConfirmedRound(null);
    setError("");
    refreshWallet();
    void history.refetch();
  }, [snapshot?.roundId]);
  useEffect(() => {
    if (snapshot?.myBets.length) {
      setLast(placed);
      if (submittedRound === snapshot.roundId) {
        remember(null);
        setError("");
        refreshWallet();
      }
    }
  }, [snapshot?.myBets.map((s) => s.slipId + s.status).join(",")]);
  function edit(next: Slip) {
    if (locked || flight.current) return false;
    const count = Object.values(next).filter((n) => n && n > 0).length;
    if (count > (config.data?.maxBetsPerDeal ?? 6)) {
      setError(
        `Choose up to ${config.data?.maxBetsPerDeal ?? 6} betting spots per round.`,
      );
      return false;
    }
    if (total(next) > wallet) {
      setError("Insufficient wallet balance.");
      return false;
    }
    if (total(next) > max || !Number.isSafeInteger(total(next))) {
      setError("Table maximum reached.");
      return false;
    }
    const previous = draftRef.current;
    setUndo((old) => [...old, previous]);
    draftRef.current = next;
    setDraft(next);
    setError("");
    return true;
  }
  async function confirm() {
    if (locked || flight.current || !snapshot || total(draftRef.current) < min)
      return;
    const roundId = snapshot.roundId;
    const bets = Object.entries(draftRef.current)
      .filter(([, n]) => n! > 0)
      .map(([type, n]) => ({ type, amountPaise: String(n) }));
    flight.current = true;
    setSending(true);
    setError("");
    remember(roundId);
    try {
      await customFetch(`${endpoint}/deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, bets }),
      });
      setConfirmedRound(roundId);
      setLast(fromBets(bets as Bet[]));
      refreshWallet();
      await table.refetch();
    } catch (e) {
      // The shared table accepts multiple slips. Never re-POST an ambiguous
      // request: a lost response may already have debited the wallet.
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408
      )
        remember(null);
      setError(
        e instanceof ApiError
          ? ((e.data as { detail?: string })?.detail ??
              "Your bet could not be accepted.")
          : "Checking your bet receipt. Please wait; this bet will not be sent again.",
      );
      void table.refetch();
    } finally {
      flight.current = false;
      setSending(false);
    }
  }
  return {
    snapshot,
    clock,
    fresh,
    ready,
    bettingOpen,
    locked,
    confirmed,
    uncertain,
    sending,
    deal,
    countdown,
    wallet,
    min,
    max,
    shown,
    error,
    config: config.data,
    total: total(shown),
    history: Array.isArray(history.data) ? history.data : [],
    historyError: history.isError,
    lastWin: Number(history.data?.[0]?.payoutAmount ?? 0),
    canConfirm: !locked && total(draft) >= min,
    canUndo: !locked && undo.length > 0,
    canRepeat: !locked && total(last) > 0,
    add: (spot: Spot, chip: number) =>
      edit({
        ...draftRef.current,
        [spot]: (draftRef.current[spot] ?? 0) + chip * 100,
      }),
    double: () =>
      edit(
        Object.fromEntries(
          Object.entries(draftRef.current).map(([k, n]) => [k, n! * 2]),
        ),
      ),
    clear: () => edit({}),
    repeat: () => edit({ ...last }),
    undo: () => {
      if (!locked && undo.length) {
        const prior = undo[undo.length - 1];
        draftRef.current = prior;
        setDraft(prior);
        setUndo(undo.slice(0, -1));
        setError("");
      }
    },
    confirm,
    verify: (id: string) =>
      customFetch<{ verified: boolean }>(
        `${endpoint}/${encodeURIComponent(id)}/verify`,
      ),
  };
}
