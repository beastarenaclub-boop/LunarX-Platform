import { cn } from "@/lib/utils";

export interface RoadEntry {
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
}

const ROWS = 6;

/**
 * Bead plate: results in chronological order filling columns top-to-bottom,
 * left-to-right. B red, P blue, T green; pair dots in the corners.
 */
export function BeadPlate({ entries }: { entries: RoadEntry[] }) {
  const maxCols = 12;
  const shown = entries.slice(-ROWS * maxCols);
  const cols = Math.max(Math.ceil(shown.length / ROWS), 6);
  return (
    <div className="overflow-x-auto">
      <div
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
        data-testid="bead-plate"
      >
        {Array.from({ length: cols * ROWS }).map((_, i) => {
          const e = shown[i];
          return (
            <div
              key={i}
              className={cn(
                "relative w-5 h-5 rounded-full border text-[9px] font-black flex items-center justify-center",
                !e && "border-white/10 bg-white/[0.03]",
                e?.winner === "banker" &&
                  "bg-red-600/90 border-red-400 text-white",
                e?.winner === "player" &&
                  "bg-blue-600/90 border-blue-400 text-white",
                e?.winner === "tie" &&
                  "bg-emerald-600/90 border-emerald-400 text-white",
              )}
            >
              {e ? (e.winner === "banker" ? "B" : e.winner === "player" ? "P" : "T") : ""}
              {e?.playerPair && (
                <span className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 rounded-full bg-blue-300 border border-white/50" />
              )}
              {e?.bankerPair && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-300 border border-white/50" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BigRoadCell {
  winner: "player" | "banker";
  ties: number;
}

/**
 * Big road: streaks of the same winner run DOWN a column; the winner
 * changing starts a new column. Ties don't move the position — they draw a
 * green slash count on the previous cell.
 */
export function BigRoad({ entries }: { entries: RoadEntry[] }) {
  const columns: BigRoadCell[][] = [];
  let leadingTies = 0;
  for (const e of entries) {
    if (e.winner === "tie") {
      const col = columns[columns.length - 1];
      const cell = col?.[col.length - 1];
      if (cell) cell.ties += 1;
      else leadingTies += 1;
      continue;
    }
    const col = columns[columns.length - 1];
    if (col && col[0]!.winner === e.winner && col.length < ROWS) {
      col.push({ winner: e.winner, ties: 0 });
    } else if (col && col[0]!.winner === e.winner) {
      // Streak longer than 6 — "dragon tail": keep appending, rendered flat.
      col.push({ winner: e.winner, ties: 0 });
    } else {
      columns.push([{ winner: e.winner, ties: 0 }]);
    }
  }
  const shownCols = columns.slice(-14);
  const colCount = Math.max(shownCols.length, 8);
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]" data-testid="big-road">
        {Array.from({ length: colCount }).map((_, ci) => {
          const col = shownCols[ci] ?? [];
          return (
            <div key={ci} className="flex flex-col gap-[3px]">
              {Array.from({ length: ROWS }).map((_, ri) => {
                const cell = col[ri];
                return (
                  <div
                    key={ri}
                    className={cn(
                      "relative w-5 h-5 rounded-full border-2 flex items-center justify-center",
                      !cell && "border-white/10 bg-white/[0.03]",
                      cell?.winner === "banker" && "border-red-500",
                      cell?.winner === "player" && "border-blue-500",
                    )}
                  >
                    {cell && cell.ties > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-emerald-400">
                        {cell.ties > 1 ? cell.ties : "/"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {leadingTies > 0 && (
        <div className="text-[9px] text-emerald-400/70 mt-1">
          {leadingTies} tie{leadingTies > 1 ? "s" : ""} before first result
        </div>
      )}
    </div>
  );
}
