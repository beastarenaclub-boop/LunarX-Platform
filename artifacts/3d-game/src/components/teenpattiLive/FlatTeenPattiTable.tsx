import { useLayoutEffect, useRef, useState } from "react";
import {
  cardIsRed,
  cardRankLabel,
  cardSuitSymbol,
} from "@/components/baccarat/cards";
import { formatChip } from "@/components/table/chips";
import { cn } from "@/lib/utils";
import { planDealMs } from "./dealPlan";
import type { DealAudio } from "./tableDealAudio";
import {
  TEEN_PATTI_SPOTS,
  categoryLabel,
  type SpotAmounts,
  type TeenPattiDeal,
  type TeenPattiSpot,
} from "./types";
import StudioDealer, { type DealerArmElements } from "./StudioDealer";
import {
  ARM_SOURCE,
  CARD_WIDTH,
  CARD_HEIGHT,
  STUDIO_WIDTH,
  STUDIO_HEIGHT,
  armJoints,
  buildStudioPlan,
  cardTarget,
  segmentMatrix,
  studioCardPose,
  studioHandPose,
} from "./studioMotion";
import "./teen-patti-studio.css";

export interface TeenPattiTableViewProps {
  deal: TeenPattiDeal | null;
  roundKey: string;
  revealEndsAt: number | null;
  revealDurationMs?: number;
  bettingEndsAt?: number | null;
  bettingDurationMs?: number;
  chips: SpotAmounts;
  animate: boolean;
  audio?: DealAudio;
  onSettled?: (roundId: string) => void;
  spotLabels: Record<TeenPattiSpot, string>;
  waitingLabel: string;
  className?: string;
}
const SPOT_X = [170, 415, 600, 785, 1030];

/** GPU-independent studio. Hands and cards share absolute elapsed time, so
 * neither late joins nor returning to a hidden tab can restart a round. */
