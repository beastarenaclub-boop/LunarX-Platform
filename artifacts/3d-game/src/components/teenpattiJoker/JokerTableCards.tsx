import { useId } from "react";
import type { JokerOutcome } from "@workspace/api-zod/teenpatti-joker";
import { CardFace } from "@/components/teenpattiLive/TableCardArt";

const centres = [320, 510, 700, 960, 1220, 1410, 1600];
const revealOrder = [2, 4, 6, 1, 3, 5, 7];

/** Cards lie on the photographed felt; the film contains no baked-in result. */
export default function JokerTableCards({
  outcome,
  count,
}: {
  outcome: JokerOutcome | null | undefined;
  count: number;
}) {
  const pattern = `joker-paper-${useId().replace(/:/g, "")}`;
  const values = outcome
    ? [...outcome.handACards, outcome.joker, ...outcome.handBCards]
    : [];
  return (
    <svg
      className="j20-physical-cards"
      viewBox="0 0 1920 1080"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={pattern}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <rect width="8" height="8" fill="#6e2638" />
          <path
            d="M0 4L4 0L8 4L4 8Z"
            fill="none"
            stroke="#c08b8b"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      {centres.map((x, i) => {
        const show = !!outcome && count >= revealOrder[i];
        const winning =
          count === 7 &&
          outcome &&
          (outcome.winner === "playerA"
            ? i < 3
            : outcome.winner === "playerB"
              ? i > 3
              : false);
        return (
          <g
            key={i}
            transform={`translate(${x - 78} 913) matrix(2.36 0 ${(x - 960) / 4000} .9 0 0)`}
            className="j20-paper"
            data-face-up={show}
          >
            <rect
              width="66"
              height="94"
              rx="4"
              fill="#e4e0d5"
              stroke="#c7bca5"
            />
            <rect
              x="3"
              y="4"
              width="60"
              height="86"
              rx="2"
              fill={`url(#${pattern})`}
            />
            <rect
              x="8"
              y="10"
              width="50"
              height="74"
              rx="2"
              fill="none"
              stroke="#ddbd9a"
              strokeWidth="0.7"
            />
            <text
              x="33"
              y="60"
              textAnchor="middle"
              fontSize="35"
              fill="#dfc39d"
            >
              ♠
            </text>
            {show && <CardFace value={values[i]} won={!!winning} />}
          </g>
        );
      })}
      {["PLAYER A", "JOKER", "PLAYER B"].map((name, i) => (
        <text
          key={name}
          x={[510, 960, 1410][i]}
          y="1048"
          textAnchor="middle"
          fill="#d3bd93"
          fontSize="18"
          letterSpacing="4"
        >
          {name}
        </text>
      ))}
    </svg>
  );
}
