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
  verifyTeenPattiLiveRound,
  TEEN_PATTI_LIVE_GAME_CODE,
  TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND,
  TEEN_PATTI_LIVE_DECKS,
} from "../services/teenPattiLive";
import { teenPattiReturnMultiplier } from "../services/teenPattiMath";
import { requireGameConfig } from "../services/rtp";
import {
  placeTableBets,
  getTableRoundSnapshot,
} from "../services/tableRounds";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const BetSchema = z.object({
  type: z.enum(["playerA", "playerB", "tie", "pairPlusA", "pairPlusB"]),
  amountPaise: z
    .string()
    .regex(/^\d{1,18}$/u, "amountPaise must be positive integer paise"),
});

const BetBody = z.object({
  roundId: z.string().min(1).optional(),
  bets: z.array(BetSchema).min(1).max(TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_TEEN_PATTI_BET":
      throw badRequest("Invalid teen patti bet");
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
      throw badRequest("Teen Patti Live is currently disabled");
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
    const cfg = await requireGameConfig(TEEN_PATTI_LIVE_GAME_CODE);
    res.json({
      enabled: cfg.enabled,
      maxMultiplier: cfg.maxMultiplier,
      minStakePaise: cfg.minStakePaise.toString(),
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxBetsPerRound: TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND,
      decks: TEEN_PATTI_LIVE_DECKS,
      // Same fixed paytable as the flat Teen Patti table — read straight from
      // the shared math module so the two games can never quote different
      // prices for the same bet.
      payouts: {
        playerA: teenPattiReturnMultiplier("playerA"),
        playerB: teenPattiReturnMultiplier("playerB"),
        tie: teenPattiReturnMultiplier("tie"),
        pairPlus: {
          pair: teenPattiReturnMultiplier("pairPlusA", "pair"),
          color: teenPattiReturnMultiplier("pairPlusA", "color"),
          sequence: teenPattiReturnMultiplier("pairPlusA", "sequence"),
          pureSequence: teenPattiReturnMultiplier("pairPlusA", "pureSequence"),
          trail: teenPattiReturnMultiplier("pairPlusA", "trail"),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// Current shared round snapshot for clients joining mid-round. This is also
// the game's fairness commitment: `serverSeedHash` + `clientSeed` + `nonce`
// are published while betting is open and `serverSeed` appears at reveal, so
// players hold the commitment before they bet. There is no per-user seed
// endpoint — one deal is shared by the whole table, so no single player's
// seed can feed it (see services/teenPattiLive.ts).
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json(
      (await getTableRoundSnapshot("teen-patti-live", req.user!.id)) ?? null,
    );
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
        // Bets join the shared server-scheduled round; the cards are dealt at
        // the round's reveal phase and settled server-side.
        res.json(
          await placeTableBets({
            roundId: input.roundId,
            gameCode: "teen-patti-live",
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
      // Replay the deck, both hands and the payouts from the stored seeds and
      // the round's snapshotted max multiplier.
      res.json({ ...round, ...verifyTeenPattiLiveRound(raw) });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
