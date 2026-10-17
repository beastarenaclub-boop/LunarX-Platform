import type { VegetableJunkKind } from "@workspace/api-zod/vegetable-game";
export type JunkKind = VegetableJunkKind;
export default function JunkArt({ kind, size = 54 }: { kind: JunkKind; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {kind === "stone" && (
        <>
          <path
            d="M5 42L15 18L40 11L58 29L55 49L30 57Z"
            fill="#8d9cae"
            stroke="#536779"
            strokeWidth="2"
          />
          <path
            d="M15 18L29 35L5 42M29 35L40 11L58 29M29 35L30 57L55 49"
            fill="none"
            stroke="#697e93"
            strokeWidth="3"
          />
          <path
            d="M21 22L36 18"
            stroke="#cbd8dd"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "boot" && (
        <>
          <path
            d="M17 8H39L36 34L53 39Q60 42 57 53H9V39L17 30Z"
            fill="#a77154"
            stroke="#69493f"
            strokeWidth="2"
          />
          <path d="M13 48H57V55H9V48Z" fill="#514d56" />
          <path d="M18 10H39V18H18Z" fill="#d49e73" />
          <path
            d="M25 22L36 24M24 29L35 31M22 36L34 38"
            stroke="#e5c6a5"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "can" && (
        <g transform="rotate(-12 32 32)">
          <path
            d="M13 12H51L47 25L51 39L46 54H17L12 39L18 25Z"
            fill="#82a3b6"
            stroke="#496879"
            strokeWidth="2"
          />
          <ellipse
            cx="32"
            cy="12"
            rx="19"
            ry="6"
            fill="#cee3e8"
            stroke="#496879"
            strokeWidth="2"
          />
          <ellipse cx="32" cy="12" rx="8" ry="2.5" fill="#567283" />
          <path d="M15 24L47 24L50 39L14 39Z" fill="#e1b997" />
          <path
            d="M23 29L39 35M39 29L23 35"
            stroke="#a45b54"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M20 48H43" stroke="#cde0e4" strokeWidth="3" />
        </g>
      )}
    </svg>
  );
}
