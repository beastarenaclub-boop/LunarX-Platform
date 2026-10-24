import {
  LUDO_COLORS,
  LUDO_PATH,
  LUDO_SAFE,
  ludoPosition,
  type LudoState,
  type LudoColor,
} from "@workspace/api-zod/ludo";
export const COLORS: Record<LudoColor, string> = {
  red: "#f05b6c",
  green: "#20ba89",
  yellow: "#f6c44e",
  blue: "#568df4",
};
const homes = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];
export function LudoBoard({
  state,
  you,
  legal = [],
  disabled = false,
  onMove,
}: {
  state: LudoState;
  you?: number;
  legal?: number[];
  disabled?: boolean;
  onMove?: (token: number) => void;
}) {
  const tokens = state.players.flatMap((p) =>
    p && !p.forfeited
      ? p.tokens.map((pos, i) => ({
          p,
          i,
          pos,
          xy: ludoPosition(p.color, pos, i),
        }))
      : [],
  );
  return (
    <div className="ld-board" role="group" aria-label="Ludo board">
      <svg viewBox="0 0 600 600" aria-hidden="true" className="ld-grid">
        <rect width="600" height="600" rx="20" fill="#f9f5eb" />
        {homes.map(([r, c], idx) => (
          <g key={idx}>
            <rect
              x={c * 40 + 5}
              y={r * 40 + 5}
              width="230"
              height="230"
              rx="15"
              fill={COLORS[LUDO_COLORS[idx]]}
            />
            <rect
              x={c * 40 + 35}
              y={r * 40 + 35}
              width="170"
              height="170"
              rx="24"
              fill="#fff"
              opacity=".96"
            />
            {[0, 1, 2, 3].map((i) => {
              const [tr, tc] = ludoPosition(LUDO_COLORS[idx], -1, i);
              return (
                <circle
                  key={i}
                  cx={tc * 40 + 20}
                  cy={tr * 40 + 20}
                  r="18"
                  fill={COLORS[LUDO_COLORS[idx]]}
                  opacity=".18"
                />
              );
            })}
          </g>
        ))}
        {LUDO_PATH.map(([r, c], i) => (
          <g key={i}>
            <rect
              x={c * 40 + 0.8}
              y={r * 40 + 0.8}
              width="38.4"
              height="38.4"
              rx="3"
              fill={
                i % 13 === 0 ? COLORS[LUDO_COLORS[Math.floor(i / 13)]] : "#fff"
              }
              stroke="#d7d9dc"
              strokeWidth="1"
            />
            {LUDO_SAFE.includes(i) && (
              <text
                x={c * 40 + 20}
                y={r * 40 + 28}
                textAnchor="middle"
                fontSize="27"
                fill={i % 13 === 0 ? "#fff" : "#b6bdc4"}
              >
                ★
              </text>
            )}
          </g>
        ))}
        {LUDO_COLORS.flatMap((color) =>
          Array.from({ length: 5 }, (_, i) => {
            const [r, c] = ludoPosition(color, 51 + i, 0);
            return (
              <rect
                key={`${color}${i}`}
                x={c * 40 + 1}
                y={r * 40 + 1}
                width="38"
                height="38"
                rx="3"
                fill={COLORS[color]}
                opacity=".85"
              />
            );
          }),
        )}
        <path d="M240 240 L300 300 L240 360Z" fill={COLORS.red} />
        <path d="M240 240 L360 240 L300 300Z" fill={COLORS.green} />
        <path d="M360 240 L360 360 L300 300Z" fill={COLORS.yellow} />
        <path d="M240 360 L300 300 L360 360Z" fill={COLORS.blue} />
        <circle cx="300" cy="300" r="24" fill="#fff" />
        <path d="m283 291 8 5 9-12 9 12 8-5-5 20h-24z" fill="#bd8d33" />
      </svg>
      {tokens.map(({ p, i, pos, xy }) => {
        if (pos === 56) return null;
        const group = tokens.filter(
            (t) => t.pos !== 56 && t.xy[0] === xy[0] && t.xy[1] === xy[1],
          ),
          index = group.findIndex((t) => t.p.seat === p.seat && t.i === i);
        const x =
            xy[1] +
            0.5 +
            (group.length > 1 ? (index % 2 === 0 ? -0.21 : 0.21) : 0),
          y =
            xy[0] +
            0.5 +
            (group.length > 2
              ? Math.floor(index / 2) % 2 === 0
                ? -0.2
                : 0.2
              : 0);
        const playable = p.seat === you && legal.includes(i) && !disabled;
        return (
          <button
            key={`${p.seat}:${i}`}
            className={`ld-token${playable ? " ld-playable" : ""}${group.length > 1 ? " ld-stacked" : ""}`}
            style={{
              left: `${(x / 15) * 100}%`,
              top: `${(y / 15) * 100}%`,
              background: COLORS[p.color],
            }}
            disabled={!playable}
            aria-label={`${p.color} token ${i + 1}${playable ? ", move" : ""}`}
            onClick={() => onMove?.(i)}
          >
            <span>{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
