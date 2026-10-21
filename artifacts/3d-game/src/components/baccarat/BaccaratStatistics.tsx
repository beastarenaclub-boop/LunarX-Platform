import type { CSSProperties } from "react";
import type { BaccaratHistoryEntry } from "./BaccaratHistory";
import { BET_LABELS } from "./cards";

const sides = ["player", "banker", "tie"] as const;

export default function BaccaratStatistics({
  entries,
}: {
  entries: BaccaratHistoryEntry[];
}) {
  const counts = { player: 0, banker: 0, tie: 0 };
  for (const entry of entries) counts[entry.deal.winner]++;
  const total = entries.length;
  const percent = (count: number) =>
    total ? Math.round((count / total) * 100) : 0;
  const playerEnd = total ? (counts.player / total) * 360 : 0;
  const bankerEnd = total ? ((counts.player + counts.banker) / total) * 360 : 0;
  let angle = 0;
  return (
    <div className="bc-statistics" data-testid="baccarat-statistics">
      <div
        className="bc-statistics-pie"
        role="img"
        aria-label={
          total
            ? `Last ${total} rounds: Player ${counts.player}, Banker ${counts.banker}, Tie ${counts.tie}`
            : "No completed rounds yet"
        }
        style={{
          background: total
            ? `conic-gradient(#168bff 0deg ${playerEnd}deg, #ed2448 ${playerEnd}deg ${bankerEnd}deg, #69d631 ${bankerEnd}deg 360deg)`
            : "#666b7c",
        }}
      >
        {total === 0 && <span className="bc-statistics-empty">No results</span>}
        {sides.map((side) => {
          const sweep = total ? (counts[side] / total) * Math.PI * 2 : 0;
          const middle = angle + sweep / 2;
          angle += sweep;
          return counts[side] > 0 ? (
            <span
              key={side}
              className="bc-pie-percentage"
              aria-hidden="true"
              style={
                {
                  left: `${50 + Math.sin(middle) * 31}%`,
                  top: `${50 - Math.cos(middle) * 31}%`,
                } as CSSProperties
              }
            >
              {percent(counts[side])}%
            </span>
          ) : null;
        })}
      </div>
      <div className="bc-statistics-legend">
        {sides.map((side) => (
          <div key={side} data-testid={`statistics-${side}`}>
            <i className={`bc-${side}-dot`} />
            <span>{BET_LABELS[side]}</span>
            <b>{counts[side]}</b>
          </div>
        ))}
        <small>
          {total} completed {total === 1 ? "round" : "rounds"}
        </small>
      </div>
    </div>
  );
}
