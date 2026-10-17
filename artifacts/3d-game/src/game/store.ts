import { useRef, useSyncExternalStore } from "react";
import type { Lang } from "./i18n";
import { INITIAL_PROGRESSION, type ProgressionState } from "./progression";

export type Phase = "betting" | "flying" | "crashed";
export type CrashPanelIndex = 0 | 1 | 2 | 3;

export interface Bet {
  id: string;
  panel: CrashPanelIndex;
  amount: number;
  autoCashOut: number | null;
  cashedOutAt: number | null;
  payout: number; // 0 if lost
  roundId: string;
  multiplier?: number; // crash multiplier of round (recorded after settle)
  ts: number;
}

export interface FakePlayerBet {
  id: string;
  name: string;
  amount: number;
  cashedOutAt: number | null;
  payout: number;
  roundId: string;
}

export interface ActiveRain {
  id: string;
  amountPaise: string;
  maxClaims: number;
  claimedCount: number;
  message: string | null;
  expiresAt: string;
  claimedByMe: boolean;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  ts: number;
  isMe?: boolean;
}

export interface RoundResult {
  houseEdge?: number;
  maxMultiplier?: number;
  id: string;
  crashAt: number;
  serverSeed: string | null; // revealed after the crash
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  ts: number;
}

export interface PanelState {
  selectedRoundId: string | null;
  amount: number;
  autoCashOutEnabled: boolean;
  autoCashOut: number;
  pendingBet: boolean; // queued for next round
  pendingAmount: number; // immutable reserved stake for the pending bet
  activeBetId: string | null; // current round bet
  autoBet: {
    enabled: boolean;
    rounds: number;
    roundsLeft: number;
    stopOnWin: number;
    stopOnLoss: number;
    stopOnBalanceBelow: number;
    stopOnBalanceAbove: number;
    runningProfit: number;
  };
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  multiplier: number;
  amount: number;
  payout: number;
  ts: number;
  isMe?: boolean;
}

export interface Settings {
  theme: "default" | "neon" | "midnight" | "sunset";
  planeSkin: "classic" | "jet" | "rocket" | "ufo" | "paper";
  trailColor: string;
  sound: boolean;
  music: boolean;
  quality: "low" | "medium" | "high";
  language: Lang;
  turbo: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  // Volume for UI navigation sounds (hover/select ticks, dialog swooshes),
  // independent of the in-game SFX slider so players can keep game sounds loud
  // while UI ticks stay quiet (or vice versa).
  uiVolume: number;
  onboarded: boolean;
}

export interface GameState {
  // Which crash game is currently active (lunar | aviator | jetx | ...).
  // The shared engine settles bets against this game's server config +
  // wallet scope; pages set it on mount via setActiveCrashGame().
  activeGameCode: string;
  // wallet
  balance: number;
  lastBonusTs: number | null;
  // round
  phase: Phase;
  multiplier: number;
  roundId: string;
  countdownMs: number; // betting countdown remaining
  countdownTotalMs: number; // full betting window for this round (progress bars)
  flyMs: number; // ms since flying started
  crashAt: number; // current round target multiplier
  // history
  history: number[]; // last ~30 crash multipliers
  rounds: RoundResult[]; // last ~50 round results
  myBets: Bet[]; // last ~100
  // current round bets (live)
  liveBets: FakePlayerBet[];
  // True once we've ever received a real bet over the realtime channel; the
  // engine uses this to suppress the synthetic crowd simulator.
  realLiveBetsActive: boolean;
  lastRealBetTs: number;
  // chat
  chat: ChatMessage[];
  // global all-time leaderboard (seeded with fake players + real wins appended)
  topWins: LeaderboardEntry[];
  // panels
  panels: [PanelState, PanelState, PanelState, PanelState];
  // multiplayer feel
  onlinePlayers: number;
  // Live admin-controlled flag. When true, the game is paused and the player
  // UI shows a "temporarily disabled" overlay. Pushed via the
  // `game-config:lunar` realtime topic.
  gameDisabled: boolean;
  // Inclusive bounds for the auto-cashout multiplier the player may pick.
  // Pulled from the server config so admins can tighten/loosen them live.
  autoCashoutMin: number;
  autoCashoutMax: number;
  // provably fair
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  pastSeeds: { seed: string; hash: string; rotatedAt: number }[];
  // settings
  settings: Settings;
  // When true, the next placeBet() will route the stake through the bonus
  // wallet instead of cash. Persisted across sessions but does not survive a
  // logout. Mirrored in Mines/Plinko/Dice via local component state.
  useBonusForBets: boolean;
  // Promotional free bets (server-granted). Count + fixed stake of the next
  // grant, refreshed via REST and the per-user `free-bets:{userId}` topic.
  freeBetCount: number;
  freeBetNextAmountPaise: string;
  // When true and free bets are available, the next placeBet() consumes one
  // free bet (stake forced server-side to the grant amount, no wallet debit).
  useFreeBetForBets: boolean;
  // Max stake in rupees from the server game config (0 = unknown/no limit).
  maxStakeRupees: number;
  // Currently claimable rain drop shown as a card in chat (null = none).
  activeRain: ActiveRain | null;
  // progression (achievements, missions, XP/level)
  progression: ProgressionState;
}

