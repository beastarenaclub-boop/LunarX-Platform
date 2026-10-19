import { z } from "zod";
import { badRequest } from "../lib/errors";
import { networkReportRange } from "./networkReportRange";

const amount = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,2})?$/,
    "Use a non-negative INR amount with at most two decimals",
  )
  .optional();
export const insightFilter = z.object({
  channel: z.enum(["all", "b2b", "b2c"]).default("all"),
  nodeId: z.string().min(1).max(100).optional(),
  playerId: z.string().min(1).max(100).optional(),
  search: z.string().trim().max(150).default(""),
  period: z
    .enum(["today", "yesterday", "weekly", "monthly", "custom"])
    .default("today"),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  entriesOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  game: z.string().max(80).optional(),
  roundId: z.string().max(150).optional(),
  status: z.enum(["placed", "won", "lost", "cashed_out", "voided"]).optional(),
  minStake: amount,
  maxStake: amount,
  sort: z
    .enum(["stake", "bets", "payout", "profit", "recent", "largest"])
    .default("stake"),
  reviewOnly: z.enum(["true", "false"]).default("false"),
  mismatchOnly: z.enum(["true", "false"]).default("false"),
  format: z.enum(["xlsx", "pdf"]).optional(),
});
export type InsightFilter = z.infer<typeof insightFilter>;
export function rupeesToPaise(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function insightRange(filter: InsightFilter) {
  if (
    filter.minStake &&
    filter.maxStake &&
    rupeesToPaise(filter.minStake) > rupeesToPaise(filter.maxStake)
  )
    throw badRequest("Minimum stake must not exceed maximum stake");
  return networkReportRange({
    ...filter,
    channel: filter.channel === "b2c" ? "b2c" : "b2b",
  });
}
