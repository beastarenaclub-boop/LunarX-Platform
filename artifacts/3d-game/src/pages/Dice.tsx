import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, useSelectionBet } from "@/components/table/AutoBet";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { sfx, unlockAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { useStore } from "@/game/store";
import { ArrowLeft, ShieldCheck, Dice5, Play, Pause } from "lucide-react";
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
  useRealtimeTopic,
} from "@workspace/api-client-react";
import type { BetsGlobalEvent } from "@workspace/api-zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import { GameRulesButton } from "@/components/game/GameRules";

type Direction = "over" | "under";

interface DiceState {
  id: string;
  betId: string;
  stakeAmount: string;
  target: number;
  direction: Direction;
  roll: number;
  didWin: boolean;
  multiplier: number;
  payoutAmount: string;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier: number;
  createdAt: string;
}

interface DiceConfig {
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: string;
  minTarget: number;
  maxTarget: number;
}

interface VerifyResp extends DiceState {
  computedRoll: number;
  computedDidWin: boolean;
  computedMultiplier: number;
  computedWinChance: number;
  computedHash: string;
  hashMatch: boolean;
  rollMatch: boolean;
  winMatch: boolean;
  multiplierMatch: boolean;
  verified: boolean;
}

const MAX_TICKER = 30;

interface TickerEntry {
  id: string;
  name: string;
  stake: number;
  payout: number | null;
  multiplier: number | null;
  status: "placed" | "cashed_out" | "lost";
  ts: number;
}

function nameForTicker(displayName: string | null, userId: string): string {
  if (displayName && displayName.length > 0) return displayName;
  return `Player ${userId.slice(-4).toUpperCase()}`;
}

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || fallback;
  }
  return (err as Error)?.message || fallback;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function computeWinChance(target: number, direction: Direction): number {
  return direction === "over" ? 99.99 - target : target;
}

function computeMultiplier(
  target: number,
  direction: Direction,
  houseEdge: number,
  maxMultiplier: number,
): number {
  const c = computeWinChance(target, direction);
  if (c <= 0) return 0;
  const raw = ((1 - houseEdge) * 100) / c;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const capped = Math.min(maxMultiplier, raw);
  return Math.floor(capped * 100) / 100;
}

