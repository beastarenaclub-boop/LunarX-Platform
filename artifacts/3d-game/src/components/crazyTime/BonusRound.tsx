import {
  crazyTimeReturn,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";
export default function BonusRound({
  outcome,
  choice,
  roundId,
}: {
  outcome: CrazyTimeOutcome;
  choice: number;
  roundId: string;
}) {
  const bonus = outcome.bonus;
  if (!bonus) return null;
  const profit = Number((crazyTimeReturn(outcome, choice) - 1).toFixed(4));
  return (
    <div
      className={`ct-bonus ct-bonus-${bonus.kind}`}
      key={roundId}
      data-testid="crazy-bonus"
      aria-live="polite"
    >
      <span className="ct-eyebrow">BONUS ROUND</span>
      <h2>{bonus.kind.replaceAll("-", " ")}</h2>
      {bonus.kind === "coin-flip" && (
        <div className="ct-coin-game">
          <span className={bonus.side === 0 ? "ct-bonus-winner" : ""}>
            BLUE
            <br />
            <b>{bonus.sides[0]}×</b>
          </span>
          <div className={`ct-flip-coin ct-coin-side-${bonus.side}`}>
            {bonus.sides[bonus.side]}×
          </div>
          <span className={bonus.side === 1 ? "ct-bonus-winner" : ""}>
            RED
            <br />
            <b>{bonus.sides[1]}×</b>
          </span>
        </div>
      )}
      {bonus.kind === "cash-hunt" && (
        <div className="ct-cash-reveal">
          {bonus.grid.map((value, i) => (
            <span key={i} className={i === choice ? "ct-picked" : ""}>
              {value}×
            </span>
          ))}
        </div>
      )}
      {bonus.kind === "pachinko" && (
        <div className="ct-pachinko">
          <svg
            viewBox="0 0 340 165"
            aria-label={`Pachinko puck lands in slot ${bonus.slot + 1}`}
          >
            {Array.from({ length: 8 }, (_, row) =>
              Array.from({ length: 15 }, (_, col) => (
                <circle
                  key={`${row}-${col}`}
                  cx={22 + col * 21 + (row % 2 ? 10 : 0)}
                  cy={15 + row * 16}
                  r="2"
                  fill="#e7b770"
                />
              )),
            )}
            <polyline
              className="ct-puck-trail"
              points={bonus.path
                .reduce<{
                  x: number;
                  points: string[];
                }>((acc, step, i) => ({ x: acc.x + (step ? 10 : -10), points: [...acc.points, `${acc.x + (step ? 10 : -10)},${10 + i * 9}`] }), { x: 170, points: ["170,0"] })
                .points.join(" ")}
              fill="none"
              stroke="#f1cc77"
              strokeWidth="3"
            />
            <circle
              className="ct-puck"
              cx={20 + bonus.slot * 20}
              cy="153"
              r="7"
              fill="#fff6c7"
            />
          </svg>
          <div className="ct-pachinko-slots">
            {bonus.slots.map((n, i) => (
              <span key={i} className={bonus.slot === i ? "ct-picked" : ""}>
                {n}×
              </span>
            ))}
          </div>
          {bonus.doubles > 0 && <small>DOUBLE ×{2 ** bonus.doubles}</small>}
        </div>
      )}
      {bonus.kind === "crazy-time" && (
        <>
          <div className="ct-pointer-prizes">
            {bonus.pointers.map((n, i) => (
              <div
                key={i}
                className={`ct-pointer-prize ct-colour-${i} ${i === choice ? "ct-picked" : ""}`}
              >
                <span>{["GREEN", "BLUE", "YELLOW"][i]}</span>
                <b>{n}×</b>
                <small>{i === choice ? "YOUR POINTER" : "POINTER"}</small>
              </div>
            ))}
          </div>
          {bonus.boosts.length > 0 && (
            <small className="ct-respins">
              {bonus.boosts
                .map((n) => (n === 2 ? "DOUBLE" : "TRIPLE"))
                .join(" → ")}{" "}
              · Applied to all pointers
            </small>
          )}
        </>
      )}
      <div className="ct-bonus-total">
        <span>
          {bonus.kind === "cash-hunt"
            ? `BOX ${choice + 1}`
            : "WINNING MULTIPLIER"}
        </span>
        <strong>{profit}×</strong>
      </div>
      <p>
        {outcome.topSlot.spot === outcome.winner
          ? `Top Slot ${outcome.topSlot.multiplier}× applied · `
          : ""}
        Original stake also returned
      </p>
    </div>
  );
}
