import { BET_SEND_BUFFER_MS } from "./AutoBet";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import type {
  TableRoundsEvent,
  GameConfigUpdatedEvent,
} from "@workspace/api-zod";
import {
  preloadCroupierRoundVoice,
  voiceBetsClosed,
  voiceRoundOpen,
} from "@/game/audio";

export type RoundPhase = "betting" | "reveal" | "settling";

export interface RoundConfigSnapshot {
  andarBaharMotionVersion?: number;
  roulettePayoutBase?: number;
  vegetableOutcomeVersion?: 1 | 2;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: string;
  minStakePaise: string;
  bettingWindowMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
}

export interface LiveBet {
  displayName: string | null;
  totalStake: string;
  bets: unknown;
  createdAt: string;
}

export interface MyBet {
  slipId: string;
  totalStake: string;
  bets: unknown;
  status: string;
  payoutAmount: string;
  auditRoundId: string | null;
}

export interface TableRoundSnapshot {
  roundId: string;
  gameCode: string;
  phase: string;
  now: number;
  bettingEndsAt: number;
  revealEndsAt: number;
  settleEndsAt: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  outcome: unknown;
  serverSeed: string | null;
  totalStake: string;
  playerCount: number;
  config: RoundConfigSnapshot;
  liveBets: LiveBet[];
  myBets: MyBet[];
  recent: { roundId: string; outcome: unknown; settledAt: string | null }[];
}

export interface TableRoundState<TOutcome = unknown> {
  /** null while loading or when no round is open yet. */
  snapshot: TableRoundSnapshot | null;
  roundId: string | null;
  phase: RoundPhase | null;
  /** Absolute server-epoch deadline of the current phase. */
  phaseEndsAt: number | null;
  /** Full duration (ms) of the current phase, from server config. */
  phaseDurationMs: number | null;
  /** Drift-corrected ms remaining in the current phase (>= 0). */
  remainingMs: number;
  bettingOpen: boolean;
  /** Outcome revealed at the reveal phase (typed per game by the caller). */
  outcome: TOutcome | null;
  serverSeedHash: string | null;
  clientSeed: string | null;
  nonce: number | null;
  serverSeed: string | null;
  config: RoundConfigSnapshot | null;
  liveBets: LiveBet[];
  playerCount: number;
  totalStake: string;
  myBets: MyBet[];
  recent: { roundId: string; outcome: unknown; settledAt: string | null }[];
  /** Convert a server-epoch timestamp to local Date.now() time. */
  toLocalTime: (serverTs: number) => number;
  refetch: () => void;
}

interface Options {
  /** A video table only needs React updates when its displayed second or cutoff changes. */
  wholeSecondCountdown?: boolean;
  /** A filmed dealer can provide its own synchronized betting greeting. */
  roundOpenVoice?: boolean;
  roundClosedVoice?: boolean;
  /** Called when the round settles (payouts done) — invalidate wallet etc. */
  onSettled?: () => void;
  /** Called when the outcome is revealed for a round. */
  onResult?: (outcome: unknown, roundId: string) => void;
  /** Called when a fresh betting window opens. */
  onBettingOpen?: (roundId: string) => void;
  enabled?: boolean;
}

/**
 * Shared client for the server-driven table-round clock.
 *
 * - Seeds from `GET /api/{game}/round` (snapshot endpoint) so opening a page
 *   mid-round shows the correct phase and remaining time immediately.
 * - Follows `table-rounds:{game}` WebSocket events for phase changes, live
 *   bets, result reveal and settlement.
 * - Follows `game-config:{game}` so admin timing changes reflect next round.
 * - Drift-corrects the countdown against the server clock (`snapshot.now`).
 */
