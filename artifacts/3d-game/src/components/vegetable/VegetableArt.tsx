import type { VegetableKind } from "@workspace/api-zod/vegetable-game";

/** Small original vector illustrations stay crisp on mobile and desktop. */
export function VegetableArt({
  kind,
  className,
}: {
  kind: VegetableKind;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 100 110" className={className} aria-hidden="true">
      {kind === "carrot" && (
        <g transform="rotate(22 50 55)">
          <path
            d="M48 34C21 26 28 80 47 105C52 105 79 36 58 33Z"
            fill="#ee872f"
          />
          <path
            d="M48 38C35 47 41 77 47 91"
            stroke="#ffb952"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M51 36C28 24 24 9 29 5C45 6 49 19 51 36M53 33C52 7 66 0 70 7C75 16 62 28 53 33"
            fill="#458746"
          />
          <path d="M55 34C67 11 86 17 81 27C76 36 66 38 55 34" fill="#70a747" />
          <path
            d="M62 52L54 55M39 68L47 71M53 81L48 82"
            stroke="#c96527"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === "tomato" && (
        <g>
          <path
            d="M50 28C7 9 0 75 25 93C41 106 67 104 84 87C104 61 88 13 50 28"
            fill="#df5944"
          />
          <path
            d="M24 46C13 57 18 76 27 81"
            fill="none"
            stroke="#f59478"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M50 34L28 21L46 23L51 8L57 24L76 20L63 32L71 44L52 38L37 47Z"
            fill="#40764b"
          />
          <path
            d="M51 29Q48 13 58 7"
            fill="none"
            stroke="#355f39"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === "aubergine" && (
        <g transform="rotate(20 50 55)">
          <path
            d="M44 31C51 61 7 68 20 93C32 117 84 99 83 72C83 49 68 44 67 28Z"
            fill="#765683"
          />
          <path
            d="M60 45C62 67 34 73 35 88"
            stroke="#ab88b3"
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M44 32L36 41L49 40L57 51L64 39L78 40L68 23L49 22Z"
            fill="#5c8d4c"
          />
          <path
            d="M57 27Q60 12 51 8"
            fill="none"
            stroke="#456e3e"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === "broccoli" && (
        <g>
          <path
            d="M39 62L38 102Q51 109 64 101L59 63L76 47L65 41L49 65L33 43L22 55Z"
            fill="#9aac68"
          />
          <path
            d="M50 74L50 98"
            stroke="#c0cd87"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M20 69C1 69 1 44 14 39C7 17 34 10 44 19C55 0 82 14 80 29C105 30 103 59 87 65C83 82 62 78 53 70C40 83 22 79 20 69"
            fill="#397751"
          />
          <circle cx="31" cy="37" r="15" fill="#59945e" />
          <circle cx="60" cy="32" r="17" fill="#659d63" />
          <circle cx="77" cy="51" r="14" fill="#4e8859" />
          <circle cx="47" cy="55" r="18" fill="#4d8b58" />
        </g>
      )}
      {kind === "pepper" && (
        <g>
          <path
            d="M48 29C11 14 9 58 19 85C25 107 44 101 50 94C73 111 90 83 90 55C91 29 68 18 48 29"
            fill="#e4b33f"
          />
          <path
            d="M29 43Q19 67 32 85M53 43L52 84"
            stroke="#f5d474"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M36 31L49 21L66 28L60 37L50 32L40 38Z" fill="#578149" />
          <path
            d="M51 29Q62 10 49 7"
            fill="none"
            stroke="#497341"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}

export function BowlArt() {
  return (
    <svg viewBox="0 0 420 205" aria-hidden="true" className="vb-bowl-art">
      <defs>
        <linearGradient id="vb-bowl-glaze" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#a4e9ff" />
          <stop offset=".5" stopColor="#71bde9" />
          <stop offset="1" stopColor="#667cc3" />
        </linearGradient>
      </defs>
      <ellipse
        cx="210"
        cy="187"
        rx="132"
        ry="13"
        fill="#3b573b"
        opacity=".12"
      />
      <path
        d="M29 36Q44 177 181 182H239Q375 176 391 36Z"
        fill="url(#vb-bowl-glaze)"
        stroke="#d8c5a2"
        strokeWidth="2"
      />
      <path d="M42 82Q204 133 376 82L367 107Q213 161 51 108Z" fill="#f5cd7c" />
      <path
        d="M58 124Q210 173 360 124L343 143Q210 188 77 144Z"
        fill="#e99e9b"
      />
      <path
        d="M71 56Q80 110 106 131"
        stroke="#fffdf0"
        opacity=".6"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse
        cx="210"
        cy="35"
        rx="181"
        ry="30"
        fill="#f8edd1"
        stroke="#d8c5a2"
        strokeWidth="3"
      />
      <ellipse cx="210" cy="33" rx="163" ry="21" fill="#9c9770" />
      <ellipse cx="210" cy="36" rx="153" ry="17" fill="#bdb590" />
      <path d="M180 177H240L232 191H188Z" fill="#d0b790" />
    </svg>
  );
}
