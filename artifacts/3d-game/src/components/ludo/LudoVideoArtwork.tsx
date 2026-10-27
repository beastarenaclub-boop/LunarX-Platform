import { useId } from "react";

/** Drawn from the recording's composition; no recorded screen pixels are used. */
export function LudoVideoHero() {
  const id = useId().replace(/:/g, "");
  const point = (r: number, c: number) => {
    const t = r / 15;
    return [63 - 35 * t + (c * (174 + 70 * t)) / 15, 105 + 65 * t];
  };
  const polygon = (r: number, c: number) =>
    [
      [r, c],
      [r, c + 1],
      [r + 1, c + 1],
      [r + 1, c],
    ]
      .map(([a, b]) => point(a, b).join(","))
      .join(" ");
  const color = (r: number, c: number) =>
    ((r >= 1 && r <= 4) || (r >= 10 && r <= 13)) &&
    ((c >= 1 && c <= 4) || (c >= 10 && c <= 13))
      ? "#fffdf1"
      : r < 6 && c < 6
        ? "#ef322d"
        : r < 6 && c > 8
          ? "#78ba28"
          : r > 8 && c < 6
            ? "#22a8e9"
            : r > 8 && c > 8
              ? "#ffda21"
              : r === 7 && c > 0 && c < 6
                ? "#ef322d"
                : c === 7 && r > 0 && r < 6
                  ? "#78ba28"
                  : r === 7 && c > 8 && c < 14
                    ? "#ffda21"
                    : c === 7 && r > 8 && r < 14
                      ? "#22a8e9"
                      : "#fffbe4";
  const pawn = (x: number, y: number, s: number, color: string) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cy="55" rx="20" ry="6" fill="#082858" opacity=".4" />
      <path
        d="M-7 5C-8 22-13 37-21 50Q0 63 21 50C13 37 8 22 7 5Z"
        fill={`url(#${id}${color})`}
        stroke="#143f69"
        strokeWidth="1.3"
      />
      <circle
        r="12"
        fill={`url(#${id}${color})`}
        stroke="#143f69"
        strokeWidth="1.3"
      />
      <ellipse cx="-4" cy="-5" rx="5" ry="3" fill="white" opacity=".45" />
    </g>
  );
  return (
    <div
      className="ld-crafted-hero ld-video-hero"
      role="img"
      aria-label="Ludo King board and dice"
    >
      <svg viewBox="0 0 300 190" aria-hidden="true">
        <defs>
          <linearGradient id={id + "gold"} x2=".2" y2="1">
            <stop stopColor="#fffdd0" />
            <stop offset=".3" stopColor="#f8d442" />
            <stop offset=".55" stopColor="#be7911" />
            <stop offset=".75" stopColor="#ffdf57" />
            <stop offset="1" stopColor="#8c5108" />
          </linearGradient>
          <radialGradient id={id + "white"} cx=".25" cy=".16" r=".85">
            <stop stopColor="white" />
            <stop offset=".7" stopColor="#f4f2e6" />
            <stop offset="1" stopColor="#a5adb3" />
          </radialGradient>
          {["#29b8f1", "#ffe32b", "#f63e2d", "#75bc28"].map((c, i) => (
            <linearGradient
              key={c}
              id={id + ["blue", "yellow", "red", "green"][i]}
            >
              <stop stopColor={c} />
              <stop offset=".35" stopColor={c} />
              <stop offset=".57" stopColor="#ffffff" stopOpacity=".75" />
              <stop offset=".72" stopColor={c} />
              <stop
                offset="1"
                stopColor={
                  i === 1
                    ? "#caa20c"
                    : i === 0
                      ? "#067daf"
                      : i === 2
                        ? "#a81616"
                        : "#42851c"
                }
              />
            </linearGradient>
          ))}
        </defs>
        <ellipse
          cx="151"
          cy="176"
          rx="126"
          ry="7"
          fill="#072b55"
          opacity=".4"
        />
        <path
          d="M62 103H238L276 173H24Z"
          fill="#16466c"
          stroke="#fff3b7"
          strokeWidth="2"
        />
        <g>
          {Array.from({ length: 225 }, (_, i) => {
            const r = Math.floor(i / 15),
              c = i % 15;
            return (
              <polygon
                key={i}
                points={polygon(r, c)}
                fill={color(r, c)}
                stroke={
                  (r < 6 || r > 8) && (c < 6 || c > 8) ? "none" : "#2a5060"
                }
                strokeWidth=".45"
              />
            );
          })}
        </g>
        {[
          [1, 1, "#ef322d"],
          [1, 10, "#78ba28"],
          [10, 1, "#22a8e9"],
          [10, 10, "#ffda21"],
        ].map(([r, c, fill]) => (
          <g key={String(fill)}>
            {[0, 1, 2, 3].map((n) => {
              const [x, y] = point(
                Number(r) + 1 + Math.floor(n / 2) * 2,
                Number(c) + 1 + (n % 2) * 2,
              );
              return (
                <ellipse
                  key={n}
                  cx={x}
                  cy={y}
                  rx="8"
                  ry="4"
                  fill={String(fill)}
                  stroke="#fffdf0"
                  strokeWidth="2"
                />
              );
            })}
          </g>
        ))}
        {pawn(83, 109, 0.55, "red")}
        {pawn(226, 108, 0.55, "green")}
        <g className="ld-video-letters">
          {"LUDO".split("").map((c, i) => (
            <g key={c} transform={`translate(${78 + i * 45} 77)`}>
              <circle cy="3" r="21" fill="#123e64" />
              <circle r="21" fill={`url(#${id}white)`} stroke="#fff9c0" />
              <text
                y="11"
                textAnchor="middle"
                fontFamily="Arial,sans-serif"
                fontSize="31"
                fontWeight="900"
                fill={["#279bd5", "#ec3e2f", "#69af29", "#e6b919"][i]}
                stroke="#29516a"
                strokeWidth=".35"
              >
                {c}
              </text>
            </g>
          ))}
        </g>
        <text
          x="220"
          y="51"
          fontFamily="Georgia,serif"
          fontSize="21"
          textAnchor="middle"
          fill="#ffe486"
          stroke="#805a18"
          strokeWidth=".35"
        >
          KING
        </text>
        <g
          transform="translate(48 15) rotate(-9 30 30)"
          className="ld-video-logo-crown"
        >
          <path
            d="M5 15L18 31 22 9 34 28 45 4 49 28 64 12 56 48H14Z"
            fill={`url(#${id}gold)`}
            stroke="#855f1d"
          />
          <path
            d="M14 47Q34 42 56 47V55Q34 50 14 55Z"
            fill={`url(#${id}gold)`}
            stroke="#8d5b13"
          />
          {[
            [5, 14],
            [22, 8],
            [45, 3],
            [64, 11],
          ].map(([x, y]) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="3.3"
              fill="#fff2a5"
              stroke="#b8801f"
            />
          ))}
          {[22, 35, 48].map((x) => (
            <path
              key={x}
              d={`M${x} 34l3 5-3 5-3-5Z`}
              fill="#3398c7"
              stroke="#ffe6a0"
            />
          ))}
        </g>
        <g
          className="ld-video-white-die"
          transform="translate(142 113) rotate(12)"
        >
          <path
            d="M-15-12L7-20Q12-21 16-17L27 5Q28 11 24 15L4 24Q-2 26-7 21L-21 1Q-25-6-15-12Z"
            fill={`url(#${id}white)`}
            stroke="#465362"
            strokeWidth="1.2"
          />
          <path
            d="M-19-9L3-1 25 9M3-1L8 22M3-1L10-20"
            fill="none"
            stroke="#a9afb1"
            strokeWidth="1"
          />
          {[
            [-12, -7],
            [-9, 4],
            [-4, 15],
            [10, 4],
            [16, 1],
            [18, 12],
            [-2, -12],
            [7, -14],
            [13, -9],
          ].map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx="2.3" ry="2.8" fill="#202c37" />
          ))}
        </g>
        <g className="ld-video-pawn-blue">{pawn(36, 125, 1.15, "blue")}</g>
        <g className="ld-video-pawn-yellow">{pawn(266, 125, 1.15, "yellow")}</g>
      </svg>
    </div>
  );
}

export function RoyalBadge({ label = "Member" }: { label?: string }) {
  return (
    <span className="ld-royal-badge">
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <path
          d="M19 16L14 4 25 10 30 0 36 10 47 4 42 17"
          fill="#f8d766"
          stroke="#8c5918"
        />
        <circle
          cx="30"
          cy="31"
          r="18"
          fill="#17294b"
          stroke="#f4d262"
          strokeWidth="3"
        />
        <circle cx="30" cy="31" r="14" fill="none" stroke="#9d7028" />
        <text
          x="30"
          y="39"
          textAnchor="middle"
          fontFamily="Georgia,serif"
          fontSize="25"
          fill="#ffdf80"
        >
          K
        </text>
      </svg>
      <em>{label}</em>
    </span>
  );
}
