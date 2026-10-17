import type { Direction } from "./store.mjs";
export const GAME_TICK_MS: number;
export const GAME_HISTORY_MS: number;
export interface GamePoint { time: number; price: number }
export interface GameTape { asset: string; time: number; points: GamePoint[] }
export interface GameChartInput { asset: string; roundStart: number; time: number; direction: Direction; idle: boolean }
export function gameIndexAt(input: GameChartInput): number;
export function updateGameTape(previous: GameTape | undefined, input: GameChartInput): GameTape;
export function gameCandles(points: GamePoint[], seconds?: number): { time: number; open: number; high: number; low: number; close: number }[];
