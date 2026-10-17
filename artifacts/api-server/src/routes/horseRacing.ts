import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import {
  bettingRateLimiter,
  bettingIpRateLimiter,
} from "../middlewares/rateLimit";
import {
  RACE_STATES,
  horseMultiplier,
  runHorseRace,
  createHorseRound,
} from "../services/horseRacing";
import { requireGameConfig } from "../services/rtp";
import { badRequest, notFound } from "../lib/errors";
import { horseGameConfig, horseGameState } from "../services/horseGame";

import { horseLiveState, placeHorseLiveBet } from "../services/horseLiveGame";

const router: IRouter = Router();

router.get("/game/config", async (_req, res, next) => {
  try {
    res.json(await horseGameConfig());
  } catch (e) {
    next(e);
  }
});
router.get("/game", requireAuth, async (req, res, next) => {
  try {
    res.json(await horseGameState(req.user!.id));
  } catch (e) {
    next(e);
  }
});
const GameSlip = z
  .object({
    roundId: z.string().min(1).max(80),
    requestId: z.string().uuid(),
    venueId: z.string().min(1).max(32),
    bets: z
      .array(
        z.object({
          horseId: z.number().int().min(1).max(8),
          amountPaise: z.string().regex(/^\d{1,18}$/),
        }),
      )
      .min(1)
      .max(8),
  })
  .strict();
// Older tabs must reload instead of creating a private race.
router.post("/game", requireAuth, (_req, _res, next) =>
  next(
    badRequest(
      "Live races are now running. Reload the page to join the current round.",
    ),
  ),
);
router.get("/game/live", requireAuth, async (req, res, next) => {
  try {
    const venueId = z
      .string()
      .min(1)
      .max(32)
      .parse(req.query.venueId ?? "royal");
    res.json(await horseLiveState(req.user!.id, venueId));
  } catch (e) {
    next(e);
  }
});
router.post(
  "/game/live",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      res.json(await placeHorseLiveBet(req.user!.id, GameSlip.parse(req.body)));
    } catch (e) {
      next(e);
    }
  },
);

const PlayBody = z.object({
  stakeAmount: z
    .string()
    .regex(/^\d{1,18}$/u, "stakeAmount must be positive integer paise"),
  horseId: z.number().int().min(1).max(6),
  roundId: z.string().min(1).max(64),
  // Optional while the new 7-state UI ships; the current live client does
  // not send it yet. Defaults to the original (Maharashtra) field.
  stateId: z.string().min(1).max(32).default("maharashtra"),
});

const RoundBody = z.object({
  clientSeed: z.string().trim().min(1).max(64).optional(),
});

function mapKnownErr(e: unknown): never {
  const msg = (e as Error).message;
  switch (msg) {
    case "INVALID_HORSE":
      throw badRequest("Unknown horse");
    case "INVALID_STATE":
      throw badRequest("Unknown state");
    case "INVALID_STAKE":
      throw badRequest("Stake must be positive");
    case "STAKE_TOO_LARGE":
      throw badRequest("Stake exceeds maximum");
    case "INSUFFICIENT_FUNDS":
      throw badRequest("Insufficient balance");
    case "GAME_DISABLED":
      throw badRequest("Horse racing is currently disabled");
    case "ROUND_NOT_FOUND":
      throw notFound("Round not found");
    case "ROUND_ALREADY_USED":
      throw badRequest("This race has already been run — request a new round");
    default:
      throw e;
  }
}

// Public config: the field, odds and stake limits.
router.get("/config", async (_req, res, next) => {
  try {
    const cfg = await requireGameConfig("horse-racing");
    res.json({
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxStakePaise: cfg.maxStakePaise.toString(),
      // Legacy field for the pre-7-state client: the default (Maharashtra)
      // field. Remove once the new state-aware UI ships.
      horses: RACE_STATES[0].horses.map((h) => ({
        id: h.id,
        name: h.name,
        color: h.color,
        multiplier: horseMultiplier(h.winProbPct, cfg.houseEdge),
      })),
      states: RACE_STATES.map((s) => ({
        id: s.id,
        name: s.name,
        racecourse: s.racecourse,
        theme: s.theme,
        horses: s.horses.map((h) => ({
          id: h.id,
          name: h.name,
          color: h.color,
          multiplier: horseMultiplier(h.winProbPct, cfg.houseEdge),
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Commit phase: issue a provably-fair round (server seed hash) BEFORE the bet.
router.post("/round", requireAuth, async (req, res, next) => {
  try {
    const body = RoundBody.parse(req.body ?? {});
    try {
      const out = await createHorseRound({ clientSeed: body.clientSeed });
      res.json(out);
    } catch (e) {
      mapKnownErr(e);
    }
  } catch (err) {
    next(err);
  }
});

// Place a win bet and run the race server-side in one shot.
router.post(
  "/play",
  requireAuth,
  bettingIpRateLimiter,
  bettingRateLimiter,
  async (req, res, next) => {
    try {
      const input = PlayBody.parse(req.body);
      const stake = BigInt(input.stakeAmount);
      try {
        const out = await runHorseRace({
          userId: req.user!.id,
          stakeAmount: stake,
          horseId: input.horseId,
          roundId: input.roundId,
          stateId: input.stateId,
        });
        res.json(out);
      } catch (e) {
        mapKnownErr(e);
      }
    } catch (err) {
      next(err);
    }
  },
);

export default router;
