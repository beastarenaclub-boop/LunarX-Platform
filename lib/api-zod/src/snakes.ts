export const SNAKE_JUMPS: Readonly<Record<number, number>> = {
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
export const SNAKE_COLORS = [
  "#22aaf3",
  "#f14e51",
  "#f4c529",
  "#36be7c",
] as const;
export type SnakeTheme = "classic" | "nature" | "disco";
export type SnakePlayer = {
  id: string;
  name: string;
  kind: "human" | "computer";
  position: number;
  left?: boolean;
};
export type SnakeMove = {
  seat: number;
  from: number;
  roll: number;
  land: number;
  to: number;
  kind: "step" | "ladder" | "snake" | "overshoot";
};
export type SnakeState = {
  players: SnakePlayer[];
  turn: number;
  dice: number | null;
  winner: number | null;
  sequence: number;
  last: SnakeMove | null;
};
export function newSnakeGame(
  players: Pick<SnakePlayer, "id" | "name" | "kind">[],
): SnakeState {
  if (![2, 3, 4].includes(players.length))
    throw Error("Choose two to four players");
  return {
    players: players.map((p) => ({ ...p, position: 0 })),
    turn: 0,
    dice: null,
    winner: null,
    sequence: 0,
    last: null,
  };
}
export function advanceSnake(state: SnakeState, roll: number): SnakeState {
  if (state.winner !== null || !Number.isInteger(roll) || roll < 1 || roll > 6)
    throw Error("Invalid roll");
  const seat = state.turn,
    from = state.players[seat].position,
    target = from + roll,
    land = target > 100 ? from : target,
    to = target > 100 ? from : (SNAKE_JUMPS[land] ?? land);
  const next = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    dice: roll,
    sequence: state.sequence + 1,
  };
  next.players[seat].position = to;
  next.last = {
    seat,
    from,
    roll,
    land,
    to,
    kind:
      target > 100
        ? "overshoot"
        : to > land
          ? "ladder"
          : to < land
            ? "snake"
            : "step",
  };
  if (to === 100) next.winner = seat;
  else if (roll !== 6) {
    do {
      next.turn = (next.turn + 1) % next.players.length;
    } while (next.players[next.turn].left);
  }
  return next;
}
export function validSnakeState(value: unknown): value is SnakeState {
  const s = value as SnakeState;
  return (
    !!s &&
    Array.isArray(s.players) &&
    [2, 3, 4].includes(s.players?.length) &&
    Number.isInteger(s.sequence) &&
    s.sequence >= 0 &&
    Number.isInteger(s.turn) &&
    s.turn >= 0 &&
    s.turn < s.players.length &&
    (s.dice === null ||
      (Number.isInteger(s.dice) && s.dice >= 1 && s.dice <= 6)) &&
    (s.last === null ||
      (!!s.last &&
        Number.isInteger(s.last.seat) &&
        s.last.seat >= 0 &&
        s.last.seat < s.players.length &&
        [s.last.from, s.last.land, s.last.to].every(
          (n) => Number.isInteger(n) && n >= 0 && n <= 100,
        ) &&
        Number.isInteger(s.last.roll) &&
        s.last.roll >= 1 &&
        s.last.roll <= 6 &&
        ["step", "ladder", "snake", "overshoot"].includes(s.last.kind))) &&
    (s.winner === null ||
      (Number.isInteger(s.winner) &&
        s.winner >= 0 &&
        s.winner < s.players.length)) &&
    s.players.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        ["human", "computer"].includes(p.kind) &&
        Number.isInteger(p.position) &&
        p.position >= 0 &&
        p.position <= 100,
    ) &&
    (s.winner === null ||
      s.players[s.winner].position === 100 ||
      s.players.filter((p) => !p.left).length === 1)
  );
}
export function snakeCell(cell: number): [number, number] {
  if (cell === 0) return [25, 525];
  const row = Math.floor((cell - 1) / 10),
    col = row % 2 ? 9 - ((cell - 1) % 10) : (cell - 1) % 10;
  return [col * 50 + 25, (9 - row) * 50 + 25];
}
/** Same curve for the painted snake and its token's slide. */
export function snakeCurve(
  from: number,
  to: number,
  t: number,
): [number, number] {
  const a = snakeCell(from),
    b = snakeCell(to),
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy),
    offset = Math.sin(t * Math.PI * 4) * Math.min(28, length * 0.13);
  return [
    a[0] + dx * t - (dy / length) * offset,
    a[1] + dy * t + (dx / length) * offset,
  ];
}
export function snakePath(from: number, to: number) {
  return Array.from({ length: 81 }, (_, i) => {
    const [x, y] = snakeCurve(from, to, i / 80);
    return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}
export type SnakeRoom = {
  id: string;
  code: string | null;
  mode: "online" | "private";
  capacity: number;
  status: "waiting" | "playing" | "finished" | "cancelled";
  version: number;
  state: SnakeState;
  you: number;
  deadline: number;
};
