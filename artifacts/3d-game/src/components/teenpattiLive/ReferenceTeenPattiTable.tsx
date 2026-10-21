import { useId, useLayoutEffect, useRef, useState } from "react";
import { cardRankLabel, cardSuitSymbol } from "@/components/baccarat/cards";
import { formatChip } from "@/components/table/chips";
import type { TeenPattiTableViewProps } from "./FlatTeenPattiTable";
import { CardFace } from "./TableCardArt";
import ReferenceFootage from "./ReferenceFootage";
import TableClock from "./TableClock";
import { categoryLabel } from "./types";
import {
  CARD_CENTRES,
  TURN_ORDER,
  openingState,
} from "./referenceSequentialMotion";
import "./teen-patti-reference.css";

export function ReferenceCardBack() {
  return (
    <svg viewBox="0 0 66 94" width="66" height="94" aria-hidden="true">
      <rect width="66" height="94" rx="4" fill="#fff7e9" />
      <rect
        x="4"
        y="4"
        width="58"
        height="86"
        rx="2"
        fill="#a02037"
        stroke="#701526"
      />
      {Array.from({ length: 12 }, (_, i) => (
        <path
          key={i}
          d={`M6 ${i * 8}L60 ${i * 8 + 36}M60 ${i * 8}L6 ${i * 8 + 36}`}
          stroke="#f4d4ca"
          strokeWidth=".7"
        />
      ))}
      <rect
        x="9"
        y="9"
        width="48"
        height="76"
        rx="2"
        fill="none"
        stroke="#fff0df"
        strokeWidth="1.5"
      />
      <path d="M33 23L48 47 33 71 18 47Z" fill="#a02037" stroke="#fff0df" />
      <text x="33" y="53" fill="#fff0df" textAnchor="middle" fontSize="23">
        ♠
      </text>
    </svg>
  );
}

