import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { cardRankLabel, cardSuitSymbol, cardIsRed } from "./cards";

/**
 * A CSS 3D flip card. Renders face-down and flips up after `flipDelayMs`
 * (respects prefers-reduced-motion by flipping instantly).
 */
export default function PlayingCard({
  card,
  flipDelayMs = 0,
  flipMs = 500,
  small = false,
  className,
  dealOffset,
}: {
  card: number;
  flipDelayMs?: number;
  /** How long the turn itself takes. Shorten it to fit a tight reveal. */
  flipMs?: number;
  small?: boolean;
  className?: string;
  /** Starting offset used by table games to create a restrained dealt-card motion. */
  dealOffset?: { x: number; y: number; rotate?: number };
}) {
  const [reducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [flipped, setFlipped] = useState(flipDelayMs <= 0);
  useEffect(() => {
    setFlipped(false);
    if (reducedMotion || flipDelayMs <= 0) {
      setFlipped(true);
      return;
    }
    const t = setTimeout(() => setFlipped(true), flipDelayMs);
    return () => clearTimeout(t);
  }, [card, flipDelayMs, reducedMotion]);

  const red = cardIsRed(card);
  return (
    <div
      className={cn(
        small ? "w-9 h-13" : "w-14 h-20 sm:w-16 sm:h-24",
        "shrink-0 transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{
        perspective: "600px",
        transform: flipped
          ? "translate3d(0, 0, 0) rotate(0deg)"
          : `translate3d(${dealOffset?.x ?? 0}px, ${dealOffset?.y ?? -18}px, 0) rotate(${dealOffset?.rotate ?? 0}deg) scale(.88)`,
        transitionDuration: reducedMotion ? "0ms" : undefined,
      }}
      data-testid={`card-${card}`}
    >
      <div
        className="relative w-full h-full transition-transform"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(0deg)" : "rotateY(180deg)",
          transitionDuration: reducedMotion ? "0ms" : `${flipMs}ms`,
        }}
      >
        {/* Face */}
        <div
          className={cn(
            "absolute inset-0 rounded-lg bg-white border border-zinc-300 shadow-md flex flex-col items-center justify-center",
            red ? "text-red-600" : "text-zinc-900",
          )}
          style={{ backfaceVisibility: "hidden" }}
        >
          <span
            className={cn(
              "font-black leading-none",
              small ? "text-sm" : "text-lg sm:text-xl",
            )}
          >
            {cardRankLabel(card)}
          </span>
          <span className={cn(small ? "text-sm" : "text-xl sm:text-2xl")}>
            {cardSuitSymbol(card)}
          </span>
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-lg border border-indigo-900 shadow-md"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background:
              "repeating-linear-gradient(45deg,#312e81,#312e81 4px,#1e1b4b 4px,#1e1b4b 8px)",
          }}
        />
      </div>
    </div>
  );
}
