import { GameInformationSection } from "@/components/game/GameInformation";
import { GameRulesButton } from "@/components/game/GameRules";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet, useChipDraft } from "@/components/table/AutoBet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { t } from "@/game/i18n";
import { useIsLgUp } from "@/hooks/use-mobile";
import { ArrowLeft, Spade, ShieldCheck } from "lucide-react";
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
import ChipRack, { formatChip } from "@/components/table/chips";
import PlayingCard from "@/components/baccarat/PlayingCard";
import {
  BeadPlate,
  BigRoad,
  type RoadEntry,
} from "@/components/baccarat/Roads";
import TeenPattiTable from "@/components/teenpattiLive/TeenPattiTable";
import { useTeenPattiAudio } from "@/components/teenpattiLive/useTeenPattiAudio";
import TableAudioControls from "@/components/teenpattiLive/TableAudioControls";
import "@/components/table/live-bet-dock.css";
import "@/components/teenpattiLive/teen-patti-mobile.css";
import "@/components/teenpattiLive/teen-patti-reference.css";
import {
  TEEN_PATTI_SPOTS,
  categoryLabel,
  type SpotAmounts,
  type TeenPattiDeal,
  type TeenPattiSpot,
} from "@/components/teenpattiLive/types";

type BetType = TeenPattiSpot;

type SpotLabelKey =
  | "tplPairPlusA"
  | "tplPlayerA"
  | "tplTie"
  | "tplPlayerB"
  | "tplPairPlusB";

const SPOT_LABEL_KEYS: Record<BetType, SpotLabelKey> = {
  pairPlusA: "tplPairPlusA",
  playerA: "tplPlayerA",
  tie: "tplTie",
  playerB: "tplPlayerB",
  pairPlusB: "tplPairPlusB",
};

const SPOT_ACCENTS: Record<BetType, string> = {
  pairPlusA:
    "from-amber-600/60 to-amber-950/70 border-amber-400/45 hover:border-amber-300/75",
  playerA:
    "from-sky-700/70 to-sky-950/70 border-sky-400/45 hover:border-sky-300/70",
  tie: "from-emerald-700/70 to-emerald-950/70 border-emerald-400/45 hover:border-emerald-300/70",
  playerB:
    "from-rose-700/70 to-rose-950/70 border-rose-400/45 hover:border-rose-300/70",
  pairPlusB:
    "from-amber-600/60 to-amber-950/70 border-amber-400/45 hover:border-amber-300/75",
};

const SHORT_LABELS: Record<BetType, string> = {
  pairPlusA: "Pair+ A",
  playerA: "Player A",
  tie: "Tie",
  playerB: "Player B",
  pairPlusB: "Pair+ B",
};

/** A slip bet as stored server-side (myBets / liveBets `bets` payload). */
interface SlipBet {
  type: BetType;
  amountPaise: string;
}

interface PairPlusPayouts {
  pair: number;
  color: number;
  sequence: number;
  pureSequence: number;
  trail: number;
}

interface TeenPattiLiveConfig {
  enabled: boolean;
  maxMultiplier: number;
  minStakePaise: string;
  maxStakePaise: string;
  maxBetsPerRound: number;
  decks: number;
  payouts: {
    playerA: number;
    playerB: number;
    tie: number;
    pairPlus: PairPlusPayouts;
  };
}

interface SettledBet {
  type: BetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
  push?: boolean;
}

/** One settled round from the player's own audit feed. */
interface TeenPattiLiveRoundState {
  id: string;
  betId: string;
  handACards: number[];
  handBCards: number[];
  handACategory: string;
  handBCategory: string;
  winner: TeenPattiDeal["winner"];
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

interface VerifyResp extends TeenPattiLiveRoundState {
  computedWinner: TeenPattiDeal["winner"];
  computedHandACategory: string;
  computedHandBCategory: string;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  dealMatch: boolean;
  payoutMatch: boolean;
  verified: boolean;
}

const PAIR_PLUS_ROWS: { key: keyof PairPlusPayouts; label: string }[] = [
  { key: "pair", label: "Pair" },
  { key: "color", label: "Color" },
  { key: "sequence", label: "Sequence" },
  { key: "pureSequence", label: "Pure Sequence" },
  { key: "trail", label: "Trail" },
];

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as
      | { detail?: string; title?: string; error?: { message?: string } }
      | undefined;
    return data?.detail || data?.error?.message || data?.title || fallback;
  }
  const msg = (err as Error)?.message || fallback;
  if (msg === "BETTING_CLOSED") return "Betting is closed for this round.";
  return msg;
}

