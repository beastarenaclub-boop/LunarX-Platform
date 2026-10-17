import { useId } from "react";
import { CardBack, CardFace } from "./TableCardArt";
import { OVERHEAD_X } from "./tableCameras";
import { categoryLabel, type TeenPattiDeal } from "./types";

export default function OverheadTable({
  deal,
  settled,
  cardRef,
}: {
  deal: TeenPattiDeal | null;
  settled: boolean;
  cardRef: (index: number, element: SVGGElement | null) => void;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className="tpl-overhead-camera"
      viewBox="142 145 616 280"
      preserveAspectRatio="xMidYMid meet"
      data-testid="tpl-card-camera"
      role="group"
      aria-label="Overhead view of the table cards"
    >
      <defs>
        <radialGradient id={`${id}-felt`}>
          <stop stopColor="#28634e" />
          <stop offset="1" stopColor="#11392b" />
        </radialGradient>
        <linearGradient id={`${id}-rail`} x2="0" y2="1">
          <stop stopColor="#5b4130" />
          <stop offset=".4" stopColor="#1d1920" />
          <stop offset="1" stopColor="#755438" />
        </linearGradient>
        <filter id={`${id}-grain`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".65"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".06" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" mode="soft-light" />
        </filter>
        <filter
          id={`${id}-shadow`}
          x="-20%"
          y="-10%"
          width="150%"
          height="150%"
        >
          <feDropShadow dx="2" dy="4" stdDeviation="3" floodOpacity=".4" />
        </filter>
      </defs>
      <rect width="864" height="496" fill="#081b14" />
      <rect
        x="15"
        y="16"
        width="834"
        height="468"
        rx="100"
        fill={`url(#${id}-rail)`}
        stroke="#a38a59"
        strokeWidth="2"
      />
      <rect
        x="34"
        y="33"
        width="796"
        height="434"
        rx="88"
        fill={`url(#${id}-felt)`}
        filter={`url(#${id}-grain)`}
      />
      <rect
        x="50"
        y="47"
        width="764"
        height="406"
        rx="75"
        fill="none"
        stroke="#d4b472"
        strokeWidth="1"
        opacity=".6"
      />
      <path
        d="M432 177V371"
        stroke="#d6c391"
        strokeDasharray="2 7"
        opacity=".2"
      />
      {[0, 1].map((side) => (
        <g key={side} textAnchor="middle">
          <text
            x={side ? 601 : 301}
            y="186"
            fill={side ? "#e2b7bb" : "#c4ddef"}
            fontSize="17"
            letterSpacing="3"
            fontWeight="700"
          >
            PLAYER {side ? "B" : "A"}
          </text>
          <text
            x={side ? 601 : 301}
            y="363"
            fill="#d8c59b"
            fontSize="14"
            letterSpacing="1.5"
          >
            {settled && deal
              ? categoryLabel(
                  (side ? deal.handB : deal.handA).category,
                ).toUpperCase()
              : "THREE CARDS"}
          </text>
          {settled && deal?.winner === (side ? "playerB" : "playerA") && (
            <g>
              <path
                d={`M${side ? 491 : 191} 380H${side ? 711 : 411}`}
                stroke="#e3bb63"
              />
              <text
                x={side ? 601 : 301}
                y="404"
                fill="#ffdb86"
                fontSize="13"
                letterSpacing="3"
                fontWeight="700"
              >
                WINNING HAND
              </text>
            </g>
          )}
        </g>
      ))}
      {Array.from({ length: 6 }, (_, index) => {
        const value =
          index < 3 ? deal?.handACards[index] : deal?.handBCards[index - 3];
        return (
          <g
            key={index}
            ref={(el) => cardRef(index, el)}
            className="tpl-overhead-card"
            data-face-up="false"
            data-dealt="false"
            data-testid={`tpl-card-camera-card-${index}`}
            data-card={value}
            transform={`translate(${OVERHEAD_X[index]} 212) scale(1.12)`}
            filter={`url(#${id}-shadow)`}
          >
            <g className="tpl-camera-back">
              <CardBack />
            </g>
            <g className="tpl-camera-face">
              {value != null && (
                <CardFace
                  value={value}
                  jumbo
                  won={
                    settled &&
                    deal?.winner === (index < 3 ? "playerA" : "playerB")
                  }
                />
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
