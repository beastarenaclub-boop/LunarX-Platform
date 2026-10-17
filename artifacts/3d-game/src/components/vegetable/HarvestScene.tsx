import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VegetableOutcome } from "@workspace/api-zod/vegetable-game";
import { BowlArt, VegetableArt } from "./VegetableArt";
import HarvestBackdrop from "./HarvestBackdrop";
import JunkArt from "./JunkArt";
import type { HarvestWorld } from "./harvestWorld";
import {
  catchTime,
  catchX,
  clamp01,
  FALL_DURATION_MS,
  harvestFrame,
  junkDrops,
  dodgeBowlX,
  JUNK_FALL_MS,
} from "./harvestMotion";

export default function HarvestScene({
  world,
  roundId,
  outcome,
  phase,
  duration,
  endsAt,
  onCollected,
}: {
  world: HarvestWorld;
  roundId: string;
  outcome: VegetableOutcome | null;
  phase: string | null;
  duration: number;
  endsAt: number | null;
  onCollected: (count: number, complete: boolean) => void;
}) {
  const id = useId().replace(/:/g, "");
  const scene = useRef<SVGSVGElement>(null);
  const [sceneHeight, setSceneHeight] = useState(420);
  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSceneHeight(Math.max(220, (720 * height) / width));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const [now, setNow] = useState(Date.now);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    let raf = 0,
      last = 0;
    const animate = (time: number) => {
      if (time - last >= (media.matches ? 200 : 32)) {
        setNow(Date.now());
        last = time;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("change", update);
    };
  }, []);
  const elapsed =
    phase === "settling"
      ? duration
      : endsAt
        ? Math.max(0, duration - (endsAt - now))
        : 0;
  const isJunk = outcome?.winner === "junk";
  const items = isJunk ? outcome.junk ?? [] : outcome?.vegetables ?? [];
  const frame = harvestFrame(elapsed, items.length, duration);
  const junk = useMemo(
    () => junkDrops(outcome?.total ?? 0, duration, roundId),
    [outcome?.total, duration, roundId],
  );
  const dodged = outcome
    ? junk.filter((drop) => elapsed >= drop.crossesAt).length
    : 0;
  const dodge =
    outcome && !reduced
      ? junk.find(
          (drop) => elapsed >= drop.crossesAt && elapsed < drop.crossesAt + 650,
        )
      : undefined;
  const count = outcome && !isJunk ? frame.collected : 0;
  const complete = !!outcome && items.length > 0 && frame.collected === items.length;
  const bowlX = reduced
    ? 360
    : outcome
      ? dodgeBowlX(frame.bowlX, elapsed, junk)
      : 360 + Math.sin(now / 1500) * 95;
  const bob = reduced ? 0 : outcome ? frame.bounce : Math.sin(now / 600) * 2;
  useEffect(() => {
    onCollected(count, complete);
  }, [count, complete, onCollected]);

  return (
    <svg
      ref={scene}
      className="vb-harvest-svg"
      viewBox={`0 0 720 ${sceneHeight}`}
      role="img"
      aria-label={isJunk
        ? `${world.name}. Junk Bowl, ${frame.collected} junk objects caught, 0 vegetables collected`
        : `${world.name}. Moving bowl collecting vegetables, ${count} collected, ${dodged} junk objects dodged`}
      data-junk-dodged={dodged}
      data-junk-caught={isJunk ? frame.collected : 0}
    >
      <defs>
        <filter
          id={`${id}-shadow`}
          x="-50%"
          y="-50%"
          width="200%"
          height="220%"
        >
          <feDropShadow
            dx="1"
            dy="5"
            stdDeviation="3"
            floodColor="#243f39"
            floodOpacity=".2"
          />
        </filter>
      </defs>
      <HarvestBackdrop world={world} height={sceneHeight} id={id} />
      {!outcome && (
        <g className="vb-waiting-garland" opacity=".9">
          {(["carrot", "tomato", "pepper"] as const).map((kind, i) => (
            <svg
              key={kind}
              x={260 + i * 72}
              y={sceneHeight * 0.26 + (i % 2) * 20}
              width="48"
              height="54"
            >
              <VegetableArt kind={kind} />
            </svg>
          ))}
        </g>
      )}
      <ellipse
        cx={bowlX}
        cy={sceneHeight - 27}
        rx="117"
        ry="12"
        fill="#72513c"
        opacity=".22"
      />
      <g
        data-testid="moving-bowl"
        data-x={bowlX.toFixed(1)}
        transform={`translate(${bowlX - 120} ${sceneHeight - 134 + bob})`}
      >
        <svg width="240" height="118">
          <BowlArt />
        </svg>
        {items.slice(0, frame.collected).map((kind, index) => (
          <svg
            key={index}
            className={`${isJunk ? "vb-junk" : "vb-produce"} landed`}
            x={40 + ((index * 29) % 126)}
            y={-15 - Math.floor(index / 5) * 14}
            width="39"
            height="43"
            transform={`rotate(${index % 2 ? 18 : -12} ${60 + ((index * 29) % 126)} 16)`}
          >
            {kind === "stone" || kind === "boot" || kind === "can"
              ? <JunkArt kind={kind} size={39} />
              : <VegetableArt kind={kind} />}
          </svg>
        ))}
        <path
          d="M20 26Q119 47 221 26"
          fill="none"
          stroke="#e7c478"
          strokeWidth="6"
        />
        <g transform="translate(91 58)">
          <rect x="-8" y="-7" width="72" height="40" rx="13" fill="#fff5d7" />
          <text
            x="28"
            y="19"
            textAnchor="middle"
            fill="#456675"
            fontSize="24"
            fontWeight="800"
          >
            {count.toString().padStart(2, "0")}
          </text>
        </g>
      </g>
      {items.map((kind, index) => {
        const landing = catchTime(index, items.length, duration);
        const t = (elapsed - (landing - FALL_DURATION_MS)) / FALL_DURATION_MS;
        if (t < 0 || t >= 1) return null;
        const x = reduced ? 360 : catchX(index);
        const y = -65 + (sceneHeight - 100) * Math.pow(clamp01(t), 1.55);
        return (
          <g
            key={index}
            className={`${isJunk ? "vb-junk" : "vb-produce"} falling`}
            data-fall-index={index}
            data-y={y.toFixed(1)}
            transform={`translate(${x - 27} ${reduced ? sceneHeight - 181 : y}) rotate(${reduced ? 0 : Math.sin(t * Math.PI * 2) * 20} 27 30)`}
            filter={`url(#${id}-shadow)`}
          >
            {!reduced && (
              <g
                stroke="#fff"
                strokeWidth="3"
                opacity=".65"
                strokeLinecap="round"
              >
                <path d="M13 -21V-5M28 -32V-13M43 -17V-2" />
              </g>
            )}
            <svg width="54" height="60">
              {kind === "stone" || kind === "boot" || kind === "can"
                ? <JunkArt kind={kind} />
                : <VegetableArt kind={kind} />}
            </svg>
          </g>
        );
      })}
      {outcome &&
        junk.map((drop, index) => {
          const delta = elapsed - drop.crossesAt;
          if (delta < -JUNK_FALL_MS || delta > 380) return null;
          const progress = clamp01((delta + JUNK_FALL_MS) / JUNK_FALL_MS);
          const x = reduced ? (drop.side === 1 ? 590 : 130) : drop.x;
          const y =
            delta <= 0
              ? -65 + (sceneHeight - 45) * Math.pow(progress, 1.55)
              : sceneHeight - 110 + 180 * Math.pow(clamp01(delta / 280), 1.2);
          return (
            <g
              key={index}
              className="vb-junk falling"
              data-junk-kind={drop.kind}
              data-junk-index={index}
              data-x={x.toFixed(1)}
              data-y={y.toFixed(1)}
              opacity={delta > 220 ? clamp01((380 - delta) / 160) : 1}
              transform={`translate(${x - 27} ${reduced ? sceneHeight - 170 : y - 27}) rotate(${reduced ? 0 : drop.side * progress * 135} 27 27)`}
              filter={`url(#${id}-shadow)`}
            >
              <JunkArt kind={drop.kind} />
              <circle
                cx="52"
                cy="7"
                r="10"
                fill="#fceae4"
                stroke="#ba675d"
                strokeWidth="1.5"
              />
              <path
                d="M48 3L56 11M56 3L48 11"
                stroke="#ae544e"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      {dodge && (
        <g
          className="vb-dodge-burst"
          transform={`translate(${bowlX} ${sceneHeight - 155})`}
          pointerEvents="none"
        >
          <rect
            x="-46"
            y="-17"
            width="92"
            height="25"
            rx="12"
            fill="#fff5dd"
            stroke="#e6b980"
          />
          <text
            textAnchor="middle"
            y="0"
            fontSize="13"
            fontWeight="800"
            fill="#a55b42"
          >
            DODGED!
          </text>
          <path
            d={`M${dodge.side * 120} 38l${-dodge.side * 24} -7m${dodge.side * 27} 20l${-dodge.side * 21} -3`}
            stroke="#fff4d4"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      )}
      {outcome && !reduced && frame.bounce > 0 && (
        <g
          transform={`translate(${bowlX} ${sceneHeight - 130})`}
          fill="#fff6ae"
        >
          <path d="M-64 -11l3 -10l3 10l10 3l-10 3l-3 10l-3 -10l-10 -3ZM55 -20l3 -10l3 10l10 3l-10 3l-3 10l-3 -10l-10 -3Z" />
          <text
            y="-22"
            textAnchor="middle"
            fontSize="21"
            fontWeight="800"
            fill="#37724f"
          >
            {isJunk ? "JUNK!" : "+1"}
          </text>
        </g>
      )}
    </svg>
  );
}