export function useTableRound<TOutcome = unknown>(
  game:
    | "roulette"
    | "baccarat"
    | "blackjack"
    | "teen-patti"
    | "andar-bahar"
    | "lucky-7"
    | "crazy-time"
    | "vegetable-bowl"
    | "teen-patti-live",
  opts: Options = {},
): TableRoundState<TOutcome> {
  const qc = useQueryClient();
  const enabled = opts.enabled !== false;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Fire each per-round callback exactly once per round, whether the trigger
  // arrives via WebSocket or via snapshot hydration (page opened mid-round).
  const lastResultRoundRef = useRef<string | null>(null);
  const lastBettingRoundRef = useRef<string | null>(null);
  const lastClosedRoundRef = useRef<string | null>(null);
  const emitResult = useCallback((value: unknown, roundId: string) => {
    if (lastResultRoundRef.current === roundId) return;
    lastResultRoundRef.current = roundId;
    optsRef.current.onResult?.(value, roundId);
  }, []);
  const emitBettingOpen = useCallback((roundId: string) => {
    if (lastBettingRoundRef.current === roundId) return;
    lastBettingRoundRef.current = roundId;
    if (optsRef.current.roundOpenVoice !== false) {
      preloadCroupierRoundVoice();
      voiceRoundOpen(game, roundId);
    }
    optsRef.current.onBettingOpen?.(roundId);
  }, [game]);

  const snapQuery = useQuery<TableRoundSnapshot | null>({
    queryKey: ["table-round", game],
    queryFn: () =>
      customFetch<TableRoundSnapshot | null>(`/api/${game}/round`, {
        method: "GET",
        credentials: "include",
      }),
    enabled,
    retry: false,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });
  // A stale proxy or an unavailable game must not hydrate an empty/non-round
  // payload into live state and crash the table while it reconnects.
  const snapshot = snapQuery.data && typeof snapQuery.data.roundId === "string"
    && Array.isArray(snapQuery.data.myBets) && Array.isArray(snapQuery.data.recent)
    ? snapQuery.data : null;

  // Server-clock offset: serverNow - clientNow. Positive when the server
  // clock is ahead of the local one.
  const offsetRef = useRef(0);
  const clockReadyRef = useRef(false);
  useEffect(() => {
    // Use receipt time, not the later React effect time: a busy first render
    // must not make every reveal deadline appear farther in the future.
    if (snapshot?.now) {
      const sample = snapshot.now - snapQuery.dataUpdatedAt;
      offsetRef.current = clockReadyRef.current ? Math.max(offsetRef.current, sample) : sample;
      clockReadyRef.current = true;
    }
  }, [snapshot?.now, snapQuery.dataUpdatedAt]);
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const toLocalTime = useCallback(
    (serverTs: number) => serverTs - offsetRef.current,
    [],
  );

  // Live phase state — snapshot-seeded, WebSocket-updated.
  const [live, setLive] = useState<{
    roundId: string;
    phase: RoundPhase;
    endsAt: number;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  } | null>(null);
  const [outcome, setOutcome] = useState<{
    roundId: string;
    value: unknown;
    serverSeed: string | null;
  } | null>(null);
  const [liveBets, setLiveBets] = useState<LiveBet[] | null>(null);
  const [liveTotals, setLiveTotals] = useState<{
    playerCount: number;
    totalStake: string;
  } | null>(null);
  const [config, setConfig] = useState<RoundConfigSnapshot | null>(null);
  // Per-round cache of my slips so a just-settled round's payouts are not
  // discarded when the next round's snapshot replaces the react-query data.
  const [myBetsByRound, setMyBetsByRound] = useState<Record<string, MyBet[]>>(
    {},
  );

  // Seed live state from the snapshot whenever it is newer than what we have.
  useEffect(() => {
    if (!snapshot) return;
    setLive((prev) => {
      const phase = snapshot.phase as RoundPhase;
      const endsAt =
        phase === "betting"
          ? snapshot.bettingEndsAt
          : phase === "reveal"
            ? snapshot.revealEndsAt
            : snapshot.settleEndsAt;
      // Never let a stale snapshot roll back a newer WS-driven phase.
      if (prev && prev.roundId === snapshot.roundId) {
        const order: Record<RoundPhase, number> = {
          betting: 0,
          reveal: 1,
          settling: 2,
        };
        if (order[prev.phase] > order[phase]) return prev;
      }
      return {
        roundId: snapshot.roundId,
        phase,
        endsAt,
        serverSeedHash: snapshot.serverSeedHash,
        clientSeed: snapshot.clientSeed,
        nonce: snapshot.nonce,
      };
    });
    if (snapshot.phase === "betting") {
      emitBettingOpen(snapshot.roundId);
    }
    if (snapshot.outcome != null) {
      emitResult(snapshot.outcome, snapshot.roundId);
      setOutcome((prev) =>
        prev && prev.roundId === snapshot.roundId
          ? { ...prev, serverSeed: snapshot.serverSeed ?? prev.serverSeed }
          : {
              roundId: snapshot.roundId,
              value: snapshot.outcome,
              serverSeed: snapshot.serverSeed,
            },
      );
    }
    setLiveBets((prev) => {
      // Merge: WS may have delivered bets the snapshot missed and vice versa.
      if (!prev) return snapshot.liveBets;
      return snapshot.liveBets.length >= prev.length ? snapshot.liveBets : prev;
    });
    setLiveTotals((prev) => {
      if (!prev) {
        return {
          playerCount: snapshot.playerCount,
          totalStake: snapshot.totalStake,
        };
      }
      return snapshot.playerCount >= prev.playerCount
        ? { playerCount: snapshot.playerCount, totalStake: snapshot.totalStake }
        : prev;
    });
    setConfig(snapshot.config);
    setMyBetsByRound((prev) => {
      const next = { ...prev, [snapshot.roundId]: snapshot.myBets };
      const keys = Object.keys(next);
      // Keep only the most recent few rounds.
      while (keys.length > 3) {
        delete next[keys.shift() as string];
      }
      return next;
    });
  }, [snapshot, emitResult, emitBettingOpen]);

  const refetch = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["table-round", game] });
  }, [qc, game]);

  useRealtimeTopic<TableRoundsEvent>(
    enabled ? `table-rounds:${game}` : null,
    (ev) => {
      if (!ev) return;
      if (ev.type === "phase") {
        // The phase event carries a fresh server timestamp. Calibrate before
        // rendering the result or loading a scene, so a stale HTTP sample
        // cannot make the animation overrun the server's next phase.
        if (Number.isFinite(ev.ts)) {
          const sample = ev.ts - Date.now();
          // Delayed packets underestimate server time. Keep the least-delayed
          // sample, so network/render stalls cannot extend an active deadline.
          offsetRef.current = clockReadyRef.current ? Math.max(offsetRef.current, sample) : sample;
          clockReadyRef.current = true;
        }
        setLive({
          roundId: ev.roundId,
          phase: ev.phase,
          endsAt: ev.endsAt,
          serverSeedHash: ev.serverSeedHash,
          clientSeed: ev.clientSeed,
          nonce: ev.nonce,
        });
        if (ev.phase === "betting") {
          // New round: reset per-round accumulators.
          setOutcome(null);
          setLiveBets([]);
          setLiveTotals({ playerCount: 0, totalStake: "0" });
          emitBettingOpen(ev.roundId);
          // Refresh snapshot so myBets/recent stay authoritative.
          refetch();
        } else if (lastClosedRoundRef.current !== ev.roundId) {
          lastClosedRoundRef.current = ev.roundId;
          if (optsRef.current.roundClosedVoice !== false) {
            preloadCroupierRoundVoice();
            voiceBetsClosed(game, ev.roundId);
          }
        }
        // Accepted taps may not have reached an earlier snapshot yet. Fetch
        // at settlement even when our cached slips are empty; otherwise the
        // pending-slip poll never starts and payouts can be missed entirely.
        if (ev.phase === "settling") refetch();
      } else if (ev.type === "bet") {
        setLiveBets((prev) => [
          ...(prev ?? []),
          {
            displayName: ev.displayName,
            totalStake: ev.totalStake,
            bets: ev.bets,
            createdAt: new Date(ev.ts).toISOString(),
          },
        ]);
        setLiveTotals({
          playerCount: ev.playerCount,
          totalStake: ev.totalStakeAll,
        });
      } else if (ev.type === "result") {
        setOutcome({
          roundId: ev.roundId,
          value: ev.outcome,
          serverSeed: ev.serverSeed,
        });
        emitResult(ev.outcome, ev.roundId);
        // Snapshot now carries the outcome + will soon carry settled myBets.
        refetch();
      } else if (ev.type === "settled") {
        optsRef.current.onSettled?.();
        refetch();
      }
    },
  );

  useRealtimeTopic<GameConfigUpdatedEvent>(
    enabled ? `game-config:${game}` : null,
    (ev) => {
      if (!ev || ev.type !== "updated") return;
      setConfig((prev) => ({
        houseEdge: ev.config.houseEdge,
        maxMultiplier: ev.config.maxMultiplier,
        maxStakePaise: ev.config.maxStakePaise ?? prev?.maxStakePaise ?? "0",
        minStakePaise: ev.config.minStakePaise ?? prev?.minStakePaise ?? "0",
        bettingWindowMs: ev.config.bettingWindowMs,
        revealDurationMs:
          ev.config.revealDurationMs ?? prev?.revealDurationMs ?? 5_000,
        settleDurationMs:
          ev.config.settleDurationMs ?? prev?.settleDurationMs ?? 5_000,
      }));
    },
  );

  // WebSocket reconnect → resync from REST so we never drift.
  useRealtimeResync(refetch);

  // Settlement sync: the server broadcasts `phase: settling` BEFORE it has
  // finished paying out slips, and the final `settled` event only fires after
  // the settling window (by which time the next round may already own the
  // snapshot). While our slips for the current round are still pending during
  // the settling phase, poll the snapshot until their settled status/payout
  // arrives.
  const livePhase = live?.phase ?? null;
  const liveRoundId = live?.roundId ?? null;
  const pendingDuringSettling =
    livePhase === "settling" &&
    liveRoundId != null &&
    (myBetsByRound[liveRoundId] ?? []).some((b) => b.status === "pending");
  useEffect(() => {
    if (!pendingDuringSettling) return;
    const id = window.setInterval(refetch, 800);
    return () => window.clearInterval(id);
  }, [pendingDuringSettling, refetch]);

  // Disclosure sync: a game may withhold its outcome for part of the reveal
  // window (roulette keeps the pocket out of every payload until the wheel
  // needs it to land, so the spin cannot be read ahead from the network). The
  // `result` event is the fast path; this poll keeps a client whose socket
  // dropped from missing the disclosure and the landing that follows it.
  const awaitingOutcome =
    livePhase === "reveal" &&
    liveRoundId != null &&
    outcome?.roundId !== liveRoundId;
  useEffect(() => {
    if (!awaitingOutcome) return;
    const id = window.setInterval(refetch, 700);
    return () => window.clearInterval(id);
  }, [awaitingOutcome, refetch]);

  // Drift-corrected ticking countdown (4 Hz is smooth enough for seconds).
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (!live) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const next = Math.max(0, live.endsAt - serverNow());
      setRemainingMs(previous => {
        if (!optsRef.current.wholeSecondCountdown) return next;
        const buffer = live.phase === "betting" ? BET_SEND_BUFFER_MS : 0;
        const second = (ms: number) => Math.ceil(Math.max(0, ms - buffer) / 1000);
        // Still poll at 250ms and preserve both safety cutoffs. The timed bet
        // sender uses the absolute deadline independently of this display clock.
        return second(previous) === second(next) && (previous > 300) === (next > 300) && (previous > 0) === (next > 0)
          ? previous : next;
      });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [live, serverNow]);

  // Watchdog: if a phase deadline passed >3s ago and no WS event arrived,
  // refetch the snapshot (missed event / dropped socket safety net).
  const staleRefetchRef = useRef(0);
  useEffect(() => {
    if (!live) return;
    if (remainingMs > 0) return;
    const overdue = serverNow() - live.endsAt;
    if (overdue > 3_000 && Date.now() - staleRefetchRef.current > 5_000) {
      staleRefetchRef.current = Date.now();
      refetch();
    }
  }, [remainingMs, live, serverNow, refetch]);

  const phase = live?.phase ?? null;
  const phaseDurationMs =
    config && phase
      ? phase === "betting"
        ? config.bettingWindowMs
        : phase === "reveal"
          ? config.revealDurationMs
          : config.settleDurationMs
      : null;

  return {
    snapshot,
    roundId: live?.roundId ?? null,
    phase,
    phaseEndsAt: live?.endsAt ?? null,
    phaseDurationMs,
    remainingMs: phase === "betting" ? Math.max(0, remainingMs - BET_SEND_BUFFER_MS) : remainingMs,
    bettingOpen: phase === "betting" && remainingMs > 300,
    outcome:
      outcome && live && outcome.roundId === live.roundId
        ? (outcome.value as TOutcome)
        : outcome && !live
          ? (outcome.value as TOutcome)
          : null,
    serverSeedHash: live?.serverSeedHash ?? null,
    clientSeed: live?.clientSeed ?? null,
    nonce: live?.nonce ?? null,
    serverSeed:
      outcome && live && outcome.roundId === live.roundId
        ? outcome.serverSeed
        : null,
    config,
    liveBets: liveBets ?? [],
    playerCount: liveTotals?.playerCount ?? 0,
    totalStake: liveTotals?.totalStake ?? "0",
    myBets: live
      ? (myBetsByRound[live.roundId] ??
        (snapshot && snapshot.roundId === live.roundId ? snapshot.myBets : []))
      : [],
    recent: snapshot?.recent ?? [],
    toLocalTime,
    refetch,
  };
}
