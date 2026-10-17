import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  listRecentRounds,
  getRoundForVerify,
  getRawRound,
  verifyLucky7Round,
  LUCKY7_GAME_CODE,
  LUCKY7_MAX_BETS_PER_ROUND,
} from "../services/lucky7";
import {
  lucky7Payouts,
  LUCKY7_MAX_RETURN,
  LUCKY7_PAYOUT_VERSION,
  LUCKY7_BET_TYPES,
  LUCKY7_TOTAL_COMBINATIONS,
  LUCKY7_WINNING_COMBINATIONS,
} from "../services/lucky7Math";
import { requireGameConfig } from "../services/rtp";
import {
  placeTableBets,
  getTableRoundSnapshot,
} from "../services/tableRounds";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const BetSchema = z.object({
  type: z.enum(
    LUCKY7_BET_TYPES as readonly string[] as [
      "under",
      "exactly",
      "over",
    ],
  ),
  amountPaise: z
    .string()
    .regex(/^\d{1,18}$/u, "amountPaise must be positive integer paise"),
});

const BetBody = z.object({
  roundId: z.string().min(1).optional(),
  bets: z.array(BetSchema).min(1).max(LUCKY7_MAX_BETS_PER_ROUND),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_LUCKY7_BET":
      throw badRequest("Invalid Lucky 7 bet");
    case "DUPLICATE_BET_TYPE":
      throw badRequest("Place at most one bet per spot");
    case "NO_BETS":
      throw badRequest("Place at least one bet");
    case "TOO_MANY_BETS":
      throw badRequest("Too many bets in one round");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Total stake exceeds maximum");
    case "STAKE_TOO_SMALL":
      throw badRequest("Total stake is below the table minimum");
    case "GAME_DISABLED":
      throw badRequest("Lucky 7 is currently disabled");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "BET_NOT_FOUND":
      throw notFound("Bet not found");
    case "BET_ALREADY_SETTLED":
      throw badRequest("Bet already settled");
    case "BETTING_CLOSED":
      throw badRequest("Betting is closed for this round — wait for the next round");
    case "INSUFFICIENT_FUNDS":
      throw badRequest("Insufficient balance");
    default:
      throw e;
  }
}

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig(LUCKY7_GAME_CODE);
    res.json({
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxMultiplier: Math.max(cfg.maxMultiplier, LUCKY7_MAX_RETURN),
      minStakePaise: cfg.minStakePaise.toString(),
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxBetsPerRound: LUCKY7_MAX_BETS_PER_ROUND,
      combinations: LUCKY7_TOTAL_COMBINATIONS,
      winningCombinations: LUCKY7_WINNING_COMBINATIONS,
      payoutVersion: LUCKY7_PAYOUT_VERSION,
      // Total returns include the stake: Under/Over 2×, Exactly 7 12×.
      payouts: lucky7Payouts(cfg.houseEdge, cfg.maxMultiplier),
    });
  } catch (err) {
    next(err);
  }
});

// Current shared round snapshot for clients joining mid-round. This is also
// the game's fairness commitment: `serverSeedHash` + `clientSeed` + `nonce`
// are published while betting is open and `serverSeed` appears at reveal, so
// players hold the commitment before they bet. Lucky 7 has no per-user seed
// endpoint — one roll is shared by the whole table, so no single player's seed
// can feed it (see services/lucky7.ts).
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json((await getTableRoundSnapshot("lucky-7", req.user!.id)) ?? null);
  } catch (err) {
    next(err);
  }
});

router.get("/recent", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
      50,
    );
    res.json(await listRecentRounds({ userId: req.user!.id, limit }));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/bet",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = BetBody.parse(req.body);
      try {
        // Bets join the shared server-scheduled round; the dice are rolled at
        // the round's reveal phase and settled server-side.
        res.json(
          await placeTableBets({
            roundId: input.roundId,
            gameCode: "lucky-7",
            userId: req.user!.id,
            bets: input.bets,
          }),
        );
      } catch (e) {
        mapKnownErr(e);
      }
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    try {
      res.json(
        await getRoundForVerify({
          roundId: String(req.params.id),
          userId: req.user!.id,
        }),
      );
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.get("/:id/verify", requireAuth, async (req, res, next) => {
  try {
    try {
      const raw = await getRawRound({
        roundId: String(req.params.id),
        userId: req.user!.id,
      });
      const round = await getRoundForVerify({
        roundId: String(req.params.id),
        userId: req.user!.id,
      });
      // Replay the roll and the payout rules stored with this audit row.
      res.json({ ...round, ...verifyLucky7Round(raw) });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
