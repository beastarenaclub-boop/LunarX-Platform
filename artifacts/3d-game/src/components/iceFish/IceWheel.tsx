import { useEffect, useRef } from "react";
import {
  ICE_FISH_WHEEL,
  ICE_FISH_LABELS,
  isFish,
  type IceFishOutcome,
  type IceFishSpot,
} from "@workspace/api-zod/ice-fish";
const media = `${import.meta.env.BASE_URL}media/ice-fish/`;
export function Fish({
  color,
  className = "",
}: {
  color: "blue" | "green" | "red";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`if-fish if-fish-${color} ${className}`}
    />
  );
}
export function Anchor({
  grey = false,
  className = "",
}: {
  grey?: boolean;
  className?: string;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 80 80">
      <path
        d="M40 20V65M25 31h30M15 44c-2 18 11 24 25 26 14-2 27-8 25-26M10 49l6-10 10 8M54 47l10-8 6 10"
        fill="none"
        stroke={grey ? "#335877" : "#f3faff"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="40"
        cy="12"
        r="7"
        fill="none"
        stroke={grey ? "#335877" : "#f3faff"}
        strokeWidth="5"
      />
    </svg>
  );
}
const point = (a: number, r: number) =>
  `${500 + Math.sin((a * Math.PI) / 180) * r},${500 - Math.cos((a * Math.PI) / 180) * r}`;
const wedge = (a: number, b: number, r: number) =>
  `M500,500 L${point(a, r)} A${r},${r} 0 0 1 ${point(b, r)} Z`;
const colors: Record<IceFishSpot, string> = {
  white: "#dce9f5",
  grey: "#8da5bd",
  blue: "url(#if-blue)",
  green: "url(#if-green)",
  red: "url(#if-red)",
};
export default function IceWheel({
  outcome,
  roundId,
  revealStart,
  now,
  reducedMotion,
}: {
  outcome: IceFishOutcome | null;
  roundId: string | null;
  revealStart: number | null;
  now: number;
  reducedMotion: boolean;
}) {
  const rotor = useRef<SVGGElement>(null),
    remembered = useRef(0),
    active = useRef<string | null>(null);
  const elapsed = revealStart === null ? 0 : now - revealStart,
    landed = !!outcome && elapsed >= 9500;
  useEffect(() => {
    const node = rotor.current;
    if (!node || !outcome || !roundId || revealStart === null) return;
    const start = remembered.current,
      end = Math.ceil(start / 360) * 360 + 6 * 360 - outcome.segment * 8;
    if (active.current === roundId) return;
    active.current = roundId;
    remembered.current = end;
    const elapsed = Date.now() - revealStart;
    if (reducedMotion || elapsed >= 9500) {
      node.style.transform = `rotate(${end}deg)`;
      return;
    }
    const animation = node.animate(
      [
        { transform: `rotate(${start}deg)` },
        { transform: `rotate(${end}deg)` },
      ],
      {
        duration: 9500,
        easing: "cubic-bezier(.15,.58,.08,1)",
        fill: "forwards",
      },
    );
    animation.currentTime = Math.max(0, elapsed);
    return () => {
      animation.cancel();
      node.style.transform = `rotate(${end}deg)`;
    };
    // Polling may correct the clock by milliseconds; it must not restart a spin.
  }, [roundId, outcome?.segment, reducedMotion]);
  return (
    <svg
      className={`if-wheel ${landed ? "is-landed" : ""}`}
      viewBox="0 0 1000 1000"
      role="img"
      aria-label={
        landed
          ? `Wheel result: ${ICE_FISH_LABELS[ICE_FISH_WHEEL[outcome!.segment]]}`
          : "Ice Fish wheel with 45 segments"
      }
    >
      <defs>
        <linearGradient id="if-metal" x2="1" y2="1">
          <stop stopColor="#697b8e" />
          <stop offset=".17" stopColor="#f6ffff" />
          <stop offset=".4" stopColor="#9ba5ab" />
          <stop offset=".65" stopColor="#f5f4e7" />
          <stop offset=".82" stopColor="#64717b" />
          <stop offset="1" stopColor="#dae9ef" />
        </linearGradient>
        <linearGradient id="if-blue">
          <stop stopColor="#002e65" />
          <stop offset=".45" stopColor="#00a9ee" />
          <stop offset="1" stopColor="#003a76" />
        </linearGradient>
        <linearGradient id="if-green">
          <stop stopColor="#044713" />
          <stop offset=".45" stopColor="#62db39" />
          <stop offset="1" stopColor="#117d20" />
        </linearGradient>
        <linearGradient id="if-red">
          <stop stopColor="#62021d" />
          <stop offset=".45" stopColor="#e93544" />
          <stop offset="1" stopColor="#8c091b" />
        </linearGradient>
        <radialGradient id="if-hub">
          <stop stopColor="#d5f9ff" />
          <stop offset=".75" stopColor="#a5d5e3" />
          <stop offset="1" stopColor="#638496" />
        </radialGradient>
        <linearGradient id="if-pointer">
          <stop stopColor="#f7ffff" />
          <stop offset=".5" stopColor="#7b858a" />
          <stop offset="1" stopColor="#262c31" />
        </linearGradient>
        <radialGradient
          id="if-rim"
          gradientUnits="userSpaceOnUse"
          cx="500"
          cy="500"
          r="480"
        >
          <stop offset=".905" stopColor="#253d51" />
          <stop offset=".925" stopColor="#e6f4f9" />
          <stop offset=".935" stopColor="#5d6b76" />
          <stop offset=".958" stopColor="#abb5bc" />
          <stop offset=".981" stopColor="#d5dee0" />
          <stop offset=".991" stopColor="#596570" />
          <stop offset="1" stopColor="#eaffff" />
        </radialGradient>
        <radialGradient
          id="if-orange"
          gradientUnits="userSpaceOnUse"
          cx="500"
          cy="500"
          r="480"
        >
          <stop offset=".92" stopColor="#8e4418" />
          <stop offset=".935" stopColor="#ffcb8c" />
          <stop offset=".95" stopColor="#c85d14" />
          <stop offset=".977" stopColor="#ee8627" />
          <stop offset=".992" stopColor="#ffca8d" />
          <stop offset="1" stopColor="#9b4917" />
        </radialGradient>
        <filter id="if-glow">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <circle
        cx="500"
        cy="500"
        r="477"
        fill="#122f49"
        stroke="#a7deed"
        strokeWidth="6"
      />
      <circle
        cx="500"
        cy="500"
        r="460"
        fill="#535f69"
        stroke="url(#if-rim)"
        strokeWidth="34"
      />
      {[0, 120, 240].map((angle) => (
        <path
          key={angle}
          d={`M${point(angle - 23, 464)} A464,464 0 0 1 ${point(angle + 23, 464)}`}
          fill="none"
          stroke="url(#if-orange)"
          strokeWidth="29"
        />
      ))}
      <g ref={rotor} className="if-wheel-rotor">
        {ICE_FISH_WHEEL.map((spot, index) => (
          <g key={index} transform={`rotate(${index * 8} 500 500)`}>
            <path d={wedge(-4, 4, 438)} fill={colors[spot]} />
            {isFish(spot) ? (
              <>
                <svg
                  x="477"
                  y="64"
                  width="46"
                  height="60"
                  viewBox={`${["blue", "green", "red"].indexOf(spot) * 724 + 32} 30 660 650`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <image
                    href={media + "fish-atlas-v1.webp"}
                    width="2172"
                    height="724"
                  />
                </svg>
                <text
                  transform="translate(508 245) rotate(-90)"
                  textAnchor="middle"
                  fill="#fff"
                  stroke="#064566"
                  strokeWidth="1"
                  paintOrder="stroke"
                  fontSize="27"
                  fontWeight="900"
                  fontFamily="Arial Narrow,Arial,sans-serif"
                >
                  {ICE_FISH_LABELS[spot]}
                </text>
              </>
            ) : (
              <svg x="476" y="71" width="48" height="48" viewBox="0 0 80 80">
                <Anchor grey={spot === "grey"} />
              </svg>
            )}
            {outcome && outcome.boosts[index] > 1 && (
              <text
                x="500"
                y={isFish(spot) ? 150 : 165}
                textAnchor="middle"
                fill="#ffe581"
                stroke="#80622b"
                strokeWidth="1.5"
                paintOrder="stroke"
                fontWeight="900"
                fontSize="31"
              >
                {outcome.boosts[index]}x
              </text>
            )}
            <circle
              cx="469.5"
              cy="64"
              r="4.2"
              fill="#f4f9ff"
              stroke="#738da6"
              strokeWidth="1"
            />
          </g>
        ))}
      </g>
      {Array.from({ length: 30 }, (_, i) => (
        <circle
          key={i}
          cx={500 + Math.sin((i * Math.PI) / 15) * 461}
          cy={500 - Math.cos((i * Math.PI) / 15) * 461}
          r="8.5"
          fill="url(#if-metal)"
          stroke="#a0b2bd"
          strokeWidth="1.5"
        />
      ))}
      {landed && (
        <path
          d={wedge(-4, 4, 438)}
          fill="#efffff"
          opacity=".38"
          filter="url(#if-glow)"
        />
      )}
      <circle
        cx="500"
        cy="500"
        r="132"
        fill="#778c9b"
        stroke="#c6dce3"
        strokeWidth="8"
      />
      <circle cx="500" cy="500" r="118" fill="url(#if-hub)" />
      <image
        href={media + "frozen-lake-v1.webp"}
        x="417"
        y="420"
        width="166"
        height="160"
        opacity=".15"
      />
      <text
        x="500"
        y="482"
        textAnchor="middle"
        fontFamily="Arial Black,Arial,sans-serif"
        fontWeight="900"
        fontSize="66"
        fill="#3d6881"
        stroke="#c1edf2"
        strokeWidth="2"
        paintOrder="stroke"
      >
        ICE
      </text>
      <text
        x="500"
        y="553"
        textAnchor="middle"
        fontFamily="Arial Black,Arial,sans-serif"
        fontWeight="900"
        fontSize="68"
        fill="#3d6881"
        stroke="#c1edf2"
        strokeWidth="2"
        paintOrder="stroke"
      >
        FISH
      </text>
      <path
        d="M452 16L548 16L500 81Z"
        fill="#26333a"
        stroke="#788c94"
        strokeWidth="3"
      />
      <path d="M463 22L536 22L500 66Z" fill="url(#if-pointer)" />
      <path
        d="M496 77L504 77L500 96Z"
        fill="#d73046"
        stroke="#91323b"
        strokeWidth="2"
      />
    </svg>
  );
}
