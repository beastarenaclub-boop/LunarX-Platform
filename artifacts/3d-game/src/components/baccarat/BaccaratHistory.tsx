import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { BET_LABELS, cardRankLabel, cardSuitSymbol } from "./cards";
import { BeadPlate, BigRoad } from "./StudioRoads";
import { orderedCards, type StudioDeal } from "./studioTimeline";
import BaccaratHands from "./BaccaratHands";
import BaccaratStatistics from "./BaccaratStatistics";

export interface BaccaratHistoryEntry {
  roundId: string;
  deal: StudioDeal;
  settledAt: string | null;
}

export default function BaccaratHistory({
  entries,
}: {
  entries: BaccaratHistoryEntry[];
}) {
  const [view, setView] = useState<"statistics" | "results" | "roads">(
    "statistics",
  );
  const [selected, setSelected] = useState<BaccaratHistoryEntry | null>(null);
  const roads = [...entries].reverse().map((entry) => entry.deal);
  return (
    <section
      className="bc-history"
      aria-label="Baccarat results history"
      data-testid="baccarat-history"
    >
      <div className="bc-history-heading">
        <strong>
          {view === "statistics" ? "Statistics" : "Last results"}{" "}
          <span>{entries.length}</span>
        </strong>
        <div className="bc-history-switch" aria-label="History display">
          <button
            type="button"
            aria-pressed={view === "statistics"}
            onClick={() => setView("statistics")}
          >
            Statistics
          </button>
          <button
            type="button"
            aria-pressed={view === "results"}
            onClick={() => setView("results")}
          >
            Results
          </button>
          <button
            type="button"
            aria-pressed={view === "roads"}
            onClick={() => setView("roads")}
          >
            Roads
          </button>
        </div>
      </div>
      {view === "statistics" ? (
        <>
          <BaccaratStatistics entries={entries} />
          {entries.length === 0 ? (
            <p className="bc-history-empty">
              Completed rounds will appear here.
            </p>
          ) : (
            <div
              className="bc-result-strip"
              aria-label="Recent results, newest first"
            >
              {entries.slice(0, 20).map((entry) => (
                <button
                  key={entry.roundId}
                  type="button"
                  className={`bc-result-cell bc-history-${entry.deal.winner}`}
                  data-testid={`result-${entry.roundId}`}
                  aria-label={`${BET_LABELS[entry.deal.winner]}, Player ${entry.deal.playerTotal}, Banker ${entry.deal.bankerTotal}. Show cards for round ${entry.roundId}`}
                  onClick={() => setSelected(entry)}
                >
                  {entry.deal.winner[0].toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </>
      ) : view === "results" ? (
        <div
          className="bc-history-list"
          tabIndex={0}
          aria-label="Recent rounds, newest first"
        >
          {entries.length === 0 && (
            <p className="bc-history-empty">
              Completed rounds will appear here.
            </p>
          )}
          {entries.map((entry, index) => (
            <button
              key={entry.roundId}
              type="button"
              className="bc-history-row"
              data-testid={`history-${entry.roundId}`}
              onClick={() => setSelected(entry)}
              aria-label={`Round ${entry.roundId}: ${BET_LABELS[entry.deal.winner]}, Player ${entry.deal.playerTotal}, Banker ${entry.deal.bankerTotal}. Show cards`}
            >
              <span
                className={`bc-history-winner bc-history-${entry.deal.winner}`}
              >
                <b>{BET_LABELS[entry.deal.winner]}</b>
                <small>
                  {index === 0
                    ? "Latest"
                    : `#${entry.roundId.slice(-6).toUpperCase()}`}
                </small>
              </span>
              <span className="bc-history-cards">
                {(["player", "banker"] as const).map((side) => (
                  <span key={side} className={`bc-count-${side}`}>
                    <b>{side === "player" ? "P" : "B"}</b>{" "}
                    {entry.deal[`${side}Cards`]
                      .map(
                        (card) =>
                          `${cardRankLabel(card)}${cardSuitSymbol(card)}`,
                      )
                      .join("  ")}
                  </span>
                ))}
              </span>
              <span className="bc-history-score">
                <b className="bc-count-player">{entry.deal.playerTotal}</b>
                <span>:</span>
                <b className="bc-count-banker">{entry.deal.bankerTotal}</b>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="bc-roads">
          <div className="bc-road-heading">
            <span>SHOE HISTORY</span>
            <div>
              {(["player", "banker", "tie"] as const).map((side) => (
                <span key={side} className={`bc-count-${side}`}>
                  {side[0].toUpperCase()}{" "}
                  <b>{roads.filter((e) => e.winner === side).length}</b>
                </span>
              ))}
            </div>
          </div>
          <BeadPlate entries={roads} />
          <BigRoad entries={roads} />
          <div className="bc-road-legend">
            <span>
              <i className="bc-player-dot" />
              Player
            </span>
            <span>
              <i className="bc-banker-dot" />
              Banker
            </span>
            <span>
              <i className="bc-tie-dot" />
              Tie
            </span>
          </div>
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="bc-history-dialog"
          data-testid="baccarat-history-detail"
        >
          <DialogTitle>
            {selected?.deal.winner === "tie"
              ? "Tie"
              : `${selected ? BET_LABELS[selected.deal.winner] : ""} wins`}
          </DialogTitle>
          <DialogDescription>
            Round {selected?.roundId}
            {selected?.settledAt &&
              ` · ${new Date(selected.settledAt).toLocaleString()}`}
          </DialogDescription>
          {selected && (
            <>
              <BaccaratHands
                deal={selected.deal}
                count={orderedCards(selected.deal).length}
                complete
                id="history"
              />
              <div className="bc-result-tags">
                {selected.deal.natural && (
                  <span>
                    Natural{" "}
                    {Math.max(
                      selected.deal.playerTotal,
                      selected.deal.bankerTotal,
                    )}
                  </span>
                )}
                {selected.deal.playerPair && <span>Player pair</span>}
                {selected.deal.bankerPair && <span>Banker pair</span>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
