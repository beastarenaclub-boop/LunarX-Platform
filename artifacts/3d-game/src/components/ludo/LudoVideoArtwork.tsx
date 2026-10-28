const art = (name: string) => `/media/ludo/generated-v1/${name}.webp`;

/** Separate illustration layers keep the title sharp and the decorative pieces animated. */
export function LudoVideoHero() {
  return (
    <svg
      className="ld-video-hero"
      viewBox="0 0 300 190"
      role="img"
      aria-label="Ludo"
    >
      <image
        href={art("ludo-hero-board")}
        x="24"
        y="98"
        width="252"
        height="88"
        preserveAspectRatio="none"
      />
      <g
        fontFamily="Arial,sans-serif"
        fontWeight="900"
        fontSize="38"
        textAnchor="middle"
      >
        {["L", "U", "D", "O"].map((letter, i) => (
          <g key={letter}>
            <circle cx={78 + i * 45} cy="78" r="23" fill="#704b12" />
            <circle
              cx={78 + i * 45}
              cy="75"
              r="22"
              fill="#fffdf1"
              stroke="#f0d98a"
              strokeWidth="1.5"
            />
            <text
              x={78 + i * 45}
              y="89"
              fill={["#e32d26", "#31a540", "#199ce9", "#efb600"][i]}
              stroke="#553a29"
              strokeWidth=".7"
            >
              {letter}
            </text>
          </g>
        ))}
      </g>
      <image
        href={art("ludo-hero-crown")}
        x="40"
        y="4"
        width="76"
        height="65"
        transform="rotate(-9 78 36)"
      />
      <text
        x="152"
        y="116"
        textAnchor="middle"
        fill="#ffe88b"
        stroke="#39250a"
        strokeWidth="2"
        paintOrder="stroke"
        fontFamily="Georgia,serif"
        fontWeight="900"
        fontSize="23"
        letterSpacing="5"
      >
        KING
      </text>
      <g className="ld-video-white-die">
        <image
          href={art("ludo-hero-die")}
          x="119"
          y="117"
          width="62"
          height="62"
        />
      </g>
      <g className="ld-video-pawn-blue">
        <image
          href={art("ludo-hero-blue-pawn")}
          x="0"
          y="99"
          width="67"
          height="91"
        />
      </g>
      <g className="ld-video-pawn-yellow">
        <image
          href={art("ludo-hero-yellow-pawn")}
          x="233"
          y="99"
          width="67"
          height="91"
        />
      </g>
    </svg>
  );
}

export function RoyalBadge({ label = "Member" }: { label?: string }) {
  return (
    <span className="ld-royal-badge">
      <svg
        viewBox="0 0 60 60"
        aria-hidden="true"
        data-generated-art="membership"
      >
        <image href={art("membership")} width="60" height="60" />
        <text
          x="30"
          y="39"
          textAnchor="middle"
          fontFamily="Georgia,serif"
          fontWeight="900"
          fontSize="18"
          fill="#63250b"
        >
          K
        </text>
      </svg>
      <em>{label}</em>
    </span>
  );
}
