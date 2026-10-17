import { isRed, rankLabel, type L7Card } from "@workspace/api-zod/lucky7-live";

const symbols = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
const rows = (ys: number[]) =>
  ys.flatMap((y) => [
    [34, y],
    [66, y],
  ]);
const pips: Record<number, number[][]> = {
  2: [
    [50, 32],
    [50, 108],
  ],
  3: [
    [50, 32],
    [50, 70],
    [50, 108],
  ],
  4: rows([32, 108]),
  5: [...rows([32, 108]), [50, 70]],
  6: rows([32, 70, 108]),
  7: [...rows([32, 70, 108]), [50, 51]],
  8: [...rows([32, 70, 108]), [50, 51], [50, 89]],
  9: [...rows([28, 56, 84, 112]), [50, 70]],
  10: [...rows([28, 56, 84, 112]), [50, 42], [50, 98]],
};

/** Transparent ink: the dealer footage supplies the actual paper and shadows. */
export function CardInk({
  card,
  coveredIndex = false,
}: {
  card: L7Card;
  coveredIndex?: boolean;
}) {
  const suit = symbols[card.suit],
    rank = rankLabel(card.rank);
  return (
    <svg
      viewBox="0 0 100 140"
      role="img"
      aria-label={`${rank} of ${card.suit}`}
    >
      <g
        fill={isRed(card) ? "#b71930" : "#171c24"}
        fontFamily="Arial, sans-serif"
        fontWeight="700"
      >
        {!coveredIndex && (
          <g>
            <text x="5" y="24" fontSize="22" letterSpacing="-2">
              {rank}
            </text>
            <text x="6" y="42" fontSize="19">
              {suit}
            </text>
          </g>
        )}
        {card.rank === 1 ? (
          <text x="50" y="89" textAnchor="middle" fontSize="52">
            {suit}
          </text>
        ) : card.rank > 10 ? (
          <g>
            <rect
              x="25"
              y="24"
              width="50"
              height="92"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              opacity="0.25"
            />
            <text
              x="50"
              y="73"
              textAnchor="middle"
              fontFamily="Georgia, serif"
              fontSize="41"
            >
              {rank}
            </text>
            <text x="50" y="100" textAnchor="middle" fontSize="28">
              {suit}
            </text>
          </g>
        ) : (
          pips[card.rank]?.map(([x, y], i) => (
            <text
              key={i}
              x={x}
              y={y}
              dominantBaseline="central"
              textAnchor="middle"
              fontSize="23"
              transform={y > 70 ? `rotate(180 ${x} ${y})` : undefined}
            >
              {suit}
            </text>
          ))
        )}
        <g transform="translate(100 140) rotate(180)">
          <text x="5" y="24" fontSize="22" letterSpacing="-2">
            {rank}
          </text>
          <text x="6" y="42" fontSize="19">
            {suit}
          </text>
        </g>
      </g>
    </svg>
  );
}
