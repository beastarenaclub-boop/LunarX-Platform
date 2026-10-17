import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  actionHit,
  actionStand,
  actionDouble,
  actionSplit,
  actionInsurance,
  getActiveRound,
  listRecentRounds,
  getRoundForVerify,
  getRawRound,
  getActiveSeed,
  rotateActiveSeed,
  deriveShoe,
  BLACKJACK_DECKS,
} from "../services/blackjack";
import { replayRound, settleRound } from "../services/blackjackMath";
import { requireGameConfig, sha256Hex } from "../services/rtp";
import {
  placeTableBets,
  getTableRoundSnapshot,
} from "../services/tableRounds";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const DealBody = z.object({
  roundId: z.string().min(1).optional(),
  stakeAmount: z
    .string()
    .regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
});

const InsuranceBody = z.object({ take: z.boolean() });

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Blackjack is currently disabled");
    case "ROUND_IN_PROGRESS":
      throw badRequest("Finish your current hand first");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "ROUND_ALREADY_SETTLED":
      throw badRequest("Round already settled");
    case "ROUND_TIMED_OUT":
      throw badRequest("Round timed out and was auto-stood");
    case "ACTION_NOT_ALLOWED":
      throw badRequest("That action is not allowed right now");
    case "ROUND_CONFLICT":
      throw badRequest("Simultaneous action detected; refresh and retry");
    case "INSUFFICIENT_FUNDS":
      throw badRequest("Insufficient balance");
    case "SEED_INIT_FAILED":
    case "SEED_ROTATE_CONTENDED":
    case "NONCE_CLAIM_CONTENDED":
      throw badRequest("Seed contention; please retry");
    case "BETTING_CLOSED":
      throw badRequest("Betting is closed for this round — wait for the next round");
    case "STAKE_TOO_SMALL":
      throw badRequest("Stake is below the table minimum");
    default:
      throw e;
  }
}

router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("blackjack");
    res.json({
      enabled: cfg.enabled,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
      decks: BLACKJACK_DECKS,
      rules: {
        dealerStandsSoft17: true,
        blackjackPays: "3:2",
        insurancePays: "2:1",
        maxSplits: 1,
        doubleAfterSplit: true,
        splitAcesOneCard: true,
      },
    });
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

// Current shared round snapshot for clients joining mid-round.
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json((await getTableRoundSnapshot("blackjack", req.user!.id)) ?? null);
  } catch (err) {
    next(err);
  }
});

router.get("/active", requireAuth, async (req, res, next) => {
  try {
    try {
      res.json(await getActiveRound(req.user!.id));
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
        // Stake joins the shared round's betting window; the hand is dealt
        // at the reveal phase and played via the action endpoints before the
        // round's settlement deadline auto-stands idle players.
        res.json(
          await placeTableBets({
            roundId: input.roundId,
            gameCode: "blackjack",
            userId: req.user!.id,
            bets: [{ amountPaise: input.stakeAmount }],
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

const ACTION_HANDLERS: Record<
  string,
  (userId: string, roundId: string) => Promise<unknown>
> = {
  hit: actionHit,
  stand: actionStand,
  double: actionDouble,
  split: actionSplit,
};

for (const [name, handler] of Object.entries(ACTION_HANDLERS)) {
  router.post(`/:id/${name}`, requireAuth, async (req, res, next) => {
    try {
      try {
        res.json(await handler(req.user!.id, String(req.params.id)));
      } catch (e) {
        mapKnownErr(e);
      }
    } catch (err) {
      next(err);
    }
  });
}

router.post("/:id/insurance", requireAuth, async (req, res, next) => {
  try {
    const body = InsuranceBody.parse(req.body);
    try {
      res.json(
        await actionInsurance(req.user!.id, String(req.params.id), body.take),
      );
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

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
      if (raw.status !== "settled") {
        throw badRequest("Round not settled yet");
      }
      const round = await getRoundForVerify({
        roundId: String(req.params.id),
        userId: req.user!.id,
      });
      const recomputedHash = sha256Hex(raw.serverSeed);
      const shoe = deriveShoe(raw.serverSeed, raw.clientSeed, raw.nonce);
      const replayed = replayRound(shoe, raw.actions as string[]);
      const { totalPayout } = settleRound({
        hands: replayed.hands,
        dealerCards: replayed.dealerCards,
        dealerBlackjack: replayed.dealerBlackjack,
        baseStake: raw.stakeAmount,
        payoutVersion: raw.payoutVersion,
        insuranceTaken: replayed.insuranceTaken,
      });
      const storedHands = (raw.hands as { cards: number[] }[]).map(
        (h) => h.cards,
      );
      const replayedHands = replayed.hands.map((h) => h.cards);
      const hashMatch = recomputedHash === raw.serverSeedHash;
      const cardsMatch =
        JSON.stringify(replayedHands) === JSON.stringify(storedHands) &&
        JSON.stringify(replayed.dealerCards) ===
          JSON.stringify(raw.dealerCards);
      const payoutMatch = totalPayout === raw.payoutAmount;
      res.json({
        ...round,
        computedHash: recomputedHash,
        computedPayout: totalPayout.toString(),
        hashMatch,
        cardsMatch,
        payoutMatch,
        verified: hashMatch && cardsMatch && payoutMatch,
      });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
