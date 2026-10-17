import type { HarvestWorld } from "./harvestWorld";

export default function HarvestBackdrop({
  world,
  height,
  id,
}: {
  world: HarvestWorld;
  height: number;
  id: string;
}) {
  return (
    <g data-testid="harvest-background" data-world={world.id}>
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={world.sky[0]} />
          <stop offset="1" stopColor={world.sky[1]} />
        </linearGradient>
        <linearGradient id={`${id}-land`} x2="0" y2="1">
          <stop stopColor={world.hills[1]} />
          <stop offset="1" stopColor={world.hills[2]} />
        </linearGradient>
        <linearGradient id={`${id}-ground`} x2="0" y2="1">
          <stop stopColor={world.ground[0]} />
          <stop offset="1" stopColor={world.ground[1]} />
        </linearGradient>
      </defs>
      <path d={`M0 0H720V${height}H0Z`} fill={`url(#${id}-sky)`} />
      <g transform={`translate(0 ${(height - 420) * 0.14})`}>
        {world.night ? (
          <>
            <circle cx="618" cy="82" r="51" fill="#fff4c6" opacity=".1" />
            <path
              d="M643 46A38 38 0 1 0 651 105A34 34 0 0 1 643 46Z"
              fill="#fff3c7"
            />
            {[
              [55, 50],
              [192, 103],
              [350, 37],
              [448, 112],
              [534, 42],
              [680, 145],
            ].map(([x, y], i) => (
              <path
                key={i}
                d={`M${x} ${y - 5}v10m-5 -5h10`}
                stroke="#fff3c7"
                strokeWidth="2"
                opacity=".8"
              />
            ))}
          </>
        ) : (
          <g>
            <circle cx="623" cy="82" r="53" fill="#ffdc95" opacity=".4" />
            <circle
              cx="623"
              cy="82"
              r="34"
              fill={world.id === "beach" ? "#ff966f" : "#ffda78"}
            />
          </g>
        )}
        {!world.night && (
          <g fill="#fff" opacity=".8">
            <path d="M54 91C21 89 23 60 47 58C47 18 102 20 109 51C145 32 170 81 139 91Z" />
            <path d="M338 62C314 64 312 42 331 37C336 10 373 10 382 32C409 27 421 59 397 63Z" />
          </g>
        )}
      </g>
      <g transform={`scale(1 ${height / 420})`}>
        {world.id === "snow" ? (
          <>
            <path
              d="M0 276L144 108L282 271L464 103L720 269V372H0Z"
              fill={world.hills[0]}
            />
            <path
              d="M100 159L144 108L195 169L151 151L134 171ZM420 154L464 103L527 166L477 148L454 170Z"
              fill="#f8fcff"
            />
          </>
        ) : (
          <path
            d="M0 231Q124 125 267 222Q439 115 720 216V359H0Z"
            fill={world.hills[0]}
          />
        )}
        <path
          d="M0 267Q217 180 372 257Q537 188 720 249V372H0Z"
          fill={`url(#${id}-land)`}
        />
        <g
          stroke={
            world.id === "beach"
              ? "#cef8ec"
              : world.id === "snow"
                ? "#fff"
                : "#e0eab7"
          }
          strokeWidth="3"
          fill="none"
          opacity=".35"
        >
          <path d="M0 296Q340 239 720 284M0 322Q340 265 720 310M0 348Q340 291 720 336" />
        </g>
        <path d="M0 355H720V420H0Z" fill={`url(#${id}-ground)`} />
        {world.id === "farm" && (
          <g transform="translate(47 205)">
            <path d="M0 15L56 -30L112 15" fill="#9d7dab" />
            <path d="M9 12H103V79H9Z" fill="#c5a8ce" />
            <path d="M46 34H73V79H46Z" fill="#756c9b" />
            <path d="M18 25H37V45H18Z" fill="#ffe6a0" />
            <path d="M10 65H103" stroke="#e8cbea" strokeWidth="5" />
          </g>
        )}
        {world.id === "beach" && (
          <g transform="translate(82 222)">
            <path
              d="M0 115Q22 54 8 10"
              fill="none"
              stroke="#a37d64"
              strokeWidth="13"
            />
            <path
              d="M8 10Q-31 -40 -59 7Q-20 -9 8 10Q-43 0 -44 40Q-12 19 8 10Q34 -35 65 -8Q29 -4 8 10Q54 7 63 39Q28 18 8 10"
              fill="#388f78"
            />
            <path d="M520 83L563 83L547 67L542 32L537 67Z" fill="#ffead0" />
          </g>
        )}
        {world.id === "night" && (
          <g>
            <path
              d="M29 310L57 165L83 310ZM634 316L664 154L699 316Z"
              fill="#294e66"
            />
            {[52, 128, 581, 653].map((x, i) => (
              <g key={x} transform={`translate(${x} ${316 + (i % 2) * 13})`}>
                <path d="M0 0V-19" stroke="#70a992" strokeWidth="3" />
                <circle cy="-22" r="8" fill={i % 2 ? "#cd9dde" : "#f9db8e"} />
                <circle cy="-22" r="3" fill="#fff7c1" />
              </g>
            ))}
          </g>
        )}
        {world.id === "snow" && (
          <g>
            {[63, 644].map((x) => (
              <g key={x} transform={`translate(${x} 228)`}>
                <path d="M0 110V26" stroke="#8b8b97" strokeWidth="10" />
                <path
                  d="M-35 79L0 0L35 79ZM-42 98L0 31L42 98Z"
                  fill="#779ba9"
                />
                <path d="M-20 35L0 0L20 35L2 25Z" fill="#fff" />
              </g>
            ))}
          </g>
        )}
        {world.id === "desert" && (
          <g
            fill="none"
            stroke="#5c967c"
            strokeWidth="18"
            strokeLinecap="round"
          >
            <path d="M73 344V250M73 302H49V276M73 286H96V261M654 343V261M654 310H680V287" />
          </g>
        )}
        <g
          opacity=".2"
          stroke={world.night ? "#c4e0ef" : "#755740"}
          strokeWidth="2"
        >
          <path d="M0 379Q300 364 720 381M0 404Q400 391 720 401" fill="none" />
        </g>
      </g>
    </g>
  );
}
