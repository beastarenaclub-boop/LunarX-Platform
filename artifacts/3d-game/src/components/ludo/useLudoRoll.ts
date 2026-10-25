import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LudoMatch } from "@workspace/api-zod/ludo";

export type LudoRoll = {
  key: string;
  seat: number;
  phase: "rolling" | "landing";
  value?: number;
  at: number;
};

/** Presentation only: the server supplies every result, including no-move rolls. */
export function useLudoRoll(
  match: LudoMatch | null | undefined,
  failed: boolean,
  onRoll: () => void,
  onLand: (value: number) => void,
) {
  const [roll, setRoll] = useState<LudoRoll | null>(null);
  const [values, setValues] = useState<Record<number, number>>({});
  const active = useRef<LudoRoll | null>(null);
  const previous = useRef<LudoMatch | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sounds = useRef({ onRoll, onLand });
  sounds.current = { onRoll, onLand };
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const update = (value: LudoRoll | null) => {
    active.current = value;
    setRoll(value);
  };
  const reset = () => {
    clear();
    update(null);
  };
  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = match ?? null;
    if (!match || old?.id !== match.id) {
      reset();
      const last = match?.state.last;
      setValues(last?.dice ? { [last.seat]: last.dice } : {});
      return;
    }
    if (
      match.status !== "playing" ||
      match.state.players[match.you]?.forfeited
    ) {
      reset();
      return;
    }
    const delta = match.state.rollNonce - old.state.rollNonce;
    if (delta <= 0) return;
    const last = match.state.last;
    if (!last?.dice) {
      reset();
      return;
    }
    const value = last.dice;
    setValues((v) => ({ ...v, [last.seat]: value }));
    // Reconnects catch up directly instead of replaying old turns.
    if (document.hidden || delta > 1) {
      reset();
      return;
    }
    clear();
    const current = active.current;
    const next: LudoRoll =
      current && current.seat === last.seat && current.value === undefined
        ? { ...current, value }
        : {
            key: `${match.id}:${match.state.rollNonce}`,
            seat: last.seat,
            value,
            phase: "rolling",
            at: performance.now(),
          };
    if (next.key !== current?.key) sounds.current.onRoll();
    update(next);
    timers.current.push(
      setTimeout(
        () => {
          if (active.current?.key !== next.key) return;
          update({ ...next, phase: "landing" });
          sounds.current.onLand(value);
          timers.current.push(
            setTimeout(
              () => {
                if (active.current?.key === next.key) update(null);
              },
              reduced() ? 80 : 260,
            ),
          );
        },
        Math.max(0, (reduced() ? 120 : 640) - (performance.now() - next.at)),
      ),
    );
  }, [match?.id, match?.version, match?.state.rollNonce, match?.status]);

  useEffect(() => {
    if (failed && active.current?.value === undefined) reset();
  }, [failed]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) reset();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const begin = () => {
    if (
      active.current ||
      !match ||
      match.status !== "playing" ||
      match.state.turn !== match.you ||
      match.state.phase !== "roll"
    )
      return false;
    clear();
    update({
      key: `${match.id}:pending:${match.state.rollNonce}`,
      seat: match.you,
      phase: "rolling",
      at: performance.now(),
    });
    sounds.current.onRoll();
    // A lost response must not leave the dice spinning forever. Retry remains server-controlled.
    timers.current.push(
      setTimeout(() => {
        if (active.current?.value === undefined) reset();
      }, 3500),
    );
    return true;
  };
  return { roll, values, begin };
}
