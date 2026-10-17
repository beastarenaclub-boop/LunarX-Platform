import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  customFetch,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  W20_GAME,
  normalizeW20Bets,
  type W20Bet,
  type W20Outcome,
  type W20History,
  type W20Spot,
} from "@workspace/api-zod/wheel20-live";
import { useAuth } from "@/lib/auth";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";

type Slip = Partial<Record<W20Spot, number>>;
type Pending = { roundId: string; bets: W20Bet[] };
const endpoint = `/api/${W20_GAME}`;
const total = (slip: Slip) =>
  Object.values(slip).reduce((a, b) => a + (b ?? 0), 0);
const fromBets = (bets: W20Bet[]): Slip =>
  Object.fromEntries(bets.map((b) => [b.spot, Number(b.amountPaise)]));
export function useWheel20Live() {
  const { user } = useAuth(),
    qc = useQueryClient();
  const key = `wheel20-live:pending:${user?.id}`;
  const config = useQuery({
    queryKey: [W20_GAME, "config"],
    queryFn: () =>
      customFetch<{
        enabled: boolean;
        minStakePaise: string;
        maxStakePaise: string;
      }>(`${endpoint}/config`),
    retry: false,
    refetchInterval: 15000,
    enabled: !!user,
  });
  const table = useQuery({
    queryKey: [W20_GAME, "round", user?.id],
    queryFn: () => customFetch<TableRoundSnapshot | null>(`${endpoint}/round`),
    retry: false,
    refetchInterval: (query) => {
      const round = query.state.data;
      return round &&
        (round.phase === "reveal" ||
          (round.phase === "betting" && round.bettingEndsAt - round.now < 3000))
        ? 150
        : 750;
    },
    enabled: !!user,
  });
  const history = useQuery({
    queryKey: [W20_GAME, "history", user?.id],
    queryFn: () => customFetch<W20History[]>(`${endpoint}/history`),
    retry: false,
    refetchInterval: 2500,
    enabled: !!user,
  });
  const balance = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        enabled: !!user,
        retry: false,
        refetchInterval: 3000,
      },
    },
  );
  const [draft, setDraft] = useState<Slip>({}),
    [undo, setUndo] = useState<Slip[]>([]),
    [last, setLast] = useState<Slip>({});
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!p || typeof p.roundId !== "string") return null;
      return { roundId: p.roundId, bets: normalizeW20Bets(p.bets) };
    } catch {
      return null;
    }
  });
  const [sending, setSending] = useState(false),
    [confirmedRound, setConfirmedRound] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const lock = useRef(false),
    seen = useRef<string | null>(null);
  const snapshot = table.data,
    clock = now + (snapshot ? snapshot.now - table.dataUpdatedAt : 0);
  const fresh =
    !!snapshot && !table.isError && now - table.dataUpdatedAt < 5000;
  const bettingOpen =
    fresh &&
    snapshot?.phase === "betting" &&
    snapshot.bettingEndsAt - clock > 400;
  const myBet = snapshot?.myBets[0],
    confirmed = !!myBet || confirmedRound === snapshot?.roundId;
  const locked =
    !bettingOpen || !config.data?.enabled || sending || confirmed || !!pending;
  const min = Number(
      snapshot?.config.minStakePaise ?? config.data?.minStakePaise ?? 1000,
    ),
    max = Number(
      snapshot?.config.maxStakePaise ?? config.data?.maxStakePaise ?? 20000000,
    );
  const wallet = Number(balance.data?.balance ?? 0),
    ready = !!balance.data && !balance.isError && fresh && config.data?.enabled;
  const shown = myBet
    ? fromBets(myBet.bets as W20Bet[])
    : pending && pending.roundId === snapshot?.roundId
      ? fromBets(pending.bets)
      : draft;
  const outcome =
    fresh && snapshot?.phase !== "betting"
      ? (snapshot?.outcome as W20Outcome | null)
      : null;
  const countdown = snapshot
    ? Math.max(
        0,
        Math.ceil(
          ((snapshot.phase === "betting"
            ? snapshot.bettingEndsAt
            : snapshot.phase === "reveal"
              ? snapshot.revealEndsAt
              : snapshot.settleEndsAt) -
            clock) /
            1000,
        ),
      )
    : 0;
  function remember(p: Pending | null) {
    setPending(p);
    try {
      p
        ? localStorage.setItem(key, JSON.stringify(p))
        : localStorage.removeItem(key);
    } catch {
      /* The in-memory receipt still protects retries. */
    }
  }
  function refreshWallet() {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
  }
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!snapshot || seen.current === snapshot.roundId) return;
    seen.current = snapshot.roundId;
    setDraft({});
    setUndo([]);
    setConfirmedRound(null);
    setError("");
    refreshWallet();
    void history.refetch();
  }, [snapshot?.roundId]);
  useEffect(() => {
    if (
      pending &&
      ((pending.roundId === snapshot?.roundId && myBet) ||
        history.data?.some((h) => h.roundId === pending.roundId))
    ) {
      setLast(fromBets(pending.bets));
      remember(null);
      setError("");
      refreshWallet();
    }
  }, [myBet?.slipId, history.data, pending?.roundId]);
  function edit(next: Slip) {
    if (locked || !ready) return false;
    if (total(next) > wallet) {
      setError("Insufficient wallet balance.");
      return false;
    }
    if (total(next) > max) {
      setError("Table maximum reached.");
      return false;
    }
    setUndo((old) => [...old, draft]);
    setDraft(next);
    setError("");
    return true;
  }
  async function confirm() {
    if (lock.current || (!pending && (!ready || locked || total(draft) < min)))
      return;
    const payload = pending ?? {
      roundId: snapshot!.roundId,
      bets: normalizeW20Bets(
        Object.entries(draft)
          .filter(([, n]) => n! > 0)
          .map(([spot, amount]) => ({
            spot: spot as W20Spot,
            amountPaise: String(amount),
          })),
      ),
    };
    lock.current = true;
    setSending(true);
    setError("");
    remember(payload);
    try {
      await customFetch(`${endpoint}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setConfirmedRound(payload.roundId);
      setLast(fromBets(payload.bets));
      remember(null);
      refreshWallet();
      await Promise.all([table.refetch(), history.refetch()]);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 429
      )
        remember(null);
      const detail =
        e instanceof ApiError
          ? (e.data as { detail?: string })?.detail
          : undefined;
      setError(
        detail ??
          "Connection interrupted. Retry confirmation to check your bet; it will not be charged twice.",
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  }
  const settled = history.data?.find((h) => h.status === "settled");
  return {
    snapshot,
    clock,
    history: history.data ?? [],
    historyError: history.isError,
    outcome,
    countdown,
    fresh,
    bettingOpen,
    locked,
    ready,
    wallet,
    min,
    max,
    shown,
    total: total(shown),
    draftTotal: total(draft),
    confirmed,
    sending,
    pending,
    error,
    lastWin: settled ? Number(settled.payoutAmount) : 0,
    canConfirm:
      !sending && (!!pending || (!!ready && !locked && total(draft) >= min)),
    canUndo: !locked && undo.length > 0,
    canRepeat: !locked && total(last) > 0,
    add: (spot: W20Spot, chip: number) =>
      edit({ ...draft, [spot]: (draft[spot] ?? 0) + chip * 100 }),
    double: () =>
      edit(
        Object.fromEntries(Object.entries(draft).map(([s, n]) => [s, n! * 2])),
      ),
    repeat: () => edit({ ...last }),
    clear: () => edit({}),
    undo: () => {
      if (!locked && undo.length) {
        setDraft(undo[undo.length - 1]);
        setUndo(undo.slice(0, -1));
        setError("");
      }
    },
    confirm,
    verify: (id: string) =>
      customFetch<{
        verified: boolean;
        serverSeed: string;
        serverSeedHash: string;
        clientSeed: string;
        nonce: number;
      }>(`${endpoint}/${encodeURIComponent(id)}/verify`),
  };
}
