import { ANDAR_FIRST_RETURN, ANDAR_SECOND_RETURN, ANDAR_RANGE_RETURNS } from "@workspace/api-zod/game-economics";
import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet } from "@/components/table/AutoBet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sfx, unlockAudio, preloadTableAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import { useIsLgUp } from "@/hooks/use-mobile";
import {
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  Undo2,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import PlayingCard from "@/components/baccarat/PlayingCard";
import { useTableRound } from "@/components/table/useTableRound";
import RoundPhaseBanner from "@/components/table/RoundPhaseBanner";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import { formatChip } from "@/components/table/chips";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { GameRulesButton } from "@/components/game/GameRules";

type MainBet = "andar" | "bahar";
type RangeBet =
  | "range1_5"
  | "range6_10"
  | "range11_15"
  | "range16_25"
  | "range26_30"
  | "range31_35"
  | "range36_40"
  | "range41_49";
type BetType = MainBet | RangeBet;

const RANGE_SPOTS: { type: RangeBet; label: string; short: string; pays: string }[] = [
  { type: "range1_5", label: "1–5", short: "1-5", pays: `${ANDAR_RANGE_RETURNS.range1_5 / 100}× return` },
  { type: "range6_10", label: "6–10", short: "6-10", pays: `${ANDAR_RANGE_RETURNS.range6_10 / 100}× return` },
  { type: "range11_15", label: "11–15", short: "11-15", pays: `${ANDAR_RANGE_RETURNS.range11_15 / 100}× return` },
  { type: "range16_25", label: "16–25", short: "16-25", pays: `${ANDAR_RANGE_RETURNS.range16_25 / 100}× return` },
  { type: "range26_30", label: "26–30", short: "26-30", pays: `${ANDAR_RANGE_RETURNS.range26_30 / 100}× return` },
  { type: "range31_35", label: "31–35", short: "31-35", pays: `${ANDAR_RANGE_RETURNS.range31_35 / 100}× return` },
  { type: "range36_40", label: "36–40", short: "36-40", pays: `${ANDAR_RANGE_RETURNS.range36_40 / 100}× return` },
  { type: "range41_49", label: "41–49", short: "41-49", pays: `${ANDAR_RANGE_RETURNS.range41_49 / 100}× return` },
];

const RANGE_SHORT: Record<RangeBet, string> = Object.fromEntries(
  RANGE_SPOTS.map((r) => [r.type, r.short]),
) as Record<RangeBet, string>;

const BET_LABELS: Record<BetType, string> = {
  andar: "Andar",
  bahar: "Bahar",
  ...Object.fromEntries(RANGE_SPOTS.map((r) => [r.type, `Cards ${r.label}`])),
} as Record<BetType, string>;

const SHORT_LABELS: Record<BetType, string> = {
  andar: "Andar",
  bahar: "Bahar",
  ...RANGE_SHORT,
} as Record<BetType, string>;

/** Typed outcome delivered by the shared round hook on reveal. */
interface AndarBaharDeal {
  joker: number;
  andarCards: number[];
  baharCards: number[];
  firstSide: MainBet;
  winner: MainBet;
  cardsDealt: number;
}

/** A slip bet as stored server-side (myBets/liveBets `bets` payload). */
interface SlipBet {
  type: BetType;
  amountPaise: string;
}

const JOKER_MS = 400;

/**
 * Compute per-card flip delays so the whole paced deal (joker + all cards)
 * fits within the reveal + settling window. When many cards are dealt the
 * pacing accelerates automatically.
 */
function buildDelays(totalCards: number, budgetMs: number): {
  jokerMs: number;
  cardMs: (globalIndex: number) => number;
} {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return { jokerMs: 0, cardMs: () => 0 };
  // Reserve a little tail so the final card lands before settling ends.
  const usable = Math.max(1500, budgetMs - 600);
  const afterJoker = Math.max(0, usable - JOKER_MS);
  const per = totalCards > 0 ? afterJoker / totalCards : 0;
  return {
    jokerMs: JOKER_MS,
    cardMs: (i: number) => JOKER_MS + 150 + i * per,
  };
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  const msg = (err as Error)?.message || fallback;
  if (msg === "BETTING_CLOSED") return "Betting is closed for this round.";
  return msg;
}

function describeSlipBets(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const parts = (raw as SlipBet[]).map((b) => SHORT_LABELS[b.type] ?? b.type);
  return parts.slice(0, 4).join(", ") + (parts.length > 4 ? "…" : "");
}

export default function AndarBahar() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  const isLgUp = useIsLgUp();
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  useEffect(() => {
    document.title = "Andar Bahar • Lunar Casino";
    // Warm the recorded chip pack so the first bet of a session isn't silent.
    preloadTableAudio();
  }, []);

  const balance = useGetWalletBalance(
    { game: "andar-bahar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "andar-bahar" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const invalidateWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
  };

  // Synchronous single-flight lock so a queued auto-submit can't race the
  // async `placing` state and double-POST (or drop) staged bets.
  const placingLockRef = useRef(false);

  const round = useTableRound<AndarBaharDeal>("andar-bahar", {
    enabled: !!user,
    onBettingOpen: () => {
      // New round → staged chips are KEPT so bets queued while betting was
      // closed carry into this round; if the player queued them, auto-place now.

    },
    onSettled: () => {
      invalidateWallet();
    },
    onResult: () => {
      if (sound) sfx.cardDeal();
    },
  });

  const {
    phase,
    remainingMs,
    phaseDurationMs,
    bettingOpen,
    outcome,
    roundId,
    config,
    liveBets,
    playerCount,
    totalStake,
    myBets,
    recent,
    serverSeedHash,
    clientSeed,
    nonce,
    serverSeed,
  } = round;

  // ---- staged bets (local, this player) -----------------------------------
  const coinPreferences = useCoinPreferences("andar-bahar", user?.id);
  const { chip, selectChip: setChip } = coinPreferences;
  const [bets, setBets] = useState<Map<BetType, number>>(new Map());
  const [history, setHistory] = useState<{ spot: BetType; amount: number }[]>(
    [],
  );
  const lastBetsRef = useRef<Map<BetType, number> | null>(null);
  const [placing, setPlacing] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);

  const totalStaked = useMemo(
    () => [...bets.values()].reduce((s, v) => s + v, 0),
    [bets],
  );

  // ---- my placed slips summary --------------------------------------------
  const placedTotalPaise = useMemo(
    () => myBets.reduce((s, b) => s + BigInt(b.totalStake || "0"), 0n),
    [myBets],
  );
  const placedCount = myBets.length;
  const myPayoutPaise = useMemo(
    () =>
      myBets
        .filter((b) => b.status === "settled")
        .reduce((s, b) => s + BigInt(b.payoutAmount || "0"), 0n),
    [myBets],
  );

  // ---- reveal animation ----------------------------------------------------
  // Show the dealt cards keyed by roundId once per round during reveal/settling.
  const [animRoundId, setAnimRoundId] = useState<string | null>(null);
  const [dealing, setDealing] = useState(false);
  const [visibleCardIndex, setVisibleCardIndex] = useState(-1);
  const scheduledDealRoundRef = useRef<string | null>(null);
  const showOutcome =
    (phase === "reveal" || phase === "settling") && outcome != null;

  const delays = useMemo(() => {
    if (!outcome || !config) return null;
    const budget = config.revealDurationMs + config.settleDurationMs;
    return buildDelays(outcome.cardsDealt, budget);
  }, [outcome, config]);
  const roundWin = useRoundWin({ game: "andar-bahar", userId: user?.id, roundId,
    eligible: phase === "settling" && !!outcome && visibleCardIndex >= outcome.cardsDealt - 1, bets: myBets });

  useEffect(() => {
    if (!showOutcome || !roundId) return;
    if (scheduledDealRoundRef.current === roundId) return;
    scheduledDealRoundRef.current = roundId;
    setAnimRoundId(roundId);
    setDealing(true);
    setVisibleCardIndex(-1);
    notifyPlayStarted();
    const budget =
      (config?.revealDurationMs ?? 5000) + (config?.settleDurationMs ?? 5000);
    const timers = outcome
      ? Array.from({ length: outcome.cardsDealt }, (_, index) =>
          window.setTimeout(() => setVisibleCardIndex(index), delays?.cardMs(index) ?? 0),
        )
      : [];
    const finishTimer = window.setTimeout(() => setDealing(false), budget);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(finishTimer);
    };
  }, [showOutcome, roundId]);

  // Settlement result toast — fires once per round when my slips settle.
  const toastedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !roundId) return;
    const settled = myBets.filter((b) => b.status === "settled");
    if (settled.length === 0) return;
    if (toastedRef.current === roundId) return;
    toastedRef.current = roundId;
    const won = myPayoutPaise > 0n;
    if (sound) {
      if (!won) sfx.tableLose("andar-bahar");
      if (won) voiceRoundWin("andar-bahar", roundId);
      else voiceRoundLoss("andar-bahar", roundId);
    }
    if (won) {
      toast.success(
        `${outcome?.winner === "andar" ? "Andar" : "Bahar"} — you won ₹${formatRupees(myPayoutPaise.toString())}!`,
      );
    }
  }, [phase, roundId, myBets, myPayoutPaise, outcome, sound]);

  // Clear the anim marker when a new betting window starts.
  useEffect(() => {
    if (phase === "betting") {
      setDealing(false);
      setVisibleCardIndex(-1);
    }
  }, [phase]);

  // ---- staging actions -----------------------------------------------------
  const placeChip = (spot: BetType) => {
    // Draft chips belong only to the current betting window.
    if (placing || !bettingOpen || remainingMs <= 0) return;
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

  // ---- place slip ----------------------------------------------------------
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
      await customFetch("/api/andar-bahar/deal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId, bets: payload }),
      });
      lastBetsRef.current = new Map(bets);
      if (sound) sfx.chipPlace();
      setBets(new Map());
      setHistory([]);
      invalidateWallet();
      round.refetch();
      toast.success(
        auto ? "Queued bets placed for this round" : "Bets placed for this round.",
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
    enabled: !!user && bettingOpen && !placing && true,
    submit: () => placeBets(true),
  });

  if (!user) return null;

  // Global deal order: andar/bahar interleaved starting from firstSide.
  const globalIndex = (side: MainBet, i: number): number => {
    if (!outcome) return 0;
    return outcome.firstSide === side ? i * 2 : i * 2 + 1;
  };

  const sideColumn = (side: MainBet) => {
    const cards = showOutcome
      ? side === "andar"
        ? outcome!.andarCards
        : outcome!.baharCards
      : [];
    const visibleCards = cards.filter(
      (_, i) => globalIndex(side, i) <= visibleCardIndex,
    );
    const isWinner = showOutcome && outcome!.winner === side;
    return (
      <div
        className={cn(
          "relative isolate flex-1 overflow-hidden rounded-[1.35rem] border p-3 sm:p-4 min-h-[11rem] sm:min-h-[15rem] transition-[box-shadow,transform] duration-500",
          side === "andar"
            ? "bg-[linear-gradient(145deg,rgba(110,16,38,.97),rgba(44,5,22,.97))] border-rose-200/45 shadow-[inset_0_1px_rgba(255,255,255,.2),inset_0_-22px_30px_rgba(0,0,0,.35)]"
            : "bg-[linear-gradient(145deg,rgba(14,67,108,.97),rgba(4,28,61,.98))] border-sky-100/45 shadow-[inset_0_1px_rgba(255,255,255,.2),inset_0_-22px_30px_rgba(0,0,0,.35)]",
          isWinner &&
            "ring-2 ring-amber-200 shadow-[0_0_30px_rgba(251,191,36,.5)]",
        )}
        data-testid={`side-${side}`}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 opacity-35",
            isWinner && "animate-pulse motion-reduce:animate-none opacity-60",
            side === "andar"
              ? "bg-[radial-gradient(circle_at_50%_0%,rgba(255,218,150,.45),transparent_52%)]"
              : "bg-[radial-gradient(circle_at_50%_0%,rgba(155,220,255,.45),transparent_52%)]",
          )}
        />
        <div className="andar-lane-heading flex items-start justify-between gap-2 mb-3">
          <div>
            <span
              className={cn(
                "text-[11px] font-black uppercase tracking-[0.2em]",
                side === "andar" ? "text-rose-100" : "text-sky-100",
              )}
            >
              {side === "andar" ? "अंदर · Andar" : "बाहर · Bahar"}
            </span>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/45">
              {side === "andar" ? "Inside lane" : "Outside lane"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-black text-white/90">
              {visibleCards.length}
              <span className="text-white/35">/{cards.length || "—"}</span>
            </div>
            <div className="text-[9px] uppercase tracking-wider text-white/40">
              cards
            </div>
          </div>
        </div>
        <div
          className="andar-card-strip relative flex min-h-[6.5rem] sm:min-h-[8rem] items-center gap-2 overflow-x-auto overscroll-x-contain pb-2 pr-1 scrollbar-thin"
          aria-live="polite"
        >
          {showOutcome && visibleCards.length > 0 ? (
            visibleCards.map((card, i) => (
              <div key={`${animRoundId}-${side}-${i}`} className="relative">
                <PlayingCard
                  card={card}
                  small={false}
                  flipDelayMs={0}
                  dealOffset={{
                    x: side === "andar" ? -18 : 18,
                    y: -22,
                    rotate: side === "andar" ? -9 : 9,
                  }}
                  className="drop-shadow-[0_12px_8px_rgba(0,0,0,.52)]"
                />
              </div>
            ))
          ) : (
            <div className="mx-auto flex flex-col items-center gap-2 text-center">
              <div className="h-16 w-11 rounded-lg border border-white/15 bg-[repeating-linear-gradient(45deg,#312e81,#312e81_4px,#1e1b4b_4px,#1e1b4b_8px)] opacity-70 shadow-lg" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                {showOutcome ? "Dealing next card…" : "Waiting for deal"}
              </span>
            </div>
          )}
        </div>
        <div className="andar-lane-footer mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] uppercase tracking-wider">
          <span className="text-white/35">
            {showOutcome && outcome!.firstSide === side ? "First lane" : "Matching lane"}
          </span>
          <span className={cn(
            "font-mono font-bold",
            side === "andar" ? "text-rose-200/70" : "text-sky-200/70",
          )}>
            {showOutcome ? `${(outcome!.firstSide === side ? ANDAR_FIRST_RETURN : ANDAR_SECOND_RETURN) / 100}× return` : `${ANDAR_FIRST_RETURN / 100}–${ANDAR_SECOND_RETURN / 100}×`}
          </span>
        </div>
      </div>
    );
  };

  // Result line shown in the banner during settling.
  const resultLine =
    phase === "settling" && outcome ? (
      <span
        className="flex items-center gap-2 font-mono"
        data-testid="text-result-line"
      >
        <span className="font-black uppercase">
          {outcome.winner === "andar" ? "Andar" : "Bahar"} wins
        </span>
        <span className="text-white/60">· {outcome.cardsDealt} cards</span>
        {placedCount > 0 && (
          <span
            className={cn(
              "font-black",
              myPayoutPaise > 0n ? "text-emerald-300" : "text-rose-300",
            )}
          >
            {myPayoutPaise > 0n
              ? `+₹${formatRupees(myPayoutPaise.toString())}`
              : `-₹${formatRupees(placedTotalPaise.toString())}`}
          </span>
        )}
      </span>
    ) : null;


  // Secondary panels are available from the information button.
  const liveBetsPanel = (
    <LiveBetsPanel
      bets={liveBets}
      playerCount={playerCount}
      totalStake={totalStake}
      describeBets={describeSlipBets}
    />
  );

  const recentResultsPanel = (
    <div className="rounded-xl bg-[#081f2c] border border-amber-100/15 p-3 flex flex-col gap-2">
      <div className="text-[11px] uppercase font-bold text-white/50">
        Recent Results
      </div>
      <div className="flex gap-1 flex-wrap" data-testid="results-strip">
        {recent.length > 0 ? (
          recent.slice(0, 24).map((r) => {
            const o = r.outcome as AndarBaharDeal | null;
            if (!o) return null;
            return (
              <span
                key={r.roundId}
                title={`${o.cardsDealt} cards`}
                className={cn(
                  "w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center",
                  o.winner === "andar"
                    ? "bg-amber-500 text-black"
                    : "bg-sky-500 text-black",
                )}
              >
                {o.winner === "andar" ? "A" : "B"}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-white/40 italic">No rounds yet.</span>
        )}
      </div>
    </div>
  );

  const myBetsPanel = (
    <div className="rounded-xl bg-[#081f2c] border border-amber-100/15 p-3 flex flex-col gap-2 max-h-[340px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        Your Bets This Round
      </div>
      {myBets.length > 0 ? (
        myBets.map((b) => {
          const win =
            b.status === "settled" && BigInt(b.payoutAmount || "0") > 0n;
          return (
            <div
              key={b.slipId}
              className="text-left p-2 rounded-md bg-[#0c2a39] flex items-center justify-between gap-2"
              data-testid={`myslip-${b.slipId}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  className={cn(
                    "text-[10px] font-mono text-white shrink-0",
                    b.status === "settled"
                      ? win
                        ? "bg-emerald-600"
                        : "bg-rose-700"
                      : b.status === "refunded"
                        ? "bg-zinc-600"
                        : "bg-amber-600",
                  )}
                >
                  {b.status}
                </Badge>
                <span className="text-xs text-white/60 font-mono truncate">
                  {describeSlipBets(b.bets)} · ₹{formatRupees(b.totalStake)}
                </span>
              </div>
              <span
                className={cn(
                  "text-xs font-mono shrink-0",
                  win ? "text-emerald-400" : "text-white/50",
                )}
              >
                ₹{formatRupees(b.payoutAmount)}
              </span>
            </div>
          );
        })
      ) : (
        <div className="text-xs text-white/40 italic">
          Stage chips and place your bets.
        </div>
      )}
    </div>
  );

  // Shared controls (chip rack + actions) reused in bottom bar and desktop.
  const controls = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <TableCoinRack preferences={coinPreferences} chip={chip} onSelect={setChip} />
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase text-white/40 font-bold">
            Staged
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
          disabled={history.length === 0 || placing}
          className="touch-target h-11 w-11 sm:w-auto shrink-0 px-0 sm:px-3 bg-[#0c2a39] border-white/10 hover:bg-[#12394a]"
          data-testid="btn-undo"
          aria-label="Undo"
        >
          <Undo2 className="w-4 h-4 sm:mr-1" />{" "}
          <span className="hidden sm:inline">Undo</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={clearBets}
          disabled={bets.size === 0 || placing}
          className="touch-target h-11 w-11 sm:w-auto shrink-0 px-0 sm:px-3 bg-[#0c2a39] border-white/10 hover:bg-[#12394a]"
          data-testid="btn-clear"
          aria-label="Clear"
        >
          <Trash2 className="w-4 h-4 sm:mr-1" />{" "}
          <span className="hidden sm:inline">Clear</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={rebet}
          disabled={!lastBetsRef.current || placing}
          className="touch-target h-11 w-11 sm:w-auto shrink-0 px-0 sm:px-3 bg-[#0c2a39] border-white/10 hover:bg-[#12394a]"
          data-testid="btn-rebet"
          aria-label="Rebet"
        >
          <RotateCcw className="w-4 h-4 sm:mr-1" />{" "}
          <span className="hidden sm:inline">Rebet</span>
        </Button>
        <AutoBetStatus selected={bets.size > 0} busy={placing} seconds={bets.size > 0 ? Math.ceil(remainingMs / 1000) : null} className="flex-1" />
      </div>

      {placedCount > 0 && (
        <div
          className="flex items-center justify-between text-[11px] rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5"
          data-testid="text-placed-summary"
        >
          <span className="text-emerald-300 font-bold uppercase">
            Placed this round
          </span>
          <span className="font-mono text-emerald-200">
            {placedCount} slip{placedCount === 1 ? "" : "s"} · ₹
            {formatRupees(placedTotalPaise.toString())}
          </span>
        </div>
      )}

      {bets.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
    </>
  );

  return (
    <div className="game-page min-h-[100dvh] w-full overflow-x-clip bg-[#090d1e] text-white flex justify-center">
      <GameInformationSection>{liveBetsPanel}{recentResultsPanel}{myBetsPanel}</GameInformationSection>
      <div className="game-shell w-full max-w-7xl flex flex-col">
        {/* Top bar */}
        <div className="andar-page-header sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 py-3 bg-[#090d1e]/90 backdrop-blur-md border-b border-amber-200/10 safe-pt">
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
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-red-600 to-amber-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  Andar Bahar
                </h1>
                <p className="text-[10px] text-white/40 leading-none truncate">
                  Shared table • Provably fair
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
                data-testid="text-andarbahar-balance"
              >
                ₹{formatRupees(balance.data?.balance ?? "0")}
              </span>
            </div>
            <GameRulesButton gameCode="andar-bahar" />
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

        <div data-game-screen="andar-bahar" className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 pb-44 lg:pb-3">
          {/* Table */}
          <div className="andar-main-column flex-1 flex flex-col gap-3 min-w-0">
            {/* A CSS-built digital dealer alcove and layered felt: visual theatre,
                not a claim of a live dealer or video feed. */}
            <div
              className="relative isolate overflow-hidden rounded-[1.5rem] border border-amber-200/45 p-2 sm:p-3 shadow-[0_24px_70px_rgba(0,0,0,.48),inset_0_0_0_2px_rgba(116,54,16,.5)]"
              data-testid="andar-bahar-table"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-8%,rgba(255,202,105,.38),transparent_32%),radial-gradient(ellipse_at_50%_105%,rgba(3,37,48,.8),transparent_63%),linear-gradient(135deg,#062f3d,#06495a_48%,#032a38)]" />
              <div className="pointer-events-none absolute inset-[7px] rounded-[1.1rem] border border-amber-100/20 shadow-[inset_0_0_42px_rgba(0,0,0,.56)]" />
              <div className="pointer-events-none absolute -top-16 left-1/2 h-36 w-60 -translate-x-1/2 rounded-b-[100%] border-x-8 border-b-8 border-rose-800/80 bg-[radial-gradient(ellipse_at_50%_85%,#8e1834,transparent_67%)] shadow-[0_14px_30px_rgba(0,0,0,.45)]" />
              <div className="pointer-events-none absolute left-1/2 top-1.5 h-14 w-20 -translate-x-1/2 opacity-80" aria-hidden="true">
                <div className="mx-auto h-7 w-7 rounded-full bg-gradient-to-b from-amber-100/80 to-amber-300/35 shadow-[0_0_18px_rgba(255,217,145,.25)]" />
                <div className="mx-auto -mt-0.5 h-8 w-16 rounded-t-[100%] border-t border-amber-100/30 bg-gradient-to-b from-violet-300/45 to-violet-950/20" />
              </div>
              <div className="andar-table-content relative flex flex-col gap-3 rounded-[1.15rem] px-2 pb-3 pt-16 sm:px-5 sm:pb-5 sm:pt-20">
                <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">
                  <div className="text-[9px] sm:text-[10px] font-black tracking-[.34em] text-amber-100/85 uppercase whitespace-nowrap">
                    Lunar digital table
                  </div>
                  <div className="mt-0.5 text-[8px] font-bold tracking-[.22em] text-rose-200/70 uppercase">
                    Andar Bahar
                  </div>
                </div>
                <div className="relative mx-auto w-full max-w-md">
                  <RoundPhaseBanner
                    phase={phase}
                    remainingMs={remainingMs}
                    durationMs={phaseDurationMs}
                    settleDurationMs={round.config?.settleDurationMs}
                    resultSlot={resultLine}
                    className="shadow-[0_8px_24px_rgba(0,0,0,.3)] backdrop-blur-sm"
                  />
                </div>
                <div
                  className="mx-auto -mt-1 flex items-center gap-2 rounded-full border border-amber-100/15 bg-black/20 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-100/65"
                  data-testid="deal-progress"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,.9)]" />
                  {showOutcome
                    ? `Dealing ${Math.min(
                        outcome!.cardsDealt,
                        Math.max(0, visibleCardIndex + 1),
                      )} of ${outcome!.cardsDealt}`
                    : "Cards deal alternately"}
                </div>
              {/* Joker */}
              <div className="andar-joker relative flex items-center justify-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/40 to-amber-500/60" />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] uppercase tracking-[0.25em] text-amber-300/80 font-bold">
                    Joker
                  </span>
                  {showOutcome ? (
                    <PlayingCard
                      key={`${animRoundId}-joker`}
                      card={outcome!.joker}
                      flipDelayMs={dealing && delays ? delays.jokerMs : 0}
                        dealOffset={{ x: 0, y: -16, rotate: 0 }}
                        className="drop-shadow-[0_10px_7px_rgba(0,0,0,.55)]"
                    />
                  ) : (
                    <div className="w-14 h-20 sm:w-16 sm:h-24 rounded-lg border-2 border-dashed border-amber-500/30 flex items-center justify-center text-amber-500/40 text-2xl">
                      ?
                    </div>
                  )}
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-500/40 to-amber-500/60" />
              </div>

              {/* Andar / Bahar card rows */}
              <div className="andar-card-lanes flex flex-row gap-2 sm:gap-3">
                {sideColumn("andar")}
                {sideColumn("bahar")}
              </div>
              </div>
            </div>

            {/* Main betting spots */}
            <div className="andar-main-bets grid grid-cols-2 gap-2">
              {(["andar", "bahar"] as MainBet[]).map((spot) => {
                const amount = bets.get(spot) ?? 0;
                const won = showOutcome && outcome!.winner === spot;
                return (
                  <button
                    key={spot}
                    type="button"
                    onClick={() => placeChip(spot)}
                    disabled={placing || !bettingOpen || remainingMs <= 0}
                    className={cn(
                       "relative overflow-visible rounded-xl border-2 border-b-4 p-4 min-h-[88px] flex flex-col items-center justify-center gap-1 transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:opacity-50",
                      spot === "andar"
                         ? "bg-[linear-gradient(180deg,#a8243d,#661028)] border-rose-200/60 shadow-[inset_0_1px_rgba(255,255,255,.25),0_6px_0_#3f091b] hover:shadow-[inset_0_1px_rgba(255,255,255,.25),0_8px_0_#3f091b]"
                         : "bg-[linear-gradient(180deg,#176da0,#0b365f)] border-sky-100/60 shadow-[inset_0_1px_rgba(255,255,255,.25),0_6px_0_#062445] hover:shadow-[inset_0_1px_rgba(255,255,255,.25),0_8px_0_#062445]",
                       won && "ring-2 ring-amber-200 shadow-[0_0_25px_rgba(251,191,36,.55)]",
                    )}
                    data-game-bet data-testid={`spot-${spot}`}
                  >
                    <span className="font-black uppercase tracking-wide text-lg">
                      {BET_LABELS[spot]}
                    </span>
                    <span className="text-[10px] text-white/50 font-mono">
                      first side 0.9:1 · other 1:1
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

            {/* Range side bets */}
            <div className="andar-range-panel rounded-xl bg-[linear-gradient(145deg,#103d48,#082b38)] border border-amber-100/20 p-3 flex flex-col gap-2 shadow-[inset_0_1px_rgba(255,255,255,.1)]">
              <div className="text-[11px] uppercase font-bold text-white/50">
                Side Bets — total cards dealt
              </div>
              <div className="andar-side-bets grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
                {RANGE_SPOTS.map((r) => {
                  const amount = bets.get(r.type) ?? 0;
                  return (
                    <button
                      key={r.type}
                      type="button"
                      onClick={() => placeChip(r.type)}
                      disabled={placing || !bettingOpen || remainingMs <= 0}
                      className={cn(
                        "relative rounded-lg border p-2 min-h-[58px] flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-50",
                         "bg-[linear-gradient(180deg,rgba(94,20,42,.9),rgba(48,8,26,.95))] border-rose-200/25 hover:-translate-y-px hover:border-amber-200/55 transition-transform shadow-[inset_0_1px_rgba(255,255,255,.12),0_3px_0_rgba(22,4,14,.8)]",
                      )}
                      data-testid={`spot-${r.type}`}
                    >
                      <span className="font-black text-xs">{r.label}</span>
                      <span className="text-[9px] text-amber-300/80 font-mono">
                        {r.pays}
                      </span>
                      {amount > 0 && (
                        <span
                          className="absolute -top-1.5 -right-1.5 min-w-[1.5rem] h-6 px-1 rounded-full bg-amber-400 border border-dashed border-amber-700 text-black text-[9px] font-black flex items-center justify-center shadow"
                          data-testid={`chipstack-${r.type}`}
                        >
                          {formatChip(amount)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Desktop chip rack + actions */}
            {isLgUp && (
              <div className="rounded-xl bg-[#081f2c] border border-amber-100/15 p-3 sm:p-4 flex flex-col gap-3">
                {controls}
              </div>
            )}
          </div>
        </div>

        {/* Fixed bottom bet bar (mobile) */}
        {!isLgUp && (
          <div className="game-bottom-bar fixed bottom-0 inset-x-0 z-40 bg-[#071520]/95 backdrop-blur border-t border-amber-100/20 safe-pb">
            <div className="max-w-7xl mx-auto px-3 py-2.5 flex flex-col gap-2.5">
              {controls}
            </div>
          </div>
        )}
      </div>

      {/* Fairness dialog */}
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#071b28] border border-amber-100/15 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Provably Fair
            </DialogTitle>
            <DialogDescription className="sr-only">
              Verify this Andar Bahar round using its committed and revealed seeds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Each shared round shuffles a fresh single deck from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce)
              </span>{" "}
              via a Fisher–Yates shuffle. The first card is the joker; a black
              joker starts dealing on Andar, a red joker on Bahar, alternating
              until the joker's rank appears. The server seed hash is committed
              before the betting window closes and the full server seed is
              revealed after the deal so anyone can verify the round.
            </p>
            <div className="rounded-lg bg-[#0c2a39] p-3 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash (committed)
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
                <div className="text-[10px] uppercase text-white/40 font-bold mt-2">
                  Server Seed {serverSeed ? "(revealed)" : "(hidden until reveal)"}
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {serverSeed ?? "Revealed after the deal."}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
