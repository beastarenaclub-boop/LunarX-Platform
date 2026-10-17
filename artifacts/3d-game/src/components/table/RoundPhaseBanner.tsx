import { cn } from "@/lib/utils";
import type { RoundPhase } from "./useTableRound";
import { Timer, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  phase: RoundPhase | null;
  remainingMs: number;
  /** Full duration of the current phase (ms) for the progress bar. */
  durationMs: number | null;
  /**
   * Settle-phase duration (ms) from config. Used to merge the reveal and
   * settling windows into ONE continuous "result" countdown so players never
   * see the internal 5s reveal/settle windows — just one cycle.
   */
  settleDurationMs?: number | null;
  /** Optional extra content shown during the result window (result line). */
  resultSlot?: ReactNode;
  className?: string;
  /** Stable one-row height for scenes whose camera fits the remaining viewport. */
  compact?: boolean;
}

/**
 * Prominent round timer banner shared by all table games.
 *
 * Players see exactly two states per cycle:
 * - green ticking countdown while betting is open, and
 * - a single violet "result" countdown to the next round (the internal
 *   reveal/settle phases are merged and never shown separately).
 */
export default function RoundPhaseBanner({
  phase,
  remainingMs,
  durationMs,
  settleDurationMs,
  resultSlot,
  className,
  compact = false,
}: Props) {
  if (!phase) {
    return (
      <div
        className={cn(
          "rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 flex items-center gap-2 text-white/50 text-sm",
          className,
          compact && "h-11 py-1.5",
        )}
        data-testid="round-phase-banner"
      >
        <Timer className="w-4 h-4 shrink-0 animate-pulse" />
        <span className="font-semibold">Waiting for the next round…</span>
      </div>
    );
  }

  const betting = phase === "betting";
  // During reveal, extend the countdown through the settle window so the
  // player sees one continuous "next round in Xs" timer.
  const settleMs = settleDurationMs ?? 5_000;
  const shownRemaining = phase === "reveal" ? remainingMs + settleMs : remainingMs;
  const shownDuration = betting
    ? durationMs
    : (durationMs ?? 0) + (phase === "reveal" ? settleMs : 0);
  const secs = Math.ceil(shownRemaining / 1000);
  const pct =
    shownDuration && shownDuration > 0
      ? Math.max(0, Math.min(100, (shownRemaining / shownDuration) * 100))
      : 0;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 overflow-hidden relative",
        betting
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
          : "border-violet-400/40 bg-violet-500/10 text-violet-300",
        betting && secs <= 5 && "animate-pulse",
        className,
        compact && "h-11 py-1.5",
      )}
      data-testid="round-phase-banner"
      data-phase={phase}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {betting ? (
            <Timer className="w-4 h-4 shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 shrink-0" />
          )}
          <span className="font-bold text-sm uppercase tracking-wide truncate">
            {betting ? "Place your bets" : compact ? "Next round in" : "Result — next round in"}
          </span>
        </div>
        {compact && !betting && resultSlot && <div className="hidden sm:block ml-auto text-xs text-white/80">{resultSlot}</div>}
        <span
          className="font-mono font-black text-lg tabular-nums shrink-0"
          data-testid="round-timer-seconds"
        >
          {secs}s
        </span>
      </div>
      {!compact && !betting && resultSlot ? (
        <div className="mt-1.5 text-xs text-white/80">{resultSlot}</div>
      ) : null}
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
        <div
          className={cn(
            "h-full transition-[width] duration-300 ease-linear",
            betting ? "bg-emerald-400" : "bg-violet-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