const initialSettings: Settings = {
  theme: "default",
  planeSkin: "classic",
  trailColor: "#ef4444",
  sound: true,
  music: true,
  quality: "high",
  language: "en",
  turbo: false,
  masterVolume: 0.7,
  sfxVolume: 0.8,
  musicVolume: 0.25,
  // Defaults to the prior SFX level so existing UI-sound loudness is preserved.
  uiVolume: 0.8,
  onboarded: false,
};

const initialPanel = (): PanelState => ({
  amount: 100,
  autoCashOutEnabled: false,
  autoCashOut: 2.0,
  selectedRoundId: null,
  pendingBet: false,
  pendingAmount: 0,
  activeBetId: null,
  autoBet: {
    enabled: false,
    rounds: 10,
    roundsLeft: 0,
    stopOnWin: 0,
    stopOnLoss: 0,
    stopOnBalanceBelow: 0,
    stopOnBalanceAbove: 0,
    runningProfit: 0,
  },
});

// Seeded simulated leaderboard (deterministic so it doesn't shift on reload)
function seedLeaderboard(): LeaderboardEntry[] {
  const fakePlayers = [
    "SkyKing", "AceFlyer", "MoonShot", "RajaCash", "Velocity",
    "NightHawk", "ZenithX", "BoomBaba", "RocketDan", "Aviatrix",
    "PixelPlay", "TurboRani", "GoldenWing", "QuickSilver", "JetSetter",
    "CloudNine", "ThunderBolt", "StarPilot", "MaxFly", "AeroDyne",
  ];
  // Deterministic pseudo-random using a tiny LCG seeded from index
  const rand = (i: number) => {
    let x = (i * 9301 + 49297) % 233280;
    return x / 233280;
  };
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < 25; i++) {
    const r1 = rand(i + 1);
    const r2 = rand(i * 7 + 3);
    const r3 = rand(i * 13 + 11);
    const multiplier = +(2 + r1 * 80).toFixed(2); // 2× – 82×
    const amount = Math.round(50 + r2 * 950);
    entries.push({
      id: `seed_${i}`,
      name: fakePlayers[i % fakePlayers.length],
      multiplier,
      amount,
      payout: +(amount * multiplier).toFixed(2),
      ts: Date.now() - Math.floor(r3 * 7 * 24 * 60 * 60 * 1000),
    });
  }
  return entries.sort((a, b) => b.payout - a.payout);
}

const initialState: GameState = {
  activeGameCode: "jetx",
  balance: 10000,
  lastBonusTs: null,
  phase: "betting",
  multiplier: 1,
  roundId: "init",
  countdownMs: 5000,
  countdownTotalMs: 5000,
  flyMs: 0,
  crashAt: 1,
  history: [],
  rounds: [],
  myBets: [],
  liveBets: [],
  realLiveBetsActive: false,
  lastRealBetTs: 0,
  chat: [],
  topWins: seedLeaderboard(),
  panels: [initialPanel(), initialPanel(), initialPanel(), initialPanel()],
  onlinePlayers: 1100,
  gameDisabled: false,
  autoCashoutMin: 1.01,
  autoCashoutMax: 1000,
  serverSeed: "",
  serverSeedHash: "",
  clientSeed: "",
  nonce: 0,
  pastSeeds: [],
  settings: initialSettings,
  progression: INITIAL_PROGRESSION,
  useBonusForBets: false,
  freeBetCount: 0,
  freeBetNextAmountPaise: "0",
  useFreeBetForBets: false,
  maxStakeRupees: 0,
  activeRain: null,
};

// Legacy key kept as "aviator:v1" to preserve existing player data
const STORAGE_KEY = "aviator:v1";

