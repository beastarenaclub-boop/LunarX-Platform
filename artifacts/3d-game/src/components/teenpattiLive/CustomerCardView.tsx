import { CardBack, CardFace } from "./TableCardArt";
import { categoryLabel, type TeenPattiDeal } from "./types";

/** A readable view of the same six cards, synchronized to the filmed flips. */
export default function CustomerCardView({
  deal,
  roundKey,
  settled,
  cardRef,
}: {
  deal: TeenPattiDeal | null;
  roundKey: string;
  settled: boolean;
  cardRef: (index: number, element: SVGSVGElement | null) => void;
}) {
  return (
    <div
      className="tpl-customer-view"
      data-testid="tpl-customer-view"
      aria-label="Player cards"
    >
      {(["playerA", "playerB"] as const).map((side, hand) => (
        <div
          className="tpl-customer-hand"
          key={side}
          data-won={settled && deal?.winner === side}
        >
          <div className="tpl-customer-heading">PLAYER {hand ? "B" : "A"}</div>
          <div className="tpl-customer-cards">
            {[0, 1, 2].map((position) => {
              const index = hand * 3 + position;
              const value = (hand ? deal?.handBCards : deal?.handACards)?.[
                position
              ];
              return (
                <svg
                  key={`${roundKey}-${index}`}
                  ref={(element) => cardRef(index, element)}
                  viewBox="0 0 66 94"
                  className="tpl-customer-card"
                  data-testid={`tpl-customer-card-${index}`}
                  data-face-up="false"
                  data-card={value}
                  role="img"
                  aria-label="Face-down card"
                >
                  <g className="tpl-customer-back">
                    <CardBack />
                  </g>
                  <g className="tpl-customer-face">
                    {value != null && (
                      <CardFace
                        value={value}
                        jumbo
                        won={settled && deal?.winner === side}
                      />
                    )}
                  </g>
                </svg>
              );
            })}
          </div>
          <div className="tpl-customer-category">
            {settled && deal
              ? `${categoryLabel((hand ? deal.handB : deal.handA).category)}${deal.winner === side ? " · WINS" : ""}`
              : "OPENING CARDS"}
          </div>
        </div>
      ))}
    </div>
  );
}
