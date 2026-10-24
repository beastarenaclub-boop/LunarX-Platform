import { useId } from "react";

/** Original vector pawn, shared by the colour picker and the live board. */
export function LudoPin({ color, number }: { color: string; number?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 54" aria-hidden="true" className="ld-pin">
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" />
          <stop offset=".5" stopColor="#edf4ff" />
          <stop offset="1" stopColor="#a8bdd6" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx=".3" cy=".2" r=".8">
          <stop stopColor="#fff" stopOpacity=".65" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="47" rx="13" ry="5" fill="#102e4b" opacity=".3" />
      <ellipse
        cx="20"
        cy="45"
        rx="11"
        ry="5"
        fill={color}
        stroke="#19384f"
        strokeWidth="1.5"
      />
      <path
        d="M20 46C16 41 4 28 4 19a16 16 0 0 1 32 0c0 9-12 22-16 27Z"
        fill={`url(#${id}-rim)`}
        stroke="#25415c"
        strokeWidth="1.4"
      />
      <circle
        cx="20"
        cy="19"
        r="10.7"
        fill={color}
        stroke="#fff"
        strokeWidth="1.8"
      />
      <circle cx="20" cy="19" r="10" fill={`url(#${id}-shine)`} />
      {number !== undefined && (
        <text
          x="20"
          y="23"
          textAnchor="middle"
          fontSize="12"
          fontFamily="Arial, sans-serif"
          fontWeight="800"
          fill="#fff"
          stroke="#172b46"
          strokeWidth=".5"
          paintOrder="stroke"
        >
          {number}
        </text>
      )}
    </svg>
  );
}
