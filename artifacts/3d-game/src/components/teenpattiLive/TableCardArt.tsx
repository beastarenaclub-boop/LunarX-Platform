import {
  cardIsRed,
  cardRankLabel,
  cardSuitSymbol,
} from "@/components/baccarat/cards";

export function CardBack() {
  return (
    <g>
      <rect
        width="66"
        height="94"
        rx="4"
        fill="#e8e7df"
        stroke="#babfc2"
        strokeWidth="1"
      />
      <rect
        x="4"
        y="4"
        width="58"
        height="86"
        rx="2"
        fill="#25344c"
        stroke="#aeb8ca"
      />
      {Array.from({ length: 11 }, (_, i) => (
        <path
          key={i}
          d={`M6 ${7 + i * 7}L60 ${28 + i * 5}M60 ${7 + i * 7}L6 ${28 + i * 5}`}
          stroke="#c4cbd6"
          strokeWidth=".6"
          opacity=".65"
        />
      ))}
      <rect
        x="9"
        y="9"
        width="48"
        height="76"
        rx="20"
        fill="#24334c"
        stroke="#c6cad0"
        strokeWidth="1.4"
      />
      {[29, 65].map((y) => (
        <g key={y} transform={`translate(33 ${y})`}>
          <circle r="14" fill="none" stroke="#c6cad0" />
          <path
            d="M0 -12L4 -4L12 0L4 4L0 12L-4 4L-12 0L-4 -4Z"
            fill="none"
            stroke="#c6cad0"
          />
          <circle r="5" fill="#c6cad0" />
        </g>
      ))}
    </g>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[33, 47]],
  2: [
    [33, 25],
    [33, 69],
  ],
  3: [
    [33, 25],
    [33, 47],
    [33, 69],
  ],
  4: [
    [22, 25],
    [44, 25],
    [22, 69],
    [44, 69],
  ],
  5: [
    [22, 25],
    [44, 25],
    [33, 47],
    [22, 69],
    [44, 69],
  ],
  6: [
    [22, 25],
    [44, 25],
    [22, 47],
    [44, 47],
    [22, 69],
    [44, 69],
  ],
  7: [
    [22, 25],
    [44, 25],
    [33, 36],
    [22, 47],
    [44, 47],
    [22, 69],
    [44, 69],
  ],
  8: [
    [22, 25],
    [44, 25],
    [33, 36],
    [22, 47],
    [44, 47],
    [33, 58],
    [22, 69],
    [44, 69],
  ],
  9: [
    [22, 22],
    [44, 22],
    [22, 38],
    [44, 38],
    [33, 47],
    [22, 56],
    [44, 56],
    [22, 72],
    [44, 72],
  ],
  10: [
    [22, 22],
    [44, 22],
    [33, 30],
    [22, 38],
    [44, 38],
    [22, 56],
    [44, 56],
    [33, 64],
    [22, 72],
    [44, 72],
  ],
};

/** Full playing-card face in a 66 x 94 coordinate system, including the
 * rank-specific pip count. Values always use the server's card encoding. */
export function CardFace({
  value,
  won = false,
  inkOnly = false,
  jumbo = false,
}: {
  value: number;
  won?: boolean;
  inkOnly?: boolean;
  jumbo?: boolean;
}) {
  const rank = (value % 13) + 1;
  const suit = cardSuitSymbol(value);
  const label = cardRankLabel(value);
  const color = cardIsRed(value) ? "#b12331" : "#132635";
  return (
    <g fill={color}>
      {!inkOnly && (
        <rect
          width="66"
          height="94"
          rx="4"
          fill="#fffdf4"
          stroke={won ? "#edc568" : "#c5c8c6"}
          strokeWidth={won ? 2 : 0.7}
        />
      )}
      {!inkOnly && (
        <rect
          x="2"
          y="2"
          width="62"
          height="90"
          rx="3"
          fill="none"
          stroke="#ece9dc"
          strokeWidth=".5"
        />
      )}
      {[false, true].map((reverse) => (
        <g
          key={String(reverse)}
          transform={reverse ? "translate(66 94) rotate(180)" : undefined}
        >
          <text
            x={jumbo ? 6 : 5}
            y={jumbo ? 24 : 15}
            fontFamily="Georgia"
            fontSize={jumbo ? (rank === 10 ? 22 : 26) : rank === 10 ? 12 : 15}
            fontWeight="700"
          >
            {label}
          </text>
          <text
            x={jumbo ? 14 : 9}
            y={jumbo ? 39 : 27}
            textAnchor="middle"
            fontSize={jumbo ? 16 : 12}
          >
            {suit}
          </text>
        </g>
      ))}
      <g transform={jumbo ? "translate(12.54 17.86) scale(.62)" : undefined}>
        {rank <= 10 ? (
          PIPS[rank].map(([x, y], i) => (
            <text
              key={i}
              transform={`translate(${x} ${y})${y > 47 ? " rotate(180)" : ""}`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={rank === 1 ? 32 : 16}
            >
              {suit}
            </text>
          ))
        ) : (
          <g>
            <rect
              x="17"
              y="19"
              width="32"
              height="56"
              rx="1"
              fill="#e6d5a7"
              stroke={color}
              strokeWidth=".8"
            />
            {[false, true].map((reverse) => (
              <g
                key={String(reverse)}
                transform={reverse ? "translate(66 94) rotate(180)" : undefined}
              >
                <path
                  d="M22 28L20 21L28 25L33 20L38 25L46 21L44 28Z"
                  fill="#c7a34e"
                  stroke={color}
                  strokeWidth=".7"
                />
                <path
                  d="M26 31Q33 25 40 31L39 40L35 44L29 40Z"
                  fill="#ecd6ad"
                  stroke={color}
                  strokeWidth=".8"
                />
                <path d="M23 48L29 42L35 45L42 41L46 49Z" fill={color} />
                <path
                  d="M20 50L43 29M22 51L45 30"
                  stroke="#b39041"
                  strokeWidth="1.2"
                />
              </g>
            ))}
            <text
              x="33"
              y="52"
              textAnchor="middle"
              fontSize="14"
              fontWeight="bold"
              fill="#fff8df"
            >
              {label}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
