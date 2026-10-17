import { storedPayoutVersion } from "@workspace/api-zod/game-economics";
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
  getActiveSeed,
  rotateActiveSeed,
  deriveAndarBaharDeal,
  ANDAR_BAHAR_MAX_BETS_PER_DEAL,
  ANDAR_BAHAR_DECKS,
} from "../services/andarBahar";
import {
  settleAndarBaharBets,
  andarBaharReturnMultiplier,
  ANDAR_BAHAR_BET_TYPES,
  RANGE_BOUNDS,
  type AndarBaharBetInput,
  type SettledAndarBaharBet,
  type AndarBaharRangeBet,
} from "../services/andarBaharMath";
import { requireGameConfig, sha256Hex } from "../services/rtp";
import {
  placeTableBets,
  getTableRoundSnapshot,
} from "../services/tableRounds";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const BetSchema = z.object({
  type: z.enum(
    ANDAR_BAHAR_BET_TYPES as [string, ...string[]] as [
      "andar",
      "bahar",
      "range1_5",
      "range6_10",
      "range11_15",
      "range16_25",
      "range26_30",
      "range31_35",
      "range36_40",
      "range41_49",
    ],
  ),
  amountPaise: z
    .string()
    .regex(/^\d{1,18}$/u, "amountPaise must be positive integer paise"),
});

const DealBody = z.object({
  roundId: z.string().min(1).optional(),
  bets: z.array(BetSchema).min(1).max(ANDAR_BAHAR_MAX_BETS_PER_DEAL),
});

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_ANDAR_BAHAR_BET":
      throw badRequest("Invalid Andar Bahar bet");
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
    case "GAME_DISABLED":
      throw badRequest("Andar Bahar is currently disabled");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "BET_NOT_FOUND":
      throw notFound("Bet not found");
    case "BET_ALREADY_SETTLED":
      throw badRequest("Bet already settled");
    case "SEED_INIT_FAILED":
    case "SEED_ROTATE_CONTENDED":
    case "NONCE_CLAIM_CONTENDED":
      throw badRequest("Seed contention; please retry");
    case "BETTING_CLOSED":
      throw badRequest("Betting is closed for this round — wait for the next round");
    case "STAKE_TOO_SMALL":
      throw badRequest("Total stake is below the table minimum");
    case "INSUFFICIENT_FUNDS":
      throw badRequest("Insufficient balance");
    default:
      throw e;
  }
}

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("andar-bahar");
    const rangePayouts: Record<string, { min: number; max: number; multiplier: number }> = {};
    for (const [type, [min, max]] of Object.entries(RANGE_BOUNDS)) {
      rangePayouts[type] = {
        min,
        max,
        multiplier: andarBaharReturnMultiplier(type as AndarBaharRangeBet),
      };
    }
    res.json({
      enabled: cfg.enabled,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxBetsPerDeal: ANDAR_BAHAR_MAX_BETS_PER_DEAL,
      decks: ANDAR_BAHAR_DECKS,
      payouts: {
        // Total-return multipliers for the main bets, keyed by whether the
        // bet's side is the first dealt side (black joker → andar first).
        firstSide: andarBaharReturnMultiplier("andar", { isFirstSide: true }),
        secondSide: andarBaharReturnMultiplier("andar", { isFirstSide: false }),
        ranges: rangePayouts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Current shared round snapshot for clients joining mid-round.
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json((await getTableRoundSnapshot("andar-bahar", req.user!.id)) ?? null);
  } catch (err) {
    next(err);
  }
});

router.get("/seed", requireAuth, async (req, res, next) => {
  try {
    try {
      res.json(await getActiveSeed(req.user!.id));
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

router.post("/seed/rotate", requireAuth, async (req, res, next) => {
  try {
    const body = RotateBody.parse(req.body ?? {});
    try {
      res.json(await rotateActiveSeed(req.user!.id, body.clientSeed));
    } catch (e) {
      mapKnownErr(e);
    }
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
  "/deal",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = DealBody.parse(req.body);
      try {
        // Bets join the shared server-scheduled round; the deal happens at
        // the round's reveal phase and is settled server-side.
        res.json(
          await placeTableBets({
            roundId: input.roundId,
            gameCode: "andar-bahar",
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
      const recomputedHash = sha256Hex(raw.serverSeed);
      // Replay the deck + deal from the seeds.
      const recomputedDeal = deriveAndarBaharDeal(
        raw.serverSeed,
        raw.clientSeed,
        raw.nonce,
      );
      const storedBets = raw.bets as SettledAndarBaharBet[];
      const { totalPayout } = settleAndarBaharBets(
        storedBets.map((b) => ({
          type: b.type,
          amountPaise: BigInt(b.amountPaise),
        })),
        recomputedDeal,
        raw.maxMultiplier,
        storedPayoutVersion(raw.bets),
      );
      const hashMatch = recomputedHash === raw.serverSeedHash;
      const dealMatch =
        recomputedDeal.joker === raw.joker &&
        JSON.stringify(recomputedDeal.andarCards) ===
          JSON.stringify(raw.andarCards) &&
        JSON.stringify(recomputedDeal.baharCards) ===
          JSON.stringify(raw.baharCards) &&
        recomputedDeal.winner === raw.winner &&
        recomputedDeal.cardsDealt === raw.cardsDealt;
      const payoutMatch = totalPayout === raw.payoutAmount;
      res.json({
        ...round,
        computedWinner: recomputedDeal.winner,
        computedFirstSide: recomputedDeal.firstSide,
        computedCardsDealt: recomputedDeal.cardsDealt,
        computedPayout: totalPayout.toString(),
        computedHash: recomputedHash,
        hashMatch,
        dealMatch,
        payoutMatch,
        verified: hashMatch && dealMatch && payoutMatch,
      });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
