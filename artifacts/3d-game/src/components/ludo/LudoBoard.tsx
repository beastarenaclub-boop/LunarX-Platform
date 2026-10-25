import { memo } from "react";
import {
  LUDO_COLORS,
  LUDO_PATH,
  LUDO_SAFE,
  ludoPosition,
  type LudoState,
  type LudoColor,
} from "@workspace/api-zod/ludo";
import { LudoPin } from "./LudoPin";
import { LUDO_STEP_MS, type MovingToken } from "./useLudoMovement";
export const COLORS: Record<LudoColor, string> = {
  red: "#ff2d27",
  green: "#008d43",
  yellow: "#ffdb05",
  blue: "#19a8f2",
};
const homes = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];
function finishedPosition(color: LudoColor, token: number): [number, number] {
  let [r, c] = [
    [6.8, 6.3],
    [7.8, 6.3],
    [7.1, 6.8],
    [7.9, 6.8],
  ][token];
  for (let i = 0; i < LUDO_COLORS.indexOf(color); i++) [r, c] = [c, 15 - r];
  return [r - 0.5, c - 0.5];
}
export const LudoBoard = memo(function LudoBoard({
  state,
  you,
  legal = [],
  disabled = false,
  moving,
  onMove,
}: {
  state: LudoState;
  you?: number;
  legal?: number[];
  disabled?: boolean;
  moving?: MovingToken | null;
  onMove?: (token: number) => void;
}) {
  const tokens = state.players.flatMap((p) =>
    p && !p.forfeited
      ? p.tokens.map((pos, i) => ({
          p,
          i,
          pos,
          xy:
            pos === 56 && !(moving?.seat === p.seat && moving.token === i)
              ? finishedPosition(p.color, i)
              : ludoPosition(p.color, pos, i),
        }))
      : [],
  );
  return (
    <div
      className="ld-board"
      role="group"
      aria-label="Ludo board"
      aria-busy={!!moving}
    >
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
              fill="#fff"
              stroke="#5d6c75"
              strokeWidth="1.3"
            />
            {[0, 1, 2, 3].map((i) => {
              const [tr, tc] = ludoPosition(LUDO_COLORS[idx], -1, i);
              return (
                <circle
                  key={i}
                  cx={tc * 40 + 20}
                  cy={tr * 40 + 20}
                  r="21.5"
                  fill={COLORS[LUDO_COLORS[idx]]}
                  stroke="#5d6c75"
                  strokeWidth=".8"
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
              stroke="#7a8588"
              strokeWidth=".9"
            />
            {LUDO_SAFE.includes(i) && i % 13 !== 0 && (
              <path
                transform={
                  "translate(" + (c * 40 + 20) + " " + (r * 40 + 20) + ")"
                }
                d="m0-16 5 10 11 2-8 8 2 11L0 10l-10 5 2-11-8-8 11-2Z"
                fill="none"
                stroke="#6c7879"
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
                key={color + i}
                x={c * 40}
                y={r * 40}
                width="40"
                height="40"
                fill={COLORS[color]}
                stroke="#617475"
                strokeWidth=".7"
              />
            );
          }),
        )}
        <path d="M240 240 L300 300 L240 360Z" fill={COLORS.red} />
        <path d="M240 240 L360 240 L300 300Z" fill={COLORS.green} />
        <path d="M360 240 L360 360 L300 300Z" fill={COLORS.yellow} />
        <path d="M240 360 L300 300 L360 360Z" fill={COLORS.blue} />
        {LUDO_COLORS.map((color, index) => (
          <path
            key={color}
            transform={"rotate(" + index * 90 + " 300 300)"}
            d="M9 300h22m-8-8 8 8-8 8"
            fill="none"
            stroke={COLORS[color]}
            strokeWidth="1.7"
          />
        ))}
      </svg>
      {tokens.map(({ p, i, pos, xy }) => {
        const travelling = moving?.seat === p.seat && moving.token === i;
        const group = travelling
            ? []
            : tokens.filter(
                (t) =>
                  t.pos !== 56 &&
                  !(moving?.seat === t.p.seat && moving.token === t.i) &&
                  t.xy[0] === xy[0] &&
                  t.xy[1] === xy[1],
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
            className={`ld-token${playable ? " ld-playable" : ""}${group.length > 1 ? " ld-stacked" : ""}${travelling ? " ld-token-moving" : ""}${pos === 56 && !travelling ? " ld-token-home" : ""}`}
            data-seat={p.seat}
            data-token={i}
            data-position={pos}
            style={{
              left: `${(x / 15) * 100}%`,
              top: `${(y / 15) * 100}%`,
              transitionDuration: travelling
                ? `${LUDO_STEP_MS - 25}ms`
                : undefined,
            }}
            disabled={!playable}
            aria-label={`${p.color} token ${i + 1}${pos === 56 ? ", home" : playable ? ", move" : ""}`}
            onClick={() => onMove?.(i)}
          >
            <LudoPin key={travelling ? pos : "idle"} color={COLORS[p.color]} />
          </button>
        );
      })}
    </div>
  );
});
