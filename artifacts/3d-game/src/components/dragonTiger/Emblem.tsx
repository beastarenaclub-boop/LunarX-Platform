/** Lightweight, native vector crests keep the table sharp on mobile. */
export default function Emblem({ side }: { side: "dragon" | "tiger" }) {
  return (
    <svg
      viewBox="0 0 180 180"
      className={`dt-emblem dt-emblem-${side}`}
      aria-hidden="true"
    >
      <circle
        cx="90"
        cy="90"
        r="78"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity=".35"
      />
      <circle
        cx="90"
        cy="90"
        r="69"
        fill="none"
        stroke="currentColor"
        strokeWidth=".5"
        strokeDasharray="2 7"
        opacity=".6"
      />
      <path
        d="M90 5 95 13 90 21 85 13ZM90 159 95 167 90 175 85 167ZM5 90 13 85 21 90 13 95ZM159 90 167 85 175 90 167 95Z"
        fill="currentColor"
      />
      {side === "dragon" ? (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M48 120c-20-26-4-58 21-54-12 8-17 21-10 30 8 11 24 3 20-8-8-23 9-42 26-44l-6-13 18 11 16-10-4 19 18 10-22 5 7 12-20-2c-17 1-23 13-14 24 16 22 1 42-20 43-18 1-28-8-28-20 0-14 15-20 23-12 8 8-1 17-8 13" />
          <path d="m107 52 6 3m10 11 10 22 17-5m-94-3-13-8 2-14m44 65 16 5 9-6m-58 6-12 13-10-2" />
          <path d="m98 43-9-10m-9 27-9-10m27 48 13 3m-11 6 12 8" opacity=".7" />
        </g>
      ) : (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M55 59c-20-28-37 0-21 22-5 37 15 62 56 68 41-6 61-31 56-68 16-22-1-50-21-22-22-15-48-15-70 0Z" />
          <path d="m73 108 17 8 17-8-17-4Zm17 8v13m0 0c-7 12-22 5-22-3m22 3c7 12 22 5 22-3M48 89l23 7-8-13m69 6-23 7 8-13" />
          <path d="m77 56 4 19 9 9 9-9 4-19M90 52v19M36 100l22 5-16 6m102-11-22 5 16 6M51 118l14-4m64 4-14-4M47 70l9 6m77-6-9 6" />
        </g>
      )}
    </svg>
  );
}
