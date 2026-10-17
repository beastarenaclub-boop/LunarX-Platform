import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet } from "@/components/table/AutoBet";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sfx, unlockAudio, preloadTableAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import { ArrowLeft, ShieldCheck, Spade } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { GameRulesButton } from "@/components/game/GameRules";

interface BjHand {
  cards: number[];
  total: number;
  soft: boolean;
  busted: boolean;
  stood: boolean;
  doubled: boolean;
  fromSplit: boolean;
}

interface BjResults {
  hands: { outcome: string; stakePaise: string; payoutPaise: string }[];
  dealerBlackjack: boolean;
  insurance: {
    taken: boolean;
    won: boolean;
    stakePaise: string;
    payoutPaise: string;
  } | null;
}

interface BjState {
  id: string;
  status: "insurance" | "active" | "settled";
  hands: BjHand[];
  activeHand: number;
  dealerCards: (number | null)[];
  dealerTotal: number | null;
  stakeAmount: string;
  totalStake: string;
  payoutAmount: string;
  insurance: string | null;
  allowedActions: ("hit" | "stand" | "double" | "split" | "insurance")[];
  results: BjResults | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: string;
  settledAt: string | null;
}

interface SeedInfo {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
}

/** Blackjack shared outcome is minimal — dealer cards live in /active. */
interface BjOutcome {
  dealt?: boolean;
}


function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  return (err as Error)?.message || fallback;
}

