import { TEEN_PATTI_MAIN_RETURN, TEEN_PATTI_TIE_RETURN, TEEN_PATTI_PAIR_RETURNS } from "@workspace/api-zod/game-economics";
import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet } from "@/components/table/AutoBet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sfx, unlockAudio, preloadTableAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import {
  ArrowLeft,
  ShieldCheck,
  Crown,
  Undo2,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useTableRound } from "@/components/table/useTableRound";
import RoundPhaseBanner from "@/components/table/RoundPhaseBanner";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import { formatChip } from "@/components/table/chips";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { useIsLgUp } from "@/hooks/use-mobile";
import { GameRulesButton } from "@/components/game/GameRules";

type TeenPattiBetType =
  | "playerA"
  | "playerB"
  | "tie"
  | "pairPlusA"
  | "pairPlusB";

const BET_LABELS: Record<TeenPattiBetType, string> = {
  playerA: "Player A",
  playerB: "Player B",
  tie: "Tie",
  pairPlusA: "Pair+ A",
  pairPlusB: "Pair+ B",
};

const BET_PAYOUT_LABELS: Record<TeenPattiBetType, string> = { playerA: `${TEEN_PATTI_MAIN_RETURN / 100}× return`, playerB: `${TEEN_PATTI_MAIN_RETURN / 100}× return`, tie: `${TEEN_PATTI_TIE_RETURN / 100}× return`, pairPlusA: `up to ${TEEN_PATTI_PAIR_RETURNS.trail / 100}×`, pairPlusB: `up to ${TEEN_PATTI_PAIR_RETURNS.trail / 100}×` };

const CATEGORY_LABELS: Record<string, string> = {
  highCard: "High Card",
  pair: "Pair",
  color: "Color",
  sequence: "Sequence",
  pureSequence: "Pure Sequence",
  trail: "Trail",
};

/** Outcome broadcast by the shared round clock at the reveal phase. */
interface TeenPattiDeal {
  handACards: number[];
  handBCards: number[];
  handA: { category: string; score: number };
  handB: { category: string; score: number };
  winner: "playerA" | "playerB" | "tie";
}

interface SettledBet {
  type: TeenPattiBetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
  push?: boolean;
}

/** Full historical round record (REST /recent + /verify). */
interface TeenPattiState {
  id: string;
  betId: string;
  handACards: number[];
  handBCards: number[];
  handACategory: string;
  handBCategory: string;
  winner: "playerA" | "playerB" | "tie";
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

interface TeenPattiConfig {
  enabled: boolean;
  maxMultiplier: number;
  maxStakePaise: string;
  maxBetsPerDeal: number;
  decks: number;
  payouts: {
    playerA: number;
    playerB: number;
    tie: number;
    pairPlus: Record<string, number>;
  };
}

interface VerifyResp extends TeenPattiState {
  computedWinner: string;
  computedHandACategory: string;
  computedHandBCategory: string;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  dealMatch: boolean;
  payoutMatch: boolean;
  verified: boolean;
}

const SPOTS: TeenPattiBetType[] = [
  "pairPlusA",
  "playerA",
  "tie",
  "playerB",
  "pairPlusB",
];
const FLIP_STEP_MS = 450;

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  return (err as Error)?.message || fallback;
}

/** Short renderer for other players' slips in the live feed. */
function describeTeenPattiBets(bets: unknown): string {
  if (!Array.isArray(bets)) return "";
  return bets
    .map((b) => {
      const t = (b as { type?: TeenPattiBetType })?.type;
      return t && BET_LABELS[t] ? BET_LABELS[t] : String(t ?? "");
    })
    .filter(Boolean)
    .join(", ");
}

