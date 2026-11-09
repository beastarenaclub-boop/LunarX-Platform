/**
 * Rummy Royale's client state: the server's table, played back a move at a
 * time.
 *
 * The server is the table (`api-server/src/games/rummy/service.ts`): every
 * action is a POST, the computer seats act inside that request, and the
 * response carries the final round plus one `frame` per move with the table
 * as it stood after it. This hook shows the player's own move at once and
 * then each computer move on a beat, so three turns do not land in one
 * blink — the kit's 950 ms bot cadence, from snapshots instead of a local
 * engine. Nothing here decides anything about the game.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { Card, Phase } from "./rules";

export type RummyClass = "you" | "computer" | "draw";

export interface RummyConfig {
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  minStakePaise: string;
  maxStakePaise: string;
  returns: Record<RummyClass, number>;
  turnMs: number;
}

export interface RummySeat {
  name: string;
  cards: number;
  folded: boolean;
  hand?: Card[];
}

export interface RummyTableView {
  phase: Phase;
  seats: RummySeat[];
  hand: Card[];
  stockCount: number;
  discard: Card[];
  indicator: Card | null;
  wild: number;
  current: number;
  step: "draw" | "discard";
  drawnFromOpen: string | null;
  turns: number;
  message: string;
  result: { winner: number | null; reason: string; points: number[] } | null;
}

export interface RummyRound extends RummyTableView {
  id: string;
  betId: string;
  stakeAmount: string;
  status: "active" | "won" | "lost" | "drawn";
  turnMsLeft: number | null;
  payoutAmount: string | null;
  multiplier: number | null;
  returns: Record<RummyClass, number>;
  createdAt: string;
  settledAt: string | null;
}

export interface RummyFrame {
  seat: number;
  action: "draw" | "discard" | "declare" | "auto";
  source?: "stock" | "open";
  card?: Card;
  message: string;
  table: RummyTableView;
}

interface Reply {
  round: RummyRound;
  frames: RummyFrame[];
}

/** Beat between two computer moves. */
export const FRAME_MS = 750;

const get = <T,>(path: string) => customFetch<T>(path, { method: "GET" });
const post = <T,>(path: string, body?: unknown) =>
  customFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export function useRummy() {
  const qc = useQueryClient();
  const config = useQuery<RummyConfig>({
    queryKey: ["rummy-royale", "config"],
    queryFn: () => get<RummyConfig>("/api/rummy-royale/config"),
    staleTime: 30_000,
  });
  const recent = useQuery<RummyRound[]>({
    queryKey: ["rummy-royale", "recent"],
    queryFn: () => get<RummyRound[]>("/api/rummy-royale/recent?limit=10"),
  });

  /** The round as last COMMITTED (frames played out). */
  const [round, setRound] = useState<RummyRound | null>(null);
  /** The frame on screen, if a reply is still being played back. */
  const [frame, setFrame] = useState<RummyFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  /** When the player's turn ends, as a clock instant; 0 when it is not theirs. */
  const [deadline, setDeadline] = useState(0);
  const queueRef = useRef<RummyFrame[]>([]);
  const pendingRef = useRef<RummyRound | null>(null);
  const timerRef = useRef(0);
  /** The last frame handed to the page, for its sound cues. */
  const [lastMove, setLastMove] = useState<RummyFrame | null>(null);

  const invalidateWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["rummy-royale", "recent"] });
  }, [qc]);

  const commit = useCallback(
    (r: RummyRound) => {
      setRound(r);
      setFrame(null);
      setDeadline(r.turnMsLeft !== null ? Date.now() + r.turnMsLeft : 0);
      if (r.status !== "active") invalidateWallet();
    },
    [invalidateWallet],
  );

  /** Show the next queued frame, or commit the round when there is none. */
  const step = useCallback(() => {
    const next = queueRef.current.shift();
    if (next) {
      setFrame(next);
      setLastMove(next);
      timerRef.current = window.setTimeout(step, FRAME_MS);
      return;
    }
    if (pendingRef.current) {
      commit(pendingRef.current);
      pendingRef.current = null;
    }
  }, [commit]);

  const apply = useCallback(
    (reply: Reply, playback: boolean) => {
      window.clearTimeout(timerRef.current);
      queueRef.current = [];
      if (!playback || reply.frames.length === 0) {
        pendingRef.current = null;
        commit(reply.round);
        return;
      }
      // The player's own move is the first frame and shows at once; the
      // computer's moves follow on the beat.
      pendingRef.current = reply.round;
      queueRef.current = [...reply.frames];
      setDeadline(0);
      step();
    },
    [commit, step],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // A table left open — a reload, another tab, a lapsed turn — is picked up
  // where it stands. The server catches a lapsed turn up before answering.
  const refresh = useCallback(async () => {
    try {
      const reply = await get<Reply | null>("/api/rummy-royale/active");
      if (reply) apply(reply, reply.frames.length > 0);
      else if (pendingRef.current === null) setRound((r) => (r && r.status === "active" ? null : r));
    } catch {
      /* the page keeps what it has */
    } finally {
      setLoaded(true);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The player's turn clock ran out: the server plays the turn for them on
  // the next touch, so touch it.
  useEffect(() => {
    if (!deadline) return;
    const id = window.setTimeout(() => void refresh(), Math.max(0, deadline - Date.now()) + 150);
    return () => window.clearTimeout(id);
  }, [deadline, refresh]);

  const run = useCallback(
    async (path: string, body?: unknown) => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const reply = await post<Reply>(path, body);
        apply(reply, true);
      } catch (err) {
        const msg = (err as Error)?.message || "That did not go through.";
        setError(msg);
        // A refused move usually means the table has moved on (a lapsed
        // turn, a double tap): re-read rather than leave a stale board.
        if (/turn|state changed|already|not allowed|Draw a card/i.test(msg)) void refresh();
      } finally {
        setBusy(false);
      }
    },
    [apply, busy, refresh],
  );

  const deal = useCallback(
    (stakePaise: string) => {
      setLastMove(null);
      return run("/api/rummy-royale/deal", { stakeAmount: stakePaise }).then(() => invalidateWallet());
    },
    [run, invalidateWallet],
  );
  const draw = useCallback(
    (source: "stock" | "open") => (round ? run(`/api/rummy-royale/${round.id}/draw`, { source }) : Promise.resolve()),
    [round, run],
  );
  const discard = useCallback(
    (cardId: string, declare = false) =>
      round ? run(`/api/rummy-royale/${round.id}/discard`, { cardId, declare }) : Promise.resolve(),
    [round, run],
  );
  const drop = useCallback(() => (round ? run(`/api/rummy-royale/${round.id}/drop`) : Promise.resolve()), [round, run]);

  /** What is on screen: the frame being played, over the committed round. */
  const view: RummyRound | null = round ? (frame ? { ...round, ...frame.table } : round) : null;
  const playing = frame !== null;

  return {
    config: config.data ?? null,
    recent: recent.data ?? [],
    round,
    view,
    frame,
    lastMove,
    playing,
    busy,
    error,
    loaded,
    deadline,
    deal,
    draw,
    discard,
    drop,
    refresh,
    clearError: () => setError(""),
  };
}