export default function ReferenceTeenPattiTable({
  deal,
  roundKey,
  revealEndsAt,
  revealDurationMs = 9000,
  bettingEndsAt,
  chips,
  animate,
  audio,
  onSettled,
  waitingLabel,
}: TeenPattiTableViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const countdown = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ audio, onSettled });
  callbacks.current = { audio, onSettled };
  const settledKey = useRef<string | null>(null);
  const [revealed, setRevealed] = useState({ key: "", count: 0 });
  const occlusion = useRef<SVGPathElement>(null);
  const clipId = useId();
  const [landed, setLanded] = useState<string | null>(null);
  const settled = !!deal && landed === roundKey;
  const count = deal && revealed.key === roundKey ? revealed.count : 0;
  const faceUp = (index: number) =>
    TURN_ORDER.indexOf(index as (typeof TURN_ORDER)[number]) < count;

  useLayoutEffect(() => {
    let published = -1;
    if (!deal) {
      settledKey.current = null;
      setRevealed({ key: "", count: 0 });
      setLanded(null);
    }
    const start =
      revealEndsAt == null ? -Infinity : revealEndsAt - revealDurationMs;
    const tick = () => {
      const now = Date.now();
      const elapsed = animate ? now - start : Infinity;
      const state = openingState(elapsed, revealDurationMs);
      if (deal && state.count !== published) {
        if (
          published >= 0 &&
          state.count === published + 1 &&
          animate &&
          !document.hidden
        )
          callbacks.current.audio?.onReveal?.();
        published = state.count;
        setRevealed((previous) =>
          previous.key === roundKey && previous.count === state.count
            ? previous
            : { key: roundKey, count: state.count },
        );
      }
      // Announce the winner only after the sixth individual opening.
      if (deal && state.settled && settledKey.current !== roundKey) {
        settledKey.current = roundKey;
        setLanded(roundKey);
        callbacks.current.onSettled?.(roundKey);
      }
      const seconds =
        bettingEndsAt == null
          ? 0
          : Math.max(0, Math.ceil((bettingEndsAt - now) / 1000));
      const text = !roundKey ? "\u2014" : String(seconds).padStart(2, "0");
      if (countdown.current && countdown.current.textContent !== text)
        countdown.current.textContent = text;
      if (root.current) {
        root.current.dataset.action = deal
          ? state.settled
            ? "rest"
            : "opening"
          : "betting";
        root.current.dataset.urgent = String(seconds <= 5);
      }
    };
    tick();
    const timer = window.setInterval(() => {
      if (!document.hidden) tick();
    }, 100);
    const resume = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [deal, roundKey, revealEndsAt, revealDurationMs, bettingEndsAt, animate]);

  return (
    <div
      ref={root}
      className="tp20-stage"
      data-testid="tpl-flat-table"
      data-presentation="sequential-reference-footage"
    >
      <div className="tp20-card-rail">
        <div className="tp20-round-label">
          <strong>20-20 TEEN PATTI</strong>
          <span title={roundKey}>Round ID: {roundKey || "Connecting…"}</span>
        </div>
        <div
          className="tp20-hand-readout"
          aria-label="Current round result cards"
        >
          {(["A", "B"] as const).map((side, hand) => (
            <div
              key={side}
              className="tp20-readout-hand"
              data-won={
                settled && deal.winner === (hand ? "playerB" : "playerA")
              }
            >
              <b>PLAYER {side}</b>
              <div>
                {[0, 1, 2].map((slot) => {
                  const index = hand * 3 + slot;
                  const cardsVisible = faceUp(index);
                  const value = (hand ? deal?.handBCards : deal?.handACards)?.[
                    slot
                  ];
                  return (
                    <svg
                      key={`${roundKey}-${index}`}
                      viewBox="0 0 66 94"
                      role="img"
                      aria-label={
                        cardsVisible && value != null
                          ? cardRankLabel(value) + cardSuitSymbol(value)
                          : "Face-down card"
                      }
                      data-testid={`tp20-readout-${index}`}
                      data-card-value={cardsVisible ? value : undefined}
                      data-face-up={cardsVisible}
                    >
                      <g className="tp20-readout-back">
                        <ReferenceCardBack />
                      </g>
                      <g className="tp20-readout-face">
                        {value != null && <CardFace value={value} jumbo />}
                      </g>
                    </svg>
                  );
                })}
              </div>
              <small>
                {settled
                  ? categoryLabel((hand ? deal.handB : deal.handA).category)
                  : ""}
              </small>
            </div>
          ))}
        </div>
        <span className="tp20-rail-footer">
          TEEN PATTI
          <br />
          <b>20 · 20</b>
        </span>
      </div>
      <div className="tp20-camera">
        <ReferenceFootage
          animate={animate}
          roundKey={roundKey}
          revealing={!!deal}
          revealEndsAt={revealEndsAt}
          revealDurationMs={revealDurationMs}
          occlusion={occlusion}
        />
        <svg
          className="tp20-felt-cards"
          viewBox="0 0 1036 586"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <path ref={occlusion} d="M0,0H1036V586H0Z" clipRule="evenodd" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {deal &&
              CARD_CENTRES.map((x, index) => {
                const value = (index < 3 ? deal.handACards : deal.handBCards)[
                  index % 3
                ];
                const shown = faceUp(index);
                return (
                  <g
                    key={`${roundKey}-${index}`}
                    className="tp20-felt-card"
                    data-testid={`tp20-table-card-${index}`}
                    data-face-up={shown}
                    data-card-value={shown ? value : undefined}
                    transform={`matrix(.46 0 ${index < 3 ? -0.045 : 0.045} .245 ${x - 15} 372)`}
                  >
                    <g className="tp20-readout-back">
                      <ReferenceCardBack />
                    </g>
                    <g className="tp20-readout-face">
                      <CardFace value={value} jumbo />
                    </g>
                  </g>
                );
              })}
          </g>
        </svg>
        <svg
          className="tp20-clock-plane"
          viewBox="0 0 1036 586"
          preserveAspectRatio="none"
        >
          <foreignObject
            x="0"
            y="0"
            width="134"
            height="76"
            transform="matrix(0.94 -0.21 0.2 0.98 171 320)"
          >
            <TableClock />
          </foreignObject>
        </svg>
        <div className="tp20-camera-label">
          <span /> RECORDED DEALER
        </div>
        <div
          className="tp20-countdown"
          data-testid="tp20-countdown"
          aria-label="Betting seconds remaining"
        >
          <span ref={countdown}>—</span>
        </div>
        <div className="tp20-phase-message" data-testid="tpl-waiting">
          {!roundKey
            ? "Connecting to table…"
            : deal
              ? settled
                ? "Round result"
                : `Opening cards ${count}/6`
              : bettingEndsAt
                ? "Place your bets"
                : waitingLabel}
        </div>
        {(["playerA", "playerB"] as const).map(
          (spot, index) =>
            (chips[spot] ?? 0) > 0 && (
              <div
                key={spot}
                className={`tp20-felt-chip tp20-felt-chip--${index}`}
                data-testid={`tp20-felt-${spot}`}
              >
                {formatChip(chips[spot]!)}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
