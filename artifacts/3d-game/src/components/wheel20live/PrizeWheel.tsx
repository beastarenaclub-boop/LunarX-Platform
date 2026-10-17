import { useEffect, useRef, type RefObject } from "react";
import {
  performanceProgress,
  W20_CUES,
  type W20Playback,
} from "./studioTiming";
import {
  W20_WHEEL,
  W20_COLORS,
  type W20Outcome,
} from "@workspace/api-zod/wheel20-live";

export const wheelAngle = (segment: number) =>
  (-segment * 360) / W20_WHEEL.length;
export function spinAngle(previous: number, target: number, progress: number) {
  const from = wheelAngle(previous),
    to = wheelAngle(target);
  const travel = 3 * 360 + ((((to - from) % 360) + 360) % 360);
  const p = Math.max(0, Math.min(1, progress));
  // Smooth acceleration, free-running middle and a long mechanical slowdown.
  const pull = 0.055;
  const velocity = 1 / (pull / 2 + (1 - pull) / 3);
  const eased =
    p < pull
      ? (velocity * p * p) / (2 * pull)
      : velocity *
        (pull / 2 +
          ((1 - pull) / 3) * (1 - Math.pow(1 - (p - pull) / (1 - pull), 3)));
  return from + travel * eased;
}
const point = (degrees: number, r: number) =>
  `${300 + Math.sin((degrees * Math.PI) / 180) * r},${300 - Math.cos((degrees * Math.PI) / 180) * r}`;
export function PrizeWheel({
  outcome,
  previous,
  start,
  end,
  clock,
  playback,
  roundId,
  onLand,
  onTick,
}: {
  outcome: W20Outcome | null;
  previous: number;
  start: number;
  end: number;
  clock: number;
  playback: RefObject<W20Playback>;
  roundId: string;
  onLand: () => void;
  onTick: () => void;
}) {
  const rotor = useRef<SVGGElement>(null);
  const latest = useRef({ clock, onLand, onTick });
  latest.current = { clock, onLand, onTick };
  useEffect(() => {
    let frame = 0,
      tick = -1,
      lastSound = 0,
      done = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const offset = latest.current.clock - Date.now();
    const render = () => {
      const wallProgress = outcome
        ? Math.min(
            1,
            Math.max(
              0,
              (Date.now() + offset - start) / Math.max(1, end - start),
            ),
          )
        : 0;
      const mediaFrame = playback.current;
      const shortRound = end - start < W20_CUES.duration * 1000;
      const fallback = reduced || mediaFrame.stage === "fallback" || shortRound;
      const p =
        wallProgress >= 1
          ? 1
          : fallback
            ? wallProgress
            : performanceProgress(mediaFrame, roundId);
      const angle = outcome
        ? spinAngle(previous, outcome.segment, reduced && p < 1 ? 0 : p)
        : wheelAngle(previous);
      rotor.current?.setAttribute("transform", `rotate(${angle} 300 300)`);
      if (rotor.current)
        rotor.current.dataset.segment =
          outcome && p >= 1 ? String(outcome.segment) : "spinning";
      if (rotor.current) rotor.current.dataset.progress = p.toFixed(4);
      const now = performance.now(),
        next = Math.floor(angle / (360 / W20_WHEEL.length));
      if (
        outcome &&
        p > 0 &&
        p < 1 &&
        next !== tick &&
        now - lastSound > 65 &&
        !document.hidden &&
        !reduced
      ) {
        latest.current.onTick();
        lastSound = now;
      }
      tick = next;
      if (outcome && p >= 1 && !done) {
        done = true;
        latest.current.onLand();
      }
      if (outcome && p < 1) frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [outcome?.segment, previous, start, end, roundId, playback]);
  return (
    <svg
      className="w20-wheel"
      viewBox="0 0 600 600"
      role="img"
      aria-label="54 segment prize wheel"
      data-testid="w20-wheel"
    >
      <defs>
        <radialGradient id="w20-shade">
          <stop offset="0" stopColor="#070509" stopOpacity=".25" />
          <stop offset=".65" stopColor="#070509" stopOpacity="0" />
          <stop offset="1" stopColor="#070509" stopOpacity=".5" />
        </radialGradient>
        <linearGradient id="w20-gold" x2=".3" y2="1">
          <stop stopColor="#fff8c6" />
          <stop offset=".4" stopColor="#edc57c" />
          <stop offset=".6" stopColor="#ad702a" />
          <stop offset="1" stopColor="#ffe4a0" />
        </linearGradient>
        <radialGradient id="w20-hub">
          <stop stopColor="#e83e28" />
          <stop offset=".7" stopColor="#a91f18" />
          <stop offset="1" stopColor="#f7ac2e" />
        </radialGradient>
        <linearGradient id="w20-glass" x2="1" y2="1">
          <stop stopColor="#fff" stopOpacity=".24" />
          <stop offset=".48" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".25" />
        </linearGradient>
      </defs>
      <g ref={rotor} data-testid="w20-rotor">
        <circle
          cx="300"
          cy="300"
          r="299"
          fill="#29252a"
          stroke="#ba965d"
          strokeWidth="3"
        />
        {W20_WHEEL.map((spot, i) => {
          const angle = (i * 360) / 54,
            a = angle - 180 / 54,
            b = angle + 180 / 54;
          return (
            <g key={i}>
              <path
                d={`M300,300 L${point(a, 294)} A294,294 0 0 1 ${point(b, 294)} Z`}
                fill={spot === "1" ? "#292734" : W20_COLORS[spot]}
              />
              <path
                d={`M300,300 L${point(a, 294)}`}
                stroke="#17101d"
                strokeWidth="1.4"
                opacity=".42"
              />
              <g transform={`rotate(${angle} 300 300)`}>
                <circle
                  cx="300"
                  cy="25"
                  r="11.7"
                  fill="url(#w20-gold)"
                  stroke="#796045"
                  strokeWidth="1.3"
                />
                <text
                  x="300"
                  y="29.7"
                  textAnchor="middle"
                  fontSize={spot.length > 1 ? 11 : 14}
                  fontWeight="800"
                  fill="#342238"
                >
                  {spot}
                </text>
              </g>
            </g>
          );
        })}
        <circle cx="300" cy="300" r="295" fill="url(#w20-shade)" />
      </g>
      <circle
        cx="300"
        cy="300"
        r="295"
        fill="url(#w20-glass)"
        pointerEvents="none"
      />
      <circle cx="302" cy="306" r="105" fill="#100613" opacity=".75" />
      <circle
        cx="300"
        cy="300"
        r="101"
        fill="url(#w20-hub)"
        stroke="#2c1520"
        strokeWidth="6"
      />
      {Array.from({ length: 14 }, (_, i) => (
        <circle
          key={i}
          cx={300 + Math.sin((i * Math.PI) / 7) * 84}
          cy={300 - Math.cos((i * Math.PI) / 7) * 84}
          r="6.5"
          fill="#fff2a1"
          stroke="#ffcb19"
          strokeWidth="3"
        />
      ))}
      <text
        x="300"
        y="326"
        textAnchor="middle"
        fontSize="83"
        fontWeight="1000"
        fontStyle="italic"
        fill="url(#w20-gold)"
        stroke="#62262b"
        strokeWidth="2"
      >
        W
      </text>
      <text
        x="300"
        y="350"
        textAnchor="middle"
        fontSize="15"
        fontWeight="800"
        letterSpacing="5"
        fill="#ffe3a8"
      >
        2.0
      </text>
    </svg>
  );
}
