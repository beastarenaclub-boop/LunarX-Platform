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
  const stem =
    "M40 21V64M25 31h30M15 44c-2 18 11 24 25 26 14-2 27-8 25-26M10 49l6-10 10 8M54 47l10-8 6 10";
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 80 80">
      <path
        d={stem}
        fill="none"
        stroke={grey ? "#44637d" : "#70839b"}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={stem}
        fill="none"
        stroke={grey ? "#315778" : "#f4f9ff"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="40"
        cy="12"
        r="7"
        fill={grey ? "#91a9bf" : "#c4d5e3"}
        stroke={grey ? "#315778" : "#f4f9ff"}
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
  const showBoosts = !!outcome && elapsed >= 6000;
  const boostedValues = outcome?.boosts.filter(value => value > 1) ?? [];
  const hubBoost = boostedValues.length && elapsed >= 5000 && elapsed < 7200
    ? boostedValues[Math.min(boostedValues.length - 1, Math.floor((elapsed - 5000) / 350))] : 0;
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
        <clipPath id="if-hub-ice-clip">
          <circle cx="500" cy="500" r="117" />
        </clipPath>
        <radialGradient id="if-face-shade">
          <stop offset=".22" stopColor="#e8faff" stopOpacity=".12" />
          <stop offset=".8" stopColor="#344e73" stopOpacity="0" />
          <stop offset=".96" stopColor="#142e4d" stopOpacity=".10" />
          <stop offset="1" stopColor="#051a30" stopOpacity=".55" />
        </radialGradient>
        <pattern
          id="if-ice-letter"
          patternUnits="userSpaceOnUse"
          width="170"
          height="170"
        >
          <rect width="170" height="170" fill="#355775" />
          <image
            href={media + "frozen-lake-v2.webp"}
            width="300"
            height="170"
            opacity=".3"
          />
        </pattern>
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
        <filter id="if-motion">
          <feGaussianBlur stdDeviation=".85" />
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
          <g
            key={index}
            transform={`rotate(${index * 8} 500 500)`}
            className={
              landed && outcome?.segment === index
                ? "if-winning-segment"
                : undefined
            }
          >
            <path d={wedge(-4, 4, 438)} fill={colors[spot]} />
            {isFish(spot) ? (
              <>
                <svg
                  x="470"
                  y="60"
                  width="60"
                  height="75"
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
                  transform="translate(510 255) rotate(-90)"
                  textAnchor="middle"
                  fill="#fff"
                  stroke="#064566"
                  strokeWidth="1"
                  paintOrder="stroke"
                  fontSize="34"
                  textLength="204"
                  lengthAdjust="spacingAndGlyphs"
                  fontWeight="700"
                  fontFamily="Arial Narrow,Arial,sans-serif"
                >
                  {ICE_FISH_LABELS[spot]}
                </text>
              </>
            ) : (
              <svg x="474" y="70" width="52" height="52" viewBox="0 0 80 80">
                <Anchor
                  grey={spot === "grey"}
                  className={
                    showBoosts && outcome.boosts[index] > 1
                      ? "if-anchor-boost"
                      : undefined
                  }
                />
              </svg>
            )}
            {showBoosts && outcome.boosts[index] > 1 && (
              <text
                className="if-wheel-boost"
                transform={`translate(513 ${isFish(spot) ? 172 : 162}) rotate(-90)`}
                textAnchor="middle"
                fill="#ffe581"
                stroke="#80622b"
                strokeWidth="1.5"
                paintOrder="stroke"
                fontWeight="900"
                fontSize="40"
              >
                {outcome.boosts[index]}X
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
      <circle
        cx="500"
        cy="500"
        r="438"
        fill="url(#if-face-shade)"
        pointerEvents="none"
      />
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
        fill="#303d49"
        stroke="url(#if-metal)"
        strokeWidth="8"
      />
      <circle cx="500" cy="500" r="118" fill="url(#if-hub)" />
      <image
        href={media + "frozen-lake-v2.webp"}
        x="382"
        y="382"
        width="236"
        height="236"
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#if-hub-ice-clip)"
        opacity=".35"
      />
      <text
        x="500"
        y="482"
        textAnchor="middle"
        fontFamily="Arial Black,Arial,sans-serif"
        fontWeight="900"
        fontSize="66"
        fill="url(#if-ice-letter)"
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
        fill="url(#if-ice-letter)"
        stroke="#c1edf2"
        strokeWidth="2"
        paintOrder="stroke"
      >
        FISH
      </text>
      <path
        d="M452 -6L548 -6L500 59Z"
        fill="#26333a"
        stroke="#788c94"
        strokeWidth="3"
      />
      {hubBoost > 0 && <g className="if-boost-medallion" aria-label={`${hubBoost}x wheel boost reveal`}>
        <circle cx="500" cy="500" r="125" fill="#c19535" stroke="#dcf8ff" strokeWidth="7" />
        <circle cx="500" cy="500" r="110" fill="#ffdb68" stroke="#9f7621" strokeWidth="8" />
        <circle cx="500" cy="500" r="99" fill="none" stroke="#fff3a8" strokeWidth="3" />
        <text x="500" y="535" textAnchor="middle" fontSize="100" fontWeight="900" fill="#ffed8a" stroke="#91642e" strokeWidth="4" paintOrder="stroke">{hubBoost}X</text>
      </g>}
      <path
        className="if-pointer-face"
        d="M463 0L536 0L500 44Z"
        fill="url(#if-pointer)"
      />
      <path
        d="M496 55L504 55L500 74Z"
        fill="#d73046"
        stroke="#91323b"
        strokeWidth="2"
      />
    </svg>
  );
}
