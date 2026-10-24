import { GameInformationSection } from "@/components/game/GameInformation";
import { BET_SEND_BUFFER_MS, useTimedBet } from "@/components/table/AutoBet";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  sfx,
  unlockAudio,
  preloadTableAudio,
} from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { formatRupees, rupeesToPaise } from "@/lib/format";
import {
  customFetch,
  ApiError,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import PlayingCard from "@/components/baccarat/PlayingCard";
import type { BaccaratHistoryEntry } from "@/components/baccarat/BaccaratHistory";
import BaccaratTable from "@/components/baccarat/BaccaratTable";
import { BET_LABELS, type BaccaratBetType } from "@/components/baccarat/cards";
import { useTableRound } from "@/components/table/useTableRound";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import { useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";

/** Outcome broadcast by the shared round clock at the reveal phase. */
interface BaccaratDeal {
  playerCards: number[];
  bankerCards: number[];
  playerTotal: number;
  bankerTotal: number;
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
  natural: boolean;
}

interface SettledBet {
  type: BaccaratBetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
  push?: boolean;
}

/** Full historical round record (REST /recent + /verify). */
interface BaccaratState {
  id: string;
  betId: string;
  playerCards: number[];
  bankerCards: number[];
  playerTotal: number;
  bankerTotal: number;
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
  bets: SettledBet[];
  totalStake: string;
  payoutAmount: string;
  multiplier: number;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  maxMultiplier: number;
  createdAt: string;
}

interface BaccaratConfig {
  payoutVersion: number;
  bankerSixReturn: number;
  enabled: boolean;
  maxMultiplier: number;
  maxStakePaise: string;
  maxBetsPerDeal: number;
  decks: number;
  payouts: Record<BaccaratBetType, number>;
}

interface VerifyResp extends BaccaratState {
  computedWinner: string;
  computedPlayerTotal: number;
  computedBankerTotal: number;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  dealMatch: boolean;
  payoutMatch: boolean;
  verified: boolean;
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  return (err as Error)?.message || fallback;
}

/** Short renderer for other players' slips in the live feed. */
function describeBaccaratBets(bets: unknown): string {
  if (!Array.isArray(bets)) return "";
  return bets
    .map((b) => {
      const t = (b as { type?: BaccaratBetType })?.type;
      return t && BET_LABELS[t] ? BET_LABELS[t] : String(t ?? "");
    })
    .filter(Boolean)
    .join(", ");
}

export default function Baccarat() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  useEffect(() => {
    document.title = "Baccarat VIP • Lunar Casino";
    // Warm the recorded chip pack so the first bet of a session isn't silent.
    preloadTableAudio();
  }, []);

  const balance = useGetWalletBalance(
    { game: "baccarat" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "baccarat" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const config = useQuery<BaccaratConfig>({
    queryKey: ["baccarat.config"],
    queryFn: () =>
      customFetch<BaccaratConfig>("/api/baccarat/config", { method: "GET" }),
    staleTime: 60_000,
    retry: false,
  });

  const recent = useQuery<BaccaratState[]>({
    queryKey: ["baccarat.recent"],
    queryFn: () =>
      customFetch<BaccaratState[]>("/api/baccarat/recent?limit=50", {
        method: "GET",
        credentials: "include",
      }),
    enabled: !!user,
    retry: false,
    staleTime: 10_000,
  });

  const invalidateWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
    void qc.invalidateQueries({ queryKey: ["baccarat.recent"] });
  };

  // Synchronous single-flight lock: React `placing` state updates async, so a
  // manual click racing the queued auto-submit could otherwise POST twice.
  const placingLockRef = useRef(false);

  const round = useTableRound<BaccaratDeal>("baccarat", {
    roundOpenVoice: false,
    roundClosedVoice: false,
    onBettingOpen: () => {
      // Fresh window: clear the previous round's revealed cards/result.
      setRevealRoundId(null);
    },
    onResult: (_outcome, roundId) => {
      unlockAudio();
      notifyPlayStarted();
      setRevealRoundId(roundId);
    },
    onSettled: () => {
      invalidateWallet();
    },
  });

  const {
    phase,
    remainingMs,
    bettingOpen,
    outcome,
    roundId,
    myBets,
    liveBets,
    playerCount,
    totalStake,
    recent: hookRecent,
    serverSeedHash,
    clientSeed,
    nonce,
    serverSeed,
    config: roundConfig,
  } = round;
  const activePayouts = roundConfig?.baccaratPayouts?.payouts ?? config.data?.payouts;
  const bankerSixReturn = roundConfig?.baccaratPayouts?.bankerSixReturn ?? config.data?.bankerSixReturn;
  const roundReady = round.snapshot?.roundId === roundId;

  const coinPreferences = useCoinPreferences("baccarat", user?.id);
  const { chip, selectChip: setChip } = coinPreferences;
  const roundWin = useRoundWin({
    game: "baccarat",
    userId: user?.id,
    roundId,
    eligible: phase === "settling",
    bets: myBets,
  });
  const [bets, setBets] = useState<Map<BaccaratBetType, number>>(new Map());
  const draftRef = useRef<Map<BaccaratBetType, number>>(new Map());
  const [history, setHistory] = useState<
    { spot: BaccaratBetType; amount: number }[]
  >([]);
  const lastBetsRef = useRef<Map<BaccaratBetType, number> | null>(null);
  const [placing, setPlacing] = useState(false);
  // Which roundId's cards we are currently revealing (drives flip animation).
  const [revealRoundId, setRevealRoundId] = useState<string | null>(null);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<BaccaratState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);

  const totalStaked = useMemo(
    () => [...bets.values()].reduce((s, v) => s + v, 0),
    [bets],
  );

  // Placed slips this round (from server snapshot).
  const placedTotalPaise = useMemo(
    () => myBets.reduce((s, b) => s + BigInt(b.totalStake), 0n),
    [myBets],
  );

  // All table results, including rounds the player did not bet on.
  const resultHistory: BaccaratHistoryEntry[] = useMemo(() => {
    const rows = [...hookRecent]
      .filter((row) => row.roundId !== roundId);
    return rows
      .map((r) => {
        const o = r.outcome as BaccaratDeal | null;
        if (!o) return null;
        return {
          roundId: r.roundId,
          settledAt: r.settledAt,
          deal: o,
        };
      })
      .filter((e): e is BaccaratHistoryEntry => e !== null);
  }, [hookRecent, roundId]);

  // Reveal the outcome only when we are in reveal/settling for the round the
  // outcome belongs to, keyed so the flip runs once per round.
  const showCards =
    outcome != null &&
    revealRoundId != null &&
    roundId === revealRoundId &&
    (phase === "reveal" || phase === "settling");
  const shown = showCards ? outcome : null;

  // My result for the current round (settling phase): win/loss + payout.
  const myPayoutPaise = useMemo(
    () => myBets.reduce((s, b) => s + BigInt(b.payoutAmount), 0n),
    [myBets],
  );
  const settled = myBets.some((b) => b.status === "settled");

  const placeBet = (spot: BaccaratBetType) => {
    // Draft chips belong only to the current betting window.
    if (
      placing ||
      config.data?.enabled !== true ||
      !roundReady ||
      !Number.isFinite(activePayouts?.[spot]) ||
      !bettingOpen ||
      remainingMs <= 0 ||
      !balance.data
    )
      return;
    const next = new Map(draftRef.current);
    next.set(spot, (next.get(spot) ?? 0) + chip);
    if (!validDraft(next)) return;
    unlockAudio();
    if (sound) sfx.baccaratChipPlace();
    draftRef.current = next;
    setBets(next);
    setHistory((h) => [...h, { spot, amount: chip }]);
  };

  const undo = () => {
    if (placing || !bettingOpen || remainingMs <= 0) return;
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    const next = new Map(draftRef.current);
    const existing = next.get(last.spot) ?? 0;
    const remaining = existing - last.amount;
    if (remaining > 0) next.set(last.spot, remaining);
    else next.delete(last.spot);
    draftRef.current = next;
    setBets(next);
  };

  const clearBets = () => {
    draftRef.current = new Map();
    setBets(new Map());
    setHistory([]);
  };

  const rebet = () => {
    if (!lastBetsRef.current || !bettingOpen || remainingMs <= 0 || placing)
      return;
    if (!validDraft(lastBetsRef.current)) return;
    draftRef.current = new Map(lastBetsRef.current);
    setBets(draftRef.current);
    setHistory([]);
    if (sound) sfx.baccaratChipStack();
  };

  function validDraft(next: Map<BaccaratBetType, number>) {
    const amount = [...next.values()].reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(amount) || amount < 1) return false;
    if (BigInt(rupeesToPaise(amount)) > BigInt(balance.data?.balance ?? "0")) {
      toast.error("Insufficient balance for these bets");
      return false;
    }
    if (
      BigInt(rupeesToPaise(amount)) >
      BigInt(roundConfig?.maxStakePaise ?? config.data?.maxStakePaise ?? "0")
    ) {
      toast.error("Total stake exceeds the table limit");
      return false;
    }
    return true;
  }
  const doubleBets = () => {
    if (
      placing ||
      !bettingOpen ||
      remainingMs <= 0 ||
      config.data?.enabled !== true
    )
      return;
    const next = new Map(
      [...draftRef.current].map(([spot, value]) => [spot, value * 2]),
    );
    if (!validDraft(next)) return;
    const addedChips = [...draftRef.current].map(([spot, amount]) => ({ spot, amount }));
    setHistory((h) => [
      ...h,
      ...addedChips,
    ]);
    draftRef.current = next;
    setBets(next);
    if (sound) sfx.baccaratChipStack();
  };

  const placeBets = async (auto = false) => {
    if (!user) return;
    if (bets.size === 0) {
      if (!auto) toast.error("Place at least one chip on the table");
      return;
    }
    if (!bettingOpen) return;
    if (!validDraft(bets)) {
      clearBets();
      return;
    }
    if (
      BigInt(rupeesToPaise(totalStaked)) <
      BigInt(roundConfig?.minStakePaise ?? "1")
    ) {
      toast.error(
        `Minimum bet is ₹${formatRupees(roundConfig?.minStakePaise ?? "1")}`,
      );
      clearBets();
      return;
    }
    if (placingLockRef.current) return;
    placingLockRef.current = true;
    unlockAudio();
    setPlacing(true);
    try {
      const payload = [...bets.entries()].map(([type, amount]) => ({
        type,
        amountPaise: rupeesToPaise(amount),
      }));
      await customFetch("/api/baccarat/deal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId, bets: payload }),
      });
      lastBetsRef.current = new Map(bets);
      if (sound) sfx.baccaratChipStack();
      clearBets();
      round.refetch();
      void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
      toast.success("Bets placed automatically for this round");
    } catch (err) {
      const msg = apiMessage(err, "Could not place bets");
      clearBets();
      round.refetch();
      toast.error(msg);
    } finally {
      placingLockRef.current = false;
      setPlacing(false);
    }
  };

  useEffect(() => {
    clearBets();
  }, [round.roundId, round.phase]);
  useTimedBet({
    roundKey: round.roundId,
    deadline:
      round.phaseEndsAt == null
        ? null
        : round.toLocalTime(round.phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt:
      round.phaseEndsAt == null
        ? null
        : round.toLocalTime(round.phaseEndsAt) - 300,
    armed: bets.size > 0,
    enabled: !!user && bettingOpen && !placing && config.data?.enabled === true,
    submit: () => placeBets(true),
  });

  // Win/loss toast + sound once payouts land (settling with settled myBets).
  const settledToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !settled || !roundId) return;
    if (settledToastRef.current === roundId) return;
    settledToastRef.current = roundId;
    const profit = myPayoutPaise - placedTotalPaise;
    const won = profit > 0n;
    if (sound) {
      if (profit < 0n) sfx.tableLose("baccarat");
    }
    if (won) {
      toast.success(`Round profit ₹${formatRupees(profit.toString())}`);
    } else if (profit === 0n && placedTotalPaise > 0n) {
      toast.info("Tie / push — your stake was returned");
    }
  }, [phase, settled, roundId, myPayoutPaise, placedTotalPaise, sound]);

  const openVerify = async (r: BaccaratState) => {
    setVerifyOpen(r);
    setVerifyData(null);
    try {
      const out = await customFetch<VerifyResp>(
        `/api/baccarat/${r.id}/verify`,
        {
          method: "GET",
          credentials: "include",
        },
      );
      setVerifyData(out);
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  if (!user) return null;

  const disabledGame = config.data && !config.data.enabled;

  const liveBetsPanel = (
    <LiveBetsPanel
      bets={liveBets}
      playerCount={playerCount}
      totalStake={totalStake}
      describeBets={describeBaccaratBets}
    />
  );

  const recentPanel = (
    <div className="rounded-xl bg-[#130b24] border border-white/5 p-3 flex flex-col gap-2 max-h-[220px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        Your Recent Deals
      </div>
      {recent.data && recent.data.length > 0 ? (
        recent.data.slice(0, 10).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openVerify(r)}
            className="text-left p-2 rounded-md bg-[#1a1030] hover:bg-[#22143f] flex items-center justify-between gap-2 touch-target"
            data-testid={`recent-${r.id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge
                className={cn(
                  "text-[10px] font-mono text-white shrink-0",
                  r.winner === "player" && "bg-blue-600",
                  r.winner === "banker" && "bg-red-600",
                  r.winner === "tie" && "bg-emerald-600",
                )}
              >
                {r.winner === "player"
                  ? "P"
                  : r.winner === "banker"
                    ? "B"
                    : "T"}{" "}
                {r.playerTotal}-{r.bankerTotal}
              </Badge>
              <span className="text-xs text-white/60 font-mono truncate">
                {r.bets.length} bet{r.bets.length === 1 ? "" : "s"} • ₹
                {formatRupees(r.totalStake)}
              </span>
            </div>
            <span
              className={cn(
                "text-xs font-mono shrink-0",
                BigInt(r.payoutAmount) > 0n
                  ? "text-emerald-400"
                  : "text-white/50",
              )}
            >
              ₹{formatRupees(r.payoutAmount)}
            </span>
          </button>
        ))
      ) : (
        <div className="text-xs text-white/40 italic">
          Place a bet to start.
        </div>
      )}
    </div>
  );

  return (
    <div className="baccarat-container">
      <GameInformationSection>
        {liveBetsPanel}
        {recentPanel}
      </GameInformationSection>
      <BaccaratTable
        round={round}
        deal={shown}
        balance={balance.data?.balance ?? "0"}
        disabled={!!disabledGame}
        available={config.data?.enabled === true && !!balance.data && roundReady}
        placing={placing}
        bets={bets}
        chip={chip}
        selectChip={setChip}
        coins={coinPreferences}
        total={totalStaked}
        accepted={placedTotalPaise.toString()}
        payout={myPayoutPaise.toString()}
        canUndo={history.length > 0}
        canRebet={!!lastBetsRef.current}
        onBet={placeBet}
        onUndo={() => { undo(); if (sound) sfx.baccaratChipScoop(); }}
        onClear={() => { clearBets(); if (sound) sfx.baccaratChipScoop(); }}
        onRebet={rebet}
        onDouble={doubleBets}
        onFairness={() => setFairnessOpen(true)}
        payouts={activePayouts}
        bankerSixReturn={bankerSixReturn}
        history={resultHistory}
        accountLabel={user.isDemo ? "Demo" : user.displayName || "Player"}
      />

      {/* Fairness dialog */}
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#0f0820] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Provably Fair
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Each round shuffles a fresh 8-deck shoe from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce)
              </span>{" "}
              via a Fisher–Yates shuffle, then deals by the exact Punto Banco
              tableau. The server seed hash is committed during the betting
              window; the server seed is revealed once the round is dealt.
            </p>
            <div className="rounded-lg bg-[#1a1030] p-3 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash (this round)
                </div>
                <div className="text-[10px] font-mono text-amber-200 break-all">
                  {serverSeedHash ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Client Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {clientSeed ?? "—"}
                </div>
              </div>
              <div className="text-[10px] text-white/50">
                Nonce: <span className="font-mono">{nonce ?? "—"}</span>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed (revealed after deal)
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {serverSeed ?? "(revealed once the round is dealt)"}
                </div>
              </div>
              <div className="text-[10px] text-white/50">
                Betting window:{" "}
                <span className="font-mono">
                  {roundConfig
                    ? `${Math.round(roundConfig.bettingWindowMs / 1000)}s`
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify dialog (historical rounds) */}
      <Dialog
        open={verifyOpen !== null}
        onOpenChange={(o) => {
          if (!o) {
            setVerifyOpen(null);
            setVerifyData(null);
          }
        }}
      >
        <DialogContent className="bg-[#0f0820] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Deal Verification
            </DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">
                    Result
                  </div>
                  <div className="font-mono">
                    {verifyOpen.winner.toUpperCase()} {verifyOpen.playerTotal}-
                    {verifyOpen.bankerTotal}
                    {verifyOpen.playerPair ? " · P-pair" : ""}
                    {verifyOpen.bankerPair ? " · B-pair" : ""}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">
                    Payout
                  </div>
                  <div className="font-mono">
                    ₹{formatRupees(verifyOpen.payoutAmount)} / ₹
                    {formatRupees(verifyOpen.totalStake)} staked
                  </div>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <span className="text-[10px] text-blue-300 font-bold mr-1">
                  P:
                </span>
                {verifyOpen.playerCards.map((card, i) => (
                  <PlayingCard key={`vp${i}`} card={card} small />
                ))}
                <span className="text-[10px] text-red-300 font-bold mx-1">
                  B:
                </span>
                {verifyOpen.bankerCards.map((card, i) => (
                  <PlayingCard key={`vb${i}`} card={card} small />
                ))}
              </div>
              <div className="rounded-lg bg-[#1a1030] p-2 space-y-1 max-h-28 overflow-y-auto">
                {verifyOpen.bets.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between font-mono text-[10px]"
                  >
                    <span
                      className={
                        b.didWin
                          ? "text-emerald-300"
                          : b.push
                            ? "text-amber-300"
                            : "text-white/50"
                      }
                    >
                      {BET_LABELS[b.type]}
                      {b.push ? " (push)" : ""}
                    </span>
                    <span>
                      ₹{formatRupees(b.amountPaise)} → ₹
                      {formatRupees(b.payoutPaise)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-[#1a1030] p-2 space-y-1">
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash
                </div>
                <div className="text-[10px] font-mono text-amber-200 break-all">
                  {verifyOpen.serverSeedHash}
                </div>
                <div className="text-[10px] uppercase text-white/40 font-bold mt-2">
                  Server Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {verifyOpen.serverSeed ?? "(hidden until the round settles)"}
                </div>
                <div className="text-[10px] uppercase text-white/40 font-bold mt-2">
                  Client Seed / Nonce
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {verifyOpen.clientSeed} / {verifyOpen.nonce}
                </div>
              </div>
              {verifyData ? (
                <div
                  className={cn(
                    "rounded-lg p-2 text-[11px] font-mono",
                    verifyData.verified
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-300 border border-rose-500/30",
                  )}
                  data-testid="text-verify-result"
                >
                  {verifyData.verified ? "✔ Verified" : "✘ Mismatch"} — hash{" "}
                  {verifyData.hashMatch ? "ok" : "bad"} • deal{" "}
                  {verifyData.dealMatch ? "ok" : "bad"} • payout{" "}
                  {verifyData.payoutMatch ? "ok" : "bad"}
                  <div className="mt-1 text-white/60">
                    Recomputed: {verifyData.computedWinner}{" "}
                    {verifyData.computedPlayerTotal}-
                    {verifyData.computedBankerTotal} · payout ₹
                    {formatRupees(verifyData.computedPayout)}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-white/40">Verifying…</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