function describeSlipBets(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return (raw as SlipBet[])
    .map((b) => SHORT_LABELS[b.type] ?? b.type)
    .join(", ");
}

/** Which spots a finished deal pays. */
function winningSpotsOf(deal: TeenPattiDeal): Set<BetType> {
  const out = new Set<BetType>([deal.winner]);
  if (deal.handA.category !== "highCard") out.add("pairPlusA");
  if (deal.handB.category !== "highCard") out.add("pairPlusB");
  return out;
}

export default function TeenPattiLive() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  const lang = useStore((s) => s.settings.language);
  const isLgUp = useIsLgUp();
  const tableAudio = useTeenPattiAudio();

  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  useEffect(() => {
    document.title = "Teen Patti 20-20 Live • Lunar Casino";
    // Warm the recorded chip + card pack so the first tap isn't silent.
    preloadTableAudio();
  }, []);

  const balance = useGetWalletBalance(
    { game: "teen-patti-live" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "teen-patti-live" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  // Live paytable + table limits, straight from the shared teen patti maths.
  const configQuery = useQuery<TeenPattiLiveConfig>({
    queryKey: ["teen-patti-live", "config"],
    queryFn: () =>
      customFetch<TeenPattiLiveConfig>("/api/teen-patti-live/config", {
        method: "GET",
        credentials: "include",
      }),
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
  });
  const payouts = configQuery.data?.payouts;

  const recentQuery = useQuery<TeenPattiLiveRoundState[]>({
    queryKey: ["teen-patti-live", "recent"],
    queryFn: () =>
      customFetch<TeenPattiLiveRoundState[]>(
        "/api/teen-patti-live/recent?limit=10",
        { method: "GET", credentials: "include" },
      ),
    enabled: !!user,
    retry: false,
  });

  const invalidateWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
    void qc.invalidateQueries({ queryKey: ["teen-patti-live", "recent"] });
  }, [qc]);

  // One request per tap, with a synchronous lock against overlapping clicks.
  const placingLockRef = useRef(false);

  const round = useTableRound<TeenPattiDeal>("teen-patti-live", {
    enabled: !!user,
    wholeSecondCountdown: true,
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

  // Follow the live betting deadline, including its final safety cutoff.
  const showBettingControls = bettingOpen && configQuery.data?.enabled === true;

  // ---- the cards on the felt ----------------------------------------------
  // The hands from the last deal stay on the table through the next betting
  // window, exactly like a real table, so the canvas is mounted once instead
  // of being torn down and rebuilt every round.
  const [rest, setRest] = useState<{
    roundId: string;
    deal: TeenPattiDeal;
  } | null>(null);
  const [landedRound, setLandedRound] = useState<string | null>(null);
  const restRef = useRef(rest);
  restRef.current = rest;

  useEffect(() => {
    if (!outcome || !roundId) return;
    setRest((prev) =>
      prev?.roundId === roundId ? prev : { roundId, deal: outcome },
    );
  }, [outcome, roundId]);

  // Opened the table between deals: show the previous round's hands at rest.
  useEffect(() => {
    if (rest || outcome) return;
    const last = recent.find((r) => r.outcome != null);
    if (!last) return;
    setRest({ roundId: last.roundId, deal: last.outcome as TeenPattiDeal });
    setLandedRound(last.roundId);
  }, [rest, outcome, recent]);

  // Deadline the cards must be at rest by. Memoised per phase so a snapshot
  // refetch (which nudges the clock offset) can never restart a live deal.
  const revealEndsAt = useMemo(
    () =>
      phase === "reveal" && phaseEndsAt != null
        ? toLocalTime(phaseEndsAt)
        : null,
    [phase, phaseEndsAt, toLocalTime],
  );

  const onDealSettled = useCallback(() => {
    setLandedRound(restRef.current?.roundId ?? null);
  }, []);

  // Card cues ride the deal itself, so they land on what the player sees.
  const dealAudio = tableAudio.dealAudio;

  const showingDeal = rest != null;
  const landed =
    phase !== "betting" && showingDeal && landedRound === rest.roundId;
  const winningSpots = useMemo(
    () => (landed && rest ? winningSpotsOf(rest.deal) : null),
    [landed, rest],
  );

  // Tapping a spot submits the selected chip immediately. Only accepted slips
  // appear on the felt; keep acknowledgements until snapshots catch up.
  const coinPreferences = useCoinPreferences("teen-patti-live", user?.id);
  const { chip, selectChip: setChip } = coinPreferences;
  const [coinSettingsOpen, setCoinSettingsOpen] = useState(false);
  const [accepted, setAccepted] = useState<{
    roundId: string;
    slips: MyBet[];
  } | null>(null);
  const activeRoundRef = useRef(roundId);
  activeRoundRef.current = roundId;
  useEffect(() => {
    setAccepted((prev) => (prev?.roundId === roundId ? prev : null));
  }, [roundId]);
  const myBets = useMemo(() => {
    const confirmedIds = new Set(serverBets.map((bet) => bet.slipId));
    const acknowledged = accepted?.roundId === roundId ? accepted.slips : [];
    return [
      ...serverBets,
      ...acknowledged.filter((bet) => !confirmedIds.has(bet.slipId)),
    ];
  }, [serverBets, accepted, roundId]);
  const [placing, setPlacing] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<TeenPattiLiveRoundState | null>(
    null,
  );
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);

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
  // Payouts are only knowable once every slip this player holds in the round
  // has settled. Until then a winning bet still reads as zero, so nothing may
  // present a result in money terms.
  const mySlipsSettled =
    myBets.length > 0 && myBets.every((b) => b.status === "settled");

  // The felt shows only wagers accepted for the current round.
  const draft = useChipDraft<BetType>(roundId, showBettingControls && remainingMs > 0 && !placing, balance.data?.balance ?? "0", configQuery.data?.maxStakePaise ?? "0");
  useEffect(() => { if (phase !== "betting") draft.clear(); }, [phase]);
  const feltChips = useMemo<SpotAmounts>(() => {
    const out: SpotAmounts = {};
    for (const b of myBets) {
      if (!Array.isArray(b.bets)) continue;
      for (const raw of b.bets as SlipBet[]) {
        if (!raw || !SHORT_LABELS[raw.type]) continue;
        const rupees = Number(BigInt(raw.amountPaise || "0") / 100n);
        out[raw.type] = (out[raw.type] ?? 0) + rupees;
      }
    }
    for (const bet of draft.bets) out[bet.type] = (out[bet.type] ?? 0) + Number(bet.amountPaise) / 100;
    return out;
  }, [myBets, draft.bets]);

  const spotLabels = useMemo(
    () =>
      TEEN_PATTI_SPOTS.reduce(
        (acc, spot) => {
          acc[spot] = t(lang, SPOT_LABEL_KEYS[spot]);
          return acc;
        },
        {} as Record<TeenPattiSpot, string>,
      ),
    [lang],
  );

  const lastResult = useLastRevealedOutcome(rest?.deal ?? null, rest?.roundId, landedRound, roundId, recent);
  const roundWin = useRoundWin({ game: "teen-patti-live", userId: user?.id, roundId,
    eligible: phase === "settling" && landed && rest?.roundId === roundId, bets: myBets });
  useEffect(() => { if (roundWin.win) setCoinSettingsOpen(false); }, [roundWin.win]);

  // Result audio follows the completed visual and all final server slips.
  const toastedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "settling" || !roundId || !landed || rest?.roundId !== roundId) return;
    if (!myBets.length || myBets.some(b => b.status !== "settled" && b.status !== "refunded")) return;
    if (toastedRef.current === roundId) return;
    toastedRef.current = roundId;
    const net = myPayoutPaise - myBets.filter(b => b.status === "settled").reduce((sum, b) => sum + BigInt(b.totalStake), 0n);
    if (net === 0n) return;
    const won = net > 0n;
    if (sound) {
      if (!won && !myBets.some(b => b.status === "settled" && BigInt(b.payoutAmount) > BigInt(b.totalStake))) sfx.tableLose("teen-patti-live");
      // Same croupier vocabulary the other live tables use.
      if (won) voiceRoundWin("teen-patti-live", roundId);
      else voiceRoundLoss("teen-patti-live", roundId);
    }

  }, [phase, roundId, myBets, myPayoutPaise, sound, rest, landed]);

  const placeChip = (spot: BetType) => {
    unlockAudio();
    if (!draft.stage([{ type: spot, amountPaise: rupeesToPaise(chip) }])) toast.error("Check your balance and table limits");
    else if (sound) sfx.teenPattiChipPlace();
  };
  const submitDraft = async () => {
    if (!user || !showBettingControls || !roundId || placingLockRef.current || !draft.bets.length) return;
    if (phaseEndsAt == null || toLocalTime(phaseEndsAt) - Date.now() <= 300) return;
    placingLockRef.current = true;
    setPlacing(true);
    unlockAudio();
    const payload: SlipBet[] = draft.bets;
    try {
      const placed = await customFetch<{
        slipId: string;
        roundId: string;
        totalStake: string;
      }>("/api/teen-patti-live/bet", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, bets: payload }),
      });
      if (activeRoundRef.current === placed.roundId) {
        setAccepted((prev) => ({
          roundId: placed.roundId,
          slips: [
            ...(prev?.roundId === placed.roundId ? prev.slips : []),
            {
              slipId: placed.slipId,
              totalStake: placed.totalStake,
              bets: payload,
              status: "pending",
              payoutAmount: "0",
              auditRoundId: null,
            },
          ],
        }));
      }
      if (sound) sfx.teenPattiChipPlace();
      toast.success("Bets placed automatically");
    } catch (err) {
      // Never carry a rejected/late tap into a future round or retry a debit.
      toast.error(
        apiMessage(
          err,
          "Could not confirm bet. Check your bets before trying again.",
        ),
      );
    } finally {
      draft.clear();
      invalidateWallet();
      round.refetch();
      placingLockRef.current = false;
      setPlacing(false);
    }
  };

  useTimedBet({
    roundKey: roundId,
    deadline: phaseEndsAt == null ? null : toLocalTime(phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: phaseEndsAt == null ? null : toLocalTime(phaseEndsAt) - 300,
    armed: draft.bets.length > 0, enabled: !!user && showBettingControls && !placing,
    submit: submitDraft,
  });

  const openVerify = async (r: TeenPattiLiveRoundState) => {
    setVerifyOpen(r);
    setVerifyData(null);
    try {
      setVerifyData(
        await customFetch<VerifyResp>(`/api/teen-patti-live/${r.id}/verify`, {
          method: "GET",
          credentials: "include",
        }),
      );
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  // Roads history from the shared clock's recent outcomes (oldest → newest;
  // hook.recent is newest-first). Player A reads as "player", Player B as
  // "banker", so the baccarat road components render unchanged.
  const roadEntries: RoadEntry[] = useMemo(() => {
    return [...recent]
      .reverse()
      .map((r) => {
        const o = r.outcome as TeenPattiDeal | null;
        if (!o) return null;
        return {
          winner:
            o.winner === "playerA"
              ? "player"
              : o.winner === "playerB"
                ? "banker"
                : "tie",
          playerPair: o.handA?.category !== "highCard",
          bankerPair: o.handB?.category !== "highCard",
        } as RoadEntry;
      })
      .filter((e): e is RoadEntry => e !== null);
  }, [recent]);

  if (!user) return null;

  const minStake = configQuery.data
    ? Number(BigInt(configQuery.data.minStakePaise) / 100n)
    : null;
  const maxStake = configQuery.data
    ? Number(BigInt(configQuery.data.maxStakePaise) / 100n)
    : null;

  const spotPayoutLabel = (spot: BetType): string => {
    if (!payouts) return "—";
    if (spot === "pairPlusA" || spot === "pairPlusB")
      return `≤ ${payouts.pairPlus.trail.toFixed(0)}×`;
    return `${payouts[spot].toFixed(2)}×`;
  };


  const resultLine = lastResult ? (
    <span data-testid="text-result-line" className="font-mono uppercase">
      {lastResult.outcome.winner === "tie" ? t(lang, "tplTieResult")
        : t(lang, SPOT_LABEL_KEYS[lastResult.outcome.winner]) + " " + t(lang, "tplWins")}
      {lastResult.outcome.winner !== "tie" && <span className="ml-2 text-white/50">
        · {categoryLabel(lastResult.outcome.winner === "playerB" ? lastResult.outcome.handB.category : lastResult.outcome.handA.category)}
      </span>}
    </span>
  ) : null;

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
    <div className="rounded-xl bg-[#101b18] border border-white/5 p-3 flex flex-col gap-3">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "tplRecentResults")}
      </div>
      {/* The live table's scoreboard: the run of A / B / T, newest last. */}
      <div className="flex gap-1 flex-wrap" data-testid="results-strip">
        {roadEntries.length > 0 ? (
          roadEntries.slice(-24).map((e, i) => (
            <span
              key={i}
              className={cn(
                "w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center",
                e.winner === "player"
                  ? "bg-sky-500 text-black"
                  : e.winner === "banker"
                    ? "bg-rose-500 text-black"
                    : "bg-emerald-400 text-black",
              )}
            >
              {e.winner === "player" ? "A" : e.winner === "banker" ? "B" : "T"}
            </span>
          ))
        ) : (
          <span className="text-xs text-white/40 italic">
            {t(lang, "tplNoRounds")}
          </span>
        )}
      </div>
      <div className="overflow-x-auto scrollbar-none">
        <BigRoad entries={roadEntries} />
      </div>
      <div className="overflow-x-auto scrollbar-none">
        <BeadPlate entries={roadEntries} />
      </div>
    </div>
  );

  const pairPlusPanel = payouts ? (
    <div className="rounded-xl bg-[#101b18] border border-white/5 p-3 flex flex-col gap-1.5">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "tplPairPlusPaytable")}
      </div>
      {PAIR_PLUS_ROWS.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between text-[11px] font-mono"
        >
          <span className="text-white/55">{row.label}</span>
          <span className="text-amber-300 font-bold">
            {payouts.pairPlus[row.key].toFixed(2)}×
          </span>
        </div>
      ))}
    </div>
  ) : null;

  const myBetsPanel = (
    <div className="rounded-xl bg-[#101b18] border border-white/5 p-3 flex flex-col gap-2 max-h-[340px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "tplYourBets")}
      </div>
      {myBets.length > 0 ? (
        myBets.map((b) => {
          const settled = b.status === "settled";
          const win = settled && BigInt(b.payoutAmount || "0") > 0n;
          return (
            <div
              key={b.slipId}
              className={cn(
                "text-left p-2 rounded-md bg-[#162720] flex items-center justify-between gap-2 border border-transparent",
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
          {t(lang, "tplStageHint")}
        </div>
      )}
    </div>
  );

  const myDealsPanel = (
    <div className="rounded-xl bg-[#101b18] border border-white/5 p-3 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        {t(lang, "tplMyDeals")}
      </div>
      {recentQuery.data && recentQuery.data.length > 0 ? (
        recentQuery.data.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void openVerify(r)}
            className="text-left p-2 rounded-md bg-[#162720] hover:bg-[#20382e] flex items-center justify-between gap-2 transition-colors"
            data-testid={`btn-verify-${r.id}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono text-white/70">
                {SHORT_LABELS[r.winner]}
              </span>
              <span className="text-[10px] uppercase text-white/35 truncate">
                {categoryLabel(
                  r.winner === "playerB" ? r.handBCategory : r.handACategory,
                )}
              </span>
            </span>
            <span
              className={cn(
                "text-xs font-mono shrink-0",
                BigInt(r.payoutAmount) > 0n
                  ? "text-emerald-400"
                  : "text-white/40",
              )}
            >
              ₹{formatRupees(r.payoutAmount)}
            </span>
          </button>
        ))
      ) : (
        <div className="text-xs text-white/40 italic">
          {t(lang, "tplNoRounds")}
        </div>
      )}
    </div>
  );

  // The same chip selection and accepted total are available on both layouts.
  const controls = (idSuffix = "") => (
    <>
      <div className="live-bet-status flex items-center justify-between text-[10px] font-bold uppercase text-emerald-200">
        <span>Betting open</span><span className="font-mono tabular-nums">{Math.ceil(remainingMs / 1000)}s</span>
      </div>
      <ChipRack key={coinPreferences.values.join(",") + coinPreferences.showCustom}
        chip={chip}
        onSelect={setChip}
        disabled={!showBettingControls || placing || remainingMs <= 0}
        idSuffix={idSuffix}
        layout="fit"
        className="live-bet-coins"
        values={coinPreferences.values} showCustom={coinPreferences.showCustom}
      />
      <div
        className="live-bet-summary flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2"
        data-testid={`text-placed-summary${idSuffix}`}
      >
        <div className="flex min-w-0 items-center gap-2">
            <CoinSettingsButton onClick={() => setCoinSettingsOpen(true)} />
            <span className="min-w-0 text-[10px] text-emerald-300 font-bold uppercase">
          {t(lang, "tplPlacedThisRound")}
        </span>
          </div>
        <span
          className="shrink-0 text-sm font-black font-mono text-amber-300"
          data-testid={`text-total-staked${idSuffix}`}
        >
          ₹{formatRupees(placedTotalPaise.toString())}
        </span>
      </div>
      <AutoBetStatus selected={draft.bets.length > 0} seconds={draft.bets.length ? Math.ceil(remainingMs / 1000) : null} busy={placing} onCancel={draft.clear} />
      {minStake != null && maxStake != null && (
        <GameInformationSection><div className="live-bet-limits text-[10px] text-white/35 font-mono">
          {t(lang, "tplLimits")} ₹{minStake.toLocaleString("en-IN")} – ₹
          {maxStake.toLocaleString("en-IN")}
        </div></GameInformationSection>
      )}
    </>
  );

  const spotButton = (spot: BetType, compact = false) => {
    const amount = feltChips[spot] ?? 0;
    const won = winningSpots?.has(spot) ?? false;
    const lost = winningSpots != null && !won;
    return (
      <button
        key={spot}
        type="button"
        onClick={() => void placeChip(spot)}
        disabled={!showBettingControls || placing || remainingMs <= 0}
        className={cn(
          "relative rounded-xl border-2 bg-gradient-to-b p-2 flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50 min-w-0",
          compact ? "min-h-14" : "sm:p-3 min-h-[84px]",
          SPOT_ACCENTS[spot],
          won &&
            "ring-2 ring-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.45)] scale-[1.02]",
          lost && "opacity-45",
        )}
        data-game-bet data-testid={`spot-${spot}`}
      >
        <span className="font-black uppercase tracking-wide text-xs sm:text-base leading-tight text-center">
          {t(lang, SPOT_LABEL_KEYS[spot])}
        </span>
        <span className="text-[11px] sm:text-xs font-black text-amber-300 font-mono">
          {spotPayoutLabel(spot)}
        </span>
        {amount > 0 && (
          <span
            className="absolute -top-2 -right-2 min-w-[2rem] h-8 px-1 rounded-full bg-amber-400 border-2 border-dashed border-amber-700 text-black text-[10px] font-black flex items-center justify-center shadow-lg"
            data-testid={`chipstack-${spot}`}
          >
            {amount >= 1000 ? `${amount / 1000}k` : amount}
          </span>
        )}
        {won && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-500 text-black text-[9px] font-black uppercase tracking-wider">
            {t(lang, "tplWins")}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className="game-page tpl-live-page tp20-page min-h-[100dvh] w-full overflow-x-clip bg-[#080e0d] text-white flex justify-center"
      data-betting={phase === "betting"}
      onPointerDownCapture={() => tableAudio.enableAudio()}
      onKeyDownCapture={() => tableAudio.enableAudio()}
    >
      <GameInformationSection>{liveBetsPanel}{recentResultsPanel}{pairPlusPanel}{myBetsPanel}{myDealsPanel}</GameInformationSection>
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <div className="game-shell w-full max-w-[1440px] flex flex-col">
        {/* Top bar */}
        <div className="tpl-page-header sticky top-0 z-40 flex items-center justify-between gap-2 px-3 sm:px-4 py-3 bg-[#080e0d]/95 backdrop-blur-md border-b border-amber-200/10 safe-pt">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <Link href="/" className="shrink-0">
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
              <div className="hidden min-[380px]:flex w-9 h-9 rounded-lg bg-gradient-to-br from-amber-100 to-amber-600 items-center justify-center shrink-0 shadow-[0_0_15px_rgba(217,184,119,0.15)]">
                <Spade className="w-5 h-5 text-[#272010]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  <span className="sm:hidden">Teen Patti</span>
                  <span className="hidden sm:inline">{t(lang, "tplTitle")}</span>
                </h1>
                {isLgUp ? <p className="text-[10px] text-white/40 leading-none truncate">
                  Player A vs Player B · Shared rounds
                </p> : <p className="text-[11px] font-bold text-emerald-400 font-mono leading-tight" aria-label={t(lang, "balance")} data-testid="text-tpl-balance">
                  ₹{formatRupees(balance.data?.balance ?? "0")}
                </p>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {isLgUp && <div className="flex flex-col items-end mr-1">
              <span className="text-[10px] text-white/50 font-medium uppercase">
                {t(lang, "balance")}
              </span>
              <span
                className="text-sm font-bold text-emerald-400 font-mono"
                data-testid="text-tpl-balance"
              >
                ₹{formatRupees(balance.data?.balance ?? "0")}
              </span>
            </div>}
            <TableAudioControls audio={tableAudio} />
            <GameRulesButton gameCode="teen-patti-live" />
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
        </div>

        <div
          className="tpl-game-content flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0"
        >
          {/* Table */}
          <div data-game-screen="teen-patti-live" className="tpl-main-column flex-1 flex flex-col gap-3 min-w-0">
            <LastResultBanner roundId={lastResult?.roundId}>{resultLine}</LastResultBanner>

            <div className="live-game-scene">
            <TeenPattiTable
              deal={phase === "betting" ? null : (rest?.deal ?? null)}
              roundId={phase === "betting" ? roundId : (rest?.roundId ?? null)}
              revealEndsAt={revealEndsAt}
              revealDurationMs={config?.revealDurationMs ?? 9000}
              bettingEndsAt={
                phase === "betting" && phaseEndsAt != null
                  ? toLocalTime(phaseEndsAt) - BET_SEND_BUFFER_MS
                  : null
              }
              bettingDurationMs={config?.bettingWindowMs ?? 20000}
              chips={feltChips}
              audio={dealAudio}
              onSettled={onDealSettled}
              resultEnabled={!roundWin.win && phase !== "betting" && rest?.roundId === roundId}
              spotLabels={spotLabels}
              waitingLabel={t(lang, "tplWaitingDeal")}
            />
            </div>

              <div data-testid="tpl-betting-dock" data-live-bet-dock className="tpl-mobile-dock bg-[#081510] border border-white/10 rounded-xl">
                <div className="live-bet-layout">
                  <div className="live-bet-spots tp20-bet-grid" data-testid="tpl-mobile-bet-spots">
                    <div className="tp20-bet-hand">
                      <h3>Player A</h3>
                      {spotButton("playerA", true)}
                      {spotButton("pairPlusA", true)}
                    </div>
                    <div className="tp20-bet-tie">{spotButton("tie", true)}</div>
                    <div className="tp20-bet-hand tp20-bet-hand--b">
                      <h3>Player B</h3>
                      {spotButton("playerB", true)}
                      {spotButton("pairPlusB", true)}
                    </div>
                  </div>
                  {showBettingControls ? controls(isLgUp ? "" : "-mobile") : <div className="live-bet-status" role="status">{roundId ? "Bets closed · Next round shortly" : "Connecting to table…"}</div>}
                </div>
              </div>
          </div>
          <aside className="tp20-sidebar" aria-label="Table results and rules">
            <h2>Last results</h2>
            <div className="tp20-history" data-testid="tp20-history">
              {roadEntries.length ? roadEntries.slice(-20).map((entry, index) => <span key={index}
                data-winner={entry.winner === "player" ? "playerA" : entry.winner === "banker" ? "playerB" : "tie"}
                title={entry.winner === "player" ? "Player A" : entry.winner === "banker" ? "Player B" : "Tie"}
              >{entry.winner === "player" ? "A" : entry.winner === "banker" ? "B" : "T"}</span>) : <small>No completed rounds yet</small>}
            </div>
            <h2>Rules</h2>
            <table className="tp20-paytable" data-testid="tp20-paytable">
              <caption>Pair Plus</caption>
              <tbody>{PAIR_PLUS_ROWS.map(row => <tr key={row.key}><td>{row.label}</td><td>{payouts ? `${payouts.pairPlus[row.key].toFixed(2)}×` : "—"}</td></tr>)}</tbody>
            </table>
            <p className="tp20-sidebar-note">Returns include your stake. Three cards per hand; the higher ranked hand wins. Pair Plus pays independently.</p>
            <div className="tp20-table-limits"><span>Table limits</span><b>{minStake != null && maxStake != null ? `₹${minStake.toLocaleString("en-IN")} – ₹${maxStake.toLocaleString("en-IN")}` : "—"}</b></div>
            <p className="tp20-sidebar-note">Table clock: Delhi · IST (UTC+05:30)</p>
          </aside>
        </div>

      </div>

      {coinSettingsOpen && <CoinSettingsDialog open onOpenChange={setCoinSettingsOpen}
        preferences={coinPreferences} onSave={coinPreferences.save} />}

      {/* Fairness dialog */}
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#101b18] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              {t(lang, "provablyFair")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Both hands are dealt from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce)
              </span>
              . The table commits the server seed hash before betting closes and
              publishes the full server seed at reveal, so anyone can replay the
              deal. One deal is shared by the whole table.
            </p>
            <div className="rounded-lg bg-[#162720] p-3 space-y-2">
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
                  Server Seed{" "}
                  {serverSeed ? "(revealed)" : "(hidden until reveal)"}
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {serverSeed ?? "Revealed after the deal."}
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
        <DialogContent className="bg-[#101b18] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              {t(lang, "verify")}
            </DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                {(["A", "B"] as const).map((side) => {
                  const cards =
                    side === "A"
                      ? verifyOpen.handACards
                      : verifyOpen.handBCards;
                  const category =
                    side === "A"
                      ? verifyOpen.handACategory
                      : verifyOpen.handBCategory;
                  const isWinner =
                    verifyOpen.winner ===
                    (side === "A" ? "playerA" : "playerB");
                  return (
                    <div key={side} className="flex flex-col gap-1 min-w-0">
                      <div className="flex gap-1">
                        {cards.map((c, i) => (
                          <PlayingCard key={i} card={c} small />
                        ))}
                      </div>
                      <span
                        className={cn(
                          "text-[10px] uppercase font-bold truncate",
                          isWinner ? "text-emerald-300" : "text-white/40",
                        )}
                      >
                        {side === "A" ? "Player A" : "Player B"} ·{" "}
                        {categoryLabel(category)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-white/40 font-bold">
                  {SHORT_LABELS[verifyOpen.winner]}
                </span>
                <span className="font-mono text-sm">
                  ₹{formatRupees(verifyOpen.payoutAmount)} / ₹
                  {formatRupees(verifyOpen.totalStake)}
                </span>
              </div>
              <div className="rounded-lg bg-[#162720] p-3 space-y-1">
                {verifyOpen.bets.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[11px] font-mono"
                  >
                    <span className="text-white/60">
                      {SHORT_LABELS[b.type]}
                    </span>
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
              <div className="rounded-lg bg-[#162720] p-3 space-y-2">
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
                  {verifyData.hashMatch ? "ok" : "bad"} • deal{" "}
                  {verifyData.dealMatch ? "ok" : "bad"} • payout{" "}
                  {verifyData.payoutMatch ? "ok" : "bad"}
                  <div className="text-[10px] text-white/50 mt-1">
                    Recomputed {SHORT_LABELS[verifyData.computedWinner]} ·{" "}
                    {categoryLabel(
                      verifyData.computedWinner === "playerB"
                        ? verifyData.computedHandBCategory
                        : verifyData.computedHandACategory,
                    )}{" "}
                    · payout ₹{formatRupees(verifyData.computedPayout)}
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
