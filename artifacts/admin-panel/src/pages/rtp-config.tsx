import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeTopic } from "@workspace/api-client-react";
import type { GameConfigUpdatedEvent, TableRoundsEvent } from "@workspace/api-zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Settings,
  AlertTriangle,
  Gamepad2,
  Radio,
  Info,
  Lock,
  ChevronRight,
} from "lucide-react";
import { paiseToINR } from "@/lib/format";
import { hasRole, useAuth } from "@/lib/auth.tsx";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.VITE_API_URL || "/api";

// ── Types ────────────────────────────────────────────────────────────────────

type EngineType =
  | "crash"
  | "skill"
  | "roulette"
  | "card_fixed"
  | "horse_racing"
  | "lucky7";

interface PaytableRow {
  outcome: string;
  pays: string;
  theoreticalRtp?: string;
}
interface CardPaytable {
  rows: PaytableRow[];
  blendedEdge: string;
}
interface GameTypeMeta {
  gameCode: string;
  engineType: EngineType;
  label: string;
  editableFields: string[];
  capFloors: Record<string, number>;
  rtpNote: string;
  paytable?: CardPaytable;
}

interface GameSummary {
  id: string;
  gameCode: string;
  title: string;
  route: string;
  rtpMin: number;
  rtpMax: number;
  maxMultiplier: number;
  maxStakePaise: string;
  houseEdge: number;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

interface GameConfig extends GameSummary {
  bettingWindowMs: number;
  turboBettingWindowMs: number;
  interRoundDelayMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
  minStakePaise: string;
  minAutoCashout: number;
  maxAutoCashout: number;
}

interface TableRoundPhase {
  roundId: string;
  phase: "betting" | "reveal" | "settling";
  endsAt: number;
}

/** GET /game/config/:gameCode/round-status — open round + its config snapshot */
interface RoundCycleStatus {
  roundId: string;
  phase: "betting" | "reveal" | "settling" | string;
  bettingEndsAt: number;
  revealEndsAt: number;
  settleEndsAt: number;
  config: {
    houseEdge: number;
    maxMultiplier: number;
    maxStakePaise: string;
    minStakePaise: string;
    bettingWindowMs: number;
    revealDurationMs: number;
    settleDurationMs: number;
  };
}

function phaseFromStatus(s: RoundCycleStatus): TableRoundPhase | null {
  if (s.phase !== "betting" && s.phase !== "reveal" && s.phase !== "settling")
    return null;
  const endsAt =
    s.phase === "betting"
      ? s.bettingEndsAt
      : s.phase === "reveal"
        ? s.revealEndsAt
        : s.settleEndsAt;
  return { roundId: s.roundId, phase: s.phase, endsAt };
}

// ── Group labels & ordering ──────────────────────────────────────────────────

const ENGINE_GROUPS: { type: EngineType; label: string; icon: string }[] = [
  { type: "crash",        label: "Crash / Plane",       icon: "✈" },
  { type: "skill",        label: "Skill",               icon: "🎯" },
  { type: "roulette",     label: "Roulette",            icon: "🎰" },
  { type: "card_fixed",   label: "Card / Table",        icon: "🃏" },
  { type: "lucky7",       label: "Lucky 7",             icon: "🎲" },
  { type: "horse_racing", label: "Horse Racing",        icon: "🐴" },
];

// ── Helper ───────────────────────────────────────────────────────────────────

function editable(meta: GameTypeMeta | undefined, field: string): boolean {
  return !meta || meta.editableFields.includes(field);
}

function capFloor(meta: GameTypeMeta | undefined, field: string): number {
  return meta?.capFloors[field] ?? 2;
}

// ── Inline note component ────────────────────────────────────────────────────

function FieldNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{children}</p>
  );
}

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 ml-1.5">
      <Lock className="h-2.5 w-2.5" /> fixed by paytable
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function RtpConfigPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canWrite = hasRole(user, "admin", "super_admin");

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pendingPatch, setPendingPatch] = useState<Record<string, unknown>>({});
  const [liveAt, setLiveAt] = useState<number | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────

  const { data: games, isLoading: loadingGames } = useQuery<GameSummary[]>({
    queryKey: ["admin-games"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/admin/games`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch games");
      return res.json();
    },
  });

  const { data: typeMeta } = useQuery<Record<string, GameTypeMeta>>({
    queryKey: ["game-type-meta"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/game/config/game-type-meta`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch type metadata");
      return res.json();
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!selectedCode && games && games.length > 0) {
      const lunar = games.find((g) => g.gameCode === "lunar");
      setSelectedCode(lunar?.gameCode ?? games[0]!.gameCode);
    }
  }, [games, selectedCode]);

  const { data: config, isLoading: loadingConfig } = useQuery<GameConfig>({
    queryKey: ["game-config", selectedCode],
    enabled: !!selectedCode,
    queryFn: async () => {
      const res = await fetch(`${BASE}/game/config/${selectedCode}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch config");
      const raw = await res.json();
      const meta = games?.find((g) => g.gameCode === raw.gameCode);
      return {
        ...raw,
        title: meta?.title ?? raw.gameCode,
        route: meta?.route ?? `/${raw.gameCode}`,
      };
    },
  });

  useRealtimeTopic<GameConfigUpdatedEvent>(
    selectedCode ? `game-config:${selectedCode}` : null,
    (ev) => {
      if (!ev || ev.type !== "updated") return;
      setLiveAt(Date.now());
      void qc.invalidateQueries({ queryKey: ["game-config", selectedCode] });
      void qc.invalidateQueries({ queryKey: ["admin-games"] });
    },
  );

  // ── Live round-cycle status for shared-round table games ──────────────
  const selectedMeta = selectedCode ? typeMeta?.[selectedCode] : undefined;
  const isTableRoundGame =
    (selectedMeta?.engineType === "card_fixed" ||
      selectedMeta?.engineType === "lucky7") &&
    selectedMeta.editableFields.includes("revealDurationMs");
  const [roundPhase, setRoundPhase] = useState<TableRoundPhase | null>(null);
  // Set after a successful save on a shared-round game; cleared once a new
  // round is observed whose config snapshot matches the saved values.
  const [awaitingNextRound, setAwaitingNextRound] = useState(false);
  const [appliedRoundId, setAppliedRoundId] = useState<string | null>(null);

  useEffect(() => {
    // reset when switching games so a stale phase never shows
    setRoundPhase(null);
    setAwaitingNextRound(false);
    setAppliedRoundId(null);
  }, [selectedCode]);

  // Bootstrap + resync: the realtime topic only pushes future phase
  // transitions (no state replay), so fetch the open round's status on load
  // and keep a slow poll as a reconnect/stale-phase safety net.
  const { data: roundStatus, refetch: refetchRoundStatus } =
    useQuery<RoundCycleStatus | null>({
      queryKey: ["round-status", selectedCode],
      enabled: !!selectedCode && isTableRoundGame,
      refetchInterval: 15_000,
      queryFn: async () => {
        const res = await fetch(
          `${BASE}/game/config/${selectedCode}/round-status`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to fetch round status");
        return res.json();
      },
    });

  useEffect(() => {
    if (!isTableRoundGame) return;
    if (roundStatus === null) {
      setRoundPhase(null);
      return;
    }
    if (!roundStatus) return;
    const snap = phaseFromStatus(roundStatus);
    if (!snap) return;
    // Adopt the snapshot unless we already track the same round in a LATER
    // phase (realtime events can be fresher than the poll).
    setRoundPhase((prev) => {
      if (!prev || prev.roundId !== snap.roundId) return snap;
      const order = { betting: 0, reveal: 1, settling: 2 } as const;
      return order[snap.phase] >= order[prev.phase] ? snap : prev;
    });
  }, [roundStatus, isTableRoundGame]);

  // Stale-phase guard: if the tracked deadline passed and no event followed
  // (e.g. WebSocket dropped), resync from the server instead of freezing.
  useEffect(() => {
    if (!roundPhase) return;
    const wait = roundPhase.endsAt + 2_500 - Date.now();
    const t = setTimeout(() => void refetchRoundStatus(), Math.max(0, wait));
    return () => clearTimeout(t);
  }, [roundPhase, refetchRoundStatus]);

  useRealtimeTopic<TableRoundsEvent>(
    isTableRoundGame ? `table-rounds:${selectedCode}` : null,
    (ev) => {
      if (!ev) return;
      if (ev.type === "phase") {
        setRoundPhase({ roundId: ev.roundId, phase: ev.phase, endsAt: ev.endsAt });
        // A fresh betting round after a save: pull its config snapshot so we
        // can confirm the change is live.
        if (ev.phase === "betting") void refetchRoundStatus();
      } else if (ev.type === "settled") {
        setRoundPhase(null);
      }
    },
  );

  // Next-round-applied confirmation: compare the open round's config
  // snapshot with the saved config; when they match, the change is live.
  useEffect(() => {
    if (!awaitingNextRound || !roundStatus || !config) return;
    const c = roundStatus.config;
    const matches =
      c.bettingWindowMs === config.bettingWindowMs &&
      c.revealDurationMs === config.revealDurationMs &&
      c.settleDurationMs === config.settleDurationMs &&
      c.minStakePaise === config.minStakePaise &&
      c.maxStakePaise === config.maxStakePaise &&
      c.maxMultiplier === config.maxMultiplier;
    if (matches) {
      setAwaitingNextRound(false);
      setAppliedRoundId(roundStatus.roundId);
    }
  }, [awaitingNextRound, roundStatus, config]);

  // ── Local form state ───────────────────────────────────────────────────

  const [maxMult, setMaxMult] = useState(1000);
  const [maxStake, setMaxStake] = useState("50000000");
  const [houseEdge, setHouseEdge] = useState(0.03);
  const [enabled, setEnabled] = useState(true);
  const [bettingWindowS, setBettingWindowS] = useState(5);
  const [turboWindowS, setTurboWindowS] = useState(2.5);
  const [interRoundS, setInterRoundS] = useState(2.5);
  const [revealS, setRevealS] = useState(5);
  const [settleS, setSettleS] = useState(5);
  const [minStake, setMinStake] = useState("0");
  const [minAutoCash, setMinAutoCash] = useState(1.01);
  const [maxAutoCash, setMaxAutoCash] = useState(1000);

  useEffect(() => {
    if (config) {
      setMaxMult(config.maxMultiplier);
      setMaxStake(config.maxStakePaise);
      setHouseEdge(config.houseEdge);
      setEnabled(config.enabled);
      setBettingWindowS(config.bettingWindowMs / 1000);
      setTurboWindowS(config.turboBettingWindowMs / 1000);
      setInterRoundS(config.interRoundDelayMs / 1000);
      setRevealS(config.revealDurationMs / 1000);
      setSettleS(config.settleDurationMs / 1000);
      setMinStake(config.minStakePaise);
      setMinAutoCash(config.minAutoCashout);
      setMaxAutoCash(config.maxAutoCashout);
    }
  }, [config]);

  // ── Mutation ───────────────────────────────────────────────────────────

  const update = useMutation({
    mutationFn: async ({
      patch,
      password,
    }: {
      patch: Record<string, unknown>;
      password: string;
    }) => {
      if (!selectedCode) throw new Error("No game selected");
      const res = await fetch(`${BASE}/game/config/${selectedCode}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Confirm-Password": password,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to update config");
      }
      return res.json();
    },
    onSuccess: (fresh) => {
      toast({ title: `${config?.title ?? "Game"} config updated` });
      if (isTableRoundGame) {
        setAwaitingNextRound(true);
        setAppliedRoundId(null);
      }
      if (fresh && selectedCode) {
        qc.setQueryData(
          ["game-config", selectedCode],
          (prev: GameConfig | undefined) => ({
            ...(prev ?? ({} as GameConfig)),
            ...fresh,
          }),
        );
      }
      void qc.invalidateQueries({ queryKey: ["game-config"] });
      void qc.invalidateQueries({ queryKey: ["admin-games"] });
      setConfirmOpen(false);
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Dirty patch — only send fields editable for this engine type ───────

  const meta = selectedCode ? typeMeta?.[selectedCode] : undefined;

  const dirtyPatch = useMemo(() => {
    if (!config) return {};
    const patch: Record<string, unknown> = {};
    const can = (field: string) => editable(meta, field);

    if (can("maxMultiplier") && maxMult !== config.maxMultiplier)
      patch.maxMultiplier = maxMult;
    if (can("maxStakePaise") && maxStake !== config.maxStakePaise)
      patch.maxStakePaise = maxStake;
    if (can("houseEdge") && houseEdge !== config.houseEdge)
      patch.houseEdge = houseEdge;
    if (enabled !== config.enabled) patch.enabled = enabled;
    if (can("bettingWindowMs")) {
      const bwMs = Math.round(bettingWindowS * 1000);
      if (bwMs !== config.bettingWindowMs) patch.bettingWindowMs = bwMs;
    }
    if (can("turboBettingWindowMs")) {
      const twMs = Math.round(turboWindowS * 1000);
      if (twMs !== config.turboBettingWindowMs) patch.turboBettingWindowMs = twMs;
    }
    if (can("interRoundDelayMs")) {
      const irMs = Math.round(interRoundS * 1000);
      if (irMs !== config.interRoundDelayMs) patch.interRoundDelayMs = irMs;
    }
    if (can("revealDurationMs")) {
      const rvMs = Math.round(revealS * 1000);
      if (rvMs !== config.revealDurationMs) patch.revealDurationMs = rvMs;
    }
    if (can("settleDurationMs")) {
      const stMs = Math.round(settleS * 1000);
      if (stMs !== config.settleDurationMs) patch.settleDurationMs = stMs;
    }
    if (can("minStakePaise") && minStake !== config.minStakePaise)
      patch.minStakePaise = minStake;
    if (can("minAutoCashout") && minAutoCash !== config.minAutoCashout)
      patch.minAutoCashout = minAutoCash;
    if (can("maxAutoCashout") && maxAutoCash !== config.maxAutoCashout)
      patch.maxAutoCashout = maxAutoCash;
    return patch;
  }, [
    config,
    meta,
    maxMult,
    maxStake,
    houseEdge,
    enabled,
    bettingWindowS,
    turboWindowS,
    interRoundS,
    revealS,
    settleS,
    minStake,
    minAutoCash,
    maxAutoCash,
  ]);

  const handleSave = () => {
    if (Object.keys(dirtyPatch).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }
    if (
      editable(meta, "minAutoCashout") &&
      editable(meta, "maxAutoCashout") &&
      maxAutoCash < minAutoCash
    ) {
      toast({
        title: "Invalid auto-cashout band",
        description: "Max must be ≥ min.",
        variant: "destructive",
      });
      return;
    }
    if (editable(meta, "minStakePaise")) {
      let minS: bigint, maxS: bigint;
      try {
        minS = BigInt(minStake || "0");
        maxS = BigInt(maxStake || "0");
      } catch {
        toast({
          title: "Invalid stake value",
          description: "Stakes must be whole numbers in paise.",
          variant: "destructive",
        });
        return;
      }
      if (minS > maxS) {
        toast({
          title: "Invalid bet limits",
          description: "Min bet cannot be above max bet.",
          variant: "destructive",
        });
        return;
      }
    }
    if (
      editable(meta, "bettingWindowMs") &&
      (bettingWindowS < 1 || bettingWindowS > 120)
    ) {
      toast({
        title: "Invalid betting window",
        description: "The betting window must be between 1 and 120 seconds.",
        variant: "destructive",
      });
      return;
    }
    if (
      editable(meta, "revealDurationMs") &&
      (revealS < 1 || revealS > 60 || settleS < 1 || settleS > 60)
    ) {
      toast({
        title: "Invalid phase duration",
        description:
          "Reveal and settlement phases must be between 1 and 60 seconds.",
        variant: "destructive",
      });
      return;
    }
    setPendingPatch(dirtyPatch);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!confirmPassword) return;
    update.mutate({ patch: pendingPatch, password: confirmPassword });
  };

  const liveActive = liveAt !== null && Date.now() - liveAt < 4000;

  // ── Group games by engine type ─────────────────────────────────────────

  const grouped = useMemo(() => {
    if (!games || !typeMeta) return null;
    const map = new Map<EngineType, GameSummary[]>();
    for (const g of games) {
      const m = typeMeta[g.gameCode];
      const type: EngineType = m?.engineType ?? "crash";
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(g);
    }
    return map;
  }, [games, typeMeta]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loadingGames) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Loading games…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Shield className="h-6 w-6 text-emerald-600" />
          Game Settings
        </h1>
        <p className="text-sm text-slate-500">
          Per-game controls. Only fields that the engine actually reads are
          editable — fixed-paytable games show read-only theoretical RTP.
          All saves require step-up password confirmation and are recorded in
          the audit log.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        {/* ── Grouped game picker ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-slate-500" />
              Games
            </CardTitle>
            <CardDescription>Grouped by engine type</CardDescription>
          </CardHeader>
          <CardContent className="p-2 space-y-3">
            {grouped
              ? ENGINE_GROUPS.map(({ type, label, icon }) => {
                  const group = grouped.get(type);
                  if (!group || group.length === 0) return null;
                  return (
                    <div key={type}>
                      <div className="px-3 py-1 text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                        <span>{icon}</span>
                        {label}
                      </div>
                      {group.map((g) => {
                        const active = g.gameCode === selectedCode;
                        return (
                          <button
                            key={g.gameCode}
                            type="button"
                            onClick={() => setSelectedCode(g.gameCode)}
                            data-testid={`btn-game-${g.gameCode}`}
                            className={cn(
                              "w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between",
                              active
                                ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                                : "hover:bg-slate-50",
                            )}
                          >
                            <div>
                              <div className="text-sm font-medium">{g.title}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {g.gameCode}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant={g.enabled ? "default" : "secondary"}
                                className={cn(
                                  "text-[10px]",
                                  g.enabled
                                    ? "bg-emerald-600 hover:bg-emerald-600"
                                    : "bg-slate-300 text-slate-700 hover:bg-slate-300",
                                )}
                              >
                                {g.enabled ? "LIVE" : "OFF"}
                              </Badge>
                              {active && (
                                <ChevronRight className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              : (games ?? []).map((g) => (
                  <button
                    key={g.gameCode}
                    type="button"
                    onClick={() => setSelectedCode(g.gameCode)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between",
                      g.gameCode === selectedCode
                        ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <span className="text-sm font-medium">{g.title}</span>
                    <Badge
                      variant={g.enabled ? "default" : "secondary"}
                      className={cn(
                        "text-[10px]",
                        g.enabled
                          ? "bg-emerald-600 hover:bg-emerald-600"
                          : "bg-slate-300 text-slate-700 hover:bg-slate-300",
                      )}
                    >
                      {g.enabled ? "LIVE" : "OFF"}
                    </Badge>
                  </button>
                ))}
          </CardContent>
        </Card>

        {/* ── Editor ──────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {!selectedCode || loadingConfig || !config ? (
            <div className="flex items-center justify-center h-64 text-slate-500">
              Loading game config…
            </div>
          ) : (
            <GameEditor
              config={config}
              meta={meta}
              canWrite={canWrite}
              liveActive={liveActive}
              // field state
              maxMult={maxMult}
              setMaxMult={setMaxMult}
              maxStake={maxStake}
              setMaxStake={setMaxStake}
              houseEdge={houseEdge}
              setHouseEdge={setHouseEdge}
              enabled={enabled}
              setEnabled={setEnabled}
              bettingWindowS={bettingWindowS}
              setBettingWindowS={setBettingWindowS}
              turboWindowS={turboWindowS}
              setTurboWindowS={setTurboWindowS}
              interRoundS={interRoundS}
              setInterRoundS={setInterRoundS}
              revealS={revealS}
              setRevealS={setRevealS}
              settleS={settleS}
              setSettleS={setSettleS}
              minStake={minStake}
              setMinStake={setMinStake}
              roundPhase={isTableRoundGame ? roundPhase : null}
              awaitingNextRound={isTableRoundGame && awaitingNextRound}
              appliedRoundId={isTableRoundGame ? appliedRoundId : null}
              minAutoCash={minAutoCash}
              setMinAutoCash={setMinAutoCash}
              maxAutoCash={maxAutoCash}
              setMaxAutoCash={setMaxAutoCash}
              dirtyPatch={dirtyPatch}
              onSave={handleSave}
            />
          )}
        </div>
      </div>

      {/* ── Confirm dialog ──────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Confirm config change · {config?.title ?? selectedCode}
            </DialogTitle>
            <DialogDescription>
              This is a sensitive action. Re-enter your admin password to
              confirm. All edits are written to the audit log with a
              before/after diff and broadcast live to connected players.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              data-testid="input-confirm-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmPassword("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!confirmPassword || update.isPending}
              data-testid="btn-confirm-save"
            >
              {update.isPending ? "Saving..." : "Confirm & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Live round-cycle status badge (shared table rounds) ─────────────────────

const PHASE_STYLES: Record<TableRoundPhase["phase"], string> = {
  betting: "bg-emerald-50 text-emerald-800 border-emerald-200",
  reveal: "bg-amber-50 text-amber-800 border-amber-200",
  settling: "bg-blue-50 text-blue-800 border-blue-200",
};
const PHASE_LABELS: Record<TableRoundPhase["phase"], string> = {
  betting: "Betting open",
  reveal: "Revealing",
  settling: "Settling",
};

function TableRoundStatus({ phase }: { phase: TableRoundPhase | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!phase) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  if (!phase) {
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500"
        data-testid="badge-round-phase"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        Waiting for round…
      </span>
    );
  }
  const remaining = Math.max(0, Math.ceil((phase.endsAt - now) / 1000));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        PHASE_STYLES[phase.phase],
      )}
      data-testid="badge-round-phase"
    >
      <Radio className="h-3 w-3 animate-pulse" />
      {PHASE_LABELS[phase.phase]} · {remaining}s
    </span>
  );
}

// ── Per-game editor ──────────────────────────────────────────────────────────

interface EditorProps {
  config: GameConfig;
  meta: GameTypeMeta | undefined;
  canWrite: boolean;
  liveActive: boolean;
  maxMult: number;
  setMaxMult: (v: number) => void;
  maxStake: string;
  setMaxStake: (v: string) => void;
  houseEdge: number;
  setHouseEdge: (v: number) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  bettingWindowS: number;
  setBettingWindowS: (v: number) => void;
  turboWindowS: number;
  setTurboWindowS: (v: number) => void;
  interRoundS: number;
  setInterRoundS: (v: number) => void;
  revealS: number;
  setRevealS: (v: number) => void;
  settleS: number;
  setSettleS: (v: number) => void;
  minStake: string;
  setMinStake: (v: string) => void;
  roundPhase: TableRoundPhase | null;
  awaitingNextRound: boolean;
  appliedRoundId: string | null;
  minAutoCash: number;
  setMinAutoCash: (v: number) => void;
  maxAutoCash: number;
  setMaxAutoCash: (v: number) => void;
  dirtyPatch: Record<string, unknown>;
  onSave: () => void;
}

function GameEditor({
  config,
  meta,
  canWrite,
  liveActive,
  maxMult,
  setMaxMult,
  maxStake,
  setMaxStake,
  houseEdge,
  setHouseEdge,
  enabled,
  setEnabled,
  bettingWindowS,
  setBettingWindowS,
  turboWindowS,
  setTurboWindowS,
  interRoundS,
  setInterRoundS,
  revealS,
  setRevealS,
  settleS,
  setSettleS,
  minStake,
  setMinStake,
  roundPhase,
  awaitingNextRound,
  appliedRoundId,
  minAutoCash,
  setMinAutoCash,
  maxAutoCash,
  setMaxAutoCash,
  dirtyPatch,
  onSave,
}: EditorProps) {
  const engineType = meta?.engineType ?? "crash";
  const isCrash = engineType === "crash";
  const isSkill = engineType === "skill";
  const isRoulette = engineType === "roulette";
  const isCardFixed = engineType === "card_fixed";
  const isHorseRacing = engineType === "horse_racing";
  const isLucky7 = engineType === "lucky7";
  // Games whose rounds are driven by the shared server round clock.
  const isSharedRoundGame = isCardFixed || isLucky7;
  const multFloor = capFloor(meta, "maxMultiplier");

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold flex items-center gap-2"
            data-testid="text-game-title"
          >
            {config.title}
            {liveActive && (
              <Badge
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-600 text-[10px] gap-1"
                data-testid="badge-live-broadcast"
              >
                <Radio className="h-3 w-3 animate-pulse" />
                LIVE PUSHED
              </Badge>
            )}
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            {config.gameCode} · {config.route}
            {meta && (
              <span className="ml-2 text-slate-400">
                [{meta.label} engine]
              </span>
            )}
          </p>
        </div>
        <div className="text-xs text-slate-500 text-right">
          Last updated {new Date(config.updatedAt).toLocaleString()}
          {config.updatedBy ? (
            <div>by {config.updatedBy.slice(0, 8)}</div>
          ) : null}
        </div>
      </div>

      {/* Engine note */}
      {meta && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
          <span>{meta.rtpNote}</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── House edge (crash / skill / roulette / horse racing) ────── */}
        {editable(meta, "houseEdge") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">House Edge</CardTitle>
              <CardDescription>
                {isCrash
                  ? "Scales crash-point derivation. Higher edge → earlier average crash."
                  : isRoulette
                  ? "Scales every payout proportionally. 1/37 ≈ 2.70% gives classic 35:1."
                  : isHorseRacing
                  ? "Shifts all fixed-odds payouts simultaneously via (1−edge)/winProb."
                  : "Scales payout multipliers for this game's engine."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="number"
                min={0}
                max={1}
                step={0.001}
                value={houseEdge}
                onChange={(e) => setHouseEdge(Number(e.target.value))}
                disabled={!canWrite}
                data-testid="input-house-edge"
              />
              <p className="text-xs text-slate-600 font-medium">
                {(houseEdge * 100).toFixed(2)}% edge → player RTP ≈{" "}
                <span className="text-emerald-700 font-bold">
                  {((1 - houseEdge) * 100).toFixed(2)}%
                </span>
              </p>
              {houseEdge > 0.2 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    Edge above 20% will materially increase player churn.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Read-only RTP display for card_fixed games ────────────────── */}
        {isCardFixed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                House Edge / RTP
                <ReadOnlyBadge />
              </CardTitle>
              <CardDescription>
                Determined by the fixed paytable. Cannot be changed from the
                admin panel without modifying the game engine.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-black text-emerald-700">
                {meta?.paytable?.blendedEdge ?? "see paytable"}
              </div>
              <p className="text-xs text-slate-500">
                blended house edge (varies by bet mix)
              </p>
              <p className="text-[11px] text-slate-400">
                Adjust the paytable in the game engine code to change RTP.
                Live odds cannot be moved from this panel.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Multiplier cap ──────────────────────────────────────────── */}
        {editable(meta, "maxMultiplier") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {isCardFixed ? "Max Payout Multiplier Cap" : "Multiplier Cap"}
              </CardTitle>
              <CardDescription>
                {isCardFixed
                  ? `Must stay ≥ ${multFloor} to cover the highest-paying bet.`
                  : isCrash
                  ? "Maximum crash point allowed. Sets the jackpot ceiling."
                  : isRoulette
                  ? "Must stay ≥ 36 (straight-up 35:1 → 36× total return)."
                  : "Maximum return multiplier per bet."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                type="number"
                min={multFloor}
                max={100000}
                value={maxMult}
                onChange={(e) => setMaxMult(Number(e.target.value))}
                disabled={!canWrite}
                data-testid="input-max-multiplier"
              />
              {maxMult < multFloor && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    Value is below the safety floor of {multFloor}. The server
                    will reject this update.
                  </div>
                </div>
              )}
              <FieldNote>
                Floor: {multFloor}× (minimum to cover highest winning bet).
              </FieldNote>
            </CardContent>
          </Card>
        )}

        {/* ── Max stake ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Max Stake per Bet</CardTitle>
            <CardDescription>In paise (100 paise = ₹1)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="text"
              value={maxStake}
              onChange={(e) => setMaxStake(e.target.value.replace(/\D/g, ""))}
              disabled={!canWrite}
              data-testid="input-max-stake"
            />
            <p className="text-xs font-medium text-slate-600">
              = {paiseToINR(maxStake)}
            </p>
            <FieldNote>
              Applies per-bet, not per-round. Players may place multiple bets
              in the same round (e.g. roulette, baccarat side bets).
            </FieldNote>
          </CardContent>
        </Card>

        {/* ── Round timings (crash only) ──────────────────────────────── */}
        {isCrash && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Round Timings</CardTitle>
              <CardDescription>
                Controls the server-side round scheduler. New values apply on
                the next round; in-flight rounds keep their snapshot.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Betting window (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={bettingWindowS}
                  onChange={(e) => setBettingWindowS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-betting-window-s"
                />
                <FieldNote>
                  Time players have to place a bet before the plane takes off
                  (1–30s). Shorter = more rounds per hour.
                </FieldNote>
              </div>
              <div>
                <Label>Turbo betting window (s)</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={turboWindowS}
                  onChange={(e) => setTurboWindowS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-turbo-window-s"
                />
                <FieldNote>
                  Used when the player has Turbo mode on. Usually shorter than
                  the standard window.
                </FieldNote>
              </div>
              <div>
                <Label>Inter-round delay (s)</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={15}
                  step={0.5}
                  value={interRoundS}
                  onChange={(e) => setInterRoundS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-inter-round-s"
                />
                <FieldNote>
                  Pause shown after a crash before the next round starts.
                </FieldNote>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Table-round timings (shared server rounds) ───────────────── */}
        {isSharedRoundGame && editable(meta, "revealDurationMs") && (
          <Card className="md:col-span-2">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Round Timings</CardTitle>
                  <CardDescription>
                    All players share the same server round clock:
                    betting → reveal → settlement. Saved changes apply from
                    the <strong>next</strong> round — the in-flight round keeps
                    its snapshot.
                  </CardDescription>
                </div>
                <TableRoundStatus phase={roundPhase} />
              </div>
              {awaitingNextRound && (
                <div
                  className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  data-testid="note-awaiting-next-round"
                >
                  <Radio className="mt-0.5 h-3.5 w-3.5 animate-pulse flex-shrink-0" />
                  Saved — waiting for the next round to pick up the new
                  settings (the in-flight round keeps its snapshot).
                </div>
              )}
              {!awaitingNextRound && appliedRoundId && (
                <div
                  className="mt-2 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                  data-testid="note-change-live"
                >
                  <Radio className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Change is live — round{" "}
                  <span className="font-mono">{appliedRoundId.slice(0, 8)}</span>{" "}
                  started with the new settings.
                </div>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Betting window (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={bettingWindowS}
                  onChange={(e) => setBettingWindowS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-betting-window-s"
                />
                <FieldNote>
                  How long bets stay open each round (1–120s, default 55s).
                </FieldNote>
              </div>
              <div>
                <Label>Reveal duration (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={revealS}
                  onChange={(e) => setRevealS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-reveal-duration-s"
                />
                <FieldNote>
                  Outcome-reveal phase after betting closes (1–60s, default 5s).
                </FieldNote>
              </div>
              <div>
                <Label>Settlement duration (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={settleS}
                  onChange={(e) => setSettleS(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-settle-duration-s"
                />
                <FieldNote>
                  Payout phase before the next round opens (1–60s, default 5s).
                </FieldNote>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Min stake ───────────────────────────────────────────────── */}
        {editable(meta, "minStakePaise") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Min Stake per Bet</CardTitle>
              <CardDescription>
                In paise (100 paise = ₹1). "0" disables the minimum.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                type="text"
                value={minStake}
                onChange={(e) => setMinStake(e.target.value.replace(/\D/g, ""))}
                disabled={!canWrite}
                data-testid="input-min-stake"
              />
              <p className="text-xs font-medium text-slate-600">
                = {paiseToINR(minStake || "0")}
              </p>
              {(() => {
                try {
                  return BigInt(minStake || "0") > BigInt(maxStake || "0");
                } catch {
                  return false;
                }
              })() && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800" data-testid="warn-min-above-max">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>Min bet is above max bet — the save will be rejected.</div>
                </div>
              )}
              <FieldNote>Must stay ≤ the max stake per bet.</FieldNote>
            </CardContent>
          </Card>
        )}

        {/* ── Auto-cashout limits (crash only) ───────────────────────── */}
        {isCrash && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Auto-cashout Limits</CardTitle>
              <CardDescription>
                Inclusive bounds for the auto-cashout multiplier players can
                set. Prevents both trivial (≤1×) and absurdly high targets.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <Label>Min auto-cashout ×</Label>
                <Input
                  type="number"
                  min={1.01}
                  max={1000}
                  step={0.01}
                  value={minAutoCash}
                  onChange={(e) => setMinAutoCash(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-min-auto-cashout"
                />
              </div>
              <div>
                <Label>Max auto-cashout ×</Label>
                <Input
                  type="number"
                  min={1.01}
                  max={100000}
                  step={1}
                  value={maxAutoCash}
                  onChange={(e) => setMaxAutoCash(Number(e.target.value))}
                  disabled={!canWrite}
                  data-testid="input-max-auto-cashout"
                />
              </div>
              <FieldNote>
                Players can only choose an auto-cashout between these bounds.
                These fields are irrelevant for table games and do not appear
                there.
              </FieldNote>
            </CardContent>
          </Card>
        )}

        {/* ── Fixed paytable read-only view ───────────────────────────── */}
        {isSharedRoundGame && meta?.paytable && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                Paytable
                <ReadOnlyBadge />
              </CardTitle>
              <CardDescription>
                {isLucky7
                  ? "Fixed total returns including stake: Under/Over 2×; Exactly 7 12×. A total of 7 loses both Under and Over bets."
                  : "Theoretical payouts and RTP per bet type. These are hardcoded in the game engine and cannot be changed from the admin panel."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Pays</TableHead>
                    <TableHead className="text-right">Theoretical RTP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meta.paytable.rows.map((row) => (
                    <TableRow key={row.outcome}>
                      <TableCell className="font-medium">{row.outcome}</TableCell>
                      <TableCell className="font-mono text-sm">{row.pays}</TableCell>
                      <TableCell className="text-right text-sm">
                        {row.theoreticalRtp ? (
                          <span className="text-emerald-700 font-medium">
                            {row.theoreticalRtp}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-slate-500 mt-3">
                Blended edge across typical bet mix:{" "}
                <strong>{meta.paytable.blendedEdge}</strong>. To change the
                RTP of a card game, modify the paytable in the engine and
                update the relevant service.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Enable / disable ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="font-medium">Game Enabled</p>
            <p className="text-sm text-slate-500">
              Disable to stop all new bets immediately. Players see a
              "temporarily disabled" overlay within ~1s via the live config
              broadcast. In-flight rounds complete normally.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canWrite}
            data-testid="switch-enabled"
          />
        </CardContent>
      </Card>

      {/* ── Save row ──────────────────────────────────────────────────── */}
      {canWrite && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {Object.keys(dirtyPatch).length > 0 ? (
              <span className="text-amber-600 font-medium">
                {Object.keys(dirtyPatch).length} change
                {Object.keys(dirtyPatch).length !== 1 ? "s" : ""} pending
              </span>
            ) : (
              "No unsaved changes"
            )}
          </p>
          <Button
            onClick={onSave}
            disabled={Object.keys(dirtyPatch).length === 0}
            data-testid="btn-save"
          >
            <Settings className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      )}
    </>
  );
}
