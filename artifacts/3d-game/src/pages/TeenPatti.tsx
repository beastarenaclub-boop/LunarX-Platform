import { GameInformationSection } from "@/components/game/GameInformation";
import {
  AutoBetStatus,
  BET_SEND_BUFFER_MS,
  useChipDraft,
  useTimedBet,
} from "@/components/table/AutoBet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  sfx,
  unlockAudio,
  preloadTableAudio,
  voiceRoundLoss,
  voiceRoundWin,
} from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import {
  Home,
  Spade,
  Settings,
  UserRound,
  Megaphone,
  LockKeyhole,
  ShieldCheck,
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
import {
  TableCoinRack,
  CoinSettingsDialog,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { GameRulesButton } from "@/components/game/GameRules";
import "@/components/teenpattiLive/teen-patti-market.css";
import "@/components/teenpattiLive/teen-patti-classic.css";

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
  minStakePaise: string;
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
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
    void qc.invalidateQueries({ queryKey: ["teenpatti.recent"] });
  };

  const placingLockRef = useRef(false);

  const round = useTableRound<TeenPattiDeal>("teen-patti", {
    onBettingOpen: () => {
      // A draft belongs to one round; the draft hook clears it at rollover.
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
  const roundWin = useRoundWin({
    game: "teen-patti",
    userId: user?.id,
    roundId,
    eligible: phase === "settling",
    bets: myBets,
  });
  const [history, setHistory] = useState<
    { spot: TeenPattiBetType; amount: number }[]
  >([]);
  const lastBetsRef = useRef<Map<TeenPattiBetType, number> | null>(null);
  const [placing, setPlacing] = useState(false);
  const [revealRoundId, setRevealRoundId] = useState<string | null>(null);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [coinSettingsOpen, setCoinSettingsOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<TeenPattiState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);

  const disabledGame = config.data?.enabled !== true;
  const payouts = roundConfig?.teenPattiPayouts ?? config.data?.payouts;
  const maxStakePaise =
    roundConfig?.maxStakePaise ?? config.data?.maxStakePaise ?? "0";
  const minStakePaise =
    roundConfig?.minStakePaise ?? config.data?.minStakePaise ?? "0";
  const draft = useChipDraft<TeenPattiBetType>(
    roundId,
    !placing && !disabledGame && bettingOpen && remainingMs > 0,
    balance.data?.balance ?? "0",
    maxStakePaise,
  );
  const bets = useMemo(
    () => new Map(draft.bets.map((b) => [b.type, Number(b.amountPaise) / 100])),
    [draft.bets],
  );

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
  const settled =
    myBets.length > 0 &&
    myBets.every((b) => b.status === "settled" || b.status === "refunded");
  const activeStakePaise = myBets
    .filter((b) => b.status !== "refunded")
    .reduce((sum, b) => sum + BigInt(b.totalStake), 0n);
  const netPayoutPaise = myPayoutPaise - activeStakePaise;

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
    if (!draft.stage([{ type: spot, amountPaise: rupeesToPaise(chip) }])) {
      toast.error("Check your balance and table limits");
      return;
    }
    unlockAudio();
    if (sound) sfx.chipPlace();
    setHistory((h) => [...h, { spot, amount: chip }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last || placing || !bettingOpen || remainingMs <= 0) return;
    const next = new Map(bets);
    const existing = next.get(last.spot) ?? 0;
    const remaining = existing - last.amount;
    if (remaining > 0) next.set(last.spot, remaining);
    else next.delete(last.spot);
    if (
      draft.stage(
        [...next].map(([type, amount]) => ({
          type,
          amountPaise: rupeesToPaise(amount),
        })),
        true,
      )
    ) {
      setHistory((h) => h.slice(0, -1));
    }
  };

  const clearBets = () => {
    draft.clear();
    setHistory([]);
  };

  const rebet = () => {
    if (
      !lastBetsRef.current ||
      disabledGame ||
      !bettingOpen ||
      remainingMs <= 0 ||
      placing
    )
      return;
    if (
      !draft.stage(
        [...lastBetsRef.current].map(([type, amount]) => ({
          type,
          amountPaise: rupeesToPaise(amount),
        })),
        true,
      )
    ) {
      toast.error("Check your balance and table limits");
      return;
    }
    setHistory([]);
  };

  const placeBets = async (auto = false) => {
    if (!user) return;
    if (bets.size === 0) {
      if (!auto) toast.error("Place at least one chip on the table");
      return;
    }
    if (
      !bettingOpen ||
      disabledGame ||
      !roundId ||
      round.phaseEndsAt == null ||
      round.toLocalTime(round.phaseEndsAt) - Date.now() <= 300
    )
      return;
    const draftTotal = draft.bets.reduce(
      (sum, bet) => sum + BigInt(bet.amountPaise),
      0n,
    );
    if (
      draftTotal < BigInt(minStakePaise) ||
      draftTotal > BigInt(maxStakePaise) ||
      draftTotal > BigInt(balance.data?.balance ?? "0")
    ) {
      toast.error(
        `Check balance and table limits (minimum ₹${formatRupees(minStakePaise)})`,
      );
      clearBets();
      return;
    }
    if (placingLockRef.current) return;
    placingLockRef.current = true;
    unlockAudio();
    setPlacing(true);
    try {
      const payload = draft.bets;
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

  // Win/loss toast once payouts land.
  const settledToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !settled || !roundId) return;
    if (settledToastRef.current === roundId) return;
    settledToastRef.current = roundId;
    const won = netPayoutPaise > 0n;
    if (sound) {
      if (netPayoutPaise < 0n) sfx.tableLose("teen-patti");
      if (won) voiceRoundWin("teen-patti", roundId);
      else if (netPayoutPaise < 0n) voiceRoundLoss("teen-patti", roundId);
    }
    if (won) {
      toast.success(`Net win ₹${formatRupees(netPayoutPaise.toString())}!`);
    }
  }, [phase, settled, roundId, netPayoutPaise, sound]);

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

  const locked =
    placing ||
    config.data?.enabled !== true ||
    !bettingOpen ||
    remainingMs <= 0;
  const marketButton = (spot: TeenPattiBetType) => {
    const pairPlus = spot === "pairPlusA" || spot === "pairPlusB";
    const price = pairPlus
      ? spot === "pairPlusA"
        ? "A"
        : "B"
      : (payouts?.[spot as "playerA" | "playerB" | "tie"].toFixed(2) ?? "—");
    return (
      <button
        type="button"
        className="tp20-market-button"
        data-game-bet
        data-testid={"spot-" + spot}
        disabled={locked}
        onClick={() => placeBet(spot)}
        aria-label={
          BET_LABELS[spot] + (locked ? " · Betting closed" : " · " + price)
        }
        title={
          BET_LABELS[spot] +
          " · " +
          (pairPlus
            ? `up to ${payouts?.pairPlus.trail ?? "—"}×`
            : `${price}× return`)
        }
        data-won={shown?.winner === spot}
      >
        {locked ? (
          <LockKeyhole size={21} aria-hidden="true" />
        ) : (
          <span className="tp20-market-value">{price}</span>
        )}
        {(bets.get(spot) ?? 0) > 0 && (
          <span className="tp20-market-chip" data-testid={"chipstack-" + spot}>
            {formatChip(bets.get(spot)!)}
          </span>
        )}
      </button>
    );
  };
  const unavailableMarket = (market: string, side: string) => (
    <button
      type="button"
      className="tp20-market-button"
      disabled
      aria-label={market + ", Player " + side + " · Unavailable"}
      title="This market is not available at this table"
    >
      <LockKeyhole size={21} aria-hidden="true" />
    </button>
  );

  const resultSlot = shown ? (
    <span className="flex items-center gap-2">
      <span className="font-bold uppercase">{winnerLabel(shown.winner)}</span>
      {settled && placedCount > 0 && (
        <span
          className={cn(
            "font-mono font-black",
            netPayoutPaise > 0n
              ? "text-emerald-300"
              : netPayoutPaise < 0n
                ? "text-rose-300"
                : "text-white/70",
          )}
          data-testid="text-result-payout"
        >
          {netPayoutPaise === 0n
            ? "Stake returned"
            : `${netPayoutPaise > 0n ? "+" : "−"}₹${formatRupees((netPayoutPaise < 0n ? -netPayoutPaise : netPayoutPaise).toString())} net`}
        </span>
      )}
    </span>
  ) : null;

  // Secondary panels are available from the information button.
  const historyPanels = (
    <>
      <Button
        variant="ghost"
        onClick={() => setFairnessOpen(true)}
        data-testid="btn-fairness"
      >
        <ShieldCheck size={16} />
        Provably fair
      </Button>
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
    <div className="game-page tp20-page tp20-reference-ui tp2020-classic min-h-[100dvh] w-full text-white">
      <GameInformationSection>{historyPanels}</GameInformationSection>
      <div className="game-shell">
        <header className="tpl-page-header tp20-topbar safe-pt">
          <Link
            href="/"
            className="tp20-home-link"
            aria-label="Back to lobby"
            data-testid="btn-back"
          >
            <Home size={26} />
          </Link>
          <div className="tp20-wordmark">
            <Spade aria-hidden="true" />
            <h1>
              TEEN PATTI<span>20 / 20</span>
            </h1>
          </div>
          <div className="tp20-account">
            <span
              className="tp20-account-balance"
              data-testid="text-teenpatti-balance"
              aria-label="Balance"
            >
              ₹{formatRupees(balance.data?.balance ?? "0")}
            </span>
            <span className="tp20-account-name">
              <UserRound size={13} />
              {user.isDemo ? "Demo" : user.displayName || "Player"}
            </span>
          </div>
          <button
            type="button"
            className="tp20-settings"
            aria-label="Coin and sound settings"
            onClick={() => setCoinSettingsOpen(true)}
          >
            <Settings size={25} />
          </button>
        </header>
        <div className="tp20-announcement">
          <span>20–20 Teen Patti · Pick your player. Follow the cards.</span>
          <Megaphone size={20} aria-hidden="true" />
        </div>
        {disabledGame && (
          <p className="tp2020-disabled" role="status">
            Teen Patti is currently disabled by the operator.
          </p>
        )}
        <div data-game-screen="teen-patti" className="tp2020-content">
          <section
            className="tp2020-card-stage"
            aria-label="Teen Patti 20/20 table"
          >
            <div className="tp2020-round-label">
              <strong>20-20 TEENPATTI</strong>
              <span title={roundId ?? undefined}>
                Round ID: {roundId || "Connecting…"}
              </span>
            </div>
            <div className="tp2020-stage-actions">
              <Link href="/" aria-label="Game lobby">
                <Home size={22} />
              </Link>
              <GameRulesButton gameCode="teen-patti" />
            </div>
            {shown && (
              <div className="tp2020-hands">
                {(["A", "B"] as const).map((side, hand) => (
                  <div
                    className="tp2020-hand"
                    key={side}
                    aria-label={"Player " + side + " cards"}
                  >
                    <div className="tp2020-cards">
                      {(hand === 0 ? shown.handACards : shown.handBCards).map(
                        (card, i) => (
                          <PlayingCard
                            key={String(revealRoundId) + side + i}
                            card={card}
                            small
                            flipDelayMs={(i * 2 + hand) * FLIP_STEP_MS}
                            className="tp2020-playing-card"
                          />
                        ),
                      )}
                    </div>
                    <span
                      className="sr-only"
                      data-testid={
                        hand === 0
                          ? "text-hand-a-category"
                          : "text-hand-b-category"
                      }
                    >
                      {
                        CATEGORY_LABELS[
                          (hand === 0 ? shown.handA : shown.handB).category
                        ]
                      }
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="tp2020-stage-status" role="status">
              {shown ? (
                <span data-testid="text-result-winner">
                  {winnerLabel(shown.winner)}
                </span>
              ) : dealing ? (
                "Revealing cards…"
              ) : bettingOpen ? (
                "Place your bets"
              ) : (
                "Waiting for next round…"
              )}
            </div>
            <span className="tp2020-countdown" aria-label="Seconds remaining">
              {roundId ? Math.max(0, Math.ceil(remainingMs / 1000)) : "—"}
            </span>
          </section>
          <section className="tp2020-betting" aria-label="Betting markets">
            <table className="tp20-market-table" data-testid="tp2020-markets">
              <caption className="sr-only">
                Teen Patti 20/20 betting markets
              </caption>
              <thead>
                <tr>
                  <td />
                  <th scope="col">PLAYER A</th>
                  <th scope="col">PLAYER B</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">PLAYER</th>
                  <td>{marketButton("playerA")}</td>
                  <td>{marketButton("playerB")}</td>
                </tr>
                <tr>
                  <th scope="row">3 BACCARAT</th>
                  <td>{unavailableMarket("3 Baccarat", "A")}</td>
                  <td>{unavailableMarket("3 Baccarat", "B")}</td>
                </tr>
                <tr>
                  <th scope="row">TOTAL</th>
                  <td>{unavailableMarket("Total", "A")}</td>
                  <td>{unavailableMarket("Total", "B")}</td>
                </tr>
                <tr>
                  <th scope="row">PAIR PLUS</th>
                  <td>{marketButton("pairPlusA")}</td>
                  <td>{marketButton("pairPlusB")}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <span
                      className="tp20-suits tp20-suits-black"
                      aria-label="Spades and clubs"
                    >
                      ♠ ♣
                    </span>
                  </th>
                  <td>{unavailableMarket("Spades and clubs", "A")}</td>
                  <td>{unavailableMarket("Spades and clubs", "B")}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <span
                      className="tp20-suits tp20-suits-red"
                      aria-label="Hearts and diamonds"
                    >
                      ♥ ♦
                    </span>
                  </th>
                  <td>{unavailableMarket("Hearts and diamonds", "A")}</td>
                  <td>{unavailableMarket("Hearts and diamonds", "B")}</td>
                </tr>
              </tbody>
            </table>
            <div className="tp20-result-row">
              <div
                className="tp20-history"
                data-testid="tp2020-history"
                aria-label="Recent winners, oldest to newest"
              >
                {strip.length ? (
                  strip.slice(-10).map((entry) => (
                    <span
                      key={entry.id}
                      data-winner={entry.winner}
                      title={winnerLabel(entry.winner)}
                    >
                      {entry.winner === "playerA"
                        ? "A"
                        : entry.winner === "playerB"
                          ? "B"
                          : "T"}
                    </span>
                  ))
                ) : (
                  <small>No completed rounds yet</small>
                )}
              </div>
            </div>
          </section>
          <aside className="tp20-sidebar" aria-label="Rules and payouts">
            <h2 className="tp20-rules-heading">RULES</h2>
            <table className="tp20-paytable" data-testid="tp2020-paytable">
              <caption>Pair Plus</caption>
              <tbody>
                {(
                  [
                    "pair",
                    "color",
                    "sequence",
                    "pureSequence",
                    "trail",
                  ] as const
                ).map((key) => (
                  <tr key={key}>
                    <td>{CATEGORY_LABELS[key]}</td>
                    <td>{payouts?.pairPlus[key]?.toFixed(2) ?? "—"}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tp20-sidebar-note">
              Returns include your stake. The higher ranked three-card hand
              wins. Pair Plus pays independently. Locked markets are
              unavailable.
            </p>
          </aside>
          <div className="tp2020-extra-controls">
            <div className="tp20-extra-market">
              <span>TIE</span>
              {marketButton("tie")}
              <small>Same ranked hands</small>
            </div>
            <RoundPhaseBanner
              phase={phase}
              remainingMs={remainingMs}
              durationMs={phaseDurationMs}
              settleDurationMs={round.config?.settleDurationMs}
              resultSlot={resultSlot}
            />
            {placedCount > 0 && (
              <div className="tp2020-placed" data-testid="placed-summary">
                <span>{placedCount} slips placed</span>
                <b>₹{formatRupees(placedTotalPaise.toString())}</b>
              </div>
            )}
          </div>
        </div>

        {/* Bottom bet bar (fixed on mobile, inline on desktop) */}
        <div className="game-bottom-bar fixed bottom-0 inset-x-0 z-40 bg-[#0d0718]/95 backdrop-blur border-t border-white/10 safe-pb lg:static lg:bg-transparent lg:border-0">
          <div className="game-shell w-full max-w-7xl mx-auto p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <TableCoinRack
                  preferences={coinPreferences}
                  chip={chip}
                  onSelect={setChip}
                />
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
              <AutoBetStatus
                selected={bets.size > 0}
                busy={placing}
                seconds={bets.size > 0 ? Math.ceil(remainingMs / 1000) : null}
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </div>

      {coinSettingsOpen && (
        <CoinSettingsDialog
          open
          onOpenChange={setCoinSettingsOpen}
          preferences={coinPreferences}
          onSave={coinPreferences.save}
        />
      )}
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
