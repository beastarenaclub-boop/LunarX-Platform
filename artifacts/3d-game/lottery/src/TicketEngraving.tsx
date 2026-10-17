// Original lottery ornament, drawn as vectors so the fine ink stays sharp.
export function TicketEngraving({ series }: { series: string }) {
  return (
    <svg
      className="nice-ticket-engraving"
      viewBox="0 0 260 128"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor">
        <g opacity=".48" strokeWidth=".55">
          <rect x="4" y="4" width="252" height="120" rx="1" />
          <rect x="7" y="7" width="246" height="114" rx="1" />
          <path d="M4 17h13V4m226 0v13h13M4 111h13v13m226 0v-13h13" />
          <path d="M10 20V10h10m220 0h10v10M10 108v10h10m220 0h10v-10" />
        </g>
        <g opacity=".13" strokeWidth=".45">
          {Array.from({ length: 14 }, (_, i) => (
            <path
              key={i}
              d={`M8 ${20 + i * 7} C60 ${-8 + i * 7}, 83 ${61 + i * 4}, 139 ${24 + i * 6} S218 ${12 + i * 7}, 252 ${23 + i * 7}`}
            />
          ))}
        </g>
        <g opacity=".25" strokeWidth=".55">
          {Array.from({ length: 18 }, (_, i) => (
            <ellipse
              key={i}
              cx="204"
              cy="67"
              rx="38"
              ry="22"
              transform={`rotate(${i * 10} 204 67)`}
            />
          ))}
          <circle cx="204" cy="67" r="30" />
          <circle cx="204" cy="67" r="27" />
          <circle cx="204" cy="67" r="23" />
        </g>
      </g>
      <text
        x="204"
        y="76"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="30"
        fontWeight="bold"
        fill="currentColor"
        opacity=".2"
      >
        {series.slice(2)}
      </text>
      <text
        x="204"
        y="115"
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="4.5"
        letterSpacing="1.5"
        fill="currentColor"
        opacity=".55"
      >
        IRLAND LOTTO · IRLAND LOTTO
      </text>
    </svg>
  );
}
