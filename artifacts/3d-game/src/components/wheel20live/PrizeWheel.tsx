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
  const wheel = useRef<SVGSVGElement>(null);
  const latest = useRef({ clock, onLand, onTick });
  latest.current = { clock, onLand, onTick };
  useEffect(() => {
    let frame = 0,
      tick = -1,
      lastSound = 0,
      done = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = wheel.current?.closest<HTMLElement>(".w20-camera");
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
      // Interpolate at display refresh rate only after the decoded pull frame.
      // Cap at one film frame so a buffering video cannot run the disc ahead.
      const smoothFrame =
        mediaFrame.stage === "spin" &&
        mediaFrame.ready &&
        mediaFrame.mediaTime >= W20_CUES.pull &&
        mediaFrame.sampledAt !== undefined
          ? {
              ...mediaFrame,
              mediaTime:
                mediaFrame.mediaTime +
                Math.max(
                  0,
                  Math.min(
                    1 / 24,
                    (performance.now() - mediaFrame.sampledAt) / 1000,
                  ),
                ),
            }
          : mediaFrame;
      const shortRound = end - start < W20_CUES.duration * 1000;
      const fallback = reduced || mediaFrame.stage === "fallback" || shortRound;
      const p =
        done || wallProgress >= 1
          ? 1
          : fallback
            ? wallProgress
            : performanceProgress(smoothFrame, roundId);
      const angle = outcome
        ? spinAngle(previous, outcome.segment, reduced && p < 1 ? 0 : p)
        : wheelAngle(previous);
      rotor.current?.setAttribute("transform", `rotate(${angle} 300 300)`);
      if (rotor.current)
        rotor.current.dataset.segment =
          outcome && p >= 1 ? String(outcome.segment) : "spinning";
      if (rotor.current) rotor.current.dataset.progress = p.toFixed(4);
      // Frame-driven camera push during the final coast. Never expose the
      // winning pocket until the authoritative rotor has actually landed.
      const focus =
        outcome && !reduced && !mediaFrame.cameraWide
          ? Math.max(0, Math.min(1, (p - 0.56) / 0.32))
          : 0;
      const smoothFocus = focus * focus * (3 - 2 * focus);
      camera?.style.setProperty("--w20-focus", smoothFocus.toFixed(4));
      if (camera)
        camera.style.willChange = focus > 0 && focus < 1 ? "transform" : "auto";
      if (camera) camera.dataset.view = focus > 0 ? "closeup" : "wide";
      if (wheel.current)
        wheel.current.dataset.landed = String(!!outcome && p >= 1);
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
      // Keep the result readable, then pull back to show the physical exit and
      // entry. A landed rotor stays latched while the handoff camera changes.
      if (outcome && (!done || (!reduced && !mediaFrame.cameraWide)))
        frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [outcome?.segment, previous, start, end, roundId, playback]);
  return (
    <svg
      ref={wheel}
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
            </g>
          );
        })}
        <circle cx="300" cy="300" r="295" fill="url(#w20-shade)" />
        <circle cx="300" cy="300" r="295" fill="url(#w20-glass)" />
        {outcome && (
          <path
            className="w20-winning-ray"
            transform={`rotate(${(outcome.segment * 360) / W20_WHEEL.length} 300 300)`}
            d={`M300,300 L${point(-180 / 54, 294)} A294,294 0 0 1 ${point(180 / 54, 294)} Z`}
            fill="#fff4b5"
            fillOpacity=".45"
            stroke="#fff9de"
            strokeWidth="2"
          />
        )}
        {W20_WHEEL.map((spot, i) => (
          <g
            key={i}
            transform={`rotate(${(i * 360) / W20_WHEEL.length} 300 300)`}
            className={`w20-pocket ${outcome?.segment === i ? "is-winner" : ""}`}
            data-pocket={i}
          >
            <rect
              className="w20-number-plate"
              x="286"
              y="13"
              width="28"
              height="48"
              rx="8"
              fill="#fff1c7"
              stroke="#3b2414"
              strokeWidth="1.8"
            />
            <text
              className="w20-pocket-number"
              x="300"
              y="44"
              textAnchor="middle"
              fontSize={spot.length > 1 ? 22 : 29}
              fontWeight="900"
              fill="#100d12"
              fontFamily="Arial, Helvetica, sans-serif"
              letterSpacing="-1"
            >
              {spot}
            </text>
          </g>
        ))}
      </g>
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
