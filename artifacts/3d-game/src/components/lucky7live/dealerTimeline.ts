import type { TableRoundSnapshot } from "@/components/table/useTableRound";

// Seconds in the filmed take. These marks are measured against the delivered
// video, rather than starting a new animation whenever a poll returns a card.
export const DEALER = {
  fps: 24,
  idleStart: 0,
  idleEnd: 10,
  actionOffset: 10,
  prepareStart: 11.2,
  dealStart: 14.5,
  faceAt: 16.208333,
  holdStart: 17.5,
  holdEnd: 23.5,
  resetStart: 23.5,
  resetEnd: 30,
  clearEnd: 26.5,
};

export type DealerCue = {
  key: string;
  time: number;
  rate: number;
  end: number;
  loop?: boolean;
  stop?: boolean;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function dealerCue(
  snapshot: TableRoundSnapshot,
  now: number,
): DealerCue {
  const start = snapshot.bettingEndsAt - snapshot.config.bettingWindowMs;
  const elapsed = Math.max(0, (now - start) / 1000);
  if (snapshot.phase === "betting" && now < snapshot.bettingEndsAt) {
    const remaining = (snapshot.bettingEndsAt - now) / 1000;
    if (remaining < DEALER.dealStart - DEALER.prepareStart)
      return {
        key: "prepare",
        time: DEALER.dealStart - remaining,
        rate: 1,
        end: DEALER.dealStart,
      };
    const resetLength = DEALER.resetEnd - DEALER.resetStart;
    if (elapsed < resetLength) {
      return {
        key: "reset",
        time: DEALER.resetStart + elapsed,
        rate: 1,
        end: DEALER.resetEnd,
      };
    }
    const length = DEALER.idleEnd - DEALER.idleStart;
    return {
      key: "idle",
      time: DEALER.idleStart + ((elapsed - resetLength) % length),
      rate: 1,
      end: DEALER.idleEnd,
      loop: true,
    };
  }
  if (snapshot.phase !== "settling" && now < snapshot.revealEndsAt) {
    const duration = Math.max(
      0.1,
      (snapshot.revealEndsAt - snapshot.bettingEndsAt) / 1000,
    );
    const progress = clamp(
      (now - snapshot.bettingEndsAt) / (duration * 1000),
      0,
      1,
    );
    const length = DEALER.holdStart - DEALER.dealStart;
    return {
      key: "deal",
      time: DEALER.dealStart + progress * length,
      rate: clamp(length / duration, 0.25, 4),
      end: DEALER.holdStart,
    };
  }
  const length = DEALER.holdEnd - DEALER.holdStart;
  const elapsedHold = Math.max(0, (now - snapshot.revealEndsAt) / 1000);
  return {
    key: "hold",
    time: DEALER.holdStart + Math.min(elapsedHold, length - 1 / DEALER.fps),
    rate: 1,
    end: DEALER.holdEnd,
    stop: elapsedHold >= length - 1 / DEALER.fps,
  };
}
