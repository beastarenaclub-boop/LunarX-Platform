import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LudoMatch, LudoState } from "@workspace/api-zod/ludo";

export const LUDO_STEP_MS = 120;
export type MovingToken = { seat: number; token: number };
type Move = MovingToken & {
  before: LudoState;
  after: LudoState;
  from: number;
  to: number;
};
type View = {
  id: string;
  state: LudoState;
  moving: MovingToken | null;
  busy: boolean;
};

/** Animate only a confirmed, contiguous move. Reconnect gaps use the latest board. */
function confirmedMove(old: LudoMatch, next: LudoMatch): Move | null {
  const last = next.state.last;
  if (
    old.status !== "playing" ||
    !["playing", "finished"].includes(next.status) ||
    next.version - old.version > 2 ||
    next.state.rollNonce - old.state.rollNonce > 1 ||
    !last ||
    last.token === undefined ||
    !last.dice
  )
    return null;
  const { seat, token, dice } = last;
  const from = old.state.players[seat]?.tokens[token];
  const to = next.state.players[seat]?.tokens[token];
  if (
    from === undefined ||
    to === undefined ||
    to > 56 ||
    (from === -1 ? dice !== 6 || to !== 0 : from < 0 || to !== from + dice)
  )
    return null;
  let captures = 0;
  for (let i = 0; i < next.state.players.length; i++) {
    const a = old.state.players[i],
      b = next.state.players[i];
    if (!a || !b || a.forfeited !== b.forfeited) return null;
    for (let j = 0; j < b.tokens.length; j++) {
      if ((i === seat && j === token) || a.tokens[j] === b.tokens[j]) continue;
      if (
        i === seat ||
        b.tokens[j] !== -1 ||
        a.tokens[j] < 0 ||
        a.tokens[j] > 50
      )
        return null;
      captures++;
    }
  }
  return captures === (last.captured ?? 0)
    ? { seat, token, from, to, before: old.state, after: next.state }
    : null;
}

/** Visual positions only; rule decisions and requests always use the server state. */
export function useLudoMovement(
  match: LudoMatch | null | undefined,
  rolling: boolean,
  onStep: (step: number) => void,
  onComplete: (captured: number, home: boolean) => void,
) {
  const [view, setView] = useState<View | null>(null);
  const previous = useRef<LudoMatch | null>(null);
  const latest = useRef(match);
  latest.current = match;
  const queue = useRef<Move[]>([]);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sounds = useRef({ onStep, onComplete });
  sounds.current = { onStep, onComplete };
  const reset = () => {
    clearTimeout(timer.current);
    active.current = false;
    queue.current = [];
    const current = latest.current;
    setView(
      current
        ? { id: current.id, state: current.state, moving: null, busy: false }
        : null,
    );
  };

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = match ?? null;
    if (
      !match ||
      !old ||
      old.id !== match.id ||
      document.hidden ||
      match.state.players[match.you]?.forfeited
    ) {
      reset();
      return;
    }
    if (match.version === old.version) return;
    const move = confirmedMove(old, match);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reset();
      if (move) {
        sounds.current.onStep(0);
        sounds.current.onComplete(
          move.after.last?.captured ?? 0,
          move.to === 56,
        );
      }
      return;
    }
    if (move) {
      queue.current.push(move);
      if (!active.current)
        setView({ id: match.id, state: move.before, moving: null, busy: true });
    } else {
      const sameTokens = old.state.players.every(
        (p, i) =>
          p?.forfeited === match.state.players[i]?.forfeited &&
          p?.tokens.join(",") === match.state.players[i]?.tokens.join(","),
      );
      if (
        !sameTokens ||
        match.status === "cancelled" ||
        match.version - old.version > 2 ||
        match.state.rollNonce - old.state.rollNonce > 1
      )
        reset();
      else if (!active.current && !queue.current.length) reset();
    }
  }, [match?.id, match?.version]);

  useEffect(() => {
    if (active.current || rolling || !queue.current.length) return;
    // A deferred start also lets a dice update from this same server snapshot render first.
    timer.current = setTimeout(() => {
      if (document.hidden) {
        reset();
        return;
      }
      const move = queue.current.shift()!;
      active.current = true;
      let position = move.from;
      let step = 0;
      const advance = () => {
        if (document.hidden) {
          reset();
          return;
        }
        if (position === move.to) {
          sounds.current.onComplete(
            move.after.last?.captured ?? 0,
            move.to === 56,
          );
          active.current = false;
          const current = latest.current!;
          setView({
            id: current.id,
            state: queue.current.length ? move.after : current.state,
            moving: null,
            busy: queue.current.length > 0,
          });
          return;
        }
        position++;
        const players = move.before.players.map((p) =>
          p?.seat === move.seat
            ? {
                ...p,
                tokens: p.tokens.map((pos, i) =>
                  i === move.token ? position : pos,
                ),
              }
            : p,
        );
        setView({
          id: latest.current!.id,
          state: { ...move.before, players },
          moving: { seat: move.seat, token: move.token },
          busy: true,
        });
        sounds.current.onStep(step++);
        timer.current = setTimeout(advance, LUDO_STEP_MS);
      };
      advance();
    }, 0);
    return () => {
      if (!active.current) clearTimeout(timer.current);
    };
  }, [view, rolling]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden) reset();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer.current);
      queue.current = [];
      active.current = false;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return view?.id === match?.id ? view : null;
}

export function singleOutsideToken(
  match: LudoMatch | null | undefined,
): number | null {
  if (
    !match ||
    match.status !== "playing" ||
    match.state.turn !== match.you ||
    match.state.phase !== "move" ||
    !match.state.dice ||
    match.state.dice === 6 ||
    match.state.players[match.you]?.forfeited
  )
    return null;
  const outside =
    match.state.players[match.you]?.tokens.flatMap((pos, i) =>
      pos >= 0 && pos < 56 ? [i] : [],
    ) ?? [];
  return outside.length === 1 && match.legalTokens.includes(outside[0])
    ? outside[0]
    : null;
}

/** Submit once per roll, through the same versioned/idempotent request path as a tap. */
export function useLudoAutoMove(
  match: LudoMatch | null | undefined,
  blocked: boolean,
  move: (token: number, expected: { id: string; version: number }) => void,
) {
  const attempted = useRef("");
  const [visible, setVisible] = useState(!document.hidden);
  const action = useRef(move);
  action.current = move;
  const token = singleOutsideToken(match);
  const key = match ? `${match.id}:${match.state.rollNonce}` : "";
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (blocked || !visible || token === null || attempted.current === key)
      return;
    const timer = setTimeout(() => {
      if (document.hidden) return;
      attempted.current = key;
      action.current(token, { id: match!.id, version: match!.version });
    }, 180);
    return () => clearTimeout(timer);
  }, [key, match?.version, token, blocked, visible]);
  return token;
}
