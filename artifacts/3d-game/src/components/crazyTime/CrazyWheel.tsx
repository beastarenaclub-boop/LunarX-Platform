import { useEffect, useRef, type RefObject } from "react";
import {
  STUDIO_CUES,
  studioFrameTime,
  type StudioPlayback,
} from "./studioTiming";
import {
  CRAZY_TIME_SPOTS,
  CRAZY_TIME_WHEEL,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";
import { playGameSound } from "@/game/audio";

const STEP = 360 / CRAZY_TIME_WHEEL.length;
const point = (angle: number, radius: number) => {
  const rad = ((angle - 90) * Math.PI) / 180;
  return `${300 + Math.cos(rad) * radius},${300 + Math.sin(rad) * radius}`;
};
export function wheelAngle(segment: number) {
  return -segment * STEP;
}
export default function CrazyWheel({
  outcome,
  previousSegment,
  roundId,
  spinning,
  playback,
  revealEndsAt,
  sound,
  onLand,
}: {
  outcome: CrazyTimeOutcome | null;
  previousSegment: number;
  roundId: string | null;
  spinning: boolean;
  playback: RefObject<StudioPlayback>;
  revealEndsAt: number | null;
  sound: boolean;
  onLand: (id: string) => void;
}) {
  const wheel = useRef<SVGSVGElement>(null);
  const latest = useRef({ sound, onLand });
  latest.current = { sound, onLand };
  useEffect(() => {
    const element = wheel.current;
    if (!element) return;
    if (!outcome || !roundId) {
      element.style.transform = `rotate(${wheelAngle(previousSegment)}deg)`;
      delete element.dataset.segment;
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = wheelAngle(previousSegment);
    const target = wheelAngle(outcome.segment);
    const travel = 5 * 360 + ((((target - from) % 360) + 360) % 360);
    let frame = 0,
      lastTick = 0,
      lastSegment = -1,
      lastProgress = 0;
    const tick = () => {
      const now = Date.now();
      const shown = playback.current;
      const current = shown.roundId === roundId && shown.ready;
      const progress =
        !spinning || reduced || (revealEndsAt != null && now >= revealEndsAt)
          ? 1
          : current && shown.stage === "result"
            ? 1
            : current && shown.stage === "spin"
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    (studioFrameTime(shown) - STUDIO_CUES.wheelPull) /
                      (STUDIO_CUES.wheelStop - STUDIO_CUES.wheelPull),
                  ),
                )
              : 0;
      const p = Math.max(lastProgress, progress);
      lastProgress = p;
      const eased = 1 - (1 - p) ** 3;
      const angle = from + travel * eased;
      element.style.transform = `rotate(${angle}deg)`;
      const segment = Math.floor(angle / STEP);
      if (
        segment !== lastSegment &&
        p > 0 &&
        p < 1 &&
        now - lastTick > 65 &&
        latest.current.sound &&
        !document.hidden
      ) {
        playGameSound("tick", "crazy-time", 0.48);
        lastTick = now;
      }
      lastSegment = segment;
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        element.dataset.segment = String(outcome.segment);
        latest.current.onLand(roundId);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    outcome?.segment,
    previousSegment,
    roundId,
    spinning,
    playback,
    revealEndsAt,
  ]);

  return (
    <>
      <div
        className={`ct-wheel-wrap ${spinning ? "ct-wheel-spinning" : ""}`}
        data-testid="crazy-wheel"
      >
        <div className="ct-wheel-rotor">
          <svg
            ref={wheel}
            className="ct-wheel-disc"
            data-testid="wheel-disc"
            viewBox="0 0 600 600"
            preserveAspectRatio="none"
            role="img"
            aria-label="54 segment prize wheel"
          >
            <defs>
              <radialGradient id="ct-gold">
                <stop stopColor="#fff2bd" />
                <stop offset=".6" stopColor="#d5a34f" />
                <stop offset="1" stopColor="#563015" />
              </radialGradient>
              <radialGradient id="ct-center">
                <stop stopColor="#183c30" />
                <stop offset=".8" stopColor="#081e17" />
                <stop offset="1" stopColor="#030b08" />
              </radialGradient>
              <radialGradient id="ct-disc-depth">
                <stop offset=".36" stopColor="#080c06" stopOpacity=".22" />
                <stop offset=".46" stopColor="#fff4c9" stopOpacity=".08" />
                <stop offset=".84" stopColor="#fff6d8" stopOpacity="0" />
                <stop offset=".96" stopColor="#1a1708" stopOpacity=".08" />
                <stop offset="1" stopColor="#0c0d05" stopOpacity=".65" />
              </radialGradient>
              <linearGradient id="ct-glass-light" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#fff3cc" stopOpacity=".14" />
                <stop offset=".42" stopColor="#fff3cc" stopOpacity="0" />
                <stop offset=".72" stopColor="#000" stopOpacity=".07" />
                <stop offset="1" stopColor="#fff3cc" stopOpacity=".04" />
              </linearGradient>
            </defs>
            <circle cx="300" cy="300" r="300" fill="#14251b" />
            <g>
              {CRAZY_TIME_WHEEL.map((spot, i) => {
                const data = CRAZY_TIME_SPOTS.find((s) => s.id === spot)!;
                const start = i * STEP - STEP / 2,
                  end = start + STEP;
                return (
                  <g key={i}>
                    <path
                      d={`M300,300 L${point(start, 298)} A298,298 0 0,1 ${point(end, 298)} Z`}
                      fill={data.color}
                      stroke="#4b3326"
                      strokeWidth="1.2"
                    />
                    <g transform={`rotate(${i * STEP} 300 300)`}>
                      <text
                        x="300"
                        y="42"
                        fill="#17231d"
                        fontSize={data.short.length > 1 ? 14 : 22}
                        fontWeight="900"
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {data.short}
                      </text>
                      <circle cx="300" cy="9" r="2.2" fill="#ffedb3" />
                    </g>
                  </g>
                );
              })}
              <circle cx="300" cy="300" r="119" fill="url(#ct-gold)" />
              <circle
                cx="300"
                cy="300"
                r="108"
                fill="url(#ct-center)"
                stroke="#f6d795"
                strokeWidth="2"
              />
            </g>
          </svg>
        </div>
        <svg
          className="ct-wheel-glass"
          viewBox="0 0 600 600"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <circle
            cx="300"
            cy="300"
            r="299"
            fill="url(#ct-disc-depth)"
            pointerEvents="none"
          />
          <text
            x="300"
            y="283"
            textAnchor="middle"
            fill="#fff4d0"
            fontSize="39"
            fontWeight="950"
            fontStyle="italic"
          >
            CRAZY
          </text>
          <text
            x="300"
            y="327"
            textAnchor="middle"
            fill="#eac275"
            fontSize="43"
            fontWeight="950"
            fontStyle="italic"
          >
            TIME
          </text>
          <text
            x="300"
            y="353"
            textAnchor="middle"
            fill="#d6b878"
            fontSize="10"
            letterSpacing="4"
          >
            LUNAR ORIGINALS
          </text>
          <circle
            cx="300"
            cy="300"
            r="299"
            fill="url(#ct-glass-light)"
            pointerEvents="none"
          />
        </svg>
      </div>
    </>
  );
}
