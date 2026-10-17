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
  deriveTeenPattiDeal,
  TEEN_PATTI_MAX_BETS_PER_DEAL,
  TEEN_PATTI_DECKS,
} from "../services/teenPatti";
import {
  settleTeenPattiBets,
  teenPattiReturnMultiplier,
  type TeenPattiBetInput,
  type SettledTeenPattiBet,
} from "../services/teenPattiMath";
import { requireGameConfig, sha256Hex } from "../services/rtp";
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

const DealBody = z.object({
  roundId: z.string().min(1).optional(),
  bets: z.array(BetSchema).min(1).max(TEEN_PATTI_MAX_BETS_PER_DEAL),
});

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
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
      throw badRequest("Too many bets in one deal");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Total stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Teen Patti is currently disabled");
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
    const cfg = await requireGameConfig("teen-patti");
    res.json({
      enabled: cfg.enabled,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxBetsPerDeal: TEEN_PATTI_MAX_BETS_PER_DEAL,
      decks: TEEN_PATTI_DECKS,
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

// Current shared round snapshot for clients joining mid-round.
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json((await getTableRoundSnapshot("teen-patti", req.user!.id)) ?? null);
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
            gameCode: "teen-patti",
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
      // Replay the deck + hands from the seeds.
      const recomputedDeal = deriveTeenPattiDeal(
        raw.serverSeed,
        raw.clientSeed,
        raw.nonce,
      );
      const storedBets = raw.bets as SettledTeenPattiBet[];
      const { totalPayout } = settleTeenPattiBets(
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
        JSON.stringify(recomputedDeal.handACards) ===
          JSON.stringify(raw.handACards) &&
        JSON.stringify(recomputedDeal.handBCards) ===
          JSON.stringify(raw.handBCards) &&
        recomputedDeal.winner === raw.winner;
      const payoutMatch = totalPayout === raw.payoutAmount;
      res.json({
        ...round,
        computedWinner: recomputedDeal.winner,
        computedHandACategory: recomputedDeal.handA.category,
        computedHandBCategory: recomputedDeal.handB.category,
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
