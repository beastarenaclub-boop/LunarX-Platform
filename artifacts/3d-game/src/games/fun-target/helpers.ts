import type { Chip, Config, PendingPlacement, WireBet } from "./types";
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
export const DENOMINATIONS = [10, 50, 100, 500, 1000, 5000, 10000, 20000] as const;
export function wireBets(chips: readonly Chip[]): WireBet[] {
  const totals = new Map<number, bigint>();
  for (const { digit, amount } of chips) totals.set(digit, (totals.get(digit) ?? 0n) + amount);
  return [...totals].sort(([a], [b]) => a - b).map(([digit, amount]) => ({ type: "straight", selection: [digit], amountPaise: amount.toString() }));
}
export function totalStake(bets: readonly WireBet[]): bigint { return bets.reduce((s, bet) => s + BigInt(bet.amountPaise), 0n); }
export function readBets(raw: unknown): WireBet[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is WireBet => b && b.type === "straight" && Array.isArray(b.selection) && b.selection.length === 1 &&
    Number.isInteger(b.selection[0]) && b.selection[0] >= 0 && b.selection[0] <= 9 &&
    typeof b.amountPaise === "string" && /^\d{1,18}$/.test(b.amountPaise) && BigInt(b.amountPaise) > 0n);
}
export function activeBets(rows: { status: string; bets: unknown }[]): WireBet[] {
  return rows.filter(s => s.status !== "refunded" && s.status !== "voided").flatMap(s => readBets(s.bets));
}
export type PrecheckError = "empty" | "minimum" | "maximum" | "funds" | "positions" | "invalid" | "disabled";
export function precheck(bets: WireBet[], cfg: Config, balance: bigint, perSpot?: string | null): PrecheckError | null {
  if (!cfg.enabled) return "disabled";
  if (!bets.length) return "empty";
  if (bets.length > cfg.maxBetsPerSlip) return "positions";
  if (readBets(bets).length !== bets.length || new Set(bets.map(b => b.selection[0])).size !== bets.length) return "invalid";
  const total = totalStake(bets);
  if (total < BigInt(cfg.minStakePaise)) return "minimum";
  if (total > BigInt(cfg.maxStakePaise)) return "maximum";
  if (perSpot && bets.some(b => BigInt(b.amountPaise) > BigInt(perSpot))) return "maximum";
  if (total > balance) return "funds";
  return null;
}
export function describeBets(raw: unknown): string { return readBets(raw).map(b => String(b.selection[0])).join(" · "); }
export function restorePlacement(raw: string | null): PendingPlacement | null {
  try {
    const value = JSON.parse(raw ?? "null") as PendingPlacement | null;
    return value && typeof value.key === "string" && value.key.length <= 64 && typeof value.roundId === "string" &&
      Array.isArray(value.bets) && value.bets.length > 0 && readBets(value.bets).length === value.bets.length ? value : null;
  } catch { return null; }
}
export function isUncertainFailure(error: unknown): boolean {
  const e = error as { status?: number; data?: { error?: { code?: string } } };
  return !e?.data?.error?.code && (!e?.status || e.status >= 502);
}
export function errorCode(error: unknown): string {
  const data = (error as { data?: { error?: { code?: string; details?: { code?: string } } } })?.data;
  return data?.error?.details?.code ?? data?.error?.code ?? "UNKNOWN";
}
