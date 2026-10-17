import { Router, type IRouter } from "express";
import { ROULETTE_LIMITS, ROULETTE_PAYOUT_BASE, ROULETTE_HOUSE_EDGE } from "@workspace/api-zod/roulette-game";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  listRecentRounds,
  listRecentPockets,
  getRoundForVerify,
  getRawRound,
  getActiveSeed,
  rotateActiveSeed,
  parseStoredBets,
  ROULETTE_MAX_BETS_PER_SPIN,
} from "../services/roulette";
import {
  rouletteBetCoverage,
  rouletteTotalReturnMultiplierWithBase,
  pocketColor,
} from "../services/rouletteMath";
import {
  placeTableBets,
  getTableRoundSnapshot,
} from "../services/tableRounds";
import {
  requireGameConfig,
  sha256Hex,
  deriveRouletteOutcome,
} from "../services/rtp";
import { badRequest, notFound } from "../lib/errors";

const router: IRouter = Router();

const BetSchema = z.object({
  type: z.enum([
    "straight",
    "split",
    "street",
    "corner",
    "line",
    "dozen",
    "column",
    "red",
    "black",
    "odd",
    "even",
    "high",
    "low",
  ]),
  numbers: z.array(z.number().int().min(0).max(36)).max(6).optional(),
  selection: z.number().int().min(1).max(3).optional(),
  amountPaise: z
    .string()
    .regex(/^\d{1,18}$/u, "amountPaise must be positive integer paise"),
});

const SpinBody = z.object({
  roundId: z.string().min(1).optional(),
  bets: z.array(BetSchema).min(1).max(ROULETTE_MAX_BETS_PER_SPIN),
});

const RotateBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "ROULETTE_BET_TOO_SMALL":
      throw badRequest("Minimum bet is ₹10 on each selection");
    case "ROULETTE_STRAIGHT_LIMIT":
      throw badRequest("Maximum ₹20,000 on a single number per round, including earlier bets");
    case "ROULETTE_OTHER_LIMIT":
      throw badRequest("Maximum ₹1,00,000 on each multi-number/outside selection per round, including earlier bets");
    case "ROULETTE_BET_IN_PROGRESS":
      throw badRequest("Another roulette bet is being processed. Please retry after it finishes.");
    case "INVALID_ROULETTE_BET":
      throw badRequest("Invalid bet placement for the European layout");
    case "NO_BETS":
      throw badRequest("Place at least one bet");
    case "TOO_MANY_BETS":
      throw badRequest("Too many bets in one spin");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Total stake exceeds maximum");
    case "GAME_DISABLED":
      throw badRequest("Roulette is currently disabled");
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
    const cfg = await requireGameConfig("roulette");
    res.json({
      enabled: cfg.enabled,
      houseEdge: ROULETTE_HOUSE_EDGE,
      maxMultiplier: Math.max(cfg.maxMultiplier, ROULETTE_PAYOUT_BASE),
      payoutBase: ROULETTE_PAYOUT_BASE,
      betLimits: ROULETTE_LIMITS,
      minStakePaise: ROULETTE_LIMITS.minBetPaise,
      maxStakePaise: cfg.maxStakePaise.toString(),
      maxBetsPerSpin: ROULETTE_MAX_BETS_PER_SPIN,
    });
  } catch (err) {
    next(err);
  }
});

// Public, anonymized: last N settled pockets across all players. Pre-seeds
// the live results strip; realtime "rounds:roulette" events keep it fresh.
router.get("/pockets", async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1),
      100,
    );
    res.json(await listRecentPockets(limit));
  } catch (err) {
    next(err);
  }
});

// Current shared round snapshot: phase, countdown anchors, live bets, my
// bets, recent results. The authoritative feed is the "table-rounds:roulette"
// realtime topic; this endpoint bootstraps clients joining mid-round.
router.get("/round", requireAuth, async (req, res, next) => {
  try {
    res.json((await getTableRoundSnapshot("roulette", req.user!.id)) ?? null);
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
  "/spin",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = SpinBody.parse(req.body);
      // Bets join the game's CURRENT shared round; the outcome is revealed
      // and settled server-side when the round clock fires.
      try {
        res.json(
          await placeTableBets({
            roundId: input.roundId,
            gameCode: "roulette",
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
      const recomputedPocket = deriveRouletteOutcome(
        raw.serverSeed,
        raw.clientSeed,
        raw.nonce,
      ).pocket;
      // Recompute payouts independently using the payout base that was active
      // when the round was settled (stored in the bets JSON wrapper).
      // We derive each bet's payout from its amountPaise + coverage against the
      // verified pocket — we do NOT trust stored payoutPaise values, so a
      // tampered or mis-recorded per-bet payout is caught here.
      const { payoutBase, bets: storedBetList } = parseStoredBets(raw.bets);
      let totalPayout = 0n;
      // Per-bet integrity: recompute each bet's win state and payout from its
      // amountPaise + coverage against the verified pocket, and compare with
      // the persisted per-bet record. A tampered payoutPaise or didWin flag
      // fails verification even if the aggregate round payout is unchanged.
      let betsMatch = true;
      for (const b of storedBetList) {
        const coverage = rouletteBetCoverage(b);
        const didWin = coverage.includes(recomputedPocket);
        let payout = 0n;
        if (didWin) {
          const mult = rouletteTotalReturnMultiplierWithBase(
            coverage.length,
            payoutBase,
            raw.maxMultiplier,
          );
          payout = BigInt(Math.floor(Number(BigInt(b.amountPaise)) * mult + 1e-9));
          totalPayout += payout;
        }
        if (b.didWin !== didWin || BigInt(b.payoutPaise) !== payout) {
          betsMatch = false;
        }
      }
      const hashMatch = recomputedHash === raw.serverSeedHash;
      const pocketMatch = recomputedPocket === raw.pocket;
      const payoutMatch = totalPayout === raw.payoutAmount;
      res.json({
        ...round,
        computedPocket: recomputedPocket,
        computedPocketColor: pocketColor(recomputedPocket),
        computedPayout: totalPayout.toString(),
        computedHash: recomputedHash,
        hashMatch,
        pocketMatch,
        payoutMatch,
        betsMatch,
        verified: hashMatch && pocketMatch && payoutMatch && betsMatch,
      });
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