function loadPersisted(): Partial<GameState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const result: Partial<GameState> = {
      lastBonusTs: data.lastBonusTs ?? null,
      myBets: Array.isArray(data.myBets) ? data.myBets.slice(-200) : [],
      // One-time migration: drop crash history saved before the RNG rework
      // (rngV 2). Older saves contain rounds generated during a misconfigured
      // 50%-house-edge period (flood of 1.00x badges) — misleading to keep.
      history:
        data.rngV >= 2 && Array.isArray(data.history)
          ? data.history.slice(-50)
          : [],
      rounds:
        data.rngV >= 2 && Array.isArray(data.rounds)
          ? data.rounds.slice(-50)
          : [],
      topWins: Array.isArray(data.topWins) && data.topWins.length > 0
        ? data.topWins.slice(0, 100)
        : seedLeaderboard(),
      settings: {
        ...initialSettings,
        ...(data.settings ?? {}),
        // One-time migration: background music became on-by-default (slow
        // ambient loop). Older saves persisted music:false as the old default,
        // not a user choice — flip it once; after that the user's toggle wins.
        ...(data.musicOnByDefaultMigrated ? {} : { music: true }),
      },
      progression: data.progression
        ? {
            ...INITIAL_PROGRESSION,
            ...data.progression,
            stats: { ...INITIAL_PROGRESSION.stats, ...(data.progression.stats ?? {}) },
            achievements: data.progression.achievements ?? {},
            unlockedSkins: Array.isArray(data.progression.unlockedSkins)
              ? data.progression.unlockedSkins
              : INITIAL_PROGRESSION.unlockedSkins,
            unlockedTrails: Array.isArray(data.progression.unlockedTrails)
              ? data.progression.unlockedTrails
              : INITIAL_PROGRESSION.unlockedTrails,
            dailyMissions: Array.isArray(data.progression.dailyMissions)
              ? data.progression.dailyMissions
              : [],
          }
        : INITIAL_PROGRESSION,
    };
    // Only set keys when we have valid persisted values; spreading `undefined`
    // over `initialState` would clobber required defaults (e.g. `panels`) and
    // crash consumers like BetPanel that rely on them being present.
    if (typeof data.balance === "number") {
      result.balance = data.balance;
    }
    if (Array.isArray(data.panels) && data.panels.length >= 2) {
      result.panels = [
        { ...initialPanel(), ...(data.panels[0] ?? {}), selectedRoundId: null, pendingBet: false, pendingAmount: 0, activeBetId: null },
        { ...initialPanel(), ...(data.panels[1] ?? {}), selectedRoundId: null, pendingBet: false, pendingAmount: 0, activeBetId: null },
        { ...initialPanel(), ...(data.panels[2] ?? {}), selectedRoundId: null, pendingBet: false, pendingAmount: 0, activeBetId: null },
        { ...initialPanel(), ...(data.panels[3] ?? {}), selectedRoundId: null, pendingBet: false, pendingAmount: 0, activeBetId: null },
      ];
    }
    return result;
  } catch {
    return {};
  }
}

function persist(state: GameState) {
  try {
    const data = {
      balance: state.balance,
      lastBonusTs: state.lastBonusTs,
      myBets: state.myBets.slice(-200),
      history: state.history.slice(-50),
      rounds: state.rounds.slice(-50),
      topWins: state.topWins.slice(0, 100),
      settings: state.settings,
      musicOnByDefaultMigrated: true,
      rngV: 2,
      progression: state.progression,
      panels: state.panels.map((p) => ({
        amount: p.amount,
        autoCashOutEnabled: p.autoCashOutEnabled,
        autoCashOut: p.autoCashOut,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

let state: GameState = { ...initialState, ...loadPersisted() } as GameState;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist(state);
  }, 200);
}

const persistedKeys = new Set<keyof GameState>([
  "balance", "lastBonusTs", "myBets", "history", "rounds", "topWins", "settings", "progression", "panels",
]);

export const store = {
  getState: () => state,
  setState: (updater: Partial<GameState> | ((s: GameState) => Partial<GameState>)) => {
    const patch = typeof updater === "function" ? updater(state) : updater;
    const changed = (Object.keys(patch) as (keyof GameState)[]).filter(key => !Object.is(state[key], patch[key]));
    if (!changed.length) return;
    state = { ...state, ...patch };
    notify();
    // Live engine ticks can continuously postpone the debounced save.
    // Explicit preferences must survive an immediate reload/navigation.
    if (changed.includes("settings")) persist(state);
    else if (changed.some(key => persistedKeys.has(key))) schedulePersist();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export function useStoreShallow<T extends Record<string, any>>(selector: (s: GameState) => T): T {
  const selected = useRef<T | null>(null);
  return useStore(s => {
    const next = selector(s);
    const previous = selected.current;
    const keys = Object.keys(next);
    if (previous && keys.length === Object.keys(previous).length
      && keys.every(key => Object.prototype.hasOwnProperty.call(previous, key) && Object.is(previous[key], next[key]))) return previous;
    selected.current = next;
    return next;
  });
}
