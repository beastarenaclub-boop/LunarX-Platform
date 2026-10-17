import { useEffect, useId, useRef, type CSSProperties } from "react";
import { Trophy } from "lucide-react";
import RoundWinDialog, { type Win } from "@/components/table/RoundWinDialog";
import { categoryLabel, winnerLabel, type TeenPattiDeal } from "./types";
import "./teen-patti-result.css";

/** A result on the felt, without a page-wide portal or backdrop. */
export default function TeenPattiResult({
  deal,
  win,
  onClose,
}: {
  deal: TeenPattiDeal;
  win: Win | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirm.current?.focus({ preventScroll: true });
  }, [win?.roundId]);
  const winner = winnerLabel(deal.winner);
  const category = categoryLabel(
    deal.winner === "playerB" ? deal.handB.category : deal.handA.category,
  );
  if (win) return <div className="tpl-result-overlay" data-testid="badge-deal-winner" data-winner={deal.winner}>
    <RoundWinDialog win={win} onClose={onClose} inline />
  </div>;
  return (
    <div
      className="tpl-result-overlay"
      data-testid="badge-deal-winner"
      data-winner={deal.winner}
    >
      <section
        className="tpl-result-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="tpl-table-result"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="tpl-result-sparks" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--x": `${8 + ((i * 37) % 84)}%`,
                  "--delay": `${(i % 4) * 80}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="tpl-result-heading">
          <span className="tpl-result-trophy" aria-hidden="true">
            <Trophy />
          </span>
          <div>
            <span className="tpl-result-eyebrow">
              Table result
            </span>
            <h2 id={titleId}>{winner}</h2>
            <p id={descriptionId}>
              {category}
            </p>
          </div>
        </div>
        <button
          ref={confirm}
          type="button"
          className="tpl-result-ok"
          data-testid="tpl-result-ok"
          onClick={onClose}
        >
          OK
        </button>
      </section>
    </div>
  );
}
