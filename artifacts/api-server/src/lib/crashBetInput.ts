import { z } from "zod";

/** JetX has four independent cards; other crash games retain two. */
export const crashBetInput = z.object({
  autoCashOut: z.number().min(1.01).max(1000).multipleOf(.01).optional(),
  panel: z.number().int().min(0).max(3).optional(),
  gameCode: z.string().min(1).max(32),
  stakeAmount: z.string().regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  roundId: z.string().max(64).optional(),
  useBonus: z.boolean().optional(),
  useFreeBet: z.boolean().optional(),
}).superRefine((input, context) => {
  if (input.gameCode !== "jetx" && (input.panel ?? 0) > 1) {
    context.addIssue({ code: "custom", path: ["panel"], message: "This game supports two bet panels." });
  }
});
