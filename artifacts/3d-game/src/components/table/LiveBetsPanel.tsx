import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/format";
import { Users } from "lucide-react";
import type { LiveBet } from "./useTableRound";

interface Props {
  bets: LiveBet[];
  playerCount: number;
  totalStake: string;
  /** Per-game renderer for a slip's bets (short label like "Red ×2, 17"). */
  describeBets?: (bets: unknown) => string;
  className?: string;
  maxRows?: number;
}

/**
 * Live bets feed: other players' wager slips arriving in real time during
 * the betting window (anonymous display names only).
 */
export default function LiveBetsPanel({
  bets,
  playerCount,
  totalStake,
  describeBets,
  className,
  maxRows = 12,
}: Props) {
  const rows = [...bets].reverse().slice(0, maxRows);
  return (
    <div
      className={cn(
        "rounded-xl bg-[#130b24] border border-white/5 p-3 flex flex-col gap-2 min-h-0",
        className,
      )}
      data-testid="live-bets-panel"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold text-white/40 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Live bets
        </span>
        <span className="text-[10px] text-white/50 font-mono flex items-center gap-1">
          <Users className="w-3 h-3" />
          {playerCount} · ₹{formatRupees(totalStake)}
        </span>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto max-h-48">
        {rows.length === 0 && (
          <span className="text-[11px] text-white/25 italic py-2">
            No bets yet this round.
          </span>
        )}
        {rows.map((b, i) => (
          <div
            key={`${b.createdAt}-${i}`}
            className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5"
            data-testid={`live-bet-row-${i}`}
          >
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-semibold text-white/70 truncate block">
                {b.displayName ?? "Player"}
              </span>
              {describeBets && (
                <span className="text-[10px] text-white/40 truncate block">
                  {describeBets(b.bets)}
                </span>
              )}
            </div>
            <span className="text-[11px] font-mono font-bold text-emerald-300 shrink-0">
              ₹{formatRupees(b.totalStake)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