export default function FlatTeenPattiTable({
  deal,
  roundKey,
  revealEndsAt,
  chips,
  animate,
  audio,
  onSettled,
  spotLabels,
  waitingLabel,
  className,
}: TeenPattiTableViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const arms = useRef<DealerArmElements>({
    upperA: null,
    lowerA: null,
    upperB: null,
    lowerB: null,
  });
  const callbacks = useRef({ audio, onSettled });
  callbacks.current = { audio, onSettled };
  const anchor = useRef<{
    key: string;
    start: number;
    plan: ReturnType<typeof buildStudioPlan>;
    cue: number;
    done: boolean;
  } | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const visibleResult = !!deal && landed === roundKey;
  const layout = buildStudioPlan(roundKey, 0);

  useLayoutEffect(() => {
    if (!deal || !roundKey) {
      anchor.current = null;
      setLanded(null);
    } else if (anchor.current?.key !== roundKey) {
      const start = Date.now();
      const duration = animate ? planDealMs((revealEndsAt ?? 0) - start) : 0;
      anchor.current = {
        key: roundKey,
        start,
        plan: buildStudioPlan(roundKey, duration),
        cue: 0,
        done: false,
      };
      if (duration > 0) callbacks.current.audio?.onDealStart?.();
    }
    if (!animate && anchor.current) anchor.current.plan.durationMs = 0;
    let frame = 0;
    let last = Date.now();
    const paint = () => {
      const current = anchor.current;
      const now = Date.now();
      const t =
        !current || current.plan.durationMs === 0
          ? 1
          : Math.min(1, (now - current.start) / current.plan.durationMs);
      const stale = document.hidden || now - last > 250;
      last = now;
      for (const side of ["A", "B"] as const) {
        const hand = studioHandPose(side, current?.plan ?? null, t);
        const joints = armJoints(side, hand);
        const source = ARM_SOURCE[side];
        arms.current[`upper${side}`]?.setAttribute(
          "transform",
          segmentMatrix(
            source.shoulder,
            source.elbow,
            joints.shoulder,
            joints.elbow,
          ),
        );
        const lower = arms.current[`lower${side}`];
        lower?.setAttribute(
          "transform",
          segmentMatrix(source.elbow, source.tip, joints.elbow, joints.tip),
        );
        lower?.parentElement?.setAttribute(
          "data-contact-card",
          String(hand.contact),
        );
        lower?.parentElement?.setAttribute("data-tip-x", hand.x.toFixed(2));
        lower?.parentElement?.setAttribute("data-tip-y", hand.y.toFixed(2));
      }
      if (current && deal) {
        for (const c of current.plan.cards) {
          const element = cards.current[c.order];
          if (!element) continue;
          const p = studioCardPose(c, t);
          element.style.left = `${((p.x - CARD_WIDTH / 2) / STUDIO_WIDTH) * 100}%`;
          element.style.top = `${(p.y / STUDIO_HEIGHT) * 100}%`;
          element.style.visibility = p.visible ? "visible" : "hidden";
          element.style.transform = `rotate(${p.yaw}deg)`;
          element.setAttribute("data-face-up", String(p.flip >= 1));
          element.setAttribute("aria-hidden", String(p.flip < 1));
          const inner = element.firstElementChild as HTMLElement | null;
          if (inner)
            inner.style.transform = `rotateY(${(c.hand === "A" ? 1 : -1) * (1 - p.flip) * 180}deg)`;
        }
        root.current?.setAttribute("data-deal-progress", t.toFixed(4));
        root.current?.setAttribute(
          "data-action",
          t >= 1 ? "rest" : t < 0.34 ? "dealing" : "opening",
        );
        while (
          current.cue < current.plan.cues.length &&
          current.plan.cues[current.cue].t <= t
        ) {
          const cue = current.plan.cues[current.cue++];
          if (
            stale ||
            current.plan.durationMs === 0 ||
            (t - cue.t) * current.plan.durationMs > 180
          )
            continue;
          if (cue.kind === "deal")
            callbacks.current.audio?.onCardLand?.(current.cue - 1);
          else callbacks.current.audio?.onCardFlip?.();
        }
        if (t >= 1 && !current.done) {
          current.done = true;
          setLanded(current.key);
          if (!stale && current.plan.durationMs > 0)
            callbacks.current.audio?.onReveal?.();
          callbacks.current.onSettled?.(current.key);
        }
      } else {
        root.current?.setAttribute("data-action", "waiting");
        root.current?.removeAttribute("data-deal-progress");
      }
      if (current && t < 1) frame = requestAnimationFrame(paint);
    };
    paint();
    const resume = () => {
      if (!document.hidden) {
        cancelAnimationFrame(frame);
        paint();
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [deal, roundKey, revealEndsAt, animate]);

  return (
    <div
      ref={root}
      className={cn("tpl-studio", className)}
      data-testid="tpl-flat-table"
      data-presentation="dealer-studio"
      data-action="waiting"
    >
      <div className="tpl-studio-room" />
      <div className="tpl-studio-light" />
      <div className="tpl-studio-wordmark" aria-hidden="true">
        <span>LUNAR CASINO</span>
        <strong>TEEN PATTI</strong>
        <em>20 · 20</em>
        <i>THE CLASSIC. REIMAGINED.</i>
      </div>
      <div className="tpl-studio-status">
        <span className="tpl-live-dot" /> LIVE TABLE{" "}
        <span className="tpl-studio-id">01</span>
      </div>
      <StudioDealer layer="body" />
      <svg className="tpl-felt" viewBox="0 0 1200 760" aria-hidden="true">
        <defs>
          <radialGradient id="tpl-felt-green">
            <stop stopColor="#18634e" />
            <stop offset=".62" stopColor="#0c493b" />
            <stop offset="1" stopColor="#042f29" />
          </radialGradient>
          <linearGradient id="tpl-rail-gold" x2="0" y2="1">
            <stop stopColor="#42301b" />
            <stop offset=".35" stopColor="#e9c887" />
            <stop offset=".5" stopColor="#755128" />
            <stop offset="1" stopColor="#261d14" />
          </linearGradient>
          <pattern
            id="tpl-felt-grain"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 1H5M1 0V5"
              stroke="#b9ddc2"
              strokeOpacity=".045"
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <path
          d="M-80 590C-35 316 1235 316 1280 590L1300 790H-100Z"
          fill="#120f0d"
          stroke="#090807"
          strokeWidth="36"
        />
        <path
          d="M-80 590C-35 316 1235 316 1280 590L1300 790H-100Z"
          fill="url(#tpl-felt-green)"
          stroke="url(#tpl-rail-gold)"
          strokeWidth="9"
        />
        <path
          d="M-80 590C-35 316 1235 316 1280 590L1300 790H-100Z"
          fill="url(#tpl-felt-grain)"
        />
        <path
          d="M-10 608C50 354 1150 354 1210 608"
          fill="none"
          stroke="#e7c991"
          strokeOpacity=".22"
          strokeWidth="1.5"
        />
        <rect
          x="290"
          y="464"
          width="290"
          height="143"
          rx="16"
          className={cn(
            "tpl-hand-outline tpl-outline-a",
            visibleResult && deal.winner === "playerA" && "tpl-outline-winner",
          )}
        />
        <rect
          x="620"
          y="464"
          width="290"
          height="143"
          rx="16"
          className={cn(
            "tpl-hand-outline tpl-outline-b",
            visibleResult && deal.winner === "playerB" && "tpl-outline-winner",
          )}
        />
        <text x="435" y="630" className="tpl-hand-title tpl-title-a">
          {spotLabels.playerA}
        </text>
        <text x="765" y="630" className="tpl-hand-title tpl-title-b">
          {spotLabels.playerB}
        </text>
        {visibleResult && (
          <>
            <text x="435" y="655" className="tpl-category">
              {categoryLabel(deal.handA.category)}
            </text>
            <text x="765" y="655" className="tpl-category">
              {categoryLabel(deal.handB.category)}
            </text>
          </>
        )}
        <g transform="translate(144 451) rotate(-9)">
          <rect
            width="61"
            height="92"
            rx="7"
            fill="#080e16"
            stroke="#ba9257"
            strokeWidth="3"
          />
          <rect
            x="6"
            y="6"
            width="49"
            height="80"
            rx="3"
            fill="#122841"
            stroke="#ba9257"
          />
          <path
            d="M30 27l12 19-12 19-12-19Z"
            fill="none"
            stroke="#d8b77d"
            strokeWidth="2"
          />
        </g>
        <g transform="translate(990 453)">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} transform={`translate(0 ${-i * 5})`}>
              <ellipse rx="27" ry="12" cy="14" fill="#171a24" />
              <ellipse
                rx="27"
                ry="12"
                cy="10"
                fill={i % 2 ? "#904858" : "#dec38c"}
                stroke="#fff2cd"
                strokeWidth="2"
                strokeDasharray="8 7"
              />
            </g>
          ))}
        </g>
        <path d="M452 709H541m118 0h89" stroke="#d8bd81" strokeOpacity=".3" />
        <text x="600" y="718" className="tpl-felt-brand">
          ♠ 20 · 20 ♠
        </text>
        <text x="600" y="744" className="tpl-felt-caption">
          TEEN PATTI · THREE CARDS · ONE WINNER
        </text>
      </svg>
      {layout.cards.map((c) => {
        const value = deal
          ? (c.hand === "A" ? deal.handACards : deal.handBCards)[c.slot]
          : undefined;
        const p = cardTarget(c);
        return (
          <div
            key={`${roundKey}-${c.order}`}
            ref={(el) => {
              cards.current[c.order] = el;
            }}
            className={cn(
              "tpl-card",
              value != null && cardIsRed(value) && "tpl-card-red",
              !deal && "tpl-card-placeholder",
            )}
            data-testid={
              value != null ? `card-${value}` : `tpl-card-slot-${c.order}`
            }
            data-order={c.order}
            data-face-up="false"
            aria-hidden="true"
            style={{
              left: `${((p.x - CARD_WIDTH / 2) / STUDIO_WIDTH) * 100}%`,
              top: `${(p.y / STUDIO_HEIGHT) * 100}%`,
              width: `${(CARD_WIDTH / STUDIO_WIDTH) * 100}%`,
              height: `${(CARD_HEIGHT / STUDIO_HEIGHT) * 100}%`,
            }}
          >
            <div className="tpl-card-turn">
              <div className="tpl-card-front">
                <span className="tpl-card-corner">
                  {value != null && cardRankLabel(value)}
                  <small>{value != null && cardSuitSymbol(value)}</small>
                </span>
                <strong>{value != null && cardSuitSymbol(value)}</strong>
                <span className="tpl-card-corner tpl-card-corner-bottom">
                  {value != null && cardRankLabel(value)}
                  <small>{value != null && cardSuitSymbol(value)}</small>
                </span>
              </div>
              <div className="tpl-card-back">
                <span>♠</span>
              </div>
            </div>
          </div>
        );
      })}
      <StudioDealer layer="arms" arms={arms} />
      <div className="tpl-dealer-name">
        <span /> MAYA <small>YOUR DEALER</small>
      </div>
      <div className="tpl-table-message" data-testid="tpl-waiting">
        {!deal ? (
          waitingLabel
        ) : visibleResult ? (
          "Hands revealed"
        ) : (
          <>
            <span className="tpl-message-dealing">Maya is dealing</span>
            <span className="tpl-message-opening">Opening the cards</span>
          </>
        )}
      </div>
      <div className="tpl-felt-bets">
        {TEEN_PATTI_SPOTS.map((spot, i) => (
          <div
            key={spot}
            className={cn(
              "tpl-felt-bet",
              (chips[spot] ?? 0) > 0 && "tpl-felt-bet-active",
            )}
            style={{ left: `${(SPOT_X[i] / STUDIO_WIDTH) * 100}%` }}
            data-testid={`tpl-flat-spot-${spot}`}
          >
            <span>{spotLabels[spot]}</span>
            {(chips[spot] ?? 0) > 0 && (
              <strong>{formatChip(chips[spot]!)}</strong>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
