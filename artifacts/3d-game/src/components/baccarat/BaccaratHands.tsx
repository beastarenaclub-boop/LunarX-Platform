import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { BET_LABELS, cardIsRed, cardRankLabel, cardSuitSymbol } from "./cards";
import { handTotal, visibleHand, type StudioDeal } from "./studioTimeline";

export default function BaccaratHands({
  deal,
  count,
  complete,
  id = "current",
}: {
  deal: StudioDeal | null;
  count: number;
  complete: boolean;
  id?: string;
}) {
  return (
    <div className="bc-hands" data-testid={`${id}-hands`}>
      {(["player", "banker"] as const).map((side) => {
        const cards = visibleHand(deal, count, side);
        // All three positions stay visible; only an actually drawn card flips.
        const won =
          complete && (deal?.winner === side || deal?.winner === "tie");
        const total =
          complete && deal
            ? deal[`${side}Total`]
            : cards.length
              ? handTotal(cards)
              : "–";
        return (
          <section
            key={side}
            className={cn(
              "bc-result-hand",
              `bc-result-hand-${side}`,
              won && "bc-hand-won",
            )}
            aria-label={`${BET_LABELS[side]} cards`}
          >
            <div className="bc-hand-heading">
              <strong>{BET_LABELS[side]}</strong>
              {won && (
                <span className="bc-hand-outcome">
                  {deal?.winner === "tie" ? "TIE" : "WINNER"}
                </span>
              )}
              <span className="bc-hand-total">
                Total{" "}
                <b
                  data-testid={
                    id === "current"
                      ? `text-${side}-total`
                      : `${id}-${side}-total`
                  }
                >
                  {total}
                </b>
              </span>
            </div>
            <div
              className="bc-result-cards"
              data-testid={`${id}-${side}-cards`}
            >
              {Array.from({ length: 3 }, (_, index) => {
                const card = cards[index];
                const revealed = card !== undefined;
                const unused = complete && index === 2 && !revealed;
                return (
                  <span
                    key={index}
                    role="img"
                    aria-label={
                      revealed
                        ? `${cardRankLabel(card)} ${cardSuitSymbol(card)}`
                        : unused
                          ? `${BET_LABELS[side]} third card not drawn`
                          : `${BET_LABELS[side]} card ${index + 1}, locked, face down`
                    }
                    className={cn(
                      "bc-playing-card",
                      index === 2 && "bc-third-card",
                    )}
                    data-testid={`${id}-${side}-card-${index}`}
                    data-revealed={revealed}
                    data-unused={unused}
                  >
                    <span className="bc-card-turn" aria-hidden="true">
                      <span className="bc-card-back">
                        {unused ? (
                          <small>No draw</small>
                        ) : (
                          <span className="bc-card-lock">
                            <LockKeyhole size={18} strokeWidth={2.2} />
                          </span>
                        )}
                      </span>
                      {revealed && (
                        <span
                          className={cn(
                            "bc-face-card",
                            cardIsRed(card) && "bc-red-card",
                          )}
                        >
                          <b className="bc-card-corner">
                            {cardRankLabel(card)}
                            <small>{cardSuitSymbol(card)}</small>
                          </b>
                          <span className="bc-card-suit">
                            {cardSuitSymbol(card)}
                          </span>
                          <b className="bc-card-corner bc-card-bottom">
                            {cardRankLabel(card)}
                            <small>{cardSuitSymbol(card)}</small>
                          </b>
                        </span>
                      )}
                    </span>
                  </span>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