export default function TeenPatti() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  const isLgUp = useIsLgUp();
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  useEffect(() => {
    document.title = "Teen Patti 20/20 • Lunar Casino";
    // Warm the recorded chip pack so the first bet of a session isn't silent.
    preloadTableAudio();
  }, []);

  const balance = useGetWalletBalance(
    { game: "teen-patti" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "teen-patti" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const config = useQuery<TeenPattiConfig>({
    queryKey: ["teenpatti.config"],
    queryFn: () =>
      customFetch<TeenPattiConfig>("/api/teen-patti/config", { method: "GET" }),
    staleTime: 60_000,
    retry: false,
  });

  const recent = useQuery<TeenPattiState[]>({
    queryKey: ["teenpatti.recent"],
    queryFn: () =>
      customFetch<TeenPattiState[]>("/api/teen-patti/recent?limit=50", {
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
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["teenpatti.recent"] });
  };

  const placingLockRef = useRef(false);

  const round = useTableRound<TeenPattiDeal>("teen-patti", {
    onBettingOpen: () => {
      // Fresh window: clear reveal state only. Staged chips are KEPT so bets
      // queued while betting was closed carry into this round; if the player
      // queued them, they are auto-placed now.
      setRevealRoundId(null);

    },
    onResult: (_outcome, roundId) => {
      unlockAudio();
      if (sound) sfx.cardDeal();
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
    phaseDurationMs,
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

  const coinPreferences = useCoinPreferences("teen-patti", user?.id);
  const { chip, selectChip: setChip } = coinPreferences;
  const roundWin = useRoundWin({ game: "teen-patti", userId: user?.id, roundId,
    eligible: phase === "settling", bets: myBets });
  const [bets, setBets] = useState<Map<TeenPattiBetType, number>>(new Map());
  const [history, setHistory] = useState<
    { spot: TeenPattiBetType; amount: number }[]
  >([]);
  const lastBetsRef = useRef<Map<TeenPattiBetType, number> | null>(null);
  const [placing, setPlacing] = useState(false);
  const [revealRoundId, setRevealRoundId] = useState<string | null>(null);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<TeenPattiState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);

  const disabledGame = config.data && !config.data.enabled;

  const totalStaked = useMemo(
    () => [...bets.values()].reduce((s, v) => s + v, 0),
    [bets],
  );

  const placedTotalPaise = useMemo(
    () => myBets.reduce((s, b) => s + BigInt(b.totalStake), 0n),
    [myBets],
  );
  const placedCount = myBets.length;
  const myPayoutPaise = useMemo(
    () => myBets.reduce((s, b) => s + BigInt(b.payoutAmount), 0n),
    [myBets],
  );
  const settled = myBets.some((b) => b.status === "settled");

  // Results strip from the shared clock's recent outcomes (oldest → newest;
  // hook.recent is newest-first).
  const strip = useMemo(
    () =>
      [...hookRecent]
        .reverse()
        .map((r) => ({
          id: r.roundId,
          winner: (r.outcome as TeenPattiDeal | null)?.winner ?? null,
        }))
        .filter(
          (r): r is { id: string; winner: TeenPattiDeal["winner"] } =>
            r.winner !== null,
        ),
    [hookRecent],
  );

  const dealing = phase === "reveal";
  const showCards =
    outcome != null &&
    revealRoundId != null &&
    roundId === revealRoundId &&
    (phase === "reveal" || phase === "settling");
  const shown = showCards ? outcome : null;

  const placeBet = (spot: TeenPattiBetType) => {
    // Draft chips belong only to the current betting window.
    if (placing || disabledGame || !bettingOpen || remainingMs <= 0) return;
    unlockAudio();
    if (sound) sfx.chipPlace();
    setBets((prev) => {
      const next = new Map(prev);
      next.set(spot, (next.get(spot) ?? 0) + chip);
      return next;
    });
    setHistory((h) => [...h, { spot, amount: chip }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setBets((prev) => {
      const next = new Map(prev);
      const existing = next.get(last.spot) ?? 0;
      const remaining = existing - last.amount;
      if (remaining > 0) next.set(last.spot, remaining);
      else next.delete(last.spot);
      return next;
    });
  };

  const clearBets = () => {
    setBets(new Map());
    setHistory([]);
  };

  const rebet = () => {
    if (!lastBetsRef.current || !bettingOpen || remainingMs <= 0 || placing) return;
    setBets(new Map(lastBetsRef.current));
    setHistory([]);
  };

  const placeBets = async (auto = false) => {
    if (!user) return;
    if (bets.size === 0) {
      if (!auto) toast.error("Place at least one chip on the table");
      return;
    }
    if (!bettingOpen) return;
    if (placingLockRef.current) return;
    placingLockRef.current = true;
    unlockAudio();
    setPlacing(true);
    try {
      const payload = [...bets.entries()].map(([type, amount]) => ({
        type,
        amountPaise: rupeesToPaise(amount),
      }));
      await customFetch("/api/teen-patti/deal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId, bets: payload }),
      });
      lastBetsRef.current = new Map(bets);
      if (sound) sfx.chipPlace();
      clearBets();
      round.refetch();
      void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
      toast.success(
        auto
          ? "Queued bets placed for this round"
          : "Bets placed for this round",
      );
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

  useEffect(() => { clearBets(); }, [round.roundId, round.phase]);
  useTimedBet({
    roundKey: round.roundId,
    deadline: round.phaseEndsAt == null ? null : round.toLocalTime(round.phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: round.phaseEndsAt == null ? null : round.toLocalTime(round.phaseEndsAt) - 300,
    armed: bets.size > 0,
    enabled: !!user && bettingOpen && !placing && config.data?.enabled === true,
    submit: () => placeBets(true),
  });

  // Win/loss toast once payouts land.
  const settledToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !settled || !roundId) return;
    if (settledToastRef.current === roundId) return;
    settledToastRef.current = roundId;
    const won = myPayoutPaise > 0n;
    if (sound) {
      if (!won) sfx.tableLose("teen-patti");
      if (won) voiceRoundWin("teen-patti", roundId);
      else voiceRoundLoss("teen-patti", roundId);
    }
    if (won) {
      toast.success(`You won ₹${formatRupees(myPayoutPaise.toString())}!`);
    }
  }, [phase, settled, roundId, myPayoutPaise, sound]);

  const openVerify = async (r: TeenPattiState) => {
    setVerifyOpen(r);
    setVerifyData(null);
    try {
      const out = await customFetch<VerifyResp>(
        `/api/teen-patti/${r.id}/verify`,
        { method: "GET", credentials: "include" },
      );
      setVerifyData(out);
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  if (!user) return null;

  const winnerLabel = (w: string) =>
    w === "tie" ? "Tie" : w === "playerA" ? "Player A wins" : "Player B wins";


  const spotStyles: Record<TeenPattiBetType, string> = {
    playerA: "bg-amber-900/50 border-amber-500/50 hover:bg-amber-900/70",
    playerB: "bg-rose-900/50 border-rose-500/50 hover:bg-rose-900/70",
    tie: "bg-emerald-900/50 border-emerald-500/50 hover:bg-emerald-900/70",
    pairPlusA: "bg-amber-950/60 border-amber-500/30 hover:bg-amber-950/80",
    pairPlusB: "bg-rose-950/60 border-rose-500/30 hover:bg-rose-950/80",
  };

  const resultSlot = shown ? (
    <span className="flex items-center gap-2">
      <span className="font-bold uppercase">{winnerLabel(shown.winner)}</span>
      {settled && placedCount > 0 && (
        <span
          className={cn(
            "font-mono font-black",
            myPayoutPaise > 0n ? "text-emerald-300" : "text-rose-300",
          )}
          data-testid="text-result-payout"
        >
          {myPayoutPaise > 0n
            ? `+₹${formatRupees(myPayoutPaise.toString())}`
            : "No win"}
        </span>
      )}
    </span>
  ) : null;

  // Secondary panels are available from the information button.
  const historyPanels = (
    <>
      {/* Results strip */}
      <div className="rounded-xl bg-[#1b0d10] border border-white/5 p-3 flex flex-col gap-2">
        <div className="text-[11px] uppercase font-bold text-white/50">
          Recent Results
        </div>
        <div className="flex gap-1 flex-wrap" data-testid="results-strip">
          {strip.length > 0 ? (
            strip.slice(-24).map((r) => (
              <span
                key={r.id}
                className={cn(
                  "w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center",
                  r.winner === "playerA" && "bg-amber-500 text-black",
                  r.winner === "playerB" && "bg-rose-600 text-white",
                  r.winner === "tie" && "bg-emerald-500 text-black",
                )}
              >
                {r.winner === "playerA"
                  ? "A"
                  : r.winner === "playerB"
                    ? "B"
                    : "T"}
              </span>
            ))
          ) : (
            <span className="text-xs text-white/40 italic">No rounds yet.</span>
          )}
        </div>
      </div>

      {/* Live bets from other players */}
      <LiveBetsPanel
        bets={liveBets}
        playerCount={playerCount}
        totalStake={totalStake}
        describeBets={describeTeenPattiBets}
      />

      {/* Recent list (your own settled slips) */}
      <div className="rounded-xl bg-[#1b0d10] border border-white/5 p-3 flex flex-col gap-2 max-h-[220px] overflow-y-auto">
        <div className="text-[11px] uppercase font-bold text-white/50">
          Your Recent Deals
        </div>
        {recent.data && recent.data.length > 0 ? (
          recent.data.slice(0, 10).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openVerify(r)}
              className="text-left p-2 rounded-md bg-[#2a1418] hover:bg-[#361a20] flex items-center justify-between gap-2 touch-target"
              data-testid={`recent-${r.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  className={cn(
                    "text-[10px] font-mono text-white",
                    r.winner === "playerA" && "bg-amber-600",
                    r.winner === "playerB" && "bg-rose-600",
                    r.winner === "tie" && "bg-emerald-600",
                  )}
                >
                  {r.winner === "playerA"
                    ? "A"
                    : r.winner === "playerB"
                      ? "B"
                      : "T"}
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
    </>
  );

  return (
    <div className="game-page min-h-[100dvh] w-full overflow-x-clip bg-[#120608] text-white flex flex-col items-center safe-pb">
      <GameInformationSection>{historyPanels}</GameInformationSection>
      <div className="game-shell w-full max-w-7xl flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 py-3 bg-[#120608]/90 backdrop-blur-md border-b border-white/5 safe-pt">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="text-white/70 hover:text-white h-10 w-10 rounded-full"
                data-testid="btn-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.35)]">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  Teen Patti 20/20
                </h1>
                <p className="text-[10px] text-white/40 leading-none truncate">
                  A vs B • Single deck • Provably fair
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end mr-1">
              <span className="text-[10px] text-white/50 font-medium uppercase">
                Balance
              </span>
              <span
                className="text-sm font-bold text-emerald-400 font-mono"
                data-testid="text-teenpatti-balance"
              >
                ₹{formatRupees(balance.data?.balance ?? "0")}
              </span>
            </div>
            <GameRulesButton gameCode="teen-patti" />
            <GameInformationSection><Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white h-10 w-10 rounded-full"
              aria-label="Fairness"
              onClick={() => setFairnessOpen(true)}
              data-testid="btn-fairness"
            >
              <ShieldCheck className="w-5 h-5" />
            </Button></GameInformationSection>
          </div>
        </div>

        {disabledGame && (
          <div className="m-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
            Teen Patti is currently disabled by the operator.
          </div>
        )}

        {/* Round timer banner — always visible near the top. */}
        <div className="px-3 pt-3">
          <RoundPhaseBanner
            phase={phase}
            remainingMs={remainingMs}
            durationMs={phaseDurationMs}
            settleDurationMs={round.config?.settleDurationMs}
            resultSlot={resultSlot}
          />
        </div>

        <div data-game-screen="teen-patti" className="flex-1 flex flex-col lg:flex-row gap-3 p-3 pb-44 lg:pb-3 min-h-0">
          {/* Hands + recent */}
          <div className="lg:w-[420px] flex flex-col gap-3">
            <div className="rounded-xl bg-[#1b0d10] border border-amber-500/15 p-4 flex flex-col gap-4">
              {/* Hand A */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-16 sm:w-20 shrink-0 text-right">
                  <div className="text-[10px] uppercase font-bold text-amber-400">
                    Player A
                  </div>
                  <div
                    className="text-[11px] font-bold text-white/70 leading-tight"
                    data-testid="text-hand-a-category"
                  >
                    {shown ? CATEGORY_LABELS[shown.handA.category] : "–"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[6rem] items-center min-w-0 flex-1">
                  {shown ? (
                    shown.handACards.map((card, i) => (
                      <PlayingCard
                        key={`${revealRoundId}-a-${i}`}
                        card={card}
                        flipDelayMs={i * 2 * FLIP_STEP_MS}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-white/25 italic">
                      Cards appear here
                    </span>
                  )}
                </div>
              </div>
              {/* Hand B */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-16 sm:w-20 shrink-0 text-right">
                  <div className="text-[10px] uppercase font-bold text-rose-400">
                    Player B
                  </div>
                  <div
                    className="text-[11px] font-bold text-white/70 leading-tight"
                    data-testid="text-hand-b-category"
                  >
                    {shown ? CATEGORY_LABELS[shown.handB.category] : "–"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[6rem] items-center min-w-0 flex-1">
                  {shown &&
                    shown.handBCards.map((card, i) => (
                      <PlayingCard
                        key={`${revealRoundId}-bb-${i}`}
                        card={card}
                        flipDelayMs={(i * 2 + 1) * FLIP_STEP_MS}
                      />
                    ))}
                </div>
              </div>
              {/* Result line */}
              <div className="h-8 flex items-center justify-center">
                {shown ? (
                  <div className="flex items-center gap-3">
                    <Badge
                      className={cn(
                        "font-black uppercase",
                        shown.winner === "playerA" && "bg-amber-600",
                        shown.winner === "playerB" && "bg-rose-600",
                        shown.winner === "tie" && "bg-emerald-600",
                      )}
                      data-testid="text-result-winner"
                    >
                      {winnerLabel(shown.winner)}
                    </Badge>
                    {settled && placedCount > 0 && (
                      <span
                        className={cn(
                          "text-lg font-black font-mono",
                          myPayoutPaise > 0n
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {myPayoutPaise > 0n
                          ? `+₹${formatRupees(myPayoutPaise.toString())}`
                          : `-₹${formatRupees(placedTotalPaise.toString())}`}
                      </span>
                    )}
                  </div>
                ) : dealing ? (
                  <span className="text-sm text-white/50 animate-pulse">
                    Revealing…
                  </span>
                ) : (
                  <span className="text-sm text-white/30">
                    {bettingOpen ? "Place your bets" : "Waiting for next round…"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Table + controls */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {/* Betting spots */}
            <div
              className={cn(
                "game-bet-grid rounded-xl bg-gradient-to-b from-[#3b1d12]/80 to-[#24100c]/80 border border-amber-500/20 p-3 sm:p-4 grid gap-2 transition-opacity",
                !bettingOpen && "opacity-50",
              )}
            >
              {SPOTS.map((spot) => {
                const amount = bets.get(spot) ?? 0;
                const won =
                  shown != null &&
                  ((spot === "playerA" && shown.winner === "playerA") ||
                    (spot === "playerB" && shown.winner === "playerB") ||
                    (spot === "tie" && shown.winner === "tie"));
                return (
                  <button
                    key={spot}
                    type="button"
                    onClick={() => placeBet(spot)}
                    disabled={placing || !!disabledGame || !bettingOpen || remainingMs <= 0}
                    className={cn(
                      "relative rounded-xl border-2 p-2 sm:p-4 min-h-[72px] sm:min-h-[92px] flex flex-col items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed min-w-0",
                      spotStyles[spot],
                      won && "ring-2 ring-amber-400",
                      (spot === "playerA" ||
                        spot === "playerB" ||
                        spot === "tie") &&
                        "sm:min-h-[120px]",
                    )}
                    data-game-bet data-testid={`spot-${spot}`}
                  >
                    <span className="font-black uppercase tracking-wide text-xs sm:text-base text-center leading-tight break-words max-w-full">
                      {BET_LABELS[spot]}
                    </span>
                    <span className="text-[10px] text-white/50 font-mono">
                      {BET_PAYOUT_LABELS[spot]}
                    </span>
                    {amount > 0 && (
                      <span
                        className="absolute -top-2 -right-2 min-w-[2rem] h-8 px-1 rounded-full bg-amber-400 border-2 border-dashed border-amber-700 text-black text-[10px] font-black flex items-center justify-center shadow-lg"
                        data-testid={`chipstack-${spot}`}
                      >
                        {formatChip(amount)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Pair Plus paytable */}
            <div className="rounded-xl bg-[#1b0d10] border border-white/5 p-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-white/50">
              <span className="uppercase font-bold text-white/60">
                Pair Plus:
              </span>
              <span>Pair {TEEN_PATTI_PAIR_RETURNS.pair / 100}× return</span>
              <span>Color {TEEN_PATTI_PAIR_RETURNS.color / 100}× return</span>
              <span>Sequence {TEEN_PATTI_PAIR_RETURNS.sequence / 100}× return</span>
              <span>Pure Seq 30:1</span>
              <span className="text-amber-300">Trail {TEEN_PATTI_PAIR_RETURNS.trail / 100}× return</span>
            </div>

            {/* Placed slips summary */}
            {placedCount > 0 && (
              <div
                className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center justify-between text-sm"
                data-testid="placed-summary"
              >
                <span className="text-emerald-200 font-semibold">
                  {placedCount} slip{placedCount === 1 ? "" : "s"} placed
                </span>
                <span className="font-mono font-black text-emerald-300">
                  ₹{formatRupees(placedTotalPaise.toString())}
                </span>
              </div>
            )}

            {/* Staged bets chips (desktop) */}
            {bets.size > 0 && (
              <div className="hidden lg:flex flex-wrap gap-1.5">
                {[...bets.entries()].map(([spot, amount]) => (
                  <span
                    key={spot}
                    className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 font-mono"
                  >
                    {BET_LABELS[spot]} · ₹{amount}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bet bar (fixed on mobile, inline on desktop) */}
        <div className="game-bottom-bar fixed bottom-0 inset-x-0 z-40 bg-[#0d0718]/95 backdrop-blur border-t border-white/10 safe-pb lg:static lg:bg-transparent lg:border-0">
          <div className="game-shell w-full max-w-7xl mx-auto p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <TableCoinRack preferences={coinPreferences} chip={chip} onSelect={setChip} />
              </div>

              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Staked
                </div>
                <div
                  className="max-w-[38vw] sm:max-w-40 break-all text-sm sm:text-lg font-black font-mono text-amber-300 leading-tight"
                  data-testid="text-total-staked"
                >
                  ₹{totalStaked.toLocaleString("en-IN")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={undo}
                disabled={history.length === 0 || placing || !!disabledGame}
                className="h-11 px-3 bg-[#2a1418] border-white/10 hover:bg-[#361a20] touch-target"
                data-testid="btn-undo"
              >
                <Undo2 className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Undo</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={clearBets}
                disabled={bets.size === 0 || placing || !!disabledGame}
                className="h-11 px-3 bg-[#2a1418] border-white/10 hover:bg-[#361a20] touch-target"
                data-testid="btn-clear"
              >
                <Trash2 className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={rebet}
                disabled={!lastBetsRef.current || placing || !!disabledGame}
                className="h-11 px-3 bg-[#2a1418] border-white/10 hover:bg-[#361a20] touch-target"
                data-testid="btn-rebet"
              >
                <RotateCcw className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Rebet</span>
              </Button>
              <AutoBetStatus selected={bets.size > 0} busy={placing} seconds={bets.size > 0 ? Math.ceil(remainingMs / 1000) : null} className="flex-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Fairness dialog */}
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#190a0d] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Provably Fair
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Each round shuffles a fresh single deck from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce)
              </span>{" "}
              via a Fisher–Yates shuffle, then deals alternately A, B, A, B, A,
              B. The server seed hash is committed during the betting window;
              the server seed is revealed once the round is dealt.
            </p>
            <div className="rounded-lg bg-[#2a1418] p-3 space-y-2">
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
        <DialogContent className="bg-[#190a0d] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Round Verification
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
                    {winnerLabel(verifyOpen.winner)} ·{" "}
                    {CATEGORY_LABELS[verifyOpen.handACategory]} vs{" "}
                    {CATEGORY_LABELS[verifyOpen.handBCategory]}
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
              <div className="flex gap-1 flex-wrap items-center">
                <span className="text-[10px] text-amber-300 font-bold mr-1">
                  A:
                </span>
                {verifyOpen.handACards.map((card, i) => (
                  <PlayingCard key={`va${i}`} card={card} small />
                ))}
                <span className="text-[10px] text-rose-300 font-bold mx-1">
                  B:
                </span>
                {verifyOpen.handBCards.map((card, i) => (
                  <PlayingCard key={`vb${i}`} card={card} small />
                ))}
              </div>
              <div className="rounded-lg bg-[#2a1418] p-2 space-y-1 max-h-28 overflow-y-auto">
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
              <div className="rounded-lg bg-[#2a1418] p-2 space-y-1">
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
                    Recomputed: {verifyData.computedWinner} ·{" "}
                    {CATEGORY_LABELS[verifyData.computedHandACategory]} vs{" "}
                    {CATEGORY_LABELS[verifyData.computedHandBCategory]} · payout
                    ₹{formatRupees(verifyData.computedPayout)}
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
