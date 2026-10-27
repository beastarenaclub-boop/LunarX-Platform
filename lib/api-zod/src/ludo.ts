/** Ludo Live rules v1. All money is integer paise; only the server changes a match. */
export const LUDO = {
  entries: [1000, 5000, 10000, 50000],
  commissionBps: 1000,
  queueMs: 20000,
  privateQueueMs: 300000,
  turnMs: 10000,
  botMs: 1000,
  maxMatchMs: 600000,
  maxAutoRolls: 5,
  emojiPaise: 500,
} as const;
export const LUDO_COLORS = ["red", "green", "yellow", "blue"] as const;
export type LudoColor = (typeof LUDO_COLORS)[number];
export type LudoVariant = "classic" | "quick" | "team";
export type LudoMode = "online" | "computer" | "private";
export type LudoJoin = {
  capacity: 2 | 4;
  entryPaise: number;
  requestId: string;
  mode?: LudoMode;
  variant?: LudoVariant;
  roomCode?: string;
};
export const LUDO_VARIANTS = {
  classic: {
    name: "Classic",
    description: "Bring all four tokens home to win.",
  },
  quick: {
    name: "Quick",
    description: "One token starts outside. First token home wins.",
  },
  team: {
    name: "Team Up",
    description:
      "Opposite seats are partners. Bring all eight tokens home; split the team prize equally.",
  },
} as const;
export type LudoRoomPreview = {
  code: string;
  capacity: 2 | 4;
  entryPaise: string;
  prizePaise: string;
  variant: LudoVariant;
  joined: number;
  expiresAt: number;
};
export type LudoPlayer = {
  seat: number;
  name: string;
  color: LudoColor;
  kind: "human" | "computer";
  tokens: number[];
  forfeited: boolean;
  auto: boolean;
  missedRolls?: number;
  exitReason?: "left" | "inactive";
};
export type LudoState = {
  variant?: LudoVariant;
  roomCode?: string;
  players: (LudoPlayer | null)[];
  turn: number;
  phase: "roll" | "move";
  dice: number | null;
  sixes: number;
  winner: number | null;
  winners?: number[];
  rollNonce: number;
  last: {
    text: string;
    seat: number;
    dice?: number;
    token?: number;
    captured?: number;
  } | null;
};
export type LudoMatch = {
  mode?: LudoMode;
  id: string;
  status: "waiting" | "playing" | "finished" | "cancelled";
  capacity: 2 | 4;
  entryPaise: string;
  prizePaise: string;
  commissionPaise: string;
  commissionBps: number;
  version: number;
  you: number;
  deadline: number;
  startedAt: number | null;
  endsAt: number | null;
  payoutPaise: string;
  state: LudoState;
  legalTokens: number[];
  commitment: string;
  seed: string | null;
  reason: string | null;
};
export type LudoTable = {
  serverNow: number;
  balancePaise: string;
  enabled: boolean;
  entries: number[];
  match: LudoMatch | null;
  recent: {
    id: string;
    capacity: number;
    entryPaise: string;
    payoutPaise: string;
    result: string;
    at: number;
  }[];
};
export type LudoAction = {
  requestId: string;
  version: number;
  type: "roll" | "move" | "leave";
  token?: number;
};
export const LUDO_EMOJIS = [
  { id: "smile", glyph: "😄", name: "Smile" },
  { id: "laugh", glyph: "😂", name: "Laugh" },
  { id: "wink", glyph: "😉", name: "Wink" },
  { id: "cool", glyph: "😎", name: "Cool" },
  { id: "wow", glyph: "😮", name: "Wow" },
  { id: "cry", glyph: "😭", name: "Cry" },
  { id: "angry", glyph: "😤", name: "Angry" },
  { id: "heart", glyph: "❤️", name: "Heart" },
  { id: "fire", glyph: "🔥", name: "Fire" },
  { id: "clap", glyph: "👏", name: "Clap" },
  { id: "thumbs", glyph: "👍", name: "Thumbs up" },
  { id: "pray", glyph: "🙏", name: "Good luck" },
  { id: "crown", glyph: "👑", name: "Crown" },
  { id: "trophy", glyph: "🏆", name: "Trophy" },
  { id: "party", glyph: "🎉", name: "Celebrate" },
  { id: "dice", glyph: "🎲", name: "Dice" },
  { id: "rocket", glyph: "🚀", name: "Rocket" },
  { id: "eyes", glyph: "👀", name: "Watching" },
  { id: "handshake", glyph: "🤝", name: "Good game" },
  { id: "sleep", glyph: "😴", name: "Sleepy" },
  { id: "wave", glyph: "👋", name: "Hello" },
  { id: "star", glyph: "🌟", name: "Star" },
  { id: "hundred", glyph: "💯", name: "Perfect" },
  { id: "broken", glyph: "💔", name: "Heartbreak" },
] as const;
export type LudoChatInput = { requestId: string } & (
  | { kind: "text"; text: string }
  | { kind: "emoji"; emojiId: string }
);
export type LudoChatMessage = {
  id: string;
  seat: number;
  name: string;
  kind: "text" | "emoji";
  text: string;
  emojiId: string | null;
  costPaise: string;
  at: number;
};
export type LudoChat = {
  messages: LudoChatMessage[];
  emojiPaise: number;
  canSend: boolean;
  balancePaise: string;
};
export const ludoColors = (capacity: number): LudoColor[] =>
  capacity === 2 ? ["red", "yellow"] : [...LUDO_COLORS];
export const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
export const ludoOffset = (color: LudoColor) => LUDO_COLORS.indexOf(color) * 13;
// [row, column] on a 15 x 15 board, clockwise from red's start.
export const LUDO_PATH: [number, number][] = [
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12],
  [6, 13],
  [6, 14],
  [7, 14],
  [8, 14],
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  [14, 8],
  [14, 7],
  [14, 6],
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
  [7, 0],
  [6, 0],
];
export function ludoPosition(
  color: LudoColor,
  progress: number,
  token: number,
): [number, number] {
  if (progress < 0) {
    const [r, c] = (
      { red: [0, 0], green: [0, 9], yellow: [9, 9], blue: [9, 0] } as const
    )[color];
    return [r + (token < 2 ? 1.7 : 3.3), c + (token % 2 ? 3.3 : 1.7)];
  }
  if (progress <= 50) return LUDO_PATH[(ludoOffset(color) + progress) % 52];
  const n = progress - 50;
  return color === "red"
    ? [7, n]
    : color === "green"
      ? [n, 7]
      : color === "yellow"
        ? [7, 14 - n]
        : [14 - n, 7];
}
