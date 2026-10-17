import { z } from "zod";

export const REWARD_IDS = [
  "cashback",
  "shopping",
  "giftcard",
  "travel",
  "gadgets",
  "dining",
  "fuel",
  "gold",
] as const;
export type RewardId = (typeof REWARD_IDS)[number];
export const REWARDS = [
  {
    id: "cashback",
    name: "Cashback",
    subtitle: "Straight to your wallet",
    kind: "cash",
    color: "#146c50",
  },
  {
    id: "shopping",
    name: "Shopping",
    subtitle: "A little retail therapy",
    kind: "voucher",
    color: "#bd4f36",
  },
  {
    id: "giftcard",
    name: "Gift card",
    subtitle: "Something just for you",
    kind: "voucher",
    color: "#7051ad",
  },
  {
    id: "travel",
    name: "Travel",
    subtitle: "Your next great escape",
    kind: "voucher",
    color: "#267b9c",
  },
  {
    id: "gadgets",
    name: "Gadgets",
    subtitle: "Upgrade your everyday",
    kind: "voucher",
    color: "#4558a0",
  },
  {
    id: "dining",
    name: "Dining",
    subtitle: "Good food. Great company.",
    kind: "voucher",
    color: "#a94b75",
  },
  {
    id: "fuel",
    name: "Fuel",
    subtitle: "More miles, more memories",
    kind: "voucher",
    color: "#94701f",
  },
  {
    id: "gold",
    name: "Gold",
    subtitle: "A voucher for a little shine",
    kind: "voucher",
    color: "#9c6a26",
  },
] as const;
export const PRIZE_MULTIPLIER = 10;
export const prizeSettingsSchema = z
  .object({
    rtp: z.number().int().min(50).max(95),
    intervalSeconds: z.number().int().min(30).max(900),
    maxTicket: z.number().int().min(100).max(20000),
    maxLiability: z.number().int().min(1000).max(1000000),
    salesEnabled: z.boolean(),
  })
  .strict()
  .refine(
    (v) => v.maxLiability >= v.maxTicket * PRIZE_MULTIPLIER,
    "Liability limit must cover one maximum ticket.",
  );
export type PrizeSettings = z.infer<typeof prizeSettingsSchema>;
export const PRIZE_DEFAULTS: PrizeSettings = {
  rtp: 85,
  intervalSeconds: 60,
  maxTicket: 10000,
  maxLiability: 500000,
  salesEnabled: true,
};
export const prizePurchaseSchema = z
  .object({
    drawId: z.string().regex(/^PRIZE-\d+$/),
    reward: z.enum(REWARD_IDS),
    amount: z.number().int().min(100).max(20000),
  })
  .strict();
export const prizeRequestSchema = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/);
export const prizeSettingsUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    settings: prizeSettingsSchema,
  })
  .strict();
export const prizeFulfillmentSchema = z
  .object({
    merchant: z.string().trim().min(2).max(100),
    code: z.string().trim().min(3).max(300),
    instructions: z.string().trim().min(5).max(1500),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type PrizeDelivery = z.infer<typeof prizeFulfillmentSchema>;
export type PrizeDraw = {
  id: string;
  closes: number;
  ends: number;
  status: "open" | "settled";
  commitment: string;
  seed?: string;
  result: RewardId | "none" | null;
  config: PrizeSettings;
};
export type PrizeTicket = {
  id: string;
  userId: string;
  drawId: string;
  reward: RewardId;
  amount: number;
  prize: number;
  status: "pending" | "won" | "lost" | "cancelled";
  claimStatus: "none" | "available" | "requested" | "fulfilled" | "credited";
  created: number;
  delivery: PrizeDelivery | null;
};
export type PrizeState = {
  serverTime: number;
  balance: number;
  salesEnabled: boolean;
  maxTicket: number;
  draws: PrizeDraw[];
  tickets: PrizeTicket[];
  ticketCount: number;
  page: number;
  pages: number;
};
export type PrizeAdminState = {
  serverTime: number;
  settings: PrizeSettings;
  version: number;
  draws: PrizeDraw[];
  tickets: PrizeTicket[];
  page: number;
  pages: number;
  totals: {
    sales: number;
    prizes: number;
    cashback: number;
    voucherLiability: number;
    pendingClaims: number;
    refunds: number;
  };
};
export function prizeCommitmentMessage(
  seed: string,
  id: string,
  config: PrizeSettings,
) {
  return JSON.stringify([
    "prize-lotto:v1",
    seed,
    id,
    config.rtp,
    config.intervalSeconds,
    config.maxTicket,
    config.maxLiability,
    config.salesEnabled,
  ]);
}

/** Exactly rtp*10 buckets per selection out of 10,000; remaining buckets mean no prize. */
export function prizeBucketResult(
  bucket: number,
  rtp: number,
): RewardId | "none" {
  if (
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket >= 10000 ||
    !Number.isInteger(rtp) ||
    rtp < 50 ||
    rtp > 95
  )
    throw new Error("Invalid draw parameters");
  return REWARD_IDS[Math.floor(bucket / (rtp * 10))] ?? "none";
}
