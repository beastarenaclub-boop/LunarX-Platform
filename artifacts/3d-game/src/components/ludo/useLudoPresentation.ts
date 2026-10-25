import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LudoMatch } from "@workspace/api-zod/ludo";
import { useLudoRoll } from "./useLudoRoll";
import { useLudoMovement } from "./useLudoMovement";

/** Present committed boards in order: roll, its move, then the next player's roll. */
export function useLudoPresentation(
  match: LudoMatch | null | undefined,
  updates: LudoMatch[],
  failed: boolean,
  audio: {
    roll: () => void;
    land: (value: number) => void;
    step: (step: number) => void;
    moveEnd: (captured: number, home: boolean) => void;
  },
) {
  const [shown, setShown] = useState(match);
  const [queue, setQueue] = useState<LudoMatch[]>([]);
  const latest = useRef(match);
  const received = useRef(match);
  latest.current = match;
  useLayoutEffect(() => {
    const old = received.current;
    received.current = match;
    if (
      !match ||
      old?.id !== match.id ||
      document.hidden ||
      match.state.players[match.you]?.forfeited
    ) {
      setQueue([]);
      setShown(match);
    } else if (match.version > old.version) {
      // React may batch several WebSocket messages into one render. Keep every
      // committed transition instead of replacing a six/move with a later roll.
      const incoming = updates.filter(
        (next) => next.id === match.id && next.version > old.version,
      );
      setQueue((pending) => [
        ...pending,
        ...(incoming.length ? incoming : [match]),
      ]);
    }
  }, [match?.id, match?.version, updates]);

  const dice = useLudoRoll(shown, failed, audio.roll, audio.land);
  const movement = useLudoMovement(
    shown,
    !!dice.roll,
    audio.step,
    audio.moveEnd,
  );
  const waitingForResult = !!dice.roll && dice.roll.value === undefined;
  useEffect(() => {
    if (!queue.length || movement?.busy || (dice.roll && !waitingForResult))
      return;
    // A locally started roll needs its confirmed snapshot to finish spinning.
    // Later snapshots wait until the current roll and token movement finish.
    const timer = setTimeout(() => {
      setShown(queue[0]);
      setQueue((pending) => pending.slice(1));
    }, 0);
    return () => clearTimeout(timer);
  }, [queue, dice.roll, movement?.busy, waitingForResult]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        setQueue([]);
        setShown(latest.current);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  return {
    match: shown,
    dice,
    movement,
    catchingUp:
      !!queue.length ||
      shown?.id !== match?.id ||
      shown?.version !== match?.version,
  };
}
