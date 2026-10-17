import { useState } from "react";
import { Check, MoveHorizontal } from "lucide-react";
import { money, SERIES, seriesName, time } from "./api";
import type { Game } from "./types";
import type { Settings } from "./types";
import { seriesPrice } from "./pricing";
import { TicketEngraving } from "./TicketEngraving";

export function SeriesTickets({
  selected,
  onChange,
  pricing,
  drawTime,
  game,
  selectionMode = "single-or-multiple",
}: {
  selected: string[];
  onChange: (series: string[]) => void;
  pricing: Settings;
  drawTime?: number;
  game: Game;
  selectionMode?: "single-or-multiple" | "multiple";
}) {
  const counter = selectionMode === "multiple";
  const [multiple, setMultiple] = useState(selected.length > 1);
  function choose(series: string) {
    if (!counter && !multiple) return onChange([series]);
    onChange(
      selected.includes(series)
        ? counter || selected.length > 1
          ? selected.filter((s) => s !== series)
          : selected
        : [...selected, series],
    );
  }
  return (
    <section
      className="nice-ticket-picker"
      aria-labelledby="nice-ticket-heading"
    >
      <div className="nice-ticket-picker-heading">
        <div>
          <h2 id="nice-ticket-heading">Apna ticket chunein</h2>
          <p>
            {selected.length
              ? `${selected.map(seriesName).join(", ")} selected`
              : "Ticket select karein"}
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={counter ? selected.length === SERIES.length : multiple}
            onChange={(e) => {
              if (counter) {
                onChange(e.target.checked ? [...SERIES] : []);
                return;
              }
              setMultiple(e.target.checked);
              if (!e.target.checked) onChange([selected[0] ?? SERIES[0]]);
            }}
          />
          {counter ? "All series" : "Ek se zyada tickets"}
        </label>
      </div>
      {counter && (
        <p className="nice-ticket-counter-note">
          Ek ya zyada tickets chunein. Hatane ke liye dobara tap karein.
        </p>
      )}
      <div
        className="nice-ticket-scroll"
        role="region"
        aria-label="Irland Lotto tickets"
        tabIndex={0}
      >
        <div className="nice-ticket-grid">
          {SERIES.map((s) => {
            const active = selected.includes(s);
            return (
              <button
                key={s}
                data-series={s}
                type="button"
                className={`nice-paper-ticket ${active ? "selected" : ""}`}
                aria-label={seriesName(s)}
                aria-pressed={active}
                onClick={() => choose(s)}
              >
                <TicketEngraving series={s} />
                <span className="nice-ticket-thread" aria-hidden="true">
                  IRLAND LOTTO · IRLAND LOTTO
                </span>
                <span className="nice-ticket-top">
                  <span>IRLAND LOTTO · TICKET</span>
                  <span className="nice-ticket-check" aria-hidden="true">
                    {active && <Check size={12} strokeWidth={2.5} />}
                  </span>
                </span>
                <strong className="nice-ticket-name">{seriesName(s)}</strong>
                <span className="nice-ticket-draw">
                  {game} · {drawTime ? time(drawTime, pricing.timezone) : "Draw pending"}
                </span>
                <span className="nice-ticket-serial">SERIES IL{s.slice(2)}</span>
                <span className="nice-ticket-stub">
                  <span className="nice-ticket-stamp">
                    {active ? "SELECTED" : "SELECT TICKET"}
                  </span>
                  <span className="nice-ticket-price">
                    {money(seriesPrice(pricing, s))}
                    <small>per unit</small>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="nice-ticket-hint">
        <MoveHorizontal size={14} /> Baaki tickets ke liye swipe karein
      </p>
      {selected.length > 1 && (
        <p className="nice-ticket-multiple-note">
          {selected.length} tickets selected — har number sabhi selected tickets
          mein lagega.
        </p>
      )}
    </section>
  );
}
