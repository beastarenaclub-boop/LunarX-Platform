import { useId } from "react";
import {
  SNAKE_COLORS,
  SNAKE_JUMPS,
  snakeCell,
  snakeCurve,
  snakePath,
  type SnakeState,
  type SnakeTheme,
} from "@workspace/api-zod/snakes";
export type SnakeVisual = {
  seat: number;
  x: number;
  y: number;
  kind: "step" | "snake" | "ladder";
};
export function SnakeBoard({
  state,
  theme,
  visual,
  preview = false,
}: {
  state: SnakeState;
  theme: SnakeTheme;
  visual?: SnakeVisual | null;
  preview?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const disco = theme === "disco",
    nature = theme === "nature";
  return (
    <svg
      className={`sn-board sn-board-${theme}`}
      viewBox="-5 -5 510 555"
      role="img"
      aria-label="Snakes and Ladders board, squares 1 to 100"
      data-theme={theme}
      aria-busy={!!visual}
    >
      <defs>
        <linearGradient id={uid + "frame"} x2=".4" y2="1">
          <stop stopColor="#fff2a9" />
          <stop offset=".4" stopColor="#ca8a1c" />
          <stop offset=".7" stopColor="#fff0a0" />
          <stop offset="1" stopColor="#8d4c13" />
        </linearGradient>
        <linearGradient id={uid + "ladder"}>
          <stop stopColor="#693b13" />
          <stop offset=".35" stopColor="#fff0a5" />
          <stop offset=".7" stopColor="#e4b054" />
          <stop offset="1" stopColor="#834514" />
        </linearGradient>
        {SNAKE_COLORS.map((c, i) => (
          <radialGradient key={c} id={uid + "token" + i} cx=".3" cy=".2">
            <stop stopColor="#fff" />
            <stop offset=".3" stopColor={c} />
            <stop offset=".8" stopColor={c} />
            <stop offset="1" stopColor="#0d284c" />
          </radialGradient>
        ))}
      </defs>
      <rect
        x="-4"
        y="-4"
        width="508"
        height="508"
        rx="5"
        fill={`url(#${uid}frame)`}
      />
      {Array.from({ length: 100 }, (_, i) => {
        const [x, y] = snakeCell(i + 1),
          row = Math.floor(i / 10),
          col = i % 10;
        return (
          <g key={i}>
            <rect
              x={x - 25}
              y={y - 25}
              width="50"
              height="50"
              fill={
                disco
                  ? (row + col) % 2
                    ? "#171a36"
                    : "#0c1024"
                  : nature
                    ? (row + col) % 2
                      ? "#f1ce61"
                      : "#77b94d"
                    : (row + col) % 2
                      ? "#ffe296"
                      : "#e9a759"
              }
              stroke={disco ? "#f05ebe" : nature ? "#416d30" : "#a96a22"}
              strokeWidth={disco ? "1" : ".65"}
            />
            {nature && (
              <path
                d={`M${x - 17} ${y + 21}q-8-15 2-11m-2 11q6-15 8-9`}
                stroke="#396d32"
                fill="none"
                opacity=".25"
              />
            )}
            {i === 99 && (
              <path
                d={`M${x - 15} ${y + 2}l8 6 7-14 7 14 8-6-3 17h-24Z`}
                fill="#ffc932"
                stroke="#b37e14"
              />
            )}
          </g>
        );
      })}
      {Object.entries(SNAKE_JUMPS)
        .filter(([a, b]) => b > Number(a))
        .map(([a, to]) => {
          const from = Number(a),
            [x, y] = snakeCell(from),
            [x2, y2] = snakeCell(to),
            dx = x2 - x,
            dy = y2 - y,
            len = Math.hypot(dx, dy),
            nx = (-dy / len) * 6,
            ny = (dx / len) * 6;
          return (
            <g
              key={a}
              className={visual?.kind === "ladder" ? "sn-ladder-lit" : ""}
              data-from={from}
              data-to={to}
            >
              <path
                d={`M${x + nx + 2} ${y + ny + 3}L${x2 + nx + 2} ${y2 + ny + 3}M${x - nx + 2} ${y - ny + 3}L${x2 - nx + 2} ${y2 - ny + 3}`}
                stroke="#22130c"
                opacity=".4"
                strokeWidth="5"
              />
              {Array.from({ length: Math.floor(len / 16) }, (_, i) => {
                const t = (i + 1) / (Math.floor(len / 16) + 1);
                return (
                  <path
                    key={i}
                    d={`M${x + dx * t + nx} ${y + dy * t + ny}l${-nx * 2} ${-ny * 2}`}
                    stroke={disco ? "#ffe92d" : "#a15f1e"}
                    strokeWidth="4"
                  />
                );
              })}
              <path
                d={`M${x + nx} ${y + ny}L${x2 + nx} ${y2 + ny}M${x - nx} ${y - ny}L${x2 - nx} ${y2 - ny}`}
                stroke={disco ? "#38ecff" : `url(#${uid}ladder)`}
                strokeWidth="5"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      {Object.entries(SNAKE_JUMPS)
        .filter(([a, b]) => b < Number(a))
        .map(([a, to], i) => {
          const from = Number(a),
            [x, y] = snakeCell(from),
            next = snakeCurve(from, to, 0.03),
            angle = (Math.atan2(next[1] - y, next[0] - x) * 180) / Math.PI - 90,
            c = [
              "#6da629",
              "#d35b3a",
              "#19a8aa",
              "#ad54c5",
              "#e89126",
              "#3e8f63",
            ][i];
          return (
            <g key={a} data-from={from} data-to={to}>
              <path
                d={snakePath(from, to)}
                fill="none"
                stroke="#14200d"
                strokeWidth="12"
                strokeLinecap="round"
                opacity=".3"
                transform="translate(2 3)"
              />
              <path
                d={snakePath(from, to)}
                fill="none"
                stroke={c}
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d={snakePath(from, to)}
                fill="none"
                stroke={disco ? "#fff" : "#fff6ab"}
                strokeWidth="3"
                strokeDasharray="2 9"
                opacity=".75"
                strokeLinecap="round"
              />
              <g transform={`translate(${x} ${y}) rotate(${angle})`}>
                <path
                  d="M-8 5Q-13-6-7-14Q0-20 7-14Q13-6 8 5Z"
                  fill={c}
                  stroke="#315021"
                  strokeWidth="1"
                />
                <ellipse cx="-4" cy="-8" rx="3" ry="4" fill="white" />
                <ellipse cx="4" cy="-8" rx="3" ry="4" fill="white" />
                <circle cx="-4" cy="-9" r="1.6" fill="#17212d" />
                <circle cx="4" cy="-9" r="1.6" fill="#17212d" />
                <path
                  d="M0-17v-7m0 0-3-4m3 4 3-4"
                  stroke="#d7364f"
                  fill="none"
                  strokeWidth="1.6"
                />
              </g>
            </g>
          );
        })}
      {Array.from({ length: 100 }, (_, i) => {
        const [x, y] = snakeCell(i + 1);
        return (
          <text
            key={i}
            x={x - 21}
            y={y - 12}
            fill={disco ? "#fff" : nature ? "#223e15" : "#6c3515"}
            fontSize="11"
            fontFamily="Arial,sans-serif"
            fontWeight="700"
            paintOrder="stroke"
            stroke={disco ? "#10142b" : nature ? "#c0d97c" : "#fbd08a"}
            strokeWidth="1.5"
          >
            {i + 1}
          </text>
        );
      })}
      {!preview && (
        <g>
          <path d="M5 515h490" stroke="#ffd86c" opacity=".3" />
          <text x="485" y="536" textAnchor="end" fill="#ffe7a7" fontSize="12">
            START
          </text>
        </g>
      )}
      {!preview &&
        state.players.map((p, i) => {
          if (p.left) return null;
          const pos = snakeCell(p.position),
            same = state.players.filter(
              (other) => other.position === p.position,
            ).length;
          let x = pos[0],
            y = pos[1] + 5;
          if (p.position === 0) x = 25 + i * 50;
          else if (same > 1) {
            x += i % 2 ? 9 : -9;
            y += i > 1 ? 6 : -4;
          }
          if (visual?.seat === i) {
            x = visual.x;
            y = visual.y;
          }
          return (
            <g
              key={p.id}
              className={`sn-token ${state.turn === i ? "sn-token-active" : ""}`}
              transform={`translate(${x} ${y})`}
              data-seat={i}
              data-position={p.position}
              data-moving={visual?.seat === i ? "true" : "false"}
            >
              <ellipse cy="11" rx="13" ry="5" fill="#11203e" opacity=".45" />
              <path
                d="M-5-2L-10 9Q0 17 10 9L5-2Z"
                fill={`url(#${uid}token${i})`}
                stroke="white"
                strokeWidth="1.4"
              />
              <circle
                cy="-6"
                r="8"
                fill={`url(#${uid}token${i})`}
                stroke="white"
                strokeWidth="1.5"
              />
              <text
                y="-3"
                textAnchor="middle"
                fontSize="9"
                fontWeight="900"
                fill="#fff"
                stroke="#152641"
                strokeWidth=".3"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

export function SnakeLogo() {
  const art = (name: string) => `/media/ludo/generated-v1/${name}.webp`;
  return (
    <svg
      className="sn-logo"
      viewBox="0 0 320 175"
      role="img"
      aria-label="Snakes and Ladders"
    >
      <image
        href={art("snakes-hero-sign")}
        x="37"
        y="40"
        width="246"
        height="129"
        preserveAspectRatio="none"
      />
      <g className="sn-generated-left">
        <image
          href={art("snakes-hero-left")}
          x="0"
          y="5"
          width="84"
          height="154"
        />
      </g>
      <g className="sn-generated-right">
        <image
          href={art("snakes-hero-right")}
          x="236"
          y="5"
          width="84"
          height="154"
        />
      </g>
      <g
        fontFamily="Georgia,serif"
        textAnchor="middle"
        fontWeight="900"
        fill="#ffe343"
        stroke="#77510e"
        strokeWidth="1.5"
        paintOrder="stroke"
      >
        <text x="160" y="88" fontSize="27">
          SNAKES
        </text>
        <text x="160" y="110" fontSize="17">
          AND
        </text>
        <text x="160" y="138" fontSize="27">
          LADDERS
        </text>
      </g>
    </svg>
  );
}
