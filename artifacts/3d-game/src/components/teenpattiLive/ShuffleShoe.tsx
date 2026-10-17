import { forwardRef, useId, useImperativeHandle, useRef } from "react";
import { SHUFFLE_MS, smooth } from "./tableCameras";

export interface ShuffleController {
  update: (elapsed: number, animate: boolean) => void;
}

/** Two feed hoppers interleave 52 individual sheets into a receiving tray.
 * The collected pack squares and drops into the same outlet used for dealing. */
const ShuffleShoe = forwardRef<ShuffleController, { id: string }>(
  function ShuffleShoe({ id }, ref) {
    const token = useId().replace(/:/g, "");
    const root = useRef<SVGGElement>(null);
    const sheets = useRef<(SVGGElement | null)[]>([]);
    const paper = useRef<(SVGPathElement | null)[]>([]);
    const backs = useRef<(SVGPathElement | null)[]>([]);
    const roller = useRef<SVGGElement>(null);
    const light = useRef<SVGCircleElement>(null);
    const previous = useRef(-1);

    useImperativeHandle(
      ref,
      () => ({
        update(elapsed, animate) {
          const time = animate ? Math.min(SHUFFLE_MS, elapsed) : SHUFFLE_MS;
          if (time === previous.current) return;
          previous.current = time;
          let collected = 0;
          const load = smooth((time - 3800) / 900);
          const square = smooth((time - 3300) / 500);
          for (let index = 0; index < 52; index++) {
            const card = sheets.current[index];
            if (!card) continue;
            const layer = Math.floor(index / 2);
            const right = index % 2 === 1;
            const feed = smooth((time - 300 - index * 48) / 440);
            const fromX = right ? 116 : 15;
            const fromY = 17 - (25 - layer) * 0.43;
            const finalY = 42 - index * 0.22;
            const stagger = (right ? 1 : -1) * 2 * (1 - square);
            const x = fromX + (66 + stagger - fromX) * feed;
            const y = fromY + (finalY - fromY) * feed + load * 18;
            const bend = Math.sin(Math.PI * feed) * 12;
            card.setAttribute(
              "transform",
              `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
            );
            card.setAttribute("data-fed", String(feed >= 1));
            card.setAttribute("data-moving", String(feed > 0 && feed < 1));
            paper.current[index]?.setAttribute(
              "d",
              `M0 0Q19 ${-bend} 38 0L31 22Q12 ${22 - bend} -7 22Z`,
            );
            backs.current[index]?.setAttribute(
              "d",
              `M2 2Q19 ${2 - bend} 35 2L29 20Q12 ${20 - bend} -4 20Z`,
            );
            if (feed >= 1) collected++;
          }
          root.current?.setAttribute("data-collected", String(collected));
          root.current?.setAttribute(
            "data-shuffle-phase",
            time < 300
              ? "loaded"
              : time < 3300
                ? "interleaving"
                : time < 3800
                  ? "squaring"
                  : time < 4700
                    ? "loading"
                    : "ready",
          );
          roller.current?.setAttribute(
            "transform",
            `translate(81 78) rotate(${time < 3300 ? time * 0.38 : 0})`,
          );
          light.current?.setAttribute(
            "fill",
            time < 4700 ? "#e8b85a" : "#91d4a4",
          );
        },
      }),
      [],
    );

    return (
      <g id={id} ref={root} data-testid="tpl-shuffle-mechanism">
        <defs>
          <linearGradient id={`${token}-metal`} x2="0" y2="1">
            <stop stopColor="#697078" />
            <stop offset=".2" stopColor="#343d47" />
            <stop offset=".75" stopColor="#151e2b" />
            <stop offset="1" stopColor="#0b111a" />
          </linearGradient>
          <linearGradient id={`${token}-rim`}>
            <stop stopColor="#7c6843" />
            <stop offset=".4" stopColor="#ecdcaa" />
            <stop offset="1" stopColor="#7b6846" />
          </linearGradient>
          <pattern
            id={`${token}-back`}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" fill="#24354d" />
            <path
              d="M0 2.5L2.5 0L5 2.5L2.5 5Z"
              fill="none"
              stroke="#d5d7d7"
              strokeWidth=".35"
            />
          </pattern>
        </defs>
        <ellipse cx="80" cy="85" rx="87" ry="20" fill="#000" opacity=".3" />
        <path
          d="M5 0H154L168 77H-8Z"
          fill={`url(#${token}-metal)`}
          stroke="#8b949b"
          strokeWidth=".8"
        />
        <path
          d="M-8 77H168V91H-8Z"
          fill="#111a25"
          stroke={`url(#${token}-rim)`}
        />
        <path
          d="M3 4H56L50 42H-3Z M106 4H157L163 42H112Z"
          fill="#090e16"
          stroke="#78818b"
          strokeWidth=".7"
        />
        <path d="M56 13H110L103 70H48Z" fill="#050a11" stroke="#6f7c8c" />
        <path d="M59 14L51 67M108 14L101 67" stroke="#bbbec2" strokeWidth="2" />
        {Array.from({ length: 52 }, (_, index) => (
          <g
            key={index}
            ref={(el) => {
              sheets.current[index] = el;
            }}
            className="tpl-shuffle-sheet"
            data-fed="false"
          >
            <path
              ref={(el) => {
                paper.current[index] = el;
              }}
              fill="#eeeae1"
              stroke="#a5a7ab"
              strokeWidth=".45"
            />
            <path
              ref={(el) => {
                backs.current[index] = el;
              }}
              fill={`url(#${token}-back)`}
              stroke="#e4e3dd"
              strokeWidth=".45"
            />
          </g>
        ))}
        <path
          d="M-5 43H46V48H-6Z M114 43H163L164 48H114Z"
          fill="#2b3541"
          stroke="#858d92"
          strokeWidth=".6"
        />
        <path
          d="M47 69H111L109 87H44Z"
          fill="#080d14"
          stroke={`url(#${token}-rim)`}
          strokeWidth="1.3"
        />
        <path d="M49 68H107" stroke="#d8d6cc" strokeWidth="1.2" />
        <g ref={roller} transform="translate(81 78)" opacity=".6">
          <circle r="5" fill="#1e2938" stroke="#87909a" />
          <path d="M-4 0H4M0 -4V4" stroke="#9da7b2" />
        </g>
        <path
          d="M1 0H154L159 25H-3Z"
          fill="#dcecff"
          fillOpacity=".045"
          stroke="#dcecff"
          strokeOpacity=".25"
          strokeWidth=".6"
        />
        <circle ref={light} cx="12" cy="82" r="2" fill="#e8b85a" />
        {[
          [-3, 81],
          [160, 81],
          [9, 3],
          [149, 3],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="1.6" fill="#9c9fa1" />
            <path
              d={`M${x - 1} ${y}H${x + 1}`}
              stroke="#222936"
              strokeWidth=".6"
            />
          </g>
        ))}
        <text
          x="79"
          y="105"
          textAnchor="middle"
          fill="#d6c394"
          fontSize="6.5"
          letterSpacing="1.3"
        >
          AUTOMATIC SHUFFLER
        </text>
      </g>
    );
  },
);

export default ShuffleShoe;
