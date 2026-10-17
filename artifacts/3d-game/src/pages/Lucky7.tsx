import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet, useChipDraft } from "@/components/table/AutoBet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sfx, unlockAudio, preloadTableAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted, updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import { t } from "@/game/i18n";
import { useIsLgUp } from "@/hooks/use-mobile";
import {
  ArrowLeft,
  Dice5,
  ShieldCheck,
  RotateCcw,
  Volume2,
  VolumeX,
  LockKeyhole,
  Timer,
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
import { useTableRound, type MyBet } from "@/components/table/useTableRound";
import LastResultBanner, { useLastRevealedOutcome } from "@/components/table/LastResultBanner";
import { CoinSettingsButton, CoinSettingsDialog, useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import ChipRack from "@/components/table/chips";
import DiceTable from "@/components/lucky7/DiceTable";
import { DICE_PRESENTATION_TAIL_MS, DICE_RESULT_HOLD_MS } from "@/components/lucky7/tableDiceMotion";
import "@/components/lucky7/lucky7-scene.css";
import "@/components/table/live-bet-dock.css";
import { DieFace } from "@/components/lucky7/StaticDice";
import type { DiceAudio } from "@/components/lucky7/diceAudio";
import { GameRulesButton } from "@/components/game/GameRules";

type BetType = "under" | "exactly" | "over";

const SPOTS: { type: BetType; labelKey: "lucky7Under" | "lucky7Exactly" | "lucky7Over"; hintKey: "lucky7UnderHint" | "lucky7ExactlyHint" | "lucky7OverHint"; accent: string }[] = [
  {
    type: "under",
    labelKey: "lucky7Under",
    hintKey: "lucky7UnderHint",
    accent: "from-sky-700/70 to-sky-950/70 border-sky-400/45 hover:border-sky-300/70",
  },
  {
    type: "exactly",
    labelKey: "lucky7Exactly",
    hintKey: "lucky7ExactlyHint",
    accent:
      "from-amber-600/70 to-amber-950/70 border-amber-400/50 hover:border-amber-300/80",
  },
  {
    type: "over",
    labelKey: "lucky7Over",
    hintKey: "lucky7OverHint",
    accent:
      "from-rose-700/70 to-rose-950/70 border-rose-400/45 hover:border-rose-300/70",
  },
];

const SHORT_LABELS: Record<BetType, string> = {
  under: "Under 7",
  exactly: "Exactly 7",
  over: "Over 7",
};

/** Typed outcome delivered by the shared round hook on reveal. */
interface Lucky7Roll {
  dice: [number, number];
  total: number;
}

/** A slip bet as stored server-side (myBets / liveBets `bets` payload). */
interface SlipBet {
  type: BetType;
  amountPaise: string;
}

interface Lucky7Config {
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  minStakePaise: string;
  maxStakePaise: string;
  maxBetsPerRound: number;
  combinations: number;
  winningCombinations: Record<BetType, number>;
  /** Server paytable: total returns already include the stake. */
  payouts: Record<BetType, number>;
}

interface SettledBet {
  type: BetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

/** One settled round from the player's own audit feed. */
interface Lucky7RoundState {
  id: string;
  dice: [number, number];
  total: number;
  result: BetType;
  bets: SettledBet[];
  totalStake: string;
  payoutAmount: string;
  multiplier: number;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: string;
}

interface VerifyResp extends Lucky7RoundState {
  computedDice: [number, number];
  computedTotal: number;
  computedResult: BetType;
  computedPayout: string;
  hashMatch: boolean;
  rollMatch: boolean;
  payoutMatch: boolean;
  betsMatch: boolean;
  verified: boolean;
}

/** Which spot a total pays out. */
function resultOf(total: number): BetType {
  return total < 7 ? "under" : total > 7 ? "over" : "exactly";
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
  return (raw as SlipBet[]).map((b) => SHORT_LABELS[b.type] ?? b.type).join(", ");
}

export default function Lucky7() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  const lang = useStore((s) => s.settings.language);
  const isLgUp = useIsLgUp();

  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  useEffect(() => {
    document.title = "Lucky 7 • Lunar Casino";
    // Warm the recorded chip + dice pack so the first tap isn't silent.
    preloadTableAudio("lucky-7");
  }, []);

  const balance = useGetWalletBalance(
    { game: "lucky-7" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lucky-7" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  // The server supplies the fixed paytable and current table limits.
  const configQuery = useQuery<Lucky7Config>({
    queryKey: ["lucky-7", "config"],
    queryFn: () =>
      customFetch<Lucky7Config>("/api/lucky-7/config", {
        method: "GET",
        credentials: "include",
      }),
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
  });
  const payouts = configQuery.data?.payouts;

  const recentQuery = useQuery<Lucky7RoundState[]>({
    queryKey: ["lucky-7", "recent"],
    queryFn: () =>
      customFetch<Lucky7RoundState[]>("/api/lucky-7/recent?limit=10", {
        method: "GET",
        credentials: "include",
      }),
    enabled: !!user,
    retry: false,
  });

  const invalidateWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["lucky-7", "recent"] });
  }, [qc]);

  // Guard rapid clicks synchronously, before React renders the disabled state.
  const placingLockRef = useRef(false);

  const round = useTableRound<Lucky7Roll>("lucky-7", {
    enabled: !!user,
    roundOpenVoice: false,
    onSettled: () => {
      invalidateWallet();
    },
    onResult: () => {
      notifyPlayStarted();
    },
  });

  const {
    phase,
    remainingMs,
    phaseDurationMs,
    phaseEndsAt,
    bettingOpen,
    outcome,
    roundId,
    config,
    liveBets,
    playerCount,
    totalStake,
    myBets: serverBets,
    recent,
    serverSeedHash,
    clientSeed,
    nonce,
    serverSeed,
    toLocalTime,
  } = round;

  // Refresh the server paytable and limits whenever the round snapshot
  // reports different config.
  useEffect(() => {
    if (!config) return;
    void qc.invalidateQueries({ queryKey: ["lucky-7", "config"] });
  }, [config?.houseEdge, config?.maxMultiplier, config, qc]);

  // ---- the dice on the felt -------------------------------------------------
  // The dice from the last roll stay on the table through the next betting
  // window. The independent dealer player stays mounted across every round.
  const [rest, setRest] = useState<{
    roundId: string;
    dice: [number, number];
    total: number;
  } | null>(null);
  const [landedRound, setLandedRound] = useState<string | null>(null);
  const restRef = useRef(rest);
  restRef.current = rest;

  useEffect(() => {
    if (!outcome || !roundId) return;
    setRest((prev) =>
      prev?.roundId === roundId
        ? prev
        : { roundId, dice: outcome.dice, total: outcome.total },
    );
  }, [outcome, roundId]);

  // Opened the table between rolls: show the previous round's faces at rest.
  useEffect(() => {
    if (rest || outcome) return;
    const last = recent.find((r) => r.outcome != null);
    if (!last) return;
    const o = last.outcome as Lucky7Roll;
    setRest({ roundId: last.roundId, dice: o.dice, total: o.total });
    setLandedRound(last.roundId);
  }, [rest, outcome, recent]);

  // Original reveal deadline determines whether a newly observed round may
  // animate. Late joins during settlement show the final faces immediately.
  const settleAt = useMemo(
    () =>
      phase === "reveal" && phaseEndsAt != null ? toLocalTime(phaseEndsAt) : null,
    [phase, phaseEndsAt, toLocalTime],
  );

  // Finish an accepted throw inside the existing settlement window. Wallets
  // settle on server time; result UI below waits for the visible dice to rest.
  const presentationEndsAt = useMemo(() => {
    if (phaseEndsAt == null) return null;
    const settlementMs = config?.settleDurationMs ?? 0;
    const resultHold = Math.min(DICE_RESULT_HOLD_MS, settlementMs);
    if (phase === "reveal" && settleAt != null) {
      return settleAt + Math.min(DICE_PRESENTATION_TAIL_MS, Math.max(0, settlementMs - resultHold));
    }
    return phase === "settling" ? toLocalTime(phaseEndsAt) - resultHold : null;
  }, [phase, phaseEndsAt, config?.settleDurationMs, settleAt, toLocalTime]);

  const onDiceSettled = useCallback(() => {
    setLandedRound(restRef.current?.roundId ?? null);
  }, []);

  // Dice cues ride the throw itself, so they land on what the player sees.
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const diceAudio = useMemo<DiceAudio>(
    () => ({
      onThrow: () => {
        if (soundRef.current) sfx.diceThrow();
      },
      onImpact: (strength) => {
        if (soundRef.current) sfx.diceImpact(strength);
      },
      onSettle: () => {
        if (soundRef.current) sfx.diceSettle();
      },
    }),
    [],
  );

  const showingRoll = rest != null;
  const landed = showingRoll && landedRound === rest.roundId;
  const showingCurrentResult = landed && rest?.roundId === roundId
    && (phase === "reveal" || phase === "settling");
  const winningSpot = showingCurrentResult ? resultOf(rest.total) : null;

  // Spot taps stage chips for this round’s countdown.
  const coinPreferences = useCoinPreferences("lucky-7", user?.id);
  const { chip, selectChip: setChip } = coinPreferences;
  const [coinSettingsOpen, setCoinSettingsOpen] = useState(false);
  const lastBetsRef = useRef<SlipBet[] | null>(null);
  const [acknowledgedBets, setAcknowledgedBets] = useState<(MyBet & { roundId: string })[]>([]);
  const currentRoundRef = useRef(roundId);
  currentRoundRef.current = roundId;
  const [placing, setPlacing] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<Lucky7RoundState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);
  const bettingAvailable = bettingOpen && configQuery.data?.enabled === true;
  const canEditBets = bettingAvailable && remainingMs > 0 && !placing;
  const draft = useChipDraft<BetType>(roundId, canEditBets, balance.data?.balance ?? "0", configQuery.data?.maxStakePaise ?? "0");
  useEffect(() => { if (phase !== "betting") draft.clear(); }, [phase]);
  // Bridge the time between a successful POST and the round snapshot. Only
  // server-acknowledged slips appear; snapshots win when settlement arrives.
  useEffect(() => {
    setAcknowledgedBets(previous => previous.filter(bet => bet.roundId === roundId));
  }, [roundId]);
  const myBets = useMemo(() => {
    const slips = new Map(acknowledgedBets.filter(bet => bet.roundId === roundId).map(bet => [bet.slipId, bet] as const));
    for (const bet of serverBets) slips.set(bet.slipId, { ...bet, roundId: roundId! });
    return [...slips.values()];
  }, [acknowledgedBets, serverBets, roundId]);

  const acceptsBetAction = () => bettingAvailable && !placingLockRef.current
    && phaseEndsAt != null && toLocalTime(phaseEndsAt) - Date.now() > 300;

  const placedBySpot = useMemo(() => {
    const totals = new Map<BetType, bigint>();
    for (const slip of myBets) {
      if (slip.status === "refunded" || !Array.isArray(slip.bets)) continue;
      for (const bet of slip.bets as SlipBet[]) {
        totals.set(bet.type, (totals.get(bet.type) ?? 0n) + BigInt(bet.amountPaise));
      }
    }
    for (const bet of draft.bets) totals.set(bet.type, (totals.get(bet.type) ?? 0n) + BigInt(bet.amountPaise));
    return totals;
  }, [myBets, draft.bets]);

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

  const lastResult = useLastRevealedOutcome(rest, rest?.roundId, landedRound, roundId, recent);
  const roundWin = useRoundWin({ game: "lucky-7", userId: user?.id, roundId,
    eligible: phase === "settling" && landed && rest?.roundId === roundId, bets: myBets });
  useEffect(() => { if (roundWin.win) setCoinSettingsOpen(false); }, [roundWin.win]);

  // Result audio follows the completed visual and all final server slips.
  const toastedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !roundId || !landed || rest?.roundId !== roundId) return;
    if (myBets.some(b => b.status !== "settled" && b.status !== "refunded")) return;
    const settled = myBets.filter((b) => b.status === "settled");
    if (settled.length === 0) return;
    if (toastedRef.current === roundId) return;
    toastedRef.current = roundId;
    const net = myPayoutPaise - settled.reduce((sum, b) => sum + BigInt(b.totalStake), 0n);
    if (net === 0n) return;
    const won = net > 0n;
    if (sound) {
      if (!won && !settled.some(b => BigInt(b.payoutAmount) > BigInt(b.totalStake))) sfx.tableLose("lucky-7");
      if (won) voiceRoundWin("lucky-7", roundId);
      else voiceRoundLoss("lucky-7", roundId);
    }

  }, [phase, roundId, myBets, myPayoutPaise, rest, sound, landed]);

  // The countdown submits one combined slip; rejected drafts never carry forward.
  const placeBets = async (payload: SlipBet[]) => {
    if (!user || placingLockRef.current) return;
    if (!acceptsBetAction()) {
      toast.info(t(lang, "lucky7BettingClosed"));
      round.refetch();
      return;
    }
    placingLockRef.current = true;
    unlockAudio();
    setPlacing(true);
    try {
      const accepted = await customFetch<{ slipId: string; roundId: string; totalStake: string }>("/api/lucky-7/bet", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, bets: payload }),
      });
      lastBetsRef.current = payload;
      if (accepted.roundId === currentRoundRef.current) {
        setAcknowledgedBets(previous => [...previous, {
          ...accepted, bets: payload, status: "pending", payoutAmount: "0", auditRoundId: null,
        }]);
      }
      if (sound) sfx.chipStackPush();
      invalidateWallet();
      round.refetch();
      toast.success(t(lang, "lucky7BetPlaced"));
    } catch (err) {
      const msg = apiMessage(err, "Could not place bets");
      if (/betting is closed|BETTING_CLOSED/i.test(msg)) {
        round.refetch();
        toast.info(t(lang, "lucky7BettingClosed"));
      } else {
        toast.error(msg);
      }
    } finally {
      draft.clear();
      placingLockRef.current = false;
      setPlacing(false);
    }
  };

  useTimedBet({
    roundKey: roundId,
    deadline: phaseEndsAt == null ? null : toLocalTime(phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: phaseEndsAt == null ? null : toLocalTime(phaseEndsAt) - 300,
    armed: draft.bets.length > 0, enabled: !!user && bettingAvailable && !placing,
    submit: () => placeBets(draft.bets),
  });
  const stageBets = (bets: SlipBet[], replace = false) => {
    unlockAudio();
    if (!draft.stage(bets, replace)) toast.error("Check your balance and table limits");
    else if (sound) sfx.chipPlace();
  };

  const openVerify = async (r: Lucky7RoundState) => {
    setVerifyOpen(r);
    setVerifyData(null);
    try {
      setVerifyData(
        await customFetch<VerifyResp>(`/api/lucky-7/${r.id}/verify`, {
          method: "GET",
          credentials: "include",
        }),
      );
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  if (!user) return null;

  const minStake = configQuery.data
    ? Number(BigInt(configQuery.data.minStakePaise) / 100n)
    : null;
  const maxStake = configQuery.data
    ? Number(BigInt(configQuery.data.maxStakePaise) / 100n)
    : null;


  const resultLine = lastResult ? (
    <span data-testid="text-result-line" className="font-mono uppercase">
      {t(lang, SPOTS.find(s => s.type === resultOf(lastResult.outcome.total))!.labelKey)} · {lastResult.outcome.total}
      <span className="ml-2 text-white/50">({lastResult.outcome.dice[0]} + {lastResult.outcome.dice[1]})</span>
    </span>
  ) : null;

  const bettingStatus = configQuery.isError ? "unavailable"
    : configQuery.data?.enabled === false ? "paused"
    : phase == null || !payouts ? "loading"
    : bettingAvailable ? "open" : "closed";
  const bettingStatusLabel = t(lang, bettingStatus === "open" ? "lucky7BettingOpen"
    : bettingStatus === "loading" ? "lucky7LoadingTable"
    : bettingStatus === "unavailable" ? "lucky7TableUnavailable"
    : bettingStatus === "paused" ? "lucky7TablePaused" : "lucky7BettingClosed");
  const instantBetHint = "Select a coin and a side. Bets submit when the timer ends.";

  // ---- panels --------------------------------------------------------------
  const liveBetsPanel = (
    <LiveBetsPanel
      bets={liveBets}
      playerCount={playerCount}
      totalStake={totalStake}
      describeBets={describeSlipBets}
    />
  );

  const recentResultsPanel = (
    <div className="rounded-xl bg-[#0c1f18] border border-white/5 p-3 flex flex-col gap-2">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "lucky7RecentResults")}
      </div>
      <div className="flex gap-1 flex-wrap" data-testid="results-strip">
        {recent.length > 0 ? (
          recent.slice(0, 24).map((r) => {
            const o = r.outcome as Lucky7Roll | null;
            if (!o) return null;
            const res = resultOf(o.total);
            return (
              <span
                key={r.roundId}
                title={`${o.dice[0]} + ${o.dice[1]}`}
                className={cn(
                  "w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center",
                  res === "under"
                    ? "bg-sky-500 text-black"
                    : res === "over"
                      ? "bg-rose-500 text-black"
                      : "bg-amber-400 text-black",
                )}
              >
                {o.total}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-white/40 italic">
            {t(lang, "lucky7NoRounds")}
          </span>
        )}
      </div>
    </div>
  );

  const myBetsPanel = (
    <div className="rounded-xl bg-[#0c1f18] border border-white/5 p-3 flex flex-col gap-2 max-h-[340px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "lucky7YourBets")}
      </div>
      {myBets.length > 0 ? (
        myBets.map((b) => {
          const settled = b.status === "settled";
          const win = settled && BigInt(b.payoutAmount || "0") > 0n;
          return (
            <div
              key={b.slipId}
              className={cn(
                "text-left p-2 rounded-md bg-[#123024] flex items-center justify-between gap-2 border border-transparent",
                settled &&
                  "animate-in fade-in zoom-in-95 duration-500 " +
                    (win
                      ? "border-emerald-400/50 shadow-[0_0_18px_rgba(52,211,153,0.25)]"
                      : "border-rose-500/30"),
              )}
              data-testid={`myslip-${b.slipId}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  className={cn(
                    "text-[10px] font-mono text-white shrink-0",
                    settled
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
                  win ? "text-emerald-400 font-black" : "text-white/50",
                )}
              >
                ₹{formatRupees(b.payoutAmount)}
              </span>
            </div>
          );
        })
      ) : (
        <div className="text-xs text-white/40 italic">
          {t(lang, "lucky7StageHint")}
        </div>
      )}
    </div>
  );

  const myRollsPanel = (
    <div className="rounded-xl bg-[#0c1f18] border border-white/5 p-3 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "lucky7MyRolls")}
      </div>
      {recentQuery.data && recentQuery.data.length > 0 ? (
        recentQuery.data.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void openVerify(r)}
            className="text-left p-2 rounded-md bg-[#123024] hover:bg-[#17402f] flex items-center justify-between gap-2 transition-colors"
            data-testid={`btn-verify-${r.id}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono text-white/70">
                {r.dice[0]} + {r.dice[1]} = <b className="text-white">{r.total}</b>
              </span>
              <span className="text-[10px] uppercase text-white/35 truncate">
                {SHORT_LABELS[r.result]}
              </span>
            </span>
            <span
              className={cn(
                "text-xs font-mono shrink-0",
                BigInt(r.payoutAmount) > 0n ? "text-emerald-400" : "text-white/40",
              )}
            >
              ₹{formatRupees(r.payoutAmount)}
            </span>
          </button>
        ))
      ) : (
        <div className="text-xs text-white/40 italic">
          {t(lang, "lucky7NoRounds")}
        </div>
      )}
    </div>
  );

  // Coins and actions share one panel with the three betting spots.
  const controls = (idSuffix = "") => (
    <>
        <fieldset className="live-bet-coins min-w-0 w-full" disabled={!canEditBets}>
          <ChipRack key={coinPreferences.values.join(",") + coinPreferences.showCustom} chip={chip} onSelect={value => { if (acceptsBetAction()) setChip(value); }}
            disabled={!canEditBets} idSuffix={idSuffix} layout="fit" values={coinPreferences.values} showCustom={coinPreferences.showCustom} />
        </fieldset>
      <div className="live-bet-summary flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2"
        data-testid={`text-placed-summary${idSuffix}`}>
          <div className="flex min-w-0 items-center gap-2">
            <CoinSettingsButton onClick={() => setCoinSettingsOpen(true)} />
            <span className="min-w-0 text-[10px] uppercase text-emerald-300 font-bold">
            {t(lang, "lucky7PlacedThisRound")}
          </span>
          </div>
          <span
            className="shrink-0 text-sm font-black font-mono text-amber-300"
            data-testid={`text-total-staked${idSuffix}`}
          >
            ₹{formatRupees(placedTotalPaise.toString())}
          </span>
      </div>

      <div className="live-bet-actions lucky7-bet-actions flex items-center gap-2 py-1">
        <AutoBetStatus selected={draft.bets.length > 0} seconds={draft.bets.length ? Math.ceil(remainingMs / 1000) : null} busy={placing} onCancel={draft.clear} className="flex-1" />
        <Button
          type="button"
          variant="outline"
          onClick={() => { if (lastBetsRef.current) stageBets(lastBetsRef.current, true); }}
          disabled={!canEditBets || !lastBetsRef.current}
          className="touch-target h-11 shrink-0 px-2 sm:px-3 text-xs bg-[#123024] border-white/10 hover:bg-[#17402f]"
          data-testid={`btn-rebet${idSuffix}`}
          aria-label={t(lang, "lucky7RepeatLast")}
          aria-description={instantBetHint}
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {t(lang, "lucky7RepeatLast")}
        </Button>
      </div>

      <GameInformationSection><p id="lucky7-instant-hint" role="status" className="live-bet-hint text-xs text-emerald-200" data-testid="lucky7-instant-hint">
        {placing ? t(lang, "lucky7Placing") : bettingAvailable ? instantBetHint : bettingStatusLabel}
      </p></GameInformationSection>

      {minStake != null && maxStake != null && (
        <GameInformationSection><div className="live-bet-limits text-[10px] text-white/35 font-mono">
          {t(lang, "lucky7Limits")} ₹{minStake.toLocaleString("en-IN")} – ₹
          {maxStake.toLocaleString("en-IN")}
        </div></GameInformationSection>
      )}
    </>
  );

  return (
    <div data-ui-version="cinema-dealer-24" className="game-page lucky7-game min-h-[100dvh] w-full bg-[#07130e] text-white flex justify-center">
      <GameInformationSection>{liveBetsPanel}{recentResultsPanel}{myBetsPanel}{myRollsPanel}</GameInformationSection>
      <div className="game-shell w-full max-w-7xl flex flex-col">
        {/* Top bar */}
        <div className="lucky7-header flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[#07130e] border-b border-white/5 safe-pt">
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
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-emerald-600 to-amber-400 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(52,211,153,0.35)]">
                <Dice5 className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  {t(lang, "lucky7Title")}
                </h1>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white h-10 w-10 rounded-full"
              aria-label={t(lang, "sound")}
              aria-pressed={sound}
              title={sound ? "Mute sound" : "Enable sound"}
              onClick={() => { unlockAudio(); updateSettings({ sound: !sound }); }}
              data-testid="btn-lucky7-sound"
            >
              {sound ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>
            <GameRulesButton gameCode="lucky-7" />
            <GameInformationSection><Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white h-10 w-10 rounded-full"
              aria-label={t(lang, "provablyFair")}
              onClick={() => setFairnessOpen(true)}
              data-testid="btn-fairness"
            >
              <ShieldCheck className="w-5 h-5" />
            </Button></GameInformationSection>
          </div>
          <div className="lucky7-header-details">
            <p>{t(lang, "lucky7Tagline")}</p>
            <div className="lucky7-wallet"><span>{t(lang, "balance")}</span>
              <strong data-testid="text-lucky7-balance">₹{formatRupees(balance.data?.balance ?? "0")}</strong>
            </div>
          </div>
        </div>

        <div
          className="lucky7-main flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0"
        >
          {/* Table */}
          <div data-game-screen="lucky-7" className="lucky7-table-column flex-1 flex flex-col gap-3 min-w-0">
            <LastResultBanner roundId={lastResult?.roundId}>{resultLine}</LastResultBanner>

            <div className="live-game-scene">
            <DiceTable
              dice={rest?.dice ?? null}
              roundId={rest?.roundId ?? null}
              settleAt={rest?.roundId === roundId ? settleAt : null}
              presentationEndsAt={rest?.roundId === roundId ? presentationEndsAt : null}
              audio={diceAudio}
              onSettled={onDiceSettled}
            />
            </div>

            <GameInformationSection><p className="text-center text-xs text-white/60" data-testid="lucky7-payout-rules">
              {t(lang, "lucky7PayoutRules")}
            </p></GameInformationSection>

            {/* Normal flow keeps every betting control reachable without overlays. */}
            <div
              data-testid="lucky7-betting-dock"
              data-betting-state={bettingStatus}
              className="lucky7-betting-dock relative min-w-0"
            >
              <div className="min-w-0">
                <div
                  data-testid="lucky7-betting-panel"
                  data-live-bet-dock
                  className="rounded-xl border border-white/10 bg-[#0c1f18] safe-pb"
                >
                  <div className="live-bet-layout px-3 py-3 sm:p-4 flex flex-col gap-3">
                    <div className="live-bet-status flex h-5 items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide">
                      <span role="status" data-testid="lucky7-betting-status"
                        className={cn("flex min-w-0 items-center gap-1.5", bettingAvailable ? "text-emerald-300" : "text-white/75")}>
                        {bettingAvailable ? <Timer className="h-3.5 w-3.5 shrink-0" /> : <LockKeyhole className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate">{bettingStatusLabel}</span>
                      </span>
                      {bettingAvailable && <span className="shrink-0 font-mono tabular-nums text-emerald-300" aria-hidden="true">
                        {Math.ceil(remainingMs / 1000)}s
                      </span>}
                    </div>
                    <div className="live-bet-spots grid grid-cols-3 gap-2">
                      {SPOTS.map((spot) => {
                        const amountPaise = placedBySpot.get(spot.type) ?? 0n;
                        const won = winningSpot === spot.type;
                        const lost = winningSpot != null && !won;
                        const pays = payouts?.[spot.type];
                        return (
                          <button
                            key={spot.type}
                            type="button"
                            onClick={() => stageBets([{ type: spot.type, amountPaise: rupeesToPaise(chip) }])}
                            disabled={!canEditBets}
                            aria-describedby="lucky7-instant-hint"
                            data-winner={won || undefined}
                            className={cn(
                              "relative rounded-xl border-2 bg-gradient-to-b p-2 sm:p-4 min-h-[80px] flex flex-col items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                              spot.accent,
                              canEditBets && amountPaise > 0n && "ring-2 ring-white/60 border-white/80",
                              won &&
                                "ring-2 ring-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.45)]",
                              lost && "opacity-70",
                            )}
                            data-game-bet data-testid={`spot-${spot.type}`}
                          >
                            <span className="font-black uppercase tracking-wide text-sm sm:text-lg leading-tight text-center">
                              {t(lang, spot.labelKey)}
                            </span>
                            <span className="text-[10px] text-white/55 font-mono">
                              {t(lang, spot.hintKey)}
                            </span>
                            <span className="text-[11px] sm:text-xs font-black text-amber-300 font-mono">
                              {pays ? `${pays.toFixed(2)}×` : "—"}
                            </span>
                            {amountPaise > 0n && (
                              <span
                                className="absolute -top-2 -right-2 min-w-[2rem] h-8 px-1 rounded-full bg-amber-400 border-2 border-dashed border-amber-700 text-black text-[10px] font-black flex items-center justify-center shadow-lg"
                                data-testid={`chipstack-${spot.type}`}
                              >
                                {formatRupees(amountPaise.toString())}
                              </span>
                            )}
                            {won && (
                              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-500 text-black text-[9px] font-black uppercase tracking-wider">
                                {t(lang, "lucky7Wins")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {controls(isLgUp ? "" : "-mobile")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <CoinSettingsDialog open={coinSettingsOpen} onOpenChange={setCoinSettingsOpen}
        preferences={coinPreferences} onSave={coinPreferences.save} />
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />

      {/* Fairness dialog */}
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#0a1c14] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              {t(lang, "provablyFair")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Both dice are rolled from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce)
              </span>
              . The table commits the server seed hash before betting closes and
              publishes the full server seed at reveal, so anyone can replay the
              roll. One roll is shared by the whole table.
            </p>
            <div className="rounded-lg bg-[#123024] p-3 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  {t(lang, "serverSeedHash")}
                </div>
                <div className="text-[10px] font-mono text-amber-200 break-all">
                  {serverSeedHash ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  {t(lang, "clientSeed")}
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {clientSeed ?? "—"}
                </div>
              </div>
              <div className="text-[10px] text-white/50">
                {t(lang, "nonce")}:{" "}
                <span className="font-mono">{nonce ?? "—"}</span>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold mt-2">
                  Server Seed {serverSeed ? "(revealed)" : "(hidden until reveal)"}
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {serverSeed ?? "Revealed after the roll."}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify dialog (historical rounds) */}
      <Dialog
        open={verifyOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVerifyOpen(null);
            setVerifyData(null);
          }
        }}
      >
        <DialogContent className="bg-[#0a1c14] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              {t(lang, "verify")}
            </DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <DieFace value={verifyOpen.dice[0]} className="w-10 h-10" />
                <DieFace value={verifyOpen.dice[1]} className="w-10 h-10" />
                <div className="min-w-0">
                  <div className="text-lg font-black font-mono">
                    {verifyOpen.total}
                  </div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">
                    {SHORT_LABELS[verifyOpen.result]}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] uppercase text-white/40 font-bold">
                    {t(lang, "payout")}
                  </div>
                  <div className="font-mono text-sm">
                    ₹{formatRupees(verifyOpen.payoutAmount)} / ₹
                    {formatRupees(verifyOpen.totalStake)}
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-[#123024] p-3 space-y-1">
                {verifyOpen.bets.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[11px] font-mono"
                  >
                    <span className="text-white/60">{SHORT_LABELS[b.type]}</span>
                    <span
                      className={cn(
                        b.didWin ? "text-emerald-400" : "text-white/40",
                      )}
                    >
                      ₹{formatRupees(b.amountPaise)} → ₹
                      {formatRupees(b.payoutPaise)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-[#123024] p-3 space-y-2">
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  {t(lang, "serverSeedHash")}
                </div>
                <div className="text-[10px] font-mono text-amber-200 break-all">
                  {verifyOpen.serverSeedHash}
                </div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {verifyOpen.serverSeed ?? "Not revealed yet."}
                </div>
                <div className="text-[10px] text-white/50 font-mono">
                  {verifyOpen.clientSeed} / {verifyOpen.nonce}
                </div>
              </div>
              {verifyData ? (
                <div
                  className={cn(
                    "rounded-lg p-3 text-xs font-mono",
                    verifyData.verified
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/10 text-rose-300 border border-rose-500/30",
                  )}
                  data-testid="text-verify-result"
                >
                  {verifyData.verified ? "✔ Verified" : "✘ Mismatch"} — hash{" "}
                  {verifyData.hashMatch ? "ok" : "bad"} • roll{" "}
                  {verifyData.rollMatch ? "ok" : "bad"} • payout{" "}
                  {verifyData.payoutMatch ? "ok" : "bad"}
                  <div className="text-[10px] text-white/50 mt-1">
                    Recomputed {verifyData.computedDice[0]} +{" "}
                    {verifyData.computedDice[1]} = {verifyData.computedTotal} ·
                    payout ₹{formatRupees(verifyData.computedPayout)}
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
