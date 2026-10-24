import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  jokerCardLabel,
  type JokerOutcome,
} from "@workspace/api-zod/teenpatti-joker";
import {
  cardIsRed,
  cardRankLabel,
  cardSuitSymbol,
} from "@/components/baccarat/cards";
import preparedFrames from "@/assets/teenpatti-joker/reference-motion/table-rank-frames.json";
import { JOKER_REFERENCE_FILM as film } from "./jokerReferenceFilm";

const frames = preparedFrames as [number[], string][];

/** Vector card values and precomputed hand masks; no video pixel reads at runtime. */
export default memo(function JokerTableRanks({
  video,
  ready,
  outcome,
  count,
}: {
  video: RefObject<HTMLVideoElement | null>;
  ready: boolean;
  outcome?: JokerOutcome | null;
  count: number;
}) {
  const maskId = `joker-hands-${useId().replace(/:/g, "")}`;
  const [frame, setFrame] = useState(-1);
  const last = useRef(-1);
  const active = !!outcome;
  useEffect(() => {
    const player = video.current;
    if (!player || !ready || !active) return;
    let request = 0,
      stopped = false;
    const update = (time: number) => {
      const index =
        time >= 20 && time < 86
          ? Math.min(frames.length - 1, Math.floor((time - 20) * 6))
          : -1;
      if (index !== last.current) {
        last.current = index;
        setFrame(index);
      }
    };
    const next: VideoFrameRequestCallback = (_, metadata) => {
      if (stopped) return;
      update(metadata.mediaTime);
      request = player.requestVideoFrameCallback(next);
    };
    const seeked = () => update(player.currentTime);
    seeked();
    if (player.requestVideoFrameCallback)
      request = player.requestVideoFrameCallback(next);
    else player.addEventListener("timeupdate", seeked);
    player.addEventListener("seeked", seeked);
    return () => {
      stopped = true;
      if (request) player.cancelVideoFrameCallback(request);
      player.removeEventListener("timeupdate", seeked);
      player.removeEventListener("seeked", seeked);
    };
  }, [video, ready, active]);

  if (!outcome || !count || (ready && frame < 0)) return null;
  const values = [
    outcome.joker,
    outcome.handACards[0],
    outcome.handBCards[0],
    outcome.handACards[1],
    outcome.handBCards[1],
    outcome.handACards[2],
    outcome.handBCards[2],
  ];
  const [points, handMask] = frames[Math.max(0, frame)];
  const time = film.dealStart + frame / 6;
  return (
    <svg
      className="j20-table-ranks"
      viewBox="0 0 960 540"
      aria-label="Card values on the dealer table"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="960"
          height="540"
        >
          <rect width="960" height="540" fill="white" />
          {ready && <path d={handMask} fill="black" />}
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        {values.map((value, index) => {
          if (
            index >= count ||
            (ready &&
              (time < film.dealStart + film.cardLandings[index] ||
                time >= film.dealStart + film.cardClearings[index]))
          )
            return null;
          const p = points.slice(index * 8, index * 8 + 8);
          const x = (p[0] + p[2] + p[4] + p[6]) / 4;
          const y = (p[1] + p[3] + p[5] + p[7]) / 4;
          const width = Math.min(
            Math.hypot(p[2] - p[0], p[3] - p[1]),
            Math.hypot(p[4] - p[6], p[5] - p[7]),
          );
          const height = Math.min(
            Math.hypot(p[6] - p[0], p[7] - p[1]),
            Math.hypot(p[4] - p[2], p[5] - p[3]),
          );
          const angle = (Math.atan2(p[3] - p[1], p[2] - p[0]) * 180) / Math.PI;
          return (
            <g
              key={index}
              className="j20-table-card"
              data-slot={index}
              data-card={value}
              role="img"
              aria-label={jokerCardLabel(value)}
            >
              <polygon
                points={`${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]} ${p[6]},${p[7]}`}
                fill="#fff9e9"
                stroke="#d6c4a2"
                strokeWidth="0.7"
              />
              <text
                className="j20-table-rank"
                x={x}
                y={y + 1}
                transform={`rotate(${angle} ${x} ${y})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Arial, sans-serif"
                fontWeight="900"
                fontSize={Math.min(30, height * 0.95)}
                fill={cardIsRed(value) ? "#ba1427" : "#111820"}
                textLength={Math.min(width - 6, 42)}
                lengthAdjust="spacingAndGlyphs"
              >
                {cardRankLabel(value)}
                {cardSuitSymbol(value)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
});