function CardBack() {
  return (
    <div
      className="shrink-0 w-14 h-20 sm:w-16 sm:h-24 rounded-lg border border-indigo-400/40 bg-gradient-to-br from-indigo-900 to-purple-950 shadow-md flex items-center justify-center"
      data-testid="card-back"
    >
      <Spade className="w-5 h-5 text-indigo-300/60" />
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  blackjack: "Blackjack!",
  win: "Win",
  push: "Push",
  lose: "Lose",
};

function describeBlackjackBets(bets: unknown): string {
  if (Array.isArray(bets) && bets.length > 0) {
    const b = bets[0] as { amountPaise?: string };
    if (b?.amountPaise) return `Stake ₹${formatRupees(b.amountPaise)}`;
  }
  return "Blackjack hand";
}

export default function Blackjack() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);

  const balance = useGetWalletBalance(
    { game: "blackjack" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "blackjack" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const invalidateWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["blackjack.recent"] });
  }, [qc]);

  const round = useTableRound<BjOutcome>("blackjack", {
    onSettled: () => {
      invalidateWallet();
      // The shared round settled → the server may have auto-stood our hand.
      void fetchActive({ silent: true });
    },
    onResult: () => {
      // Cards are dealt at reveal — play the deal cue and pull our private hand.
      if (sound) sfx.cardDeal();
      void fetchActive({ retry: true });
    },
    onBettingOpen: () => {
      // Fresh round: return to the bet form.
      setHand(null);
      setDealt(false);
      setAutoStood(false);
    },
  });

  const coinPreferences = useCoinPreferences("blackjack", user?.id);
  // Keep the editable amount field independent of denomination filtering.
  const [stakeRupees, setStakeRupees] = useState<number>(coinPreferences.chip);
  const [hand, setHand] = useState<BjState | null>(null);
  const roundWin = useRoundWin({ game: "blackjack", userId: user?.id, roundId: hand?.id ?? null,
    eligible: hand?.status === "settled", bets: hand ? [hand] : [] });
  const [dealt, setDealt] = useState(false);
  const [autoStood, setAutoStood] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<BjState | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [clientSeedDraft, setClientSeedDraft] = useState("");

  useEffect(() => {
    document.title = "Blackjack • Lunar Casino";
    // Warm the recorded chip pack so the first bet of a session isn't silent.
    preloadTableAudio();
  }, []);

  const seed = useQuery<SeedInfo>({
    queryKey: ["blackjack.seed"],
    queryFn: () =>
      customFetch<SeedInfo>("/api/blackjack/seed", { method: "GET" }),
    enabled: !!user && fairnessOpen,
  });

  const recent = useQuery<BjState[]>({
    queryKey: ["blackjack.recent"],
    queryFn: () =>
      customFetch<BjState[]>("/api/blackjack/recent?limit=10", {
        method: "GET",
      }),
    enabled: !!user,
    retry: false,
    staleTime: 10_000,
  });

  // --- /active fetching (private hand state) ------------------------------
  const fetchLockRef = useRef(false);
  const fetchActive = useCallback(
    async (opts: { retry?: boolean; silent?: boolean } = {}) => {
      if (!user) return null;
      const attempts = opts.retry ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          const out = await customFetch<BjState | null>(
            "/api/blackjack/active",
            { method: "GET", credentials: "include" },
          );
          if (out) {
            setHand(out);
            setDealt(true);
            return out;
          }
        } catch {
          // ignore; will retry / stay on bet form
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 700));
      }
      return null;
    },
    [user],
  );

  // Hydrate any in-flight hand on mount / when the user loads.
  useEffect(() => {
    if (!user) return;
    void fetchActive({ silent: true });
  }, [user, fetchActive]);

  // Safety-net poll while our hand is live so auto-stand/settlement surfaces
  // even without interaction.
  useEffect(() => {
    if (!hand) return;
    if (hand.status === "settled") return;
    const id = window.setInterval(() => {
      if (fetchLockRef.current) return;
      fetchLockRef.current = true;
      void fetchActive({ silent: true }).finally(() => {
        fetchLockRef.current = false;
      });
    }, 3_000);
    return () => window.clearInterval(id);
  }, [hand, fetchActive]);

  // React to settled state: toast + wallet invalidation (once per hand).
  const settledToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hand || hand.status !== "settled") return;
    if (settledToastRef.current === hand.id) return;
    settledToastRef.current = hand.id;
    invalidateWallet();
    const paid = Number(hand.payoutAmount);
    const staked = Number(hand.totalStake);
    if (sound) {
      if (paid === 0) sfx.tableLose("blackjack");
      if (paid > staked) voiceRoundWin("blackjack", hand.id);
      else if (paid === 0) voiceRoundLoss("blackjack", hand.id);
    }
    if (paid > staked) {
      toast.success(`Won ₹${formatRupees(hand.payoutAmount)}`);
    } else if (paid === staked) {
      toast.info("Draw — 85% of stake returned");
    } else if (paid > 0) {
      toast.info(`Returned ₹${formatRupees(hand.payoutAmount)}`);
    } else {
      toast.error("Dealer wins this one");
    }
  }, [hand, invalidateWallet, sound]);

  const post = async (path: string, body?: unknown) => {
    return customFetch<BjState>(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  // Did we already place a slip this round?
  const placed = round.myBets.length > 0 || dealt;
  const placedTotal = round.myBets.reduce(
    (a, b) => a + Number(b.totalStake),
    0,
  );

  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const selectStake = (value: number) => {
    if (!round.bettingOpen || round.remainingMs <= 0 || placed || busy) return;
    unlockAudio();
    setStakeRupees(value);
    setSelectedRound(value > 0 ? round.roundId : null);
  };
  useTimedBet({
    roundKey: round.roundId,
    deadline: round.phaseEndsAt == null ? null : round.toLocalTime(round.phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: round.phaseEndsAt == null ? null : round.toLocalTime(round.phaseEndsAt) - 300,
    armed: selectedRound != null && selectedRound === round.roundId,
    enabled: !!user && round.bettingOpen && !busy && !placed,
    submit: () => { setSelectedRound(null); return dealHand(); },
  });
  const dealHand = async () => {
    if (!user) return;
    if (!round.bettingOpen) {
      toast.error("Betting is closed — wait for the next round");
      return;
    }
    if (stakeRupees <= 0) {
      toast.error("Enter a stake amount");
      return;
    }
    unlockAudio();
    if (sound) sfx.chipPlace();
    setBusy("deal");
    try {
      await customFetch("/api/blackjack/deal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId, stakeAmount: String(rupeesToPaise(stakeRupees)) }),
      });
      notifyPlayStarted();
      invalidateWallet();
      round.refetch();
      toast.success("Hand placed — cards at reveal");
    } catch (err) {
      toast.error(apiMessage(err, "Failed to place hand"));
    } finally {
      setBusy(null);
    }
  };

  const doAction = async (action: "hit" | "stand" | "double" | "split") => {
    if (!hand) return;
    if (sound) sfx.click();
    setBusy(action);
    try {
      const out = await post(`/api/blackjack/${hand.id}/${action}`);
      setHand(out);
      if (action === "double" || action === "split") invalidateWallet();
    } catch (err) {
      toast.error(apiMessage(err, "Action failed"));
      // Action may have failed because the round already settled/auto-stood.
      const refreshed = await fetchActive({ silent: true });
      if (refreshed && refreshed.status === "settled") setAutoStood(true);
    } finally {
      setBusy(null);
    }
  };

  const doInsurance = async (take: boolean) => {
    if (!hand) return;
    if (sound) sfx.click();
    setBusy("insurance");
    try {
      const out = await post(`/api/blackjack/${hand.id}/insurance`, { take });
      setHand(out);
      if (take) invalidateWallet();
    } catch (err) {
      toast.error(apiMessage(err, "Insurance failed"));
    } finally {
      setBusy(null);
    }
  };

  const rotateSeed = async () => {
    try {
      await customFetch("/api/blackjack/seed/rotate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clientSeedDraft.trim() ? { clientSeed: clientSeedDraft.trim() } : {},
        ),
      });
      toast.success("Seed rotated — previous server seed revealed");
      setClientSeedDraft("");
      void seed.refetch();
      void qc.invalidateQueries({ queryKey: ["blackjack.recent"] });
    } catch (err) {
      toast.error(apiMessage(err, "Rotate failed"));
    }
  };

  const openVerify = async (r: BjState) => {
    setVerifyOpen(r);
    setVerifyResult(null);
    try {
      const out = await customFetch<Record<string, unknown>>(
        `/api/blackjack/${r.id}/verify`,
        { method: "GET", credentials: "include" },
      );
      setVerifyResult(out);
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  if (!user) return null;

  const phase = round.phase;
  const isSettled = hand?.status === "settled";
  const acting = busy !== null;
  const allowed = new Set(hand?.allowedActions ?? []);
  const showInsurancePrompt =
    hand?.status === "insurance" && hand.insurance === "offered";
  const canAct = !!hand && hand.status !== "settled";

  const netResult =
    hand && isSettled
      ? Number(hand.payoutAmount) - Number(hand.totalStake)
      : 0;

  // Action countdown: time until the shared round's settle deadline.
  // During reveal, we still have the whole settling window ahead of us.
  const actionRemainingMs =
    phase === "reveal"
      ? round.remainingMs + (round.config?.settleDurationMs ?? 0)
      : phase === "settling"
        ? round.remainingMs
        : 0;
  const actionTotalMs =
    (round.config?.revealDurationMs ?? 0) +
    (round.config?.settleDurationMs ?? 0);
  const actionSecs = Math.ceil(actionRemainingMs / 1000);
  const actionPct =
    actionTotalMs > 0
      ? Math.max(0, Math.min(100, (actionRemainingMs / actionTotalMs) * 100))
      : 0;
  const actionUrgent = actionSecs <= 5;

  // Fairness commit/reveal comes from the shared round.
  const commitHash = round.serverSeedHash ?? hand?.serverSeedHash ?? "…";
  const revealedSeed = round.serverSeed ?? hand?.serverSeed ?? null;

  // Bet form is shown while we haven't placed / cards not yet dealt.
  const showBetForm = !placed || (!dealt && !hand);
  const dealDisabled = acting || !round.bettingOpen || placed;

  const dealLabel = (() => {
    if (busy === "deal") return "Placing…";
    if (placed) return "Hand placed";
    if (round.bettingOpen) return "Deal";
    if (phase === "betting") return "Opening…";
    return actionSecs > 0 ? `Next round in ${actionSecs}s` : "Betting closed";
  })();

  const actionButtons = (
    <>
      <Button
        className="h-12 font-black uppercase bg-emerald-500 hover:bg-emerald-400 text-black touch-target"
        disabled={acting || !allowed.has("hit")}
        onClick={() => doAction("hit")}
        data-testid="btn-hit"
      >
        Hit
      </Button>
      <Button
        className="h-12 font-black uppercase bg-rose-500 hover:bg-rose-400 text-black touch-target"
        disabled={acting || !allowed.has("stand")}
        onClick={() => doAction("stand")}
        data-testid="btn-stand"
      >
        Stand
      </Button>
      <Button
        className="h-12 font-black uppercase bg-amber-500 hover:bg-amber-400 text-black touch-target"
        disabled={acting || !allowed.has("double")}
        onClick={() => doAction("double")}
        data-testid="btn-double"
      >
        Double
      </Button>
      <Button
        className="h-12 font-black uppercase bg-indigo-500 hover:bg-indigo-400 text-black touch-target"
        disabled={acting || !allowed.has("split")}
        onClick={() => doAction("split")}
        data-testid="btn-split"
      >
        Split
      </Button>
    </>
  );

  const betControls = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col min-[420px]:flex-row min-[420px]:items-center gap-2">
        <Input
          type="number"
          min={1}
          inputMode="decimal"
          value={stakeRupees}
          onChange={(e) =>
            selectStake(Math.max(0, Number(e.target.value) || 0))
          }
          disabled={!round.bettingOpen || placed}
          className="h-12 min-h-12 w-full min-w-0 text-lg font-mono bg-[#1a1030] border-white/10 flex-1"
          data-testid="input-blackjack-stake"
        />
        <AutoBetStatus selected={selectedRound != null && selectedRound === round.roundId} seconds={selectedRound === round.roundId ? Math.ceil(round.remainingMs / 1000) : null} busy={busy === "deal"} onCancel={() => setSelectedRound(null)} />
      </div>
      <TableCoinRack preferences={coinPreferences}
        chip={stakeRupees}
        onSelect={selectStake}
        idSuffix="-blackjack"
        layout="grid"
        showCustom={false}
        disabled={!round.bettingOpen || placed}
      />
      {placed && (
        <div
          className="text-[11px] text-center text-emerald-300 font-semibold"
          data-testid="text-hand-placed"
        >
          Hand placed — ₹{formatRupees(String(placedTotal))} · cards at reveal
        </div>
      )}
    </div>
  );

  return (
    <div className="game-page min-h-[100dvh] w-full overflow-x-clip bg-[#0a0612] text-white flex justify-center">
      <div className="game-shell w-full max-w-[1200px] flex flex-col pb-40 lg:pb-3">
        {/* Top bar */}
        <div className="sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 py-3 bg-[#0a0612]/90 backdrop-blur-md border-b border-white/5 safe-pt">
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
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-indigo-400 to-purple-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(129,140,248,0.3)]">
                <Spade className="w-5 h-5 text-black" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  Blackjack
                </h1>
                <p className="text-[10px] text-white/40 leading-none truncate">
                  6 decks • 85% of standard returns
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
                className="text-sm font-bold text-indigo-300 font-mono"
                data-testid="text-blackjack-balance"
              >
                ₹{formatRupees(balance.data?.balance ?? "0")}
              </span>
            </div>
            <GameRulesButton gameCode="blackjack" />
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

        {/* Round timer banner — prominent, near the top. */}
        <div className="px-3 pt-3">
          <RoundPhaseBanner
            phase={round.phase}
            remainingMs={round.remainingMs}
            durationMs={round.phaseDurationMs}
            settleDurationMs={round.config?.settleDurationMs}
            resultSlot={
              isSettled && hand ? (
                <span>
                  {netResult > 0
                    ? `You won ₹${formatRupees(String(netResult))}`
                    : netResult === 0
                      ? "Push — stake returned"
                      : `Net loss · −₹${formatRupees(String(-netResult))}`}
                </span>
              ) : undefined
            }
          />
        </div>

        <div data-game-screen="blackjack" className="flex-1 flex flex-col lg:flex-row gap-3 p-3">
          {/* Table */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {/* Dealer */}
            <div className="rounded-xl bg-[#10202b] border border-white/5 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-white/50">
                  Dealer
                </span>
                {hand && hand.dealerTotal !== null && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-white/5 border-white/20 text-white/80 font-mono"
                    data-testid="text-dealer-total"
                  >
                    {hand.dealerTotal}
                    {hand.results?.dealerBlackjack ? " • BJ" : ""}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2 flex-wrap min-h-[6rem] items-center">
                {hand ? (
                  hand.dealerCards.map((c, i) =>
                    c === null ? (
                      <CardBack key={`hole-${i}`} />
                    ) : (
                      <PlayingCard
                        key={`${c}-${i}`}
                        card={c}
                        flipDelayMs={i * 200}
                      />
                    ),
                  )
                ) : phase === "betting" ? (
                  <span className="text-[11px] text-white/30">
                    Place your bet — cards deal when the round closes.
                  </span>
                ) : (
                  <span className="text-[11px] text-white/30">
                    Dealing…
                  </span>
                )}
              </div>
            </div>

            {/* Player hands */}
            <div className="rounded-xl bg-[#132b1c] border border-white/5 p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-white/50">
                  Your hand{hand && hand.hands.length > 1 ? "s" : ""}
                </span>
                {autoStood && (
                  <Badge
                    className="text-[9px] bg-amber-500/20 text-amber-300 border-amber-400/30"
                    data-testid="badge-auto-stood"
                  >
                    Time up · auto-stand
                  </Badge>
                )}
              </div>
              {!hand && (
                <div className="min-h-[6rem] flex items-center">
                  <span className="text-[11px] text-white/30">
                    {placed
                      ? "Cards will be dealt at reveal."
                      : "Cards will be dealt here."}
                  </span>
                </div>
              )}
              {hand?.hands.map((h, hi) => {
                const isActiveHand =
                  hand.status === "active" &&
                  hi === hand.activeHand &&
                  !isSettled;
                const res = hand.results?.hands[hi];
                return (
                  <div
                    key={hi}
                    className={cn(
                      "rounded-lg p-2 -m-2 transition-colors",
                      isActiveHand &&
                        "bg-emerald-400/5 ring-1 ring-emerald-400/30",
                    )}
                    data-testid={`hand-${hi}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-white/5 border-white/20 text-white/80 font-mono"
                        data-testid={`text-hand-total-${hi}`}
                      >
                        {h.total}
                        {h.soft ? " soft" : ""}
                      </Badge>
                      {h.doubled && (
                        <Badge className="text-[9px] bg-amber-500/20 text-amber-300 border-amber-400/30">
                          Doubled
                        </Badge>
                      )}
                      {h.busted && (
                        <Badge className="text-[9px] bg-rose-500/20 text-rose-300 border-rose-400/30">
                          Bust
                        </Badge>
                      )}
                      {res && (
                        <Badge
                          className={cn(
                            "text-[9px] border",
                            res.outcome === "lose"
                              ? "bg-rose-500/20 text-rose-300 border-rose-400/30"
                              : res.outcome === "push"
                                ? "bg-white/10 text-white/70 border-white/20"
                                : "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
                          )}
                          data-testid={`text-outcome-${hi}`}
                        >
                          {OUTCOME_LABEL[res.outcome] ?? res.outcome}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {h.cards.map((c, i) => (
                        <PlayingCard
                          key={`${c}-${i}`}
                          card={c}
                          flipDelayMs={i * 200}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Result banner */}
            {isSettled && hand && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-center font-bold",
                  netResult > 0
                    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-300"
                    : netResult === 0
                      ? "bg-white/5 border-white/15 text-white/70"
                      : "bg-rose-500/10 border-rose-400/30 text-rose-300",
                )}
                data-testid="text-result-banner"
              >
                {netResult > 0
                  ? `+₹${formatRupees(String(netResult))}`
                  : netResult === 0
                    ? "Push — stake returned"
                    : `−₹${formatRupees(String(-netResult))}`}
              </div>
            )}

            {/* Live bets (below the board, esp. on mobile) */}
            <GameInformationSection><LiveBetsPanel
              bets={round.liveBets}
              playerCount={round.playerCount}
              totalStake={round.totalStake}
              describeBets={describeBlackjackBets}
            /></GameInformationSection>
          </div>

          {/* Side panel (desktop): bet form / recent hands */}
          <div className="lg:w-[320px] shrink-0 flex flex-col gap-3">
            {/* Desktop bet / action panel (hidden on mobile → bottom bar) */}
            <div className="hidden lg:flex flex-col gap-3">
              {showBetForm && (
                <div className="rounded-xl bg-[#130b24] border border-white/5 p-4 flex flex-col gap-3">
                  <label className="text-[11px] uppercase font-bold text-white/50 block">
                    Stake (₹)
                  </label>
                  {betControls}
                </div>
              )}

              {canAct && !showInsurancePrompt && hand && (
                <div className="rounded-xl bg-[#130b24] border border-white/5 p-4 flex flex-col gap-3">
                  <ActionTimer
                    secs={actionSecs}
                    pct={actionPct}
                    urgent={actionUrgent}
                  />
                  <div className="grid grid-cols-2 gap-2">{actionButtons}</div>
                  <div className="text-center text-[11px] text-white/40 font-mono">
                    Stake ₹{formatRupees(hand.stakeAmount)}
                    {hand.hands.length > 1 ? " per hand" : ""}
                  </div>
                </div>
              )}

              {showInsurancePrompt && hand && (
                <div className="rounded-xl bg-[#2b1d0e] border border-amber-400/30 p-4 flex flex-col gap-2">
                  <div className="text-sm font-bold text-amber-300">
                    Dealer shows an Ace
                  </div>
                  <div className="text-[11px] text-white/60">
                    Insurance costs half your stake. On new hands, a dealer
                    blackjack returns 2.55× the insurance stake, including that stake.
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Button
                      className="h-11 font-black uppercase bg-amber-500 hover:bg-amber-400 text-black touch-target"
                      disabled={acting}
                      onClick={() => doInsurance(true)}
                      data-testid="btn-insurance-take"
                    >
                      Take
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 font-black uppercase border-white/20 touch-target"
                      disabled={acting}
                      onClick={() => doInsurance(false)}
                      data-testid="btn-insurance-decline"
                    >
                      No thanks
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Recent rounds */}
            <GameInformationSection><div className="rounded-xl bg-[#130b24] border border-white/5 p-3 flex flex-col gap-2">
              <div className="text-[10px] uppercase font-bold text-white/50">
                My recent hands
              </div>
              {(!recent.data || recent.data.length === 0) && (
                <div className="text-[11px] text-white/30 text-center py-4">
                  Your settled hands will appear here.
                </div>
              )}
              {recent.data?.map((r) => {
                const net = Number(r.payoutAmount) - Number(r.totalStake);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void openVerify(r)}
                    className="text-left flex items-center justify-between text-[11px] py-1.5 px-2 rounded bg-[#1a1030]/60 hover:bg-[#22143f]"
                    data-testid={`blackjack-recent-${r.id}`}
                  >
                    <div className="flex flex-col">
                      <span className="text-white/70">
                        {r.hands.map((h) => h.total).join(" / ")} vs{" "}
                        {r.dealerTotal ?? "?"}
                      </span>
                      <span className="text-white/30 text-[10px]">
                        {r.id.slice(0, 8)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "font-mono font-bold",
                        net > 0
                          ? "text-emerald-400"
                          : net === 0
                            ? "text-white/60"
                            : "text-rose-400",
                      )}
                    >
                      {net > 0
                        ? `+₹${formatRupees(String(net))}`
                        : net === 0
                          ? "push"
                          : `−₹${formatRupees(String(-net))}`}
                    </span>
                  </button>
                );
              })}
            </div></GameInformationSection>
          </div>
        </div>
      </div>

      {/* Fixed bottom bet/action bar (mobile only) */}
      <div className="game-bottom-bar fixed bottom-0 inset-x-0 z-40 bg-[#0d0718]/95 backdrop-blur border-t border-white/10 safe-pb lg:hidden">
        <div className="max-w-[1200px] mx-auto p-3">
          {canAct && !showInsurancePrompt && hand ? (
            <div className="flex flex-col gap-2">
              <ActionTimer
                secs={actionSecs}
                pct={actionPct}
                urgent={actionUrgent}
              />
              <div className="grid grid-cols-4 gap-2">{actionButtons}</div>
            </div>
          ) : showInsurancePrompt && hand ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-12 font-black uppercase bg-amber-500 hover:bg-amber-400 text-black touch-target"
                disabled={acting}
                onClick={() => doInsurance(true)}
                data-testid="btn-insurance-take-m"
              >
                Insurance
              </Button>
              <Button
                variant="outline"
                className="h-12 font-black uppercase border-white/20 touch-target"
                disabled={acting}
                onClick={() => doInsurance(false)}
                data-testid="btn-insurance-decline-m"
              >
                No thanks
              </Button>
            </div>
          ) : (
            betControls
          )}
        </div>
      </div>

      {/* Fairness dialog */}
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#130b24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Provably fair</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-[12px]">
            <p className="text-white/60">
              Every round is dealt from a 6-deck shoe shuffled from a committed
              server seed + client seed + a nonce. The commit is shown during
              betting; the server seed is revealed after the reveal phase.
            </p>
            <div className="font-mono break-all bg-black/30 rounded p-2">
              <div className="text-white/40 text-[10px] uppercase">
                Round server seed hash (commit)
              </div>
              {commitHash}
            </div>
            <div className="font-mono break-all bg-black/30 rounded p-2">
              <div className="text-white/40 text-[10px] uppercase">
                Round client seed • nonce
              </div>
              {round.clientSeed
                ? `${round.clientSeed} • ${round.nonce ?? "?"}`
                : "…"}
            </div>
            <div className="font-mono break-all bg-black/30 rounded p-2">
              <div className="text-white/40 text-[10px] uppercase">
                Round server seed (after reveal)
              </div>
              {revealedSeed ?? "Revealed after the reveal phase"}
            </div>
            <div className="border-t border-white/10 pt-3">
              <div className="text-white/40 text-[10px] uppercase mb-1">
                Your personal seed
              </div>
              <div className="font-mono break-all bg-black/30 rounded p-2 mb-2">
                {seed.data?.serverSeedHash ?? "…"}
              </div>
              <div className="font-mono break-all bg-black/30 rounded p-2 mb-2">
                {seed.data
                  ? `${seed.data.clientSeed} • next ${seed.data.nextNonce}`
                  : "…"}
              </div>
              <Input
                placeholder="New client seed (optional)"
                value={clientSeedDraft}
                onChange={(e) => setClientSeedDraft(e.target.value)}
                className="bg-[#1a1030] border-white/10 font-mono mb-2"
                data-testid="input-client-seed"
              />
              <Button
                variant="outline"
                className="border-white/20 w-full"
                onClick={() => void rotateSeed()}
                data-testid="btn-rotate-seed"
              >
                Rotate & reveal seed
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify dialog (historical rounds) */}
      <Dialog
        open={!!verifyOpen}
        onOpenChange={(o) => {
          if (!o) {
            setVerifyOpen(null);
            setVerifyResult(null);
          }
        }}
      >
        <DialogContent className="bg-[#130b24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Verify hand</DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="font-mono break-all bg-black/30 rounded p-2">
                <div className="text-white/40 text-[10px] uppercase">
                  Server seed hash
                </div>
                {verifyOpen.serverSeedHash}
              </div>
              <div className="font-mono break-all bg-black/30 rounded p-2">
                <div className="text-white/40 text-[10px] uppercase">
                  Server seed (revealed after rotation)
                </div>
                {(verifyResult?.serverSeed as string) ??
                  verifyOpen.serverSeed ??
                  "Rotate your seed to reveal"}
              </div>
              <div className="font-mono break-all bg-black/30 rounded p-2">
                <div className="text-white/40 text-[10px] uppercase">
                  Client seed • nonce
                </div>
                {verifyOpen.clientSeed} • {verifyOpen.nonce}
              </div>
              {verifyResult && (
                <div
                  className={cn(
                    "rounded p-2 font-bold text-center",
                    verifyResult.verified
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300",
                  )}
                  data-testid="text-verify-status"
                >
                  {verifyResult.verified
                    ? "Verified — cards, hash and payout all match"
                    : "Seed not yet revealed or mismatch"}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionTimer({
  secs,
  pct,
  urgent,
}: {
  secs: number;
  pct: number;
  urgent: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] uppercase font-bold">
        <span className="text-white/40">Your turn</span>
        <span
          className={cn(
            "font-mono tabular-nums",
            urgent ? "text-rose-400" : "text-white/70",
          )}
          data-testid="action-timer-seconds"
        >
          {secs}s
        </span>
      </div>
      <div className="h-1 rounded-full bg-black/40 overflow-hidden">
        <div
          className={cn(
            "h-full transition-[width] duration-300 ease-linear",
            urgent ? "bg-rose-500" : "bg-emerald-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
