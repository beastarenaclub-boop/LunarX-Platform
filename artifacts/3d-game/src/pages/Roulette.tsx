import { GameInformationSection } from "@/components/game/GameInformation";
import { ROULETTE_LIMITS, ROULETTE_PAYOUT_BASE, ROULETTE_COIN_VALUES, rouletteMaxBetPaise, rouletteSelectionKey } from "@workspace/api-zod/roulette-game";
import { BET_SEND_BUFFER_MS, useTimedBet } from "@/components/table/AutoBet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  sfx,
  stopRouletteAudio,
  unlockAudio,
  preloadCroupierVoice,
  preloadTableAudio,
} from "@/game/audio";
import { notifyPlayStarted, updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import {
  ArrowLeft,
  ShieldCheck,
  CircleDot,
  CheckCircle2,
  ExternalLink,
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
import RouletteBetPanel from "@/components/roulette/RouletteBetPanel";
import RouletteDealerTable from "@/components/roulette/RouletteDealerTable";
import { DEALER_ACTION_MS, DEALER_RELEASE_MS } from "@/components/roulette/dealerTiming";
import RouletteWheel, {
  type WheelAudio,
} from "@/components/roulette/RouletteWheel";
import {
  FINAL_RUN_MS,
  planLandingMs,
} from "@/components/roulette/spinPlan";
import { useTableRound } from "@/components/table/useTableRound";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import { useCoinPreferences } from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import {
  betKey,
  betLabel,
  pocketColor,
  pocketColorHex,
  WINNING_RESULT_CLASS,
  type BetType,
  type PlacedBet,
} from "@/components/roulette/wheelData";
import rouletteUsdzUrl from "@/assets/roulette-model/roulette-wheel.usdz?url";
import { GameRulesButton } from "@/components/game/GameRules";

interface SettledBet {
  type: BetType;
  numbers?: number[];
  selection?: number;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

interface RouletteState {
  id: string;
  betId: string;
  pocket: number;
  bets: SettledBet[];
  totalStake: string;
  payoutAmount: string;
  multiplier: number;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier: number;
  createdAt: string;
}

interface RouletteConfig {
  payoutBase?: number;
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: string;
  maxBetsPerSpin: number;
}

interface VerifyResp extends RouletteState {
  computedPocket: number;
  computedPayout: string;
  computedHash: string;
  hashMatch: boolean;
  pocketMatch: boolean;
  payoutMatch: boolean;
  verified: boolean;
}

interface RouletteOutcome {
  pocket: number;
}

const MAX_BETS_PER_SLIP = ROULETTE_LIMITS.maxBetsPerSlip;

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  const msg = (err as Error)?.message;
  if (msg === "BETTING_CLOSED") return "Betting is closed for this round";
  return msg || fallback;
}

/** Short label list for another player's slip in the live-bets panel. */
function describeRouletteBets(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const parts = raw
    .slice(0, 4)
    .map((b) => {
      const bet = b as {
        type?: BetType;
        numbers?: number[];
        selection?: number;
      };
      if (!bet.type) return null;
      return betLabel({
        type: bet.type,
        numbers: bet.numbers,
        selection: bet.selection,
      });
    })
    .filter((s): s is string => !!s);
  const more = raw.length - parts.length;
  return parts.join(", ") + (more > 0 ? ` +${more}` : "");
}

export default function Roulette() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  // Read inside the wheel's per-frame audio hooks without rebuilding them.
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    document.title = "Roulette • Lunar Casino";
    // Warm the croupier's table calls and the recorded chip/wheel/ball pack so
    // the first bet and the first spin of a session are never silent.
    preloadCroupierVoice();
    preloadTableAudio();
  }, []);

  const balance = useGetWalletBalance(
    { game: "roulette" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "roulette" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const config = useQuery<RouletteConfig>({
    queryKey: ["roulette.config"],
    queryFn: () =>
      customFetch<RouletteConfig>("/api/roulette/config", { method: "GET" }),
    staleTime: 60_000,
    retry: false,
  });

  // Per-user recent settled slips list (legacy verify feed). Kept if the
  // endpoint still responds; drops gracefully otherwise.
  const recent = useQuery<RouletteState[]>({
    queryKey: ["roulette.recent"],
    queryFn: () =>
      customFetch<RouletteState[]>("/api/roulette/recent?limit=10", {
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
    void qc.invalidateQueries({ queryKey: ["roulette.recent"] });
  };

  // Reveal-animation state, driven by the shared round clock.
  const [revealPocket, setRevealPocket] = useState<number | null>(null);
  // Last round this client saw taking bets — see `watchedSpinStart` below.
  const [watchedRoundId, setWatchedRoundId] = useState<string | null>(null);
  // Round whose fast finishing run has begun — see `wheelFinalRun` below.
  const finalRunRoundRef = useRef<string | null>(null);
  // Deliberately separate from the server target: no result surface may reveal
  // the number until the wheel and ball have visibly completed their landing.
  const [landedPocket, setLandedPocket] = useState<number | null>(null);
  const [spinId, setSpinId] = useState(0);
  // How long the wheel may take to come to rest, fitted to what is left of
  // the reveal window (0 = park on the pocket immediately).
  const [landingMs, setLandingMs] = useState(0);
  const revealedRoundRef = useRef<string | null>(null);
  const settledRoundRef = useRef<string | null>(null);
  // Synchronous single-flight lock: React `placing` state updates async, so a
  // manual click racing the queued auto-submit could otherwise POST twice.
  const placingLockRef = useRef(false);

  const round = useTableRound<RouletteOutcome>("roulette", {
    onBettingOpen: () => {
      // New round → reset the wheel to idle. Staged chips are KEPT so bets
      // queued while betting was closed carry into this round; if the player
      // queued them, they are auto-placed now.
      setRevealPocket(null);
      setLandedPocket(null);
      if (sound) {
        sfx.click();
        // Croupier opens the table.
        sfx.voicePlaceYourBets();
      }

    },
    onSettled: () => {
      invalidateWallet();
    },
  });

  // Remember the round we were watching while it still took bets: the ball we
  // then see land is one we saw launched.
  useEffect(() => {
    if (round.phase === "betting" && round.roundId) {
      setWatchedRoundId(round.roundId);
    }
  }, [round.phase, round.roundId]);

  // Trigger the wheel spin once per round when the outcome is revealed. Also
  // covers a player who arrives during settling: the wheel must show the same
  // pocket as the banner, so it parks on it instantly instead of idling on.
  useEffect(() => {
    if (round.phase !== "reveal" && round.phase !== "settling") return;
    if (round.outcome == null || !round.roundId) return;
    if (revealedRoundRef.current === round.roundId) return;
    revealedRoundRef.current = round.roundId;
    // Fit the landing inside what is actually left of the reveal window, so a
    // short operator-configured reveal still lands on time and joining late
    // drops straight onto the resting pocket.
    const remainingReveal =
      round.phase === "reveal" && round.phaseEndsAt != null
        ? round.toLocalTime(round.phaseEndsAt) - Date.now()
        : 0;
    const ms = planLandingMs(remainingReveal);
    setLandingMs(ms);
    setLandedPocket(null);
    setRevealPocket(round.outcome.pocket);
    setSpinId((n) => n + 1);
    // The spin cues (launch, roll, rattle, drop) are fired by the wheel itself
    // from its own motion — see `wheelAudio` below.
    if (sound) {
      // Fetch the spoken call for this pocket while the wheel spins so the
      // announcement lands the instant the ball drops.
      sfx.preloadVoicePocket(round.outcome.pocket);
    }
    notifyPlayStarted();
  }, [
    round.phase,
    round.outcome,
    round.roundId,
    round.phaseEndsAt,
    round.toLocalTime,
    sound,
  ]);

  // Pending "Winner!" line — cancelled if the player leaves the table.
  const winnerVoiceTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (winnerVoiceTimer.current) window.clearTimeout(winnerVoiceTimer.current);
      // Leaving the table must invalidate any spoken call as well as stop the
      // continuous ball layer.
      stopRouletteAudio();
    },
    [],
  );

  // Spin audio, driven by the wheel's real motion rather than a parallel
  // timeline: the launch fires when the ball is visibly sent round, the roll
  // tracks the ball's speed frame by frame from there — free spin and landing
  // alike — the frets rattle when it slows and the clack lands as it drops
  // into its pocket. Stable identity: `sound` is read through a ref so
  // toggling it never rebuilds the hooks mid-spin.
  const wheelAudio = useMemo<WheelAudio>(
    () => ({
      onLaunch: () => {
        if (soundRef.current) sfx.wheelLaunch();
      },
      onRoll: (speed01) => {
        // Sound turned off mid-spin: drop the layer on the very next frame.
        if (!soundRef.current) {
          sfx.ballRollStop(80);
          return;
        }
        sfx.ballRoll(speed01);
      },
      onRattle: () => {
        if (soundRef.current) sfx.ballRattle();
      },
      onDrop: (settleInMs) => {
        // Fade the roll out across the drop so it is gone — cleanly, not cut —
        // by the time the ball is sitting in its pocket.
        sfx.ballRollStop(Math.max(120, Math.min(settleInMs, 400)));
        if (soundRef.current) sfx.ballDrop();
      },
      onRollEnd: () => sfx.ballRollStop(120),
    }),
    [],
  );

  // Croupier calls the winning number + its colour once the wheel comes to
  // rest ("Twenty three. Red."), exactly like a live table. Guarded per round
  // so a re-render of the wheel can't repeat the call.
  const announcedRoundRef = useRef<string | null>(null);
  const completeWheelLanding = () => {
    const pocket = revealPocket;
    const roundId = round.roundId;
    if (pocket == null || !roundId) return;
    setLandedPocket(pocket);
    if (announcedRoundRef.current === roundId) return;
    announcedRoundRef.current = roundId;
    if (sound) sfx.voicePocket(pocket);
  };

  // Croupier: "No more bets, please." the moment the betting window closes.
  // Only on a real betting -> closed transition, so opening the page midway
  // through a spin doesn't greet the player with the call.
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = round.phase;
    if (!round.roundId) return;
    if (prev !== "betting" || round.phase === "betting") return;
    if (sound) sfx.voiceNoMoreBets();
  }, [round.phase, round.roundId, sound]);

  // When the round settles, surface this player's own win/loss once.
  useEffect(() => {
    if (round.phase !== "settling" || !round.roundId) return;
    if (landedPocket == null || landedPocket !== round.outcome?.pocket) return;
    if (settledRoundRef.current === round.roundId) return;
    if (round.myBets.length === 0) return;
    let staked = 0n;
    let payout = 0n;
    let anySettled = false;
    for (const slip of round.myBets) {
      staked += BigInt(slip.totalStake || "0");
      if (slip.status === "settled") {
        anySettled = true;
        payout += BigInt(slip.payoutAmount || "0");
      }
    }
    // The settling snapshot can arrive before the slips flip to "settled".
    // Only claim the round once there is a real result to announce, or the
    // later update finds the round already spoken for and stays silent.
    if (!anySettled) return;
    settledRoundRef.current = round.roundId;
    const pocket = round.outcome?.pocket;
    const pocketLabel = pocket != null ? `Pocket ${pocket} — ` : "";
    if (payout > 0n) {
      if (sound) {
        // Croupier congratulates the player just after the number call.
        // Tracked so leaving the table cancels a pending congratulation.
        if (winnerVoiceTimer.current) window.clearTimeout(winnerVoiceTimer.current);
        winnerVoiceTimer.current = window.setTimeout(() => {
          winnerVoiceTimer.current = null;
          sfx.voiceWinner();
        }, 700);
      }
      toast.success(`${pocketLabel}you won ₹${formatRupees(payout.toString())}!`);
    } else if (staked > 0n) {
      if (sound) sfx.tableLose("roulette");
    }
  }, [
    round.phase,
    round.roundId,
    round.myBets,
    round.outcome,
    landedPocket,
    sound,
  ]);

  // Live results strip + hot/cold stats from the shared recent feed.
  const livePockets = useMemo(
    () => {
      const pockets = round.recent
        .map((r) => ({
          id: r.roundId,
          pocket: (r.outcome as RouletteOutcome | null)?.pocket,
        }))
        .filter(
          (p): p is { id: string; pocket: number } =>
            p.pocket != null &&
            (p.id !== round.roundId || landedPocket != null),
        );
      if (
        landedPocket != null &&
        round.roundId &&
        !pockets.some((p) => p.id === round.roundId)
      ) {
        pockets.unshift({ id: round.roundId, pocket: landedPocket });
      }
      return pockets;
    },
    [round.recent, round.roundId, landedPocket],
  );

  const stats = useMemo(() => {
    const pockets = livePockets.map((p) => p.pocket);
    if (pockets.length === 0) return null;
    const counts = new Map<number, number>();
    for (let n = 0; n <= 36; n++) counts.set(n, 0);
    let red = 0,
      black = 0,
      green = 0,
      odd = 0,
      even = 0;
    for (const n of pockets) {
      counts.set(n, (counts.get(n) ?? 0) + 1);
      const c = pocketColor(n);
      if (c === "red") red++;
      else if (c === "black") black++;
      else green++;
      if (n !== 0) {
        if (n % 2 === 1) odd++;
        else even++;
      }
    }
    const ranked = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    );
    const coldRanked = [...counts.entries()].sort(
      (a, b) => a[1] - b[1] || a[0] - b[0],
    );
    return {
      total: pockets.length,
      hot: ranked.slice(0, 5).map(([n]) => n),
      cold: coldRanked.slice(0, 5).map(([n]) => n),
      red,
      black,
      green,
      odd,
      even,
    };
  }, [livePockets]);

  // ── Staged bets (local) ──────────────────────────────────────────────
  const coinPreferences = useCoinPreferences("roulette", user?.id, 100000, ROULETTE_COIN_VALUES);
  const { chip, selectChip: setChip } = coinPreferences;
  const roundWin = useRoundWin({ game: "roulette", userId: user?.id, roundId: round.roundId,
    eligible: round.phase === "settling" && landedPocket != null && landedPocket === round.outcome?.pocket, bets: round.myBets });
  const [bets, setBets] = useState<Map<string, PlacedBet>>(new Map());
  const draftRef = useRef(bets);
  draftRef.current = bets;
  const acceptedRef = useRef<{ roundId: string | null; slips: Map<string, { type: BetType; numbers?: number[]; selection?: number; amountPaise: string }[]> }>({ roundId: null, slips: new Map() });
  const [automatic, setAutomatic] = useState(true);
  const [history, setHistory] = useState<{ key: string; amount: number }[]>([]);
  const lastBetsRef = useRef<Map<string, PlacedBet> | null>(null);
  const [placing, setPlacing] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [revealed, setRevealed] = useState<{
    revealedServerSeed: string;
    revealedServerSeedHash: string;
  } | null>(null);
  const [verifyOpen, setVerifyOpen] = useState<RouletteState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);

  const bettingOpen = round.bettingOpen;
  const disabledGame = config.data && !config.data.enabled;
  // A draft belongs to the current betting window only.
  const controlsDisabled = placing || !!disabledGame || !bettingOpen || round.remainingMs <= 0;

  const totalStaged = useMemo(
    () => [...bets.values()].reduce((s, b) => s + b.amount, 0),
    [bets],
  );

  // My placed slips for the current round.
  const placedTotal = useMemo(() => {
    let sum = 0n;
    for (const slip of round.myBets) sum += BigInt(slip.totalStake || "0");
    return sum;
  }, [round.myBets]);
  const slipCount = round.myBets.length;

  const acceptedAmounts = new Map<string, bigint>();
  const knownSlips = new Map(round.myBets.filter(slip => slip.status !== "refunded").map(slip => [slip.slipId, slip.bets]));
  if (acceptedRef.current.roundId === round.roundId) {
    for (const [id, slip] of acceptedRef.current.slips) if (!knownSlips.has(id)) knownSlips.set(id, slip);
  }
  for (const slip of knownSlips.values()) {
    if (!Array.isArray(slip)) continue;
    for (const bet of slip) {
      const key = rouletteSelectionKey(bet);
      acceptedAmounts.set(key, (acceptedAmounts.get(key) ?? 0n) + BigInt(bet.amountPaise));
    }
  }
  const validateDraft = (draft: Map<string, PlacedBet>) => {
    if (draft.size > MAX_BETS_PER_SLIP) return `Maximum ${MAX_BETS_PER_SLIP} selections per slip`;
    let total = 0n;
    for (const bet of draft.values()) {
      const amount = BigInt(rupeesToPaise(bet.amount));
      if (amount < BigInt(ROULETTE_LIMITS.minBetPaise)) return "Minimum ₹10 on each selection";
      const limit = rouletteMaxBetPaise(bet.type);
      if (amount + (acceptedAmounts.get(rouletteSelectionKey(bet)) ?? 0n) > limit) {
        return `${betLabel(bet)}: maximum ₹${Number(limit / 100n).toLocaleString("en-IN")} per round, including placed bets`;
      }
      total += amount;
    }
    if (total > BigInt(balance.data?.balance ?? "0")) return "Insufficient balance for these bets";
    if (total > BigInt(round.config?.maxStakePaise ?? config.data?.maxStakePaise ?? "50000000")) return "Total stake exceeds the table limit";
    return null;
  };
  const saveDraft = (next: Map<string, PlacedBet>) => { draftRef.current = next; setBets(next); };

  const placeBet = (spot: Omit<PlacedBet, "amount">) => {
    // Draft chips belong only to the current betting window.
    if (placing || disabledGame || !bettingOpen || round.remainingMs <= 0) return;
    if (!Number.isSafeInteger(chip) || chip < 10 || chip > 100000) { toast.error("Choose a coin from ₹10 to ₹1,00,000"); return; }
    const key = betKey(spot);
    const next = new Map(draftRef.current);
    next.set(key, { ...spot, amount: (next.get(key)?.amount ?? 0) + chip });
    const problem = validateDraft(next);
    if (problem) { toast.error(problem); return; }
    unlockAudio();
    if (sound) sfx.chipPlace();
    saveDraft(next);
    setHistory((h) => [...h, { key, amount: chip }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    if (sound) sfx.chipScoop();
    setHistory((h) => h.slice(0, -1));
    setBets((prev) => {
      const next = new Map(prev);
      const existing = next.get(last.key);
      if (!existing) return next;
      const remaining = existing.amount - last.amount;
      if (remaining > 0) next.set(last.key, { ...existing, amount: remaining });
      else next.delete(last.key);
      return next;
    });
  };

  // Silent: also called internally after a successful submit, where the chip
  // stack push is the sound of the moment.
  const clearBets = () => {
    saveDraft(new Map());
    setHistory([]);
  };

  const sweepBets = () => {
    if (bets.size > 0 && sound) sfx.chipScoop();
    clearBets();
  };

  const rebet = () => {
    if (!lastBetsRef.current || !bettingOpen || round.remainingMs <= 0 || placing) return;
    const problem = validateDraft(lastBetsRef.current);
    if (problem) { toast.error(problem); return; }
    if (sound) sfx.chipStackPush();
    saveDraft(new Map(lastBetsRef.current));
    setHistory([]);
  };

  const placeBets = async (auto = false) => {
    if (!user) return;
    const submitted = new Map(draftRef.current);
    if (submitted.size === 0) {
      if (!auto) toast.error("Place at least one chip on the table");
      return;
    }
    if (!bettingOpen) return;
    const problem = validateDraft(draftRef.current);
    if (problem) { toast.error(problem); return; }
    if (bets.size > MAX_BETS_PER_SLIP) {
      toast.error(`Max ${MAX_BETS_PER_SLIP} bets per slip`);
      return;
    }
    if (placingLockRef.current) return;
    placingLockRef.current = true;
    unlockAudio();
    setPlacing(true);
    try {
      const payload = [...submitted.values()].map((b) => ({
        type: b.type,
        ...(b.numbers ? { numbers: b.numbers } : {}),
        ...(b.selection !== undefined ? { selection: b.selection } : {}),
        amountPaise: rupeesToPaise(b.amount),
      }));
      const placed = await customFetch<{ slipId: string }>("/api/roulette/spin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId, bets: payload }),
      });
      if (acceptedRef.current.roundId !== round.roundId) acceptedRef.current = { roundId: round.roundId, slips: new Map() };
      acceptedRef.current.slips.set(placed.slipId, payload);
      lastBetsRef.current = submitted;
      clearBets();
      // Bet confirmed — the stack goes across the felt.
      if (sound) sfx.chipStackPush();
      // Refresh snapshot so the "placed" state + wallet update immediately.
      round.refetch();
      invalidateWallet();
      toast.success(auto ? "Auto bet placed for this round" : "Bets placed for this round");
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
    armed: automatic && bets.size > 0,
    enabled: !!user && bettingOpen && !placing && config.data?.enabled === true,
    submit: () => placeBets(true),
  });

  const rotateSeed = async () => {
    if (!user || rotating) return;
    setRotating(true);
    try {
      const out = await customFetch<{
        revealedServerSeed: string;
        revealedServerSeedHash: string;
      }>("/api/roulette/seed/rotate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setRevealed(out);
      toast.success("Seed rotated; previous seed revealed.");
    } catch (err) {
      toast.error(apiMessage(err, "Rotate failed"));
    } finally {
      setRotating(false);
    }
  };

  const openVerify = async (round: RouletteState) => {
    setVerifyOpen(round);
    setVerifyData(null);
    try {
      const out = await customFetch<VerifyResp>(
        `/api/roulette/${round.id}/verify`,
        { method: "GET", credentials: "include" },
      );
      setVerifyData(out);
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  if (!user) return null;

  const resultActive =
    landedPocket != null &&
    (round.phase === "reveal" || round.phase === "settling");
  // Did this client see the round while it was still taking bets? The wheel
  // now idles through the blind part of the reveal too, so only this can tell
  // a spin the player watched start from one already in flight when they
  // arrived (the launch whoosh belongs to the first case only).
  const watchedSpinStart = watchedRoundId != null && watchedRoundId === round.roundId;
  const wheelBoosted =
    (round.phase === "betting" &&
      round.remainingMs > 0 &&
      round.remainingMs <= 20_000) ||
    // Reveal runs blind: the server does not hand over the pocket until the
    // wheel needs it, so keep the wheel at full tilt until it arrives and the
    // landing takes over.
    (round.phase === "reveal" && revealPocket == null);
  // The last few seconds of the round are the ball's fast finishing run. It
  // starts off the round clock — well before the server discloses the pocket —
  // so the landing inherits a wheel already at speed and only has to brake.
  // Latched for the round: the countdown is drift-corrected against the server
  // clock, so a re-estimated offset can nudge it back over the threshold for a
  // tick, and the wheel must not visibly ease off once it is running.
  if (
    round.phase === "reveal" &&
    round.roundId &&
    round.remainingMs <= FINAL_RUN_MS
  ) {
    finalRunRoundRef.current = round.roundId;
  }
  const wheelFinalRun =
    round.phase === "reveal" && finalRunRoundRef.current === round.roundId;

  // Stats + recent-spins panels are rendered twice: in the left wheel column
  // on desktop, and BELOW the betting area on mobile — players asked for the
  // playable table first and history at the bottom on phones.
  const statsPanel = stats && (
    <div
      className="rounded-xl bg-[#130b24] border border-white/5 p-3 flex flex-col gap-2"
      data-testid="stats-panel"
    >
      <div className="text-[11px] uppercase font-bold text-white/50">
        Table Stats · last {stats.total} spins
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-orange-400 w-8">
          Hot
        </span>
        <div className="flex gap-1 flex-wrap">
          {stats.hot.map((n) => (
            <span
              key={`h${n}`}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white border border-orange-400/50"
              style={{ background: pocketColorHex(n) }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-sky-400 w-8">
          Cold
        </span>
        <div className="flex gap-1 flex-wrap">
          {stats.cold.map((n) => (
            <span
              key={`c${n}`}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white border border-sky-400/40"
              style={{ background: pocketColorHex(n) }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden">
        <div
          className="bg-red-600"
          style={{ width: `${(stats.red / stats.total) * 100}%` }}
        />
        <div
          className="bg-emerald-600"
          style={{ width: `${(stats.green / stats.total) * 100}%` }}
        />
        <div
          className="bg-zinc-700"
          style={{ width: `${(stats.black / stats.total) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-white/50">
        <span className="text-red-400">Red {stats.red}</span>
        <span className="text-emerald-400">Zero {stats.green}</span>
        <span>Black {stats.black}</span>
        <span>
          Odd {stats.odd} · Even {stats.even}
        </span>
      </div>
    </div>
  );

  const recentPanel = recent.isSuccess && (
    <div className="rounded-xl bg-[#130b24] border border-white/5 p-3 flex flex-col gap-2 max-h-[220px] overflow-y-auto">
      <div className="text-[11px] uppercase font-bold text-white/50">
        Your Recent Spins
      </div>
      {recent.data && recent.data.length > 0 ? (
        recent.data.map((r, index) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openVerify(r)}
            className={cn(
              "text-left p-2 rounded-md bg-[#1a1030] hover:bg-[#22143f] flex items-center justify-between gap-2 touch-target-sm",
              resultActive &&
                index === 0 &&
                r.pocket === landedPocket &&
                WINNING_RESULT_CLASS,
            )}
            data-testid={`recent-${r.id}`}
            data-winning={
              resultActive && index === 0 && r.pocket === landedPocket
                ? "true"
                : undefined
            }
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge
                className="text-[10px] font-mono text-white"
                style={{ background: pocketColorHex(r.pocket) }}
              >
                {r.pocket}
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
          Place bets to start.
        </div>
      )}
    </div>
  );

  return (
    <div className="game-page roulette-page min-h-[100dvh] w-full overflow-x-clip bg-[#0a0612] text-white flex justify-center safe-pb">
      <GameInformationSection>{statsPanel}{recentPanel}</GameInformationSection>
      <div className="game-shell w-full max-w-7xl flex flex-col">
        {/* Top bar */}
        <div className="roulette-page-header sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 py-3 bg-[#0a0612]/90 backdrop-blur-md border-b border-white/5 safe-pt">
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
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-amber-400 to-red-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(251,191,36,0.3)]">
                <CircleDot className="w-5 h-5 text-black" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  Roulette
                </h1>
                <p className="text-[10px] text-white/40 leading-none truncate">
                  European • Single zero • Provably fair
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
                data-testid="text-roulette-balance"
              >
                ₹{formatRupees(balance.data?.balance ?? "0")}
              </span>
            </div>
            <GameRulesButton gameCode="roulette" />
            <GameInformationSection><a
              href={rouletteUsdzUrl}
              rel="ar"
              download="roulette-wheel.usdz"
              aria-label="Open roulette wheel in AR"
              title="Open roulette wheel in AR / download USDZ"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-amber-300"
              data-testid="btn-roulette-ar"
            >
              <ExternalLink className="h-5 w-5" />
            </a></GameInformationSection>
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
            Roulette is currently disabled by the operator.
          </div>
        )}

        {/* Live results strip — all players */}
        <div className="roulette-history-strip px-3 pt-3">
          <div className="rounded-xl bg-[#130b24] border border-white/5 px-3 py-2 flex items-center gap-2 overflow-hidden">
            <span className="text-[10px] uppercase font-bold text-white/40 shrink-0 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              Live
            </span>
            <div
              className="flex items-center gap-1.5 overflow-x-auto scrollbar-none"
              data-testid="live-pockets-strip"
            >
              {livePockets.length > 0 ? (
                livePockets.slice(0, 30).map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black text-white border border-white/20",
                      resultActive &&
                        p.id === round.roundId &&
                        p.pocket === landedPocket &&
                        WINNING_RESULT_CLASS,
                    )}
                    style={{ background: pocketColorHex(p.pocket) }}
                    data-testid={`live-result-${p.id}`}
                    data-winning={
                      resultActive &&
                      p.id === round.roundId &&
                      p.pocket === landedPocket
                        ? "true"
                        : undefined
                    }
                  >
                    {p.pocket}
                  </span>
                ))
              ) : (
                <span className="text-xs text-white/30 italic">
                  Waiting for spins…
                </span>
              )}
            </div>
          </div>
        </div>

        {/* One attached studio and betting dock, with its own scrollable board. */}
        <div data-game-screen="roulette" className="roulette-live-layout flex-1 flex flex-col gap-3 p-3 pb-6 min-h-0">
          <div className="roulette-studio-column w-full max-w-[1000px] mx-auto flex flex-col gap-2">
            <div className="roulette-wheel-placeholder">
            <div className="roulette-wheel-surface flex flex-col items-center gap-2">
              <RouletteDealerTable
                roundId={round.roundId}
                phase={round.phase}
                bettingEndsAt={round.phase === "betting" && round.phaseEndsAt != null ? round.toLocalTime(round.phaseEndsAt) : null}
                resultActive={resultActive}
                winningPocket={resultActive ? landedPocket : null}
                soundEnabled={sound}
                onSoundToggle={() => {
                  if (!sound) unlockAudio();
                  else stopRouletteAudio();
                  updateSettings({ sound: !sound });
                }}
              >
                <RouletteWheel
                  presentation="studio"
                  roundId={round.roundId}
                  ballReleaseAt={round.phase === "betting" && round.phaseEndsAt != null
                    ? round.toLocalTime(round.phaseEndsAt) - DEALER_ACTION_MS + DEALER_RELEASE_MS : null}
                  ballInPlay={round.phase === "reveal" || round.phase === "settling"}
                  pocket={revealPocket}
                  revealedPocket={resultActive ? landedPocket : null}
                  spinId={spinId}
                  landingMs={landingMs}
                  boosted={wheelBoosted}
                  finalRun={wheelFinalRun}
                  watchedStart={watchedSpinStart}
                  onSettled={completeWheelLanding}
                  audio={wheelAudio}
                />
              </RouletteDealerTable>
              {/* Result / status line */}
              <div className="roulette-round-status h-8 flex items-center [@media(max-height:500px)]:hidden">
                {round.phase === "reveal" || round.phase === "settling" ? (
                  resultActive && landedPocket != null ? (
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center font-black text-white border border-white/30",
                          WINNING_RESULT_CLASS,
                        )}
                        style={{ background: pocketColorHex(landedPocket) }}
                        data-testid="text-result-pocket"
                      >
                        {landedPocket}
                      </div>
                      <span className="text-sm text-white/60">
                        {pocketColor(landedPocket)}
                      </span>
                    </div>
                  ) : (
                    <span
                      className="text-sm text-white/50 animate-pulse"
                      data-testid="result-hidden-status"
                    >
                      Ball in motion — result hidden
                    </span>
                  )
                ) : slipCount > 0 ? (
                  <span
                    className="text-sm text-emerald-300 flex items-center gap-1.5"
                    data-testid="text-placed-state"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {slipCount} slip{slipCount === 1 ? "" : "s"} placed · ₹
                    {formatRupees(placedTotal.toString())}
                  </span>
                ) : null}
              </div>
            </div>
            </div>
          </div>

          <div className="roulette-controls-column flex-1 min-w-0">
            <RouletteBetPanel
              coins={coinPreferences} bets={bets} onPlace={placeBet}
              disabled={controlsDisabled} placing={placing}
              automatic={automatic} setAutomatic={setAutomatic}
              onSubmit={() => void placeBets()} onClear={sweepBets} onUndo={undo} onRebet={rebet}
              canUndo={history.length > 0} canRebet={!!lastBetsRef.current}
              total={totalStaged} balance={balance.data?.balance ?? "0"} placed={placedTotal.toString()}
              phase={round.phase} remainingMs={round.remainingMs} durationMs={round.phaseDurationMs ?? 1}
              result={resultActive ? landedPocket : null}
              payoutBase={round.config?.roulettePayoutBase ?? config.data?.payoutBase ?? ROULETTE_PAYOUT_BASE}
            />
            <GameInformationSection><LiveBetsPanel bets={round.liveBets} playerCount={round.playerCount} totalStake={round.totalStake} describeBets={describeRouletteBets} /></GameInformationSection>
          </div>
        </div>
      </div>

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
              Each round's pocket is derived from{" "}
              <span className="font-mono text-amber-300">
                SHA-256(serverSeed:clientSeed:nonce:i)
              </span>
              . The server seed hash is committed while betting is open; the
              server seed is revealed after the wheel spins so the round can be
              verified.
            </p>
            <div className="rounded-lg bg-[#1a1030] p-3 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash (committed)
                </div>
                <div className="text-[10px] font-mono text-amber-200 break-all">
                  {round.serverSeedHash ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Client Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {round.clientSeed ?? "—"}
                </div>
              </div>
              <div className="text-[10px] text-white/50">
                Nonce: <span className="font-mono">{round.nonce ?? "—"}</span>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed (revealed)
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  <span data-testid="current-server-seed">
                    {resultActive
                      ? round.serverSeed ?? "(seed unavailable)"
                      : "(hidden until the wheel lands)"}
                  </span>
                </div>
              </div>
            </div>
            {revealed && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-1">
                <div className="text-[10px] uppercase text-emerald-300 font-bold">
                  Rotated (previous personal seed)
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  Seed: {revealed.revealedServerSeed}
                </div>
                <div className="text-[10px] font-mono text-white/60 break-all">
                  Hash: {revealed.revealedServerSeedHash}
                </div>
              </div>
            )}
            <Button
              type="button"
              onClick={rotateSeed}
              disabled={rotating || !user}
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold"
              data-testid="btn-rotate-seed"
            >
              {rotating ? "Rotating…" : "Rotate personal seed"}
            </Button>
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
              Spin Verification
            </DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">
                    Pocket
                  </div>
                  <div className="font-mono flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ background: pocketColorHex(verifyOpen.pocket) }}
                    />
                    {verifyOpen.pocket} ({pocketColor(verifyOpen.pocket)})
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
              <div className="rounded-lg bg-[#1a1030] p-2 space-y-1 max-h-28 overflow-y-auto">
                {verifyOpen.bets.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between font-mono text-[10px]"
                  >
                    <span
                      className={b.didWin ? "text-emerald-300" : "text-white/50"}
                    >
                      {betLabel(b)}
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
                  {verifyOpen.serverSeed ??
                    "(hidden until the seed is rotated)"}
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
                  {verifyData.hashMatch ? "ok" : "bad"} • pocket{" "}
                  {verifyData.pocketMatch ? "ok" : "bad"} • payout{" "}
                  {verifyData.payoutMatch ? "ok" : "bad"}
                  <div className="mt-1 text-white/60">
                    Recomputed pocket: {verifyData.computedPocket} · payout ₹
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
