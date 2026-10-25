import { useId, type CSSProperties } from "react";
import { Bot, Gift, Globe2 } from "lucide-react";
import { LUDO, type LudoColor, type LudoPlayer } from "@workspace/api-zod/ludo";
import { COLORS } from "./LudoBoard";
import { LudoDice } from "./LudoDice";
import { LudoPin } from "./LudoPin";
import type { LudoRoll } from "./useLudoRoll";

/** Original player artwork; names and computer labels always come from the seat. */
function Portrait({ computer, color }: { computer: boolean; color: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className="ld-match-portrait">
      <defs>
        <linearGradient id={id} x2="1" y2="1">
          <stop stopColor="#33a7e0" />
          <stop offset="1" stopColor="#052c65" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M0 0H80V80H0Z" />
      <path
        d="M0 60 80 14M0 80 80 34"
        stroke="#7edaff"
        strokeWidth="12"
        opacity=".16"
      />
      {computer ? (
        <>
          <path
            d="M16 80V64Q16 55 30 54H50Q64 55 64 64V80"
            fill="#d7edf5"
            stroke="#14334e"
            strokeWidth="2"
          />
          <path d="M40 14V7" stroke="#ffdd72" strokeWidth="3" />
          <circle cx="40" cy="7" r="4" fill="#ffcc38" />
          <rect
            x="13"
            y="24"
            width="54"
            height="23"
            rx="5"
            fill="#799bad"
            stroke="#16374e"
            strokeWidth="2"
          />
          <rect
            x="19"
            y="16"
            width="42"
            height="39"
            rx="11"
            fill="#eef9ff"
            stroke="#284656"
            strokeWidth="2"
          />
          <rect x="24" y="25" width="32" height="15" rx="6" fill="#063f66" />
          <circle cx="32" cy="32" r="3" fill="#72efff" />
          <circle cx="48" cy="32" r="3" fill="#72efff" />
          <path
            d="M34 46Q40 50 46 46"
            stroke="#236482"
            strokeWidth="2"
            fill="none"
          />
          <circle
            cx="40"
            cy="66"
            r="6"
            fill={color}
            stroke="#fff"
            strokeWidth="2"
          />
        </>
      ) : (
        <>
          <path
            d="M8 80V68Q12 57 28 54H52Q68 57 72 68V80"
            fill={color}
            stroke="#153b66"
            strokeWidth="2"
          />
          <path d="M31 46V57L40 63L49 57V46" fill="#d99561" />
          <ellipse cx="40" cy="33" rx="17" ry="22" fill="#f1b77c" />
          <path
            d="M22 36Q16 13 32 10Q52 2 60 23L56 38L51 23Q40 30 27 23L26 38Z"
            fill="#26314b"
          />
          <path
            d="M29 33h6m10 0h6"
            stroke="#51352e"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M35 44Q40 48 45 44"
            stroke="#b1684e"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M29 55 40 63 32 69 25 57M51 55 40 63 48 69 55 57"
            fill="#fff2cc"
          />
          <path
            d="m59 5 4 6 6-4-2 10H56L54 7Z"
            fill="#ffda45"
            stroke="#ad6b0c"
          />
        </>
      )}
    </svg>
  );
}

export function LudoMatchPlayer({
  p,
  color,
  active,
  you,
  dice,
  remaining,
  disabled,
  roll,
  onRoll,
  onEmojis,
  dockSide,
}: {
  p: LudoPlayer | null;
  color: LudoColor;
  active: boolean;
  you: boolean;
  dice?: number;
  remaining: number;
  disabled: boolean;
  roll?: LudoRoll | null;
  onRoll: () => void;
  onEmojis: () => void;
  dockSide?: "left" | "right";
}) {
  const home = p?.tokens.filter((t) => t === 56).length ?? 0;
  return (
    <div
      className={`ld-player ld-seat-${color}${active ? " ld-player-active" : ""}${p?.forfeited ? " ld-left" : ""}`}
      data-you={you || undefined}
      data-dock-side={dockSide}
      style={
        {
          "--seat": COLORS[color],
          "--turn": `${active ? Math.min(100, (remaining / (p?.kind === "computer" ? LUDO.botMs / 1000 : LUDO.turnMs / 1000)) * 100) : 0}%`,
        } as CSSProperties
      }
    >
      <svg
        className="ld-player-plate"
        viewBox="0 0 132 108"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M8 2H81Q88 2 90 12L92 18Q93 23 103 23H124Q130 23 130 30V85Q130 92 123 92H92Q84 92 82 100Q81 106 73 106H8Q2 106 2 99V9Q2 2 8 2Z"
          fill="#07599ad9"
          stroke="#554512"
          strokeWidth="4"
        />
        <path
          d="M8 2H81Q88 2 90 12L92 18Q93 23 103 23H124Q130 23 130 30V85Q130 92 123 92H92Q84 92 82 100Q81 106 73 106H8Q2 106 2 99V9Q2 2 8 2Z"
          fill="none"
          stroke="#ffe275"
          strokeWidth="1.8"
        />
        <path
          d="M8 99V9H78M100 28H124V84H93"
          fill="none"
          stroke="#64b8f1"
          strokeWidth="1"
        />
      </svg>
      <span className="ld-player-kind">
        {p?.kind === "computer" ? <Bot /> : <Globe2 />}
        {p?.forfeited
          ? "LEFT"
          : p?.kind === "computer"
            ? "COMPUTER"
            : you
              ? "YOU"
              : "ONLINE"}
      </span>
      <div className="ld-player-controls">
        <span className="ld-avatar">
          <Portrait computer={p?.kind === "computer"} color={COLORS[color]} />
        </span>
        {you ? (
          <button
            className="ld-roll"
            disabled={disabled}
            onClick={onRoll}
            aria-label="Roll dice"
          >
            <LudoDice value={dice} roll={roll} />
            <span>
              {roll
                ? "ROLLING"
                : active && !disabled
                  ? "ROLL"
                  : active
                    ? `${remaining}s`
                    : "DICE"}
            </span>
          </button>
        ) : (
          <div
            className="ld-other-dice"
            aria-label={
              active
                ? `Opponent turn, ${remaining} seconds`
                : "Waiting for turn"
            }
          >
            {(dice || roll || active) && <LudoDice value={dice} roll={roll} />}
            {active && <small>{remaining}s</small>}
          </div>
        )}
        <span className="ld-progress" aria-label={`${home} of 4 tokens home`}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i < home ? "ld-home" : ""} />
          ))}
        </span>
      </div>
      <div className="ld-player-name">
        <strong title={p?.name}>
          {p?.name || "Finding player…"}
          {you && <em>YOU</em>}
        </strong>
        <small>
          {p?.forfeited
            ? "Left match"
            : p?.kind === "computer"
              ? "Computer"
              : `${home}/4 home`}
        </small>
        {you && !!p?.missedRolls && !p.forfeited && (
          <small className="ld-auto-warning">
            Auto {p.missedRolls}/{LUDO.maxAutoRolls} · roll to stay
          </small>
        )}
      </div>
      <span className="ld-seat-pin">
        <LudoPin color={COLORS[color]} />
      </span>
      {!you && !p?.forfeited && (
        <button
          className="ld-player-gift"
          aria-label={`Open match emojis · ${p?.name || "player"}`}
          title="Match emojis · ₹5 each"
          onClick={onEmojis}
        >
          <Gift />
        </button>
      )}
    </div>
  );
}
