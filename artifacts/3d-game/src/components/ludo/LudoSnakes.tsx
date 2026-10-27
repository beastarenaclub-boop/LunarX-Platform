import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { LudoDice } from "./LudoDice";
import type { LudoRoll } from "./useLudoRoll";
import { LudoArtwork } from "./LudoArtwork";
const jumps: Record<number, number> = {
  4: 25,
  13: 46,
  33: 49,
  42: 63,
  62: 81,
  74: 92,
  27: 5,
  40: 3,
  54: 31,
  66: 45,
  89: 53,
  99: 41,
};
function xy(cell: number) {
  const n = Math.max(1, cell) - 1,
    row = Math.floor(n / 10),
    col = row % 2 ? 9 - (n % 10) : n % 10;
  return [col * 30 + 15, (9 - row) * 30 + 15];
}
type Game = {
  positions: [number, number];
  turn: number;
  dice: number;
  winner: number | null;
  computer: boolean;
  message: string;
};
export function LudoSnakes({
  userId,
  name,
  onBack,
}: {
  userId: string;
  name: string;
  onBack: () => void;
}) {
  const key = `ludo-snakes:${userId}`;
  const [game, setGame] = useState<Game | null>(() => {
      try {
        const g = JSON.parse(localStorage.getItem(key) || "null");
        return g &&
          g.positions?.length === 2 &&
          g.positions.every(
            (p: number) => Number.isInteger(p) && p >= 0 && p <= 100,
          ) &&
          [0, 1].includes(g.turn)
          ? g
          : null;
      } catch {
        return null;
      }
    }),
    [computer, setComputer] = useState(true),
    [roll, setRoll] = useState<LudoRoll | null>(null),
    [visual, setVisual] = useState<[number, number] | null>(null),
    [busy, setBusy] = useState(false);
  const live = useRef(game),
    locked = useRef(false),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  live.current = game;
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    try {
      if (game) localStorage.setItem(key, JSON.stringify(game));
      else localStorage.removeItem(key);
    } catch {}
  }, [game, key]);
  const later = (fn: () => void, t: number) =>
    timers.current.push(setTimeout(fn, t));
  const play = () => {
    const g = live.current;
    if (!g || g.winner !== null || locked.current) return;
    locked.current = true;
    setBusy(true);
    const bytes = new Uint8Array(1);
    do {
      crypto.getRandomValues(bytes);
    } while (bytes[0] >= 252);
    const dice = (bytes[0] % 6) + 1,
      seat = g.turn,
      token = crypto.randomUUID(),
      reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRoll({ key: token, seat, phase: "rolling", at: Date.now() });
    later(
      () => {
        setRoll({
          key: token,
          seat,
          phase: "landing",
          value: dice,
          at: Date.now(),
        });
        later(
          () => {
            setRoll(null);
            const target = g.positions[seat] + dice,
              next: Game = { ...g, positions: [...g.positions], dice };
            const finish = () => {
              const landing = next.positions[seat];
              next.winner = landing === 100 ? seat : null;
              next.turn = dice === 6 ? seat : 1 - seat;
              next.message =
                target > 100
                  ? "An exact roll is needed to reach 100."
                  : jumps[target]
                    ? `${jumps[target] > target ? "Ladder up" : "Snake slide"}: ${target} → ${landing}`
                    : `${seat === 0 ? name : g.computer ? "Computer" : "Player 2"} rolled ${dice}`;
              setGame(next);
              setVisual(null);
              setBusy(false);
              locked.current = false;
            };
            if (target > 100) {
              finish();
              return;
            }
            let pos = g.positions[seat];
            const step = () => {
              pos++;
              const positions: [number, number] = [...g.positions];
              positions[seat] = pos;
              setVisual(positions);
              if (pos < target) later(step, reduced ? 0 : 110);
              else {
                next.positions[seat] = jumps[target] ?? target;
                later(
                  () => {
                    setVisual([...next.positions]);
                    later(finish, reduced ? 0 : 380);
                  },
                  reduced ? 0 : 180,
                );
              }
            };
            step();
          },
          reduced ? 0 : 240,
        );
      },
      reduced ? 50 : 480,
    );
  };
  useEffect(() => {
    if (game?.computer && game.turn === 1 && game.winner === null && !busy) {
      const t = setTimeout(play, 800);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [game, busy]);
  const names = [name, game?.computer ? "Computer" : "Player 2"];
  return (
    <section
      className="ld-feature-screen ld-snakes-screen"
      aria-label="Snakes and Ladders"
    >
      <header className="ld-feature-header">
        <button aria-label="Back to main menu" onClick={onBack}>
          <ArrowLeft />
        </button>
        <div>
          <strong>SNAKES & LADDERS</strong>
          <small>Free local game · no wallet entry</small>
        </div>
        <LudoArtwork kind="snakes" />
      </header>
      {!game ? (
        <div className="ld-feature-body ld-local-setup">
          <LudoArtwork kind="snakes" />
          <h1>Race to 100</h1>
          <p>
            Climb the ladders, slide down snakes. Land exactly on 100 to win. A
            six gives another turn.
          </p>
          <div className="ld-feature-options">
            <button aria-pressed={computer} onClick={() => setComputer(true)}>
              Computer
            </button>
            <button aria-pressed={!computer} onClick={() => setComputer(false)}>
              Pass n Play
            </button>
          </div>
          <button
            className="ld-feature-primary"
            onClick={() =>
              setGame({
                positions: [0, 0],
                turn: 0,
                dice: 6,
                winner: null,
                computer,
                message: "Roll to begin",
              })
            }
          >
            Start game
          </button>
        </div>
      ) : (
        <div className="ld-feature-body">
          <div className="ld-local-players">
            {names.map((n, i) => (
              <span key={i} className={game.turn === i ? "active" : ""}>
                {n}
                <small>Square {game.positions[i]}</small>
              </span>
            ))}
          </div>
          <svg
            className="ld-snakes-board"
            viewBox="0 0 300 300"
            role="img"
            aria-label="Snakes and Ladders board, squares 1 to 100"
          >
            {Array.from({ length: 100 }, (_, i) => {
              const [x, y] = xy(i + 1);
              return (
                <g key={i}>
                  <rect
                    x={x - 15}
                    y={y - 15}
                    width="30"
                    height="30"
                    fill={i % 2 ? "#d3ead3" : "#fff5c8"}
                    stroke="#a8be99"
                    strokeWidth=".5"
                  />
                  <text x={x - 12} y={y - 5} fontSize="7" fill="#325347">
                    {i + 1}
                  </text>
                </g>
              );
            })}
            {Object.entries(jumps).map(([a, b]) => {
              const from = Number(a),
                [x1, y1] = xy(from),
                [x2, y2] = xy(b),
                dx = x2 - x1,
                dy = y2 - y1,
                len = Math.hypot(dx, dy),
                nx = (-dy / len) * 3,
                ny = (dx / len) * 3;
              return b > from ? (
                <g key={a} stroke="#b27635" strokeWidth="2.5">
                  <path
                    d={`M${x1 + nx} ${y1 + ny}L${x2 + nx} ${y2 + ny}M${x1 - nx} ${y1 - ny}L${x2 - nx} ${y2 - ny}`}
                  />
                  {Array.from({ length: Math.floor(len / 9) }, (_, i) => {
                    const t = (i + 1) / (Math.floor(len / 9) + 1);
                    return (
                      <path
                        key={i}
                        d={`M${x1 + dx * t + nx} ${y1 + dy * t + ny}l${-nx * 2} ${-ny * 2}`}
                      />
                    );
                  })}
                </g>
              ) : (
                <g key={a}>
                  <path
                    d={`M${x1} ${y1}C${x1 + 30} ${y1 + 10},${x2 - 25} ${y2 - 10},${x2} ${y2}`}
                    fill="none"
                    stroke={from % 2 ? "#dc6643" : "#479b60"}
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                  <ellipse
                    cx={x1}
                    cy={y1}
                    rx="5"
                    ry="7"
                    fill={from % 2 ? "#dc6643" : "#479b60"}
                  />
                  <circle cx={x1 - 2} cy={y1 - 3} r="1" fill="white" />
                  <circle cx={x1 + 2} cy={y1 - 3} r="1" fill="white" />
                </g>
              );
            })}
            {(visual ?? game.positions).map((pos, i) => {
              const [x, y] = xy(pos);
              return (
                <g
                  key={i}
                  className="ld-snake-token"
                  transform={`translate(${x + (i === 0 ? -5 : 5)} ${y + 3})`}
                >
                  <circle
                    r="8"
                    fill={i === 0 ? "#188de6" : "#ef4752"}
                    stroke="#fff"
                    strokeWidth="2"
                  />
                  <text
                    textAnchor="middle"
                    y="3"
                    fontSize="8"
                    fontWeight="900"
                    fill="#fff"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
          <p role="status">
            {game.winner === null
              ? game.message
              : `${names[game.winner]} wins!`}
          </p>
          {game.winner === null ? (
            <button
              className="ld-local-roll"
              onClick={play}
              disabled={busy || (game.computer && game.turn === 1)}
              aria-label="Roll dice"
            >
              <LudoDice value={game.dice} roll={roll} />
              <span>
                {game.computer && game.turn === 1
                  ? "Computer's turn"
                  : `${names[game.turn]} · Roll`}
              </span>
            </button>
          ) : (
            <button
              className="ld-feature-primary"
              onClick={() => setGame(null)}
            >
              Play again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
