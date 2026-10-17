import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { LotteryGame, LotteryLine, LotteryResults, LotterySettings } from "@workspace/db";

export const LOTTERY_SERIES = Array.from({ length: 10 }, (_, i) => `JP${i + 10}`);
export const LOTTERY_PRICES = Object.fromEntries(LOTTERY_SERIES.map((s, i) => [s, [100, 200, 500, 1000, 2000, 3000, 4000, 5000, 7500, 10000][i]]));
export const LOTTERY_DEFAULTS: LotterySettings = {
  brand: "Irland Lotto", interval: 15, unitPrice: 100, seriesPrices: LOTTERY_PRICES,
  maxTicket: 20000, payouts: { "2D": 80, "3D": 800, Titli: 8 }, salesEnabled: true, timezone: "Asia/Kolkata",
};
export const lotteryPurchaseSchema = z.object({
  drawId: z.string().regex(/^(?:IRLAND|NICE)-\d+$/), game: z.enum(["2D", "3D", "Titli"]),
  lines: z.array(z.object({ series: z.string().regex(/^JP1[0-9]$/), number: z.string().regex(/^\d{1,3}$/),
    quantity: z.number().int().min(1).max(500) }).strict()).min(1).max(1000),
}).strict().superRefine((body, ctx) => {
  const digits = body.game === "3D" ? 3 : body.game === "2D" ? 2 : 1;
  const seen = new Set<string>();
  for (const line of body.lines) {
    const key = `${line.series}:${line.number}`;
    if (line.number.length !== digits || seen.has(key)) ctx.addIssue({ code: "custom", message: "Use unique selections with the correct number of digits." });
    seen.add(key);
  }
}).transform(body => ({ ...body, lines: [...body.lines].sort((a, b) => a.series.localeCompare(b.series) || a.number.localeCompare(b.number)) }));
export const lotteryRequestSchema = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/);
export const lotterySettingsSchema = z.object({ version: z.number().int().positive(), interval: z.number().int().min(1).max(60),
  maxTicket: z.number().int().min(100).max(20000), salesEnabled: z.boolean() }).strict();
export const lotteryHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Same published-seed rules as the existing paper lottery; unbiased draws. */
export function lotteryResults(seed: string): LotteryResults {
  const result: LotteryResults = {};
  for (const series of LOTTERY_SERIES) {
    result[series] = {} as Record<LotteryGame, string>;
    for (const [game, count, digits] of [["2D", 100, 2], ["3D", 1000, 3], ["Titli", 10, 1]] as const) {
      let sample: number, attempt = 0;
      do { sample = createHmac("sha256", seed).update(`${series}:${game}:${attempt++}`).digest().readUInt32BE(); }
      while (sample >= Math.floor(4294967296 / count) * count);
      result[series][game] = String(sample % count).padStart(digits, "0");
    }
  }
  return result;
}
export function lotteryPayout(lines: LotteryLine[], game: LotteryGame, config: LotterySettings, results: LotteryResults) {
  return lines.reduce((sum, line) => sum + (results[line.series][game] === line.number
    ? BigInt(line.quantity) * BigInt(line.unitPrice) * 100n * BigInt(config.payouts[game]) : 0n), 0n);
}