export default function Dice() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const coins = useCoinPreferences("dice", user?.id);
  const [, navigate] = useLocation();
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);
  // Legacy game attribution; the server uses the shared wallet.
  const balance = useGetWalletBalance(
    { game: "dice" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "dice" }),
        enabled: !!user,
        retry: false,
      },
    },
  );

  const [stakeRupees, setStakeRupees] = useState<number>(100);
  const [useBonus, setUseBonus] = useState<boolean>(false);
  const [target, setTarget] = useState<number>(50);
  const [direction, setDirection] = useState<Direction>("over");
  const [busy, setBusy] = useState(false);
  const [autoCount, setAutoCount] = useState<number>(10);
  const [autoRunning, setAutoRunning] = useState(false);
  const [stopOnWin, setStopOnWin] = useState(false);
  const [stopOnLoss, setStopOnLoss] = useState(false);
  const [lastResult, setLastResult] = useState<DiceState | null>(null);
  const [animatedRoll, setAnimatedRoll] = useState<number | null>(null);
  const [completedResult, setCompletedResult] = useState<DiceState | null>(null);
  const roundWin = useRoundWin({ game: "dice", userId: user?.id, roundId: completedResult?.id ?? null,
    eligible: !!completedResult,
    bets: completedResult ? [{ status: "settled", totalStake: completedResult.stakeAmount, payoutAmount: completedResult.payoutAmount ?? "0" }] : [] });
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<DiceState | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyResp | null>(null);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const autoStopRef = useRef(false);

  const config = useQuery<DiceConfig>({
    queryKey: ["dice.config"],
    queryFn: () => customFetch<DiceConfig>("/api/dice/config", { method: "GET" }),
    staleTime: 60_000,
    retry: false,
  });

  const seed = useQuery<{
    serverSeedHash: string;
    clientSeed: string;
    nextNonce: number;
    createdAt: string;
    lastRotatedAt: string;
  }>({
    queryKey: ["dice.seed"],
    queryFn: () =>
      customFetch("/api/dice/seed", { method: "GET", credentials: "include" }),
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
  });

  const [revealed, setRevealed] = useState<{
    revealedServerSeed: string;
    revealedServerSeedHash: string;
    revealedClientSeed: string;
  } | null>(null);
  const [rotating, setRotating] = useState(false);

  const rotateSeed = async () => {
    if (!user || rotating) return;
    setRotating(true);
    try {
      const out = await customFetch<{
        revealedServerSeed: string;
        revealedServerSeedHash: string;
        revealedClientSeed: string;
        newSeed: typeof seed.data;
      }>("/api/dice/seed/rotate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setRevealed({
        revealedServerSeed: out.revealedServerSeed,
        revealedServerSeedHash: out.revealedServerSeedHash,
        revealedClientSeed: out.revealedClientSeed,
      });
      void qc.invalidateQueries({ queryKey: ["dice.seed"] });
      toast.success("Seed rotated; previous seed revealed.");
    } catch (err) {
      toast.error(apiMessage(err, "Rotate failed"));
    } finally {
      setRotating(false);
    }
  };

  const recent = useQuery<DiceState[]>({
    queryKey: ["dice.recent"],
    queryFn: () =>
      customFetch<DiceState[]>("/api/dice/recent?limit=10", { method: "GET" }),
    enabled: !!user,
    retry: false,
    staleTime: 10_000,
  });

  useRealtimeTopic<BetsGlobalEvent>("bets:global", (ev) => {
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "placed") {
      if (ev.gameCode !== "dice") return;
      setTicker((prev) =>
        [
          {
            id: ev.id,
            name: nameForTicker(ev.displayName, ev.userId),
            stake: Number(ev.stakeAmount) / 100,
            payout: null,
            multiplier: null,
            status: "placed" as const,
            ts: ev.ts,
          },
          ...prev.filter((e) => e.id !== ev.id),
        ].slice(0, MAX_TICKER),
      );
    } else if (ev.type === "settled") {
      if (ev.gameCode !== "dice") return;
      setTicker((prev) =>
        prev.map((e) =>
          e.id === ev.id
            ? {
                ...e,
                status: ev.status === "cashed_out" ? "cashed_out" : "lost",
                payout: Number(ev.payoutAmount) / 100,
                multiplier: ev.multiplier ?? null,
              }
            : e,
        ),
      );
    }
  });

  useEffect(() => {
    document.title = "Dice • Lunar Casino";
  }, []);

  const winChance = useMemo(
    () => computeWinChance(target, direction),
    [target, direction],
  );
  const multiplierPreview = useMemo(() => {
    if (!config.data) return 0;
    return computeMultiplier(
      target,
      direction,
      config.data.houseEdge,
      config.data.maxMultiplier,
    );
  }, [target, direction, config.data]);

  const minTarget = config.data?.minTarget ?? 0.01;
  const maxTarget = config.data?.maxTarget ?? 99.98;

  const invalidateWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["dice.recent"] });
  };

  const rollOnce = async (): Promise<DiceState | null> => {
    if (!user) return null;
    if (stakeRupees <= 0) {
      toast.error("Enter a stake amount");
      return null;
    }
    unlockAudio();
    if (sound) sfx.diceRoll();
    try {
      const out = await customFetch<DiceState>("/api/dice/roll", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stakeAmount: rupeesToPaise(stakeRupees),
          target: Math.round(target * 100) / 100,
          direction,
          useBonus,
        }),
      });
      setLastResult(out);
      notifyPlayStarted();
      // Brief roll animation: tween from current displayed roll → final.
      const startVal = animatedRoll ?? 50;
      const startTs = performance.now();
      const dur = 600;
      const animate = (now: number) => {
        const t = Math.min(1, (now - startTs) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = startVal + (out.roll - startVal) * eased;
        setAnimatedRoll(v);
        if (t < 1) requestAnimationFrame(animate);
        else setAnimatedRoll(out.roll);
      };
      requestAnimationFrame(animate);
      invalidateWallet();
      if (sound) {
        if (out.didWin) voiceRoundWin("dice", out.id);
        else voiceRoundLoss("dice", out.id);
      }
      window.setTimeout(() => {
        setCompletedResult(out);
        if (sound) {
          if (out.didWin) {
            sfx.diceWin();
          }
          else sfx.diceLose();
        }
      }, 600);
      return out;
    } catch (err) {
      toast.error(apiMessage(err, "Roll failed"));
      return null;
    }
  };

  const autoSubmit = useSelectionBet({ enabled: !!user && config.data?.enabled === true && !busy && !autoRunning, submit: () => handleSingleRoll() });
  const selectStake = (value: number) => {
    setStakeRupees(value);
    unlockAudio();
    if (value > 0) autoSubmit.select(); else autoSubmit.cancel();
  };

  const handleSingleRoll = async () => {
    setBusy(true);
    try {
      await rollOnce();
    } finally {
      setBusy(false);
    }
  };

  const startAuto = async () => {
    if (autoRunning || busy) return;
    autoSubmit.cancel();
    if (sound) sfx.click();
    setAutoRunning(true);
    autoStopRef.current = false;
    let remaining = Math.max(1, Math.min(autoCount, 100));
    while (remaining > 0 && !autoStopRef.current) {
      const out = await rollOnce();
      remaining -= 1;
      if (!out) break;
      if (stopOnWin && out.didWin) break;
      if (stopOnLoss && !out.didWin) break;
      await new Promise((r) => setTimeout(r, 450));
    }
    setAutoRunning(false);
  };

  const stopAuto = () => {
    if (sound) sfx.click();
    autoStopRef.current = true;
  };

  const openVerify = async (round: DiceState) => {
    setVerifyOpen(round);
    setVerifyData(null);
    try {
      const out = await customFetch<VerifyResp>(
        `/api/dice/${round.id}/verify`,
        { method: "GET", credentials: "include" },
      );
      setVerifyData(out);
    } catch (err) {
      toast.error(apiMessage(err, "Verify failed"));
    }
  };

  // Visual position on the 0-100 bar.
  const pointerPct = clamp(animatedRoll ?? 50, 0, 100);
  const targetPct = clamp(target, 0, 100);

  if (!user) return null;

  return (
    <div className="game-page min-h-[100dvh] w-full overflow-x-clip bg-[#0a0612] text-white flex justify-center safe-pb">
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <div className="game-shell w-full max-w-7xl flex flex-col">
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
              <div className="w-9 h-9 rounded bg-gradient-to-tr from-cyan-400 to-sky-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(56,189,248,0.3)]">
                <Dice5 className="w-5 h-5 text-black" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight uppercase truncate">
                  Dice
                </h1>
                <p className="text-[10px] text-white/40 leading-none truncate">
                  Provably fair • {direction === "over" ? "Roll over" : "Roll under"} {target.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <div className="hidden sm:flex flex-col items-end mr-1">
                <span className="text-[10px] text-white/50 font-medium uppercase">
                  Balance
                </span>
                <span
                  className="text-sm font-bold text-emerald-400 font-mono"
                  data-testid="text-dice-balance"
                >
                  ₹{formatRupees(balance.data?.balance ?? "0")}
                </span>
              </div>
            )}
            <GameRulesButton gameCode="dice" />
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

        {/* Layout */}
        <div data-game-screen="dice" className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0">
          {/* Board panel */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#130b24] border border-white/5">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Last Roll
                </div>
                <div
                  className={cn(
                    "text-3xl sm:text-4xl font-black font-mono",
                    lastResult
                      ? lastResult.didWin
                        ? "text-emerald-400"
                        : "text-rose-400"
                      : "text-white/30",
                  )}
                  data-testid="text-last-roll"
                >
                  {animatedRoll !== null ? animatedRoll.toFixed(2) : "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Last Payout
                </div>
                <div className="text-lg sm:text-xl font-bold text-white font-mono">
                  ₹{lastResult ? formatRupees(lastResult.payoutAmount) : "0"}
                </div>
              </div>
            </div>

            {/* Dice bar */}
            <div className="game-canvas-frame game-canvas-frame--dice rounded-xl bg-[#130b24] border border-white/5 p-4 sm:p-6 flex flex-col gap-6">
              <div className="relative h-12 sm:h-14 rounded-full bg-[#1a1030] border border-white/10 overflow-hidden">
                {/* Win zone shading */}
                {direction === "over" ? (
                  <div
                    className="absolute inset-y-0 bg-emerald-500/20"
                    style={{ left: `${targetPct}%`, right: 0 }}
                  />
                ) : (
                  <div
                    className="absolute inset-y-0 bg-emerald-500/20"
                    style={{ left: 0, width: `${targetPct}%` }}
                  />
                )}
                {/* Lose zone shading */}
                {direction === "over" ? (
                  <div
                    className="absolute inset-y-0 bg-rose-500/15"
                    style={{ left: 0, width: `${targetPct}%` }}
                  />
                ) : (
                  <div
                    className="absolute inset-y-0 bg-rose-500/15"
                    style={{ left: `${targetPct}%`, right: 0 }}
                  />
                )}
                {/* Tick marks */}
                {[0, 25, 50, 75, 100].map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 bottom-0 w-px bg-white/10"
                    style={{ left: `${t}%` }}
                  />
                ))}
                {/* Target line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]"
                  style={{ left: `${targetPct}%` }}
                  data-testid="dice-target-line"
                />
                {/* Roll pointer */}
                {animatedRoll !== null && (
                  <div
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all",
                      lastResult?.didWin ? "drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]",
                    )}
                    style={{ left: `${pointerPct}%` }}
                    data-testid="dice-roll-pointer"
                  >
                    <div
                      className={cn(
                        "w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white flex items-center justify-center font-mono text-[10px] sm:text-xs font-black",
                        lastResult?.didWin
                          ? "bg-emerald-500 text-black"
                          : lastResult
                            ? "bg-rose-500 text-white"
                            : "bg-white text-black",
                      )}
                    >
                      {animatedRoll.toFixed(0)}
                    </div>
                  </div>
                )}
              </div>

              {/* 0-100 axis labels */}
              <div className="relative -mt-4 px-1 text-[10px] font-mono text-white/40 select-none">
                <span className="absolute left-0">0</span>
                <span className="absolute left-1/4 -translate-x-1/2">25</span>
                <span className="absolute left-1/2 -translate-x-1/2">50</span>
                <span className="absolute left-3/4 -translate-x-1/2">75</span>
                <span className="absolute right-0">100</span>
              </div>

              {/* Target slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase font-bold text-white/50">
                    Target
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min={minTarget}
                    max={maxTarget}
                    value={target}
                    onChange={(e) =>
                      setTarget(
                        clamp(Number(e.target.value) || 0, minTarget, maxTarget),
                      )
                    }
                    className="h-8 w-24 text-sm font-mono bg-[#1a1030] border-white/10 text-right"
                    data-testid="input-dice-target"
                  />
                </div>
                <input
                  type="range"
                  min={minTarget}
                  max={maxTarget}
                  step={0.01}
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                  disabled={busy || autoRunning}
                  className="w-full accent-cyan-400"
                  data-testid="slider-dice-target"
                />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-[#1a1030] border border-white/5 p-2">
                  <div className="text-[9px] uppercase text-white/40 font-bold">
                    Multiplier
                  </div>
                  <div
                    className="text-lg font-mono font-bold text-cyan-300"
                    data-testid="text-multiplier-preview"
                  >
                    {multiplierPreview.toFixed(2)}×
                  </div>
                </div>
                <div className="rounded-lg bg-[#1a1030] border border-white/5 p-2">
                  <div className="text-[9px] uppercase text-white/40 font-bold">
                    Roll {direction === "over" ? "Over" : "Under"}
                  </div>
                  <div className="text-lg font-mono font-bold text-white">
                    {target.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg bg-[#1a1030] border border-white/5 p-2">
                  <div className="text-[9px] uppercase text-white/40 font-bold">
                    Win Chance
                  </div>
                  <div
                    className="text-lg font-mono font-bold text-emerald-400"
                    data-testid="text-win-chance"
                  >
                    {winChance.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bet panel */}
          <div className="lg:w-[320px] flex flex-col gap-3">
            <div className="rounded-xl bg-[#130b24] border border-white/5 p-3 sm:p-4 flex flex-col gap-3">
              <div>
                <label className="text-[11px] uppercase font-bold text-white/50 mb-1.5 block">
                  Stake (₹)
                </label>
                <Input
                  type="number"
                  min={1}
                  inputMode="decimal"
                  value={stakeRupees}
                  onChange={(e) =>
                    selectStake(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="h-12 text-lg font-mono bg-[#1a1030] border-white/10"
                  data-testid="input-dice-stake"
                  disabled={!user || config.data?.enabled !== true || busy || autoRunning}
                />
                {useBonus && <span className="text-[10px] text-amber-300">Bonus wallet selected</span>}
                  <TableCoinRack preferences={coins}
                  chip={stakeRupees}
                  onSelect={selectStake}
                  disabled={!user || config.data?.enabled !== true || busy || autoRunning}
                  idSuffix="-dice"
                  layout="fit"
                  className="mt-2"
                />
              </div>

              <GameInformationSection><label className="flex items-center justify-between text-[11px] uppercase font-bold text-white/50 cursor-pointer">
                <span>Use bonus wallet</span>
                <input
                  type="checkbox"
                  checked={useBonus}
                  onChange={(e) => setUseBonus(e.target.checked)}
                  disabled={busy || autoRunning}
                  className="h-4 w-4 accent-cyan-400"
                  data-testid="toggle-dice-bonus"
                />
              </label></GameInformationSection>

              <div>
                <label className="text-[11px] uppercase font-bold text-white/50 mb-1.5 block">
                  Direction
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["over", "under"] as Direction[]).map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDirection(d)}
                      disabled={busy || autoRunning}
                      className={cn(
                        "h-10 text-xs uppercase font-bold",
                        direction === d
                          ? "bg-cyan-500/20 border-cyan-400/60 text-cyan-200"
                          : "bg-[#1a1030] border-white/10 hover:bg-[#22143f]",
                      )}
                      data-testid={`btn-direction-${d}`}
                    >
                      Roll {d}
                    </Button>
                  ))}
                </div>
              </div>

              <AutoBetStatus seconds={autoSubmit.seconds} busy={busy} onCancel={autoSubmit.cancel} />
            </div>

            {/* Auto-bet */}
            <GameInformationSection><div className="rounded-xl bg-[#130b24] border border-white/5 p-3 sm:p-4 flex flex-col gap-2">
              <label className="text-[11px] uppercase font-bold text-white/50">
                Auto Bet
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={autoCount}
                  onChange={(e) =>
                    setAutoCount(
                      Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={autoRunning}
                  className="h-10 w-24 text-sm font-mono bg-[#1a1030] border-white/10"
                  data-testid="input-auto-count"
                />
                {autoRunning ? (
                  <Button
                    type="button"
                    onClick={stopAuto}
                    variant="outline"
                    className="flex-1 h-10 bg-rose-500/20 border-rose-500/40 text-rose-200 hover:bg-rose-500/30"
                    data-game-bet data-testid="btn-auto-stop"
                  >
                    <Pause className="w-4 h-4 mr-1" /> Stop
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={startAuto}
                    disabled={busy || !user}
                    variant="outline"
                    className="flex-1 h-10 bg-[#1a1030] border-white/10 hover:bg-[#22143f]"
                    data-game-bet data-testid="btn-auto-start"
                  >
                    <Play className="w-4 h-4 mr-1" /> Auto
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={stopOnWin}
                    onChange={(e) => setStopOnWin(e.target.checked)}
                    disabled={autoRunning}
                    className="accent-emerald-400"
                    data-testid="check-stop-win"
                  />
                  Stop on win
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={stopOnLoss}
                    onChange={(e) => setStopOnLoss(e.target.checked)}
                    disabled={autoRunning}
                    className="accent-rose-400"
                    data-testid="check-stop-loss"
                  />
                  Stop on loss
                </label>
              </div>
            </div></GameInformationSection>
            {autoRunning && <Button onClick={stopAuto} className="h-10 bg-rose-700 hover:bg-rose-600" data-testid="btn-auto-stop-main">Stop auto</Button>}

            {/* Recent rolls */}
            <GameInformationSection><div className="rounded-xl bg-[#130b24] border border-white/5 p-3 sm:p-4 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              <div className="text-[11px] uppercase font-bold text-white/50">
                Your Recent Rolls
              </div>
              {recent.data && recent.data.length > 0 ? (
                recent.data.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openVerify(r)}
                    className="text-left p-2 rounded-md bg-[#1a1030] hover:bg-[#22143f] flex items-center justify-between gap-2"
                    data-testid={`recent-${r.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        className={cn(
                          "text-[10px] font-mono",
                          r.didWin
                            ? "bg-emerald-500 text-black"
                            : "bg-zinc-700 text-white/80",
                        )}
                      >
                        {r.roll.toFixed(2)}
                      </Badge>
                      <span className="text-xs text-white/60 font-mono truncate">
                        {r.direction === "over" ? "▲" : "▼"} {r.target.toFixed(2)} • {r.multiplier.toFixed(2)}×
                      </span>
                    </div>
                    <span className="text-xs text-white/80 font-mono shrink-0">
                      ₹{formatRupees(r.payoutAmount)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="text-xs text-white/40 italic">
                  Roll the dice to start.
                </div>
              )}
            </div></GameInformationSection>

            {/* Live ticker */}
            <GameInformationSection><div className="rounded-xl bg-[#130b24] border border-white/5 p-3 sm:p-4 flex flex-col gap-2 max-h-[200px] overflow-y-auto">
              <div className="text-[11px] uppercase font-bold text-white/50">
                Live Dice Wins
              </div>
              {ticker.length > 0 ? (
                ticker.map((t) => (
                  <div
                    key={t.id}
                    className="text-xs flex items-center justify-between gap-2"
                  >
                    <span className="text-white/60 truncate">{t.name}</span>
                    {t.payout !== null ? (
                      <span
                        className={cn(
                          "font-mono",
                          t.status === "cashed_out"
                            ? "text-emerald-400"
                            : "text-white/40",
                        )}
                      >
                        ₹{t.payout.toLocaleString("en-IN")}
                      </span>
                    ) : (
                      <span className="font-mono text-white/40">
                        ₹{t.stake.toLocaleString("en-IN")}…
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/40 italic">
                  Waiting for live action…
                </div>
              )}
            </div></GameInformationSection>
          </div>
        </div>
      </div>

      {/* Fairness drawer */}
      <Dialog open={fairnessOpen} onOpenChange={setFairnessOpen}>
        <DialogContent className="bg-[#0f0820] border border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase tracking-wider">
              Provably Fair
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-white/70 text-xs leading-relaxed">
              Each roll is derived from{" "}
              <span className="font-mono text-cyan-300">SHA-256(serverSeed:clientSeed:nonce:i)</span>.
              The server seed hash is committed before any roll. After you rotate,
              the prior seed is revealed and you can verify every past roll.
            </p>
            <div className="rounded-lg bg-[#1a1030] p-3 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash (active)
                </div>
                <div className="text-[10px] font-mono text-cyan-200 break-all">
                  {seed.data?.serverSeedHash ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Client Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {seed.data?.clientSeed ?? "—"}
                </div>
              </div>
              <div className="text-[10px] text-white/50">
                Next nonce: <span className="font-mono">{seed.data?.nextNonce ?? "—"}</span>
              </div>
            </div>
            {revealed && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-1">
                <div className="text-[10px] uppercase text-emerald-300 font-bold">
                  Revealed (previous seed)
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
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold"
              data-testid="btn-rotate-seed"
            >
              {rotating ? "Rotating…" : "Rotate seed (reveal current)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify dialog */}
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
              Round Verification
            </DialogTitle>
          </DialogHeader>
          {verifyOpen && (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">Roll</div>
                  <div className="font-mono">{verifyOpen.roll.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">Bet</div>
                  <div className="font-mono">
                    {verifyOpen.direction === "over" ? "▲" : "▼"} {verifyOpen.target.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">Multiplier</div>
                  <div className="font-mono">{verifyOpen.multiplier.toFixed(2)}×</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-white/40 font-bold">Payout</div>
                  <div className="font-mono">₹{formatRupees(verifyOpen.payoutAmount)}</div>
                </div>
              </div>
              <div className="rounded-lg bg-[#1a1030] p-2 space-y-1">
                <div className="text-[10px] uppercase text-white/40 font-bold">
                  Server Seed Hash
                </div>
                <div className="text-[10px] font-mono text-cyan-200 break-all">
                  {verifyOpen.serverSeedHash}
                </div>
                <div className="text-[10px] uppercase text-white/40 font-bold mt-2">
                  Server Seed
                </div>
                <div className="text-[10px] font-mono text-white/80 break-all">
                  {verifyOpen.serverSeed ??
                    "(hidden until you rotate the active seed)"}
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
                  {verifyData.verified ? "✔ Verified" : "✘ Mismatch"} — hash {verifyData.hashMatch ? "ok" : "bad"} • roll {verifyData.rollMatch ? "ok" : "bad"} • mult {verifyData.multiplierMatch ? "ok" : "bad"}
                  <div className="mt-1 text-white/60">
                    Server-computed roll: {verifyData.computedRoll.toFixed(2)} · win chance {verifyData.computedWinChance.toFixed(2)}%
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
