import { useEffect, useRef } from "react";
import { bigRoadCells, type RoadEntry } from "./roadLayout";
export type { RoadEntry } from "./roadLayout";

function useLatestColumn(length: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [length]);
  return ref;
}
export function BeadPlate({ entries }: { entries: RoadEntry[] }) {
  const shown = entries.slice(-180),
    cols = Math.max(24, Math.ceil(shown.length / 6));
  const ref = useLatestColumn(entries.length);
  return (
    <div
      ref={ref}
      className="bc-road-scroll"
      aria-label="Bead plate, oldest to newest"
    >
      <div className="bc-road-grid" data-testid="bead-plate">
        {Array.from({ length: cols * 6 }, (_, i) => {
          const e = shown[i];
          return (
            <div key={i} className="bc-road-cell">
              {e && (
                <span className={`bc-road-bead ${e.winner}`} title={e.winner}>
                  {e.winner[0].toUpperCase()}
                  {e.playerPair && <i className="bc-pair-dot bc-pair-player" />}
                  {e.bankerPair && <i className="bc-pair-dot bc-pair-banker" />}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function BigRoad({ entries }: { entries: RoadEntry[] }) {
  const cells = bigRoadCells(entries),
    cols = Math.max(24, ...cells.map((c) => c.col + 1));
  const map = new Map(cells.map((c) => [`${c.col}:${c.row}`, c]));
  const ref = useLatestColumn(entries.length);
  return (
    <div
      ref={ref}
      className="bc-road-scroll"
      aria-label="Big road with streaks and ties"
    >
      <div className="bc-road-grid" data-testid="big-road">
        {Array.from({ length: cols * 6 }, (_, i) => {
          const e = map.get(`${Math.floor(i / 6)}:${i % 6}`);
          return (
            <div key={i} className="bc-road-cell">
              {e && (
                <span
                  className={`bc-road-ring ${e.winner}`}
                  title={`${e.winner}${e.ties ? `, ${e.ties} ties` : ""}`}
                >
                  {e.ties > 0 && (
                    <b className="bc-road-tie">{e.ties > 1 ? e.ties : "/"}</b>
                  )}
                  {e.playerPair && <i className="bc-pair-dot bc-pair-player" />}
                  {e.bankerPair && <i className="bc-pair-dot bc-pair-banker" />}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
