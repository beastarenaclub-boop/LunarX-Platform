import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Draw, Game } from "./types";
import { date, SERIES, seriesName, time, TITLI } from "./api";

const games: Game[] = ["2D", "3D", "Titli"];

export function LatestDrawResults({
  draws,
  timezone,
  onViewAll,
}: {
  draws: Draw[];
  timezone: string;
  onViewAll: () => void;
}) {
  const [game, setGame] = useState<Game>("2D");
  const latest = useMemo(
    () =>
      draws.reduce<Draw | undefined>(
        (current, draw) =>
          draw.status === "settled" &&
          draw.results &&
          (!current || draw.ends > current.ends)
            ? draw
            : current,
        undefined,
      ),
    [draws],
  );

  return (
    <section
      className="player-home-results"
      aria-labelledby="home-results-title"
    >
      <div className="player-home-results-heading">
        <div>
          <h2 id="home-results-title">Latest draw result</h2>
          {latest && (
            <time dateTime={new Date(latest.ends).toISOString()}>
              {date(latest.ends, timezone)} · {time(latest.ends, timezone)}
            </time>
          )}
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="player-results-link"
        >
          Sabhi results <ArrowRight size={14} />
        </button>
      </div>
      <div className="player-home-results-toolbar">
        <span>{game === "Titli" ? "Winning symbols" : "Winning numbers"}</span>
        <div
          className="player-result-games"
          role="group"
          aria-label="Result game"
        >
          {games.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={game === value}
              onClick={() => setGame(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {latest ? (
          <dl
            className="player-home-results-grid"
            aria-label={`${game} latest results`}
          >
            {SERIES.map((series) => {
              const result = latest.results?.[series]?.[game];
              return (
                <div key={series} data-series={series}>
                  <dt>{seriesName(series)}</dt>
                  <dd
                    className={game === "Titli" ? "symbol-result" : undefined}
                  >
                    {result == null
                      ? "—"
                      : game === "Titli"
                        ? (TITLI[Number(result)] ?? "—")
                        : result}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="player-home-results-empty">
            Pehla draw hone ke baad result yahan dikhega.
          </p>
        )}
      </div>
    </section>
  );
}
