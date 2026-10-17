import { useEffect, useState, type ReactNode } from "react";
import { History } from "lucide-react";

export function useLastRevealedOutcome<T>(visible: T | null, visibleRoundId: string | undefined,
  landedRound: string | null, currentRoundId: string | null, recent: { roundId: string; outcome: unknown }[]) {
  const [last, setLast] = useState<{ roundId: string; outcome: T } | null>(null);
  useEffect(() => {
    if (visible && visibleRoundId && landedRound === visibleRoundId) {
      setLast(previous => previous?.roundId === visibleRoundId ? previous : { roundId: visibleRoundId, outcome: visible });
    } else {
      const previous = recent.find(r => r.roundId !== currentRoundId && r.outcome != null);
      if (previous) setLast(value => value ?? { roundId: previous.roundId, outcome: previous.outcome as T });
    }
  }, [visible, visibleRoundId, landedRound, currentRoundId, recent]);
  return last;
}

export default function LastResultBanner({ roundId, children }: { roundId?: string; children?: ReactNode }) {
  return <div data-testid="last-result-banner" data-round-id={roundId}
    className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-200/20 bg-amber-200/5 px-3 py-2">
    <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-100/65"><History size={14} />Last result</span>
    <div className="min-w-0 line-clamp-2 text-right text-xs leading-4 font-bold text-amber-100" role="status">
      {children ?? <span className="font-normal text-white/45">Waiting for a completed round</span>}
    </div>
  </div>;
}
