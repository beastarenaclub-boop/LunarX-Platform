import { createContext, useContext, useId } from "react";
export type LudoTokenStyle = "pin" | "ring" | "gem" | "crown";
export const LudoTokenStyleContext = createContext<LudoTokenStyle>("pin");

/** Original vector pawn, shared by the colour picker and the live board. */
export function LudoPin({
  color,
  number,
  variant,
}: {
  color: string;
  number?: number;
  variant?: LudoTokenStyle;
}) {
  const id = useId().replace(/:/g, "");
  const selected = useContext(LudoTokenStyleContext);
  const style = variant ?? selected;
  if (style !== "pin")
    return (
      <svg
        viewBox="0 0 40 54"
        aria-hidden="true"
        className={`ld-pin ld-pin-${style}`}
      >
        <defs>
          <linearGradient id={id} x2=".8" y2="1">
            <stop stopColor="#fff" />
            <stop offset=".3" stopColor={color} />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        <ellipse cx="20" cy="47" rx="15" ry="5" fill="#102e4b" opacity=".3" />
        {style === "ring" ? (
          <>
            <ellipse
              cx="20"
              cy="34"
              rx="16"
              ry="12"
              fill={color}
              stroke="#e9faff"
              strokeWidth="3"
            />
            <circle
              cx="20"
              cy="25"
              r="14"
              fill={`url(#${id})`}
              stroke="#e9faff"
              strokeWidth="3"
            />
            <circle
              cx="20"
              cy="25"
              r="8"
              fill={color}
              stroke="#e9faff"
              strokeWidth="2"
            />
          </>
        ) : style === "gem" ? (
          <>
            <path
              d="m5 18 8-12h14l8 12-15 29Z"
              fill={`url(#${id})`}
              stroke="#e9faff"
              strokeWidth="2"
            />
            <path
              d="M5 18h30M13 6l-2 12 9 29 9-29-2-12M11 18h18"
              fill="none"
              stroke="#fff"
              strokeOpacity=".65"
            />
          </>
        ) : (
          <>
            <path
              d="M8 35 4 14l10 7 6-14 6 14 10-7-4 21Z"
              fill={`url(#${id})`}
              stroke="#fff4b6"
              strokeWidth="2"
            />
            <rect
              x="8"
              y="36"
              width="24"
              height="8"
              rx="3"
              fill={color}
              stroke="#fff4b6"
              strokeWidth="2"
            />
            <circle cx="20" cy="28" r="3" fill="#fff4b6" />
          </>
        )}
        {number !== undefined && (
          <text x="20" y="31" textAnchor="middle" fontSize="12" fill="#fff">
            {number}
          </text>
        )}
      </svg>
    );
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
