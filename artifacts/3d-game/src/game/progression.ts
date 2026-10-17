import type { Settings } from "./store";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
}

export interface MissionTemplate {
  id: string;
  title: string;
  description: string;
  goal: number;
  xp: number;
  metric: MissionMetric;
  threshold?: number;
}

export type MissionMetric =
  | "betsPlaced"
  | "wins"
  | "winsAt2x"
  | "winsAt5x"
  | "winsAt10x"
  | "profit"
  | "rounds"
  | "earlyCashouts";

export interface MissionInstance {
  id: string;
  templateId: string;
  title: string;
  description: string;
  goal: number;
  xp: number;
  metric: MissionMetric;
  threshold?: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface ProgressionStats {
  totalRounds: number;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  consecutiveWins: number;
  bestConsecutiveWins: number;
  biggestWinProfit: number;
  biggestMultiplier: number;
}

export interface Reward {
  level: number;
  kind: "skin" | "trail";
  value: string;
  label: string;
}

export interface ProgressionState {
  xp: number;
  level: number;
  totalXp: number;
  stats: ProgressionStats;
  achievements: Record<string, number>; // id -> unlocked timestamp
  unlockedSkins: Settings["planeSkin"][];
  unlockedTrails: string[];
  dailyMissions: MissionInstance[];
  dailyMissionsRolledAt: number | null;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_bet", title: "First Flight", description: "Place your first bet", icon: "Plane", xp: 25 },
  { id: "first_win", title: "First Cashout", description: "Cash out a winning bet", icon: "Coins", xp: 50 },
  { id: "cashout_2x", title: "Doubler", description: "Cash out at 2× or higher", icon: "TrendingUp", xp: 50 },
  { id: "cashout_5x", title: "High Flyer", description: "Cash out at 5× or higher", icon: "Rocket", xp: 100 },
  { id: "cashout_10x", title: "Stratosphere", description: "Cash out at 10× or higher", icon: "Sparkles", xp: 250 },
  { id: "cashout_50x", title: "Moonshot", description: "Cash out at 50× or higher", icon: "Star", xp: 1000 },
  { id: "streak_3", title: "Hat Trick", description: "Win 3 cashouts in a row", icon: "Flame", xp: 75 },
  { id: "streak_5", title: "On Fire", description: "Win 5 cashouts in a row", icon: "Flame", xp: 200 },
  { id: "streak_10", title: "Unstoppable", description: "Win 10 cashouts in a row", icon: "Zap", xp: 600 },
  { id: "big_win_1k", title: "Big Score", description: "Profit 1,000 ₹ in a single round", icon: "Trophy", xp: 100 },
  { id: "big_win_10k", title: "Whale", description: "Profit 10,000 ₹ in a single round", icon: "Trophy", xp: 500 },
  { id: "rounds_10", title: "Getting Started", description: "Play 10 rounds", icon: "Target", xp: 30 },
  { id: "rounds_100", title: "Regular", description: "Play 100 rounds", icon: "Target", xp: 150 },
  { id: "rounds_500", title: "Veteran", description: "Play 500 rounds", icon: "Award", xp: 750 },
  { id: "level_5", title: "Pilot", description: "Reach level 5", icon: "Medal", xp: 100 },
  { id: "level_10", title: "Captain", description: "Reach level 10", icon: "Medal", xp: 250 },
  { id: "level_25", title: "Ace", description: "Reach level 25", icon: "Crown", xp: 1000 },
];

export const MISSION_TEMPLATES: MissionTemplate[] = [
  { id: "place_5", title: "Warm Up", description: "Place 5 bets", goal: 5, xp: 30, metric: "betsPlaced" },
  { id: "place_15", title: "Active Player", description: "Place 15 bets", goal: 15, xp: 80, metric: "betsPlaced" },
  { id: "win_3", title: "Winner", description: "Win 3 cashouts", goal: 3, xp: 50, metric: "wins" },
  { id: "win_5", title: "Lucky Streak", description: "Win 5 cashouts", goal: 5, xp: 90, metric: "wins" },
  { id: "win_2x_3", title: "Patient", description: "Cash out at 2×+ three times", goal: 3, xp: 70, metric: "winsAt2x", threshold: 2 },
  { id: "win_5x_2", title: "Bold", description: "Cash out at 5×+ twice", goal: 2, xp: 120, metric: "winsAt5x", threshold: 5 },
  { id: "win_10x_1", title: "Daredevil", description: "Cash out at 10×+ once", goal: 1, xp: 200, metric: "winsAt10x", threshold: 10 },
  { id: "profit_500", title: "Pocket Money", description: "Earn 500 ₹ in profit", goal: 500, xp: 60, metric: "profit" },
  { id: "profit_2000", title: "Solid Day", description: "Earn 2,000 ₹ in profit", goal: 2000, xp: 150, metric: "profit" },
  { id: "rounds_10", title: "Spectator", description: "Watch 10 rounds finish", goal: 10, xp: 30, metric: "rounds" },
  { id: "early_3", title: "Safe Pilot", description: "Cash out before 1.5× three times", goal: 3, xp: 50, metric: "earlyCashouts", threshold: 1.5 },
];

export const LEVEL_REWARDS: Reward[] = [
  { level: 2, kind: "trail", value: "#3b82f6", label: "Blue Trail" },
  { level: 3, kind: "skin", value: "jet", label: "Jet" },
  { level: 5, kind: "trail", value: "#22c55e", label: "Green Trail" },
  { level: 7, kind: "skin", value: "rocket", label: "Rocket" },
  { level: 10, kind: "trail", value: "#a855f7", label: "Purple Trail" },
  { level: 12, kind: "skin", value: "ufo", label: "UFO" },
  { level: 15, kind: "trail", value: "#f59e0b", label: "Gold Trail" },
  { level: 18, kind: "trail", value: "#ec4899", label: "Pink Trail" },
  { level: 20, kind: "skin", value: "paper", label: "Satellite" },
];

// XP needed to advance from `level` to `level + 1`
export function xpForNextLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

// Given total XP earned over time, return { level, xp (into current level), needed }
export function levelFromTotalXp(totalXp: number): {
  level: number;
  xp: number;
  needed: number;
} {
  let level = 1;
  let remaining = totalXp;
  // Cap to avoid infinite loops on absurd values
  while (level < 999) {
    const needed = xpForNextLevel(level);
    if (remaining < needed) return { level, xp: remaining, needed };
    remaining -= needed;
    level += 1;
  }
  return { level, xp: 0, needed: xpForNextLevel(level) };
}

export const INITIAL_PROGRESSION: ProgressionState = {
  xp: 0,
  level: 1,
  totalXp: 0,
  stats: {
    totalRounds: 0,
    totalBets: 0,
    totalWins: 0,
    totalLosses: 0,
    consecutiveWins: 0,
    bestConsecutiveWins: 0,
    biggestWinProfit: 0,
    biggestMultiplier: 0,
  },
  achievements: {},
  unlockedSkins: ["classic"],
  unlockedTrails: ["#ef4444"],
  dailyMissions: [],
  dailyMissionsRolledAt: null,
};

export function rollDailyMissions(now: number): MissionInstance[] {
  // Pick 3 unique random templates
  const pool = [...MISSION_TEMPLATES];
  const picked: MissionTemplate[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.map((t, i) => ({
    id: `dm_${now}_${i}`,
    templateId: t.id,
    title: t.title,
    description: t.description,
    goal: t.goal,
    xp: t.xp,
    metric: t.metric,
    threshold: t.threshold,
    progress: 0,
    completed: false,
    claimed: false,
  }));
}

export function rewardsForLevel(level: number): Reward[] {
  return LEVEL_REWARDS.filter((r) => r.level === level);
}
