import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  LUDO_COLORS,
  type LudoState,
  type LudoMatch,
  type LudoVariant,
} from "@workspace/api-zod/ludo";
import {
  legalTokens,
  rollDie,
  moveToken,
} from "@workspace/api-zod/ludo-engine";
import { LudoBoard, COLORS } from "./LudoBoard";
import { LudoDice } from "./LudoDice";
import type { LudoRoll } from "./useLudoRoll";
import { useLudoMovement } from "./useLudoMovement";
import { useLudoAudio } from "./useLudoAudio";
import { LudoArtwork } from "./LudoArtwork";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Saved = { id: string; version: number; state: LudoState };
function readGame(key: string): Saved | null {
  try {
    const x = JSON.parse(localStorage.getItem(key) || "null");
    if (
      !x ||
      typeof x.id !== "string" ||
      !Number.isInteger(x.version) ||
      ![2, 4].includes(x.state?.players?.length) ||
      !Number.isInteger(x.state.turn) ||
      x.state.turn < 0 ||
      x.state.turn >= x.state.players.length ||
      !["roll", "move"].includes(x.state.phase) ||
      !x.state.players.every(
        (p: any, i: number) =>
          p &&
          p.seat === i &&
          typeof p.name === "string" &&
          LUDO_COLORS.includes(p.color) &&
          p.tokens?.length === 4 &&
          p.tokens.every((t: any) => Number.isInteger(t) && t >= -1 && t <= 56),
      )
    )
      return null;
    return x;
  } catch {
    return null;
  }
}
function die() {
  const b = new Uint8Array(1);
  do {
    crypto.getRandomValues(b);
  } while (b[0] >= 252);
  return (b[0] % 6) + 1;
}
export function LudoLocalPlay({
  userId,
  name,
  onBack,
}: {
  userId: string;
  name: string;
  onBack: () => void;
}) {
  const key = `ludo-pass-play-v1:${userId}`;
  const [saved, setSaved] = useState<Saved | null>(() => readGame(key));
  const [capacity, setCapacity] = useState<2 | 4>(2),
    [variant, setVariant] = useState<LudoVariant>("classic"),
    [names, setNames] = useState([name, "Player 2", "Player 3", "Player 4"]);
  const [roll, setRoll] = useState<LudoRoll | null>(null),
    [animating, setAnimating] = useState(false),
    [readySeat, setReadySeat] = useState<number | null>(null),
    [reset, setReset] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    try {
      if (saved) localStorage.setItem(key, JSON.stringify(saved));
      else localStorage.removeItem(key);
    } catch {}
  }, [key, saved]);
  const match = useMemo<LudoMatch | null>(
    () =>
      saved
        ? {
            id: saved.id,
            version: saved.version,
            state: saved.state,
            mode: "computer",
            status: saved.state.winner === null ? "playing" : "finished",
            capacity: saved.state.players.length as 2 | 4,
            you: saved.state.turn,
            entryPaise: "0",
            prizePaise: "0",
            commissionPaise: "0",
            commissionBps: 0,
            deadline: 0,
            startedAt: null,
            endsAt: null,
            payoutPaise: "0",
            legalTokens: legalTokens(saved.state),
            commitment: "",
            seed: null,
            reason: null,
          }
        : null,
    [saved],
  );
  const audio = useLudoAudio(`${userId}:local`, null, Date.now());
  const movement = useLudoMovement(match, !!roll, audio.step, audio.moveEnd);
  const blocked = animating || !!roll || !!movement?.busy;
  const state = saved?.state,
    view = movement?.state ?? state;
  const later = (fn: () => void, ms: number) => {
    timers.current.push(
      setTimeout(() => {
        if (alive.current) fn();
      }, ms),
    );
  };
  const start = () => {
    setReadySeat(0);
    setSaved({
      id: crypto.randomUUID(),
      version: 0,
      state: {
        variant,
        players: Array.from({ length: capacity }, (_, seat) => ({
          seat,
          name: names[seat].trim().slice(0, 24) || `Player ${seat + 1}`,
          color: capacity === 2 ? LUDO_COLORS[seat * 2] : LUDO_COLORS[seat],
          kind: "human",
          tokens: variant === "quick" ? [0, -1, -1, -1] : [-1, -1, -1, -1],
          forfeited: false,
          auto: false,
        })),
        turn: 0,
        phase: "roll",
        dice: null,
        sixes: 0,
        winner: null,
        rollNonce: 0,
        last: null,
      },
    });
  };
  const throwDice = () => {
    if (
      !saved ||
      blocked ||
      state!.phase !== "roll" ||
      readySeat !== state!.turn
    )
      return;
    audio.unlock();
    audio.roll();
    const value = die(),
      seat = state!.turn,
      k = crypto.randomUUID();
    setRoll({ key: k, seat, phase: "rolling", at: Date.now() });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    later(
      () => {
        setRoll({ key: k, seat, phase: "landing", value, at: Date.now() });
        audio.land(value);
        later(
          () => {
            setRoll(null);
            const next = structuredClone(saved);
            rollDie(next.state, value);
            next.version++;
            setSaved(next);
            if (next.state.turn !== seat) setReadySeat(null);
          },
          reduced ? 30 : 260,
        );
      },
      reduced ? 30 : 520,
    );
  };
  const move = (token: number) => {
    if (
      !saved ||
      blocked ||
      readySeat !== state!.turn ||
      !legalTokens(state!).includes(token)
    )
      return;
    const before = state!.players[state!.turn]!.tokens[token],
      next = structuredClone(saved);
    moveToken(next.state, token);
    next.version++;
    setAnimating(true);
    setSaved(next);
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 80
      : (before < 0 ? 1 : state!.dice!) * 120 + 250;
    later(() => {
      setAnimating(false);
      if (next.state.turn !== state!.turn) setReadySeat(null);
    }, ms);
  };
  return (
    <section
      className="ld-local-play"
      aria-label="Pass n Play"
      onPointerDownCapture={audio.unlock}
    >
      <header className="ld-feature-header">
        <button onClick={onBack} aria-label="Back to main menu">
          <ArrowLeft />
        </button>
        <div>
          <strong>PASS N PLAY</strong>
          <small>One device · no entry fee</small>
        </div>
        <button
          onClick={audio.toggleSound}
          aria-label={audio.sound ? "Mute sound" : "Enable sound"}
        >
          {audio.sound ? <Volume2 /> : <VolumeX />}
        </button>
      </header>
      {!saved ? (
        <div className="ld-local-setup">
          <LudoArtwork kind="pass" />
          <h1>Bring everyone to the board</h1>
          <p>Take turns on this device. Your game saves automatically.</p>
          <div className="ld-feature-options">
            {([2, 4] as const).map((n) => (
              <button
                key={n}
                aria-pressed={capacity === n}
                onClick={() => {
                  setCapacity(n);
                  if (n === 2 && variant === "team") setVariant("classic");
                }}
              >
                {n} players
              </button>
            ))}
          </div>
          <div className="ld-feature-options">
            {(["classic", "quick", "team"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={variant === v}
                disabled={v === "team" && capacity !== 4}
                onClick={() => setVariant(v)}
              >
                {v === "team" ? "Team Up" : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="ld-local-names">
            {names.slice(0, capacity).map((n, i) => (
              <label key={i}>
                Player {i + 1}
                <input
                  aria-label={`Player ${i + 1} name`}
                  value={n}
                  maxLength={24}
                  onChange={(e) =>
                    setNames((old) =>
                      old.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          {variant === "team" && <p>Players 1 + 3 versus Players 2 + 4.</p>}
          <button className="ld-feature-primary" onClick={start}>
            Start game
          </button>
        </div>
      ) : (
        <>
          <div className="ld-local-players">
            {state!.players.map((p) => (
              <span
                key={p!.seat}
                className={state!.turn === p!.seat ? "active" : ""}
                style={
                  { "--seat-color": COLORS[p!.color] } as React.CSSProperties
                }
              >
                <i />
                {p!.name}
                <small>{p!.tokens.filter((t) => t === 56).length}/4 home</small>
              </span>
            ))}
          </div>
          <div className="ld-local-board">
            <LudoBoard
              state={view!}
              you={state!.turn}
              legal={blocked ? [] : legalTokens(state!)}
              disabled={blocked || readySeat !== state!.turn}
              moving={movement?.moving}
              onMove={move}
            />
          </div>
          <div className="ld-local-controls">
            <p role="status">
              {state!.winner !== null
                ? `${state!.winners?.map((i) => state!.players[i]!.name).join(" & ") || state!.players[state!.winner]!.name} wins!`
                : state!.last?.text ||
                  `${state!.players[0]!.name}, roll to begin`}
            </p>
            {state!.winner !== null ? (
              <button
                className="ld-feature-primary"
                onClick={() => setReset(true)}
              >
                Play again
              </button>
            ) : readySeat !== state!.turn && !blocked ? (
              <button
                className="ld-feature-primary"
                onClick={() => setReadySeat(state!.turn)}
              >
                Pass to {state!.players[state!.turn]!.name} · Ready
              </button>
            ) : (
              <div className="ld-local-actions">
                <button
                  className="ld-local-roll"
                  onClick={throwDice}
                  disabled={blocked || state!.phase !== "roll"}
                  aria-label="Roll dice"
                >
                  <LudoDice value={state!.last?.dice} roll={roll} />
                  <span>ROLL</span>
                </button>
                <div>
                  {state!.phase === "move" && !blocked ? (
                    <>
                      <strong>Choose a token</strong>
                      <div className="ld-feature-options">
                        {legalTokens(state!).map((i) => (
                          <button key={i} onClick={() => move(i)}>
                            Token {i + 1}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <strong>
                      {roll
                        ? "Rolling…"
                        : blocked
                          ? "Moving…"
                          : `${state!.players[state!.turn]!.name}'s turn`}
                    </strong>
                  )}
                </div>
              </div>
            )}
            <button className="ld-feature-text" onClick={() => setReset(true)}>
              <RotateCcw size={15} /> New game
            </button>
          </div>
        </>
      )}
      <Dialog open={reset} onOpenChange={setReset}>
        <DialogContent className="ld-modal">
          <DialogTitle>Start a new local game?</DialogTitle>
          <DialogDescription>
            Your saved Pass n Play game will be replaced. There is no wallet
            charge.
          </DialogDescription>
          <button
            className="ld-feature-primary"
            onClick={() => {
              timers.current.forEach(clearTimeout);
              setSaved(null);
              setRoll(null);
              setAnimating(false);
              setReset(false);
            }}
          >
            New game
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
