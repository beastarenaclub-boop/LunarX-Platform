import { useId } from "react";
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
  red: "#f23851",
  green: "#19b65b",
  yellow: "#ffd139",
  blue: "#168df0",
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
  const id = useId().replace(/:/g, "");
  const paint = (color: LudoColor) => `url(#${id}-${color})`;
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
        <defs>
          {LUDO_COLORS.map((color) => (
            <linearGradient
              key={color}
              id={`${id}-${color}`}
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop stopColor={COLORS[color]} />
              <stop
                offset="1"
                stopColor={
                  {
                    red: "#c91638",
                    green: "#07873f",
                    yellow: "#efa90e",
                    blue: "#0866cb",
                  }[color]
                }
              />
            </linearGradient>
          ))}
          <linearGradient id={`${id}-ivory`} x2="0" y2="1">
            <stop stopColor="#fffef8" />
            <stop offset="1" stopColor="#e8edf4" />
          </linearGradient>
          <linearGradient id={`${id}-gold`} x2="0" y2="1">
            <stop stopColor="#fff1ac" />
            <stop offset=".5" stopColor="#f5cd60" />
            <stop offset="1" stopColor="#c18b24" />
          </linearGradient>
        </defs>
        <rect width="600" height="600" fill="#e4e8ef" />
        {homes.map(([r, c], idx) => (
          <g key={idx}>
            <rect
              x={c * 40}
              y={r * 40}
              width="240"
              height="240"
              fill={paint(LUDO_COLORS[idx])}
            />
            <rect
              x={c * 40 + 9}
              y={r * 40 + 9}
              width="222"
              height="222"
              rx="16"
              fill="none"
              stroke="#fff"
              strokeOpacity=".28"
              strokeWidth="2"
            />
            <path
              d={`M${c * 40 + 18} ${r * 40 + 35}V${r * 40 + 18}h17 M${c * 40 + 205} ${r * 40 + 222}h17v-17`}
              fill="none"
              stroke="#fff"
              strokeOpacity=".55"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect
              x={c * 40 + 38}
              y={r * 40 + 43}
              width="164"
              height="160"
              rx="22"
              fill="#001c45"
              opacity=".22"
            />
            <rect
              x={c * 40 + 40}
              y={r * 40 + 40}
              width="160"
              height="160"
              rx="20"
              fill={`url(#${id}-ivory)`}
              stroke="#fff"
              strokeWidth="3"
            />
            {[0, 1, 2, 3].map((i) => {
              const [tr, tc] = ludoPosition(LUDO_COLORS[idx], -1, i);
              return (
                <g key={i}>
                  <circle
                    cx={tc * 40 + 20}
                    cy={tr * 40 + 20}
                    r="21"
                    fill={paint(LUDO_COLORS[idx])}
                    stroke="#c7d1df"
                    strokeWidth="2"
                  />
                  <circle
                    cx={tc * 40 + 20}
                    cy={tr * 40 + 20}
                    r="16"
                    fill="none"
                    stroke="#fff"
                    strokeOpacity=".4"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })}
          </g>
        ))}
        {LUDO_PATH.map(([r, c], i) => (
          <g key={i}>
            <rect
              x={c * 40 + 1}
              y={r * 40 + 1}
              width="38"
              height="38"
              rx="3"
              fill={
                i % 13 === 0
                  ? paint(LUDO_COLORS[Math.floor(i / 13)])
                  : `url(#${id}-ivory)`
              }
              stroke="#a7b5c9"
              strokeWidth="1"
            />
            {LUDO_SAFE.includes(i) && (
              <path
                transform={`translate(${c * 40 + 20} ${r * 40 + 20})`}
                d="m0-15 4.5 10 11 1.5-8 7.5 2 11L0 10l-9.5 5 2-11-8-7.5 11-1.5Z"
                fill={i % 13 === 0 ? "#ffffff30" : "#d4dce8"}
                stroke={i % 13 === 0 ? "#fff" : "#8396af"}
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
                x={c * 40 + 1}
                y={r * 40 + 1}
                width="38"
                height="38"
                rx="3"
                fill={paint(color)}
                stroke="#ffffff85"
                strokeWidth="1"
              />
            );
          }),
        )}
        <path d="M240 240 L300 300 L240 360Z" fill={paint("red")} />
        <path d="M240 240 L360 240 L300 300Z" fill={paint("green")} />
        <path d="M360 240 L360 360 L300 300Z" fill={paint("yellow")} />
        <path d="M240 360 L300 300 L360 360Z" fill={paint("blue")} />
        <path
          d="M240 240H360V360H240ZM240 240 360 360M360 240 240 360"
          fill="none"
          stroke="#ffffffb3"
          strokeWidth="2"
        />
        <circle
          cx="300"
          cy="300"
          r="23"
          fill="#123f75"
          stroke={`url(#${id}-gold)`}
          strokeWidth="3"
        />
        <path
          d="m286 293 8 6 6-12 6 12 8-6-3 16h-22Zm3 20h22"
          fill={`url(#${id}-gold)`}
          stroke="#ffea97"
          strokeWidth="1.5"
          strokeLinejoin="round"
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
