import {
  LUDO_COLORS,
  LUDO_PATH,
  LUDO_SAFE,
  ludoPosition,
  type LudoState,
  type LudoColor,
} from "@workspace/api-zod/ludo";
import { LudoPin } from "./LudoPin";
export const COLORS: Record<LudoColor, string> = {
  red: "#ed253b",
  green: "#1aa83b",
  yellow: "#ffda17",
  blue: "#159be3",
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
        <rect width="600" height="600" fill="#fff" />
        {homes.map(([r, c], idx) => (
          <g key={idx}>
            <rect
              x={c * 40}
              y={r * 40}
              width="240"
              height="240"
              fill={COLORS[LUDO_COLORS[idx]]}
            />
            <rect
              x={c * 40 + 40}
              y={r * 40 + 40}
              width="160"
              height="160"
              rx="2"
              fill="#fff"
              stroke="#16334f"
              strokeWidth="1.2"
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
                  stroke="#18344d"
                  strokeWidth="1.2"
                />
              );
            })}
          </g>
        ))}
        {LUDO_PATH.map(([r, c], i) => (
          <g key={i}>
            <rect
              x={c * 40}
              y={r * 40}
              width="40"
              height="40"
              fill={
                i % 13 === 0 ? COLORS[LUDO_COLORS[Math.floor(i / 13)]] : "#fff"
              }
              stroke="#20384e"
              strokeWidth="1"
            />
            {LUDO_SAFE.includes(i) && (
              <path
                transform={`translate(${c * 40 + 20} ${r * 40 + 20})`}
                d="m0-15 4.5 10 11 1.5-8 7.5 2 11L0 10l-9.5 5 2-11-8-7.5 11-1.5Z"
                fill="none"
                stroke={i % 13 === 0 ? "#fff" : "#20384e"}
                strokeWidth="1.3"
              />
            )}
          </g>
        ))}
        {LUDO_COLORS.flatMap((color) =>
          Array.from({ length: 5 }, (_, i) => {
            const [r, c] = ludoPosition(color, 51 + i, 0);
            return (
              <rect
                key={`${color}${i}`}
                x={c * 40}
                y={r * 40}
                width="40"
                height="40"
                fill={COLORS[color]}
                stroke="#20384e"
                strokeWidth="1"
              />
            );
          }),
        )}
        <path d="M240 240 L300 300 L240 360Z" fill={COLORS.red} />
        <path d="M240 240 L360 240 L300 300Z" fill={COLORS.green} />
        <path d="M360 240 L360 360 L300 300Z" fill={COLORS.yellow} />
        <path d="M240 360 L300 300 L360 360Z" fill={COLORS.blue} />
        <path
          d="M240 240H360V360H240ZM240 240 360 360M360 240 240 360"
          fill="none"
          stroke="#20384e"
          strokeWidth="1.4"
        />
        {LUDO_COLORS.map((color, index) => (
          <path
            key={color}
            transform={`rotate(${index * 90} 300 300)`}
            d="M8 300h24m-9-9 9 9-9 9"
            fill="none"
            stroke={COLORS[color]}
            strokeWidth="2.5"
          />
        ))}
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
            }}
            disabled={!playable}
            aria-label={`${p.color} token ${i + 1}${playable ? ", move" : ""}`}
            onClick={() => onMove?.(i)}
          >
            <LudoPin color={COLORS[p.color]} number={i + 1} />
          </button>
        );
      })}
    </div>
  );
}
