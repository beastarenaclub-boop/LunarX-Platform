import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  betsTable,
  gameRoundsTable,
  walletLedgerTable,
  type Bet,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  requirePartnerKey,
  partnerRateLimiter,
  logPartnerResponse,
} from "../middlewares/partnerAuth";
import {
  ensurePartnerShadowUser,
  ensurePartnerWallet,
} from "../services/partners";
import {
  placeBet as placeBetSvc,
  cashOutBet as cashOutBetSvc,
} from "../services/bets";
import { getGameConfig, generateRound, recordRound, sha256Hex, deriveCrashPoint } from "../services/rtp";
import { postEntry } from "../services/wallet";
import { issueLaunchToken } from "../services/launcherSession";
import { badRequest, notFound, forbidden } from "../lib/errors";
import { isRetiredGame } from "../lib/retiredGames";

const router: IRouter = Router();

router.use(logPartnerResponse);
router.use(partnerRateLimiter);
router.use(requirePartnerKey);

function partnerBet(b: Bet) {
  return {
    id: b.id,
    partnerBetId: b.partnerBetId,
    partnerPlayerRef: b.partnerPlayerRef,
    gameCode: b.gameCode,
    roundId: b.roundId,
    stakeAmount: b.stakeAmount.toString(),
    payoutAmount: b.payoutAmount.toString(),
    multiplier: b.multiplier,
    status: b.status,
    placedAt: b.placedAt.toISOString(),
    settledAt: b.settledAt ? b.settledAt.toISOString() : null,
  };
}

function gameAllowed(allowed: string[], code: string): boolean {
  if (isRetiredGame(code)) return false;
  if (allowed.length === 0) return true; // empty = all allowed
  return allowed.includes(code);
}

router.get("/games", async (req, res, next) => {
  try {
    const allowed = req.partner!.allowedGames;
    const codes = [
      "mines",
      "plinko",
      "dice",
      "jetx",
      "fury",
    ].filter((c) =>
      gameAllowed(allowed, c),
    );
    const out = [];
    for (const code of codes) {
      const cfg = await getGameConfig(code);
      if (!cfg) continue;
      out.push({
        code,
        enabled: cfg.enabled,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
        maxStakePaise: cfg.maxStakePaise.toString(),
      });
    }
    res.json({ games: out });
  } catch (err) {
    next(err);
  }
});

router.get("/games/:code/config", async (req, res, next) => {
  try {
    const code = String(req.params.code);
    if (!gameAllowed(req.partner!.allowedGames, code)) {
      throw forbidden("Game not allowed for this partner");
    }
    const cfg = await getGameConfig(code);
    if (!cfg) throw notFound("Game not found");
    res.json({
      code: cfg.gameCode,
      enabled: cfg.enabled,
      houseEdge: cfg.houseEdge,
      maxMultiplier: cfg.maxMultiplier,
      maxStakePaise: cfg.maxStakePaise.toString(),
    });
  } catch (err) {
    next(err);
  }
});

const NewRoundBody = z.object({
  gameCode: z.string().min(1).max(32),
  partnerRoundId: z.string().min(1).max(64).optional(),
  clientSeed: z.string().min(1).max(128).optional(),
});

router.post("/rounds", async (req, res, next) => {
  try {
    const input = NewRoundBody.parse(req.body);
    if (!gameAllowed(req.partner!.allowedGames, input.gameCode)) {
      throw forbidden("Game not allowed");
    }
    const gen = await generateRound({ gameCode: input.gameCode });
    const id = await recordRound({
      gameCode: input.gameCode,
      serverSeed: gen.serverSeed,
      serverSeedHash: gen.serverSeedHash,
      clientSeed: gen.clientSeed,
      nonce: gen.nonce,
      crashPoint: gen.crashPoint,
      houseEdge: gen.houseEdge,
      maxMultiplier: gen.maxMultiplier,
      partnerId: req.partner!.id,
      partnerRoundId: input.partnerRoundId ?? null,
    });
    res.json({
      id,
      partnerRoundId: input.partnerRoundId ?? null,
      gameCode: input.gameCode,
      serverSeedHash: gen.serverSeedHash,
      clientSeed: gen.clientSeed,
      nonce: gen.nonce,
    });
  } catch (err) {
    next(err);
  }
});

const StakeStr = z.string().regex(/^\d{1,18}$/u);

const PlaceBetBody = z.object({
  gameCode: z.string().min(1).max(32),
  playerRef: z.string().min(1).max(64),
  stakeAmount: StakeStr,
  partnerBetId: z.string().min(1).max(64).optional(),
  roundId: z.string().max(64).optional(),
});

router.post("/bets", async (req, res, next) => {
  try {
    const input = PlaceBetBody.parse(req.body);
    if (!gameAllowed(req.partner!.allowedGames, input.gameCode)) {
      throw forbidden("Game not allowed");
    }
    const cfg = await getGameConfig(input.gameCode);
    if (!cfg) throw badRequest("Unknown game");
    if (!cfg.enabled) throw badRequest("Game disabled");
    const stake = BigInt(input.stakeAmount);
    if (stake <= 0n) throw badRequest("stakeAmount must be positive");
    if (stake > cfg.maxStakePaise) throw badRequest("Stake exceeds max");

    const shadow = await ensurePartnerShadowUser(
      req.partner!.id,
      input.playerRef,
    );

    try {
      const placed = await placeBetSvc({
        userId: shadow.id,
        gameCode: input.gameCode,
        roundId: input.roundId ?? null,
        stakeAmount: stake,
        partnerId: req.partner!.id,
        partnerBetId: input.partnerBetId ?? null,
        partnerPlayerRef: input.playerRef,
      });
      res.json(partnerBet(placed));
    } catch (e) {
      // DB-enforced idempotency: unique (partner_id, partner_bet_id) collision
      // means the partner already submitted this bet — return the original.
      const code = (e as { code?: string }).code;
      if (input.partnerBetId && code === "23505") {
        const existing = await db
          .select()
          .from(betsTable)
          .where(
            and(
              eq(betsTable.partnerId, req.partner!.id),
              eq(betsTable.partnerBetId, input.partnerBetId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          res.json(partnerBet(existing[0]));
          return;
        }
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

router.get("/bets/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(betsTable)
      .where(
        and(eq(betsTable.id, id), eq(betsTable.partnerId, req.partner!.id)),
      )
      .limit(1);
    if (!rows[0]) throw notFound("Bet not found");
    res.json(partnerBet(rows[0]));
  } catch (err) {
    next(err);
  }
});

const CashoutBody = z.object({
  multiplier: z.number().min(1).max(100000),
});

router.post("/bets/:id/cashout", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = CashoutBody.parse(req.body);
    const rows = await db
      .select()
      .from(betsTable)
      .where(
        and(eq(betsTable.id, id), eq(betsTable.partnerId, req.partner!.id)),
      )
      .limit(1);
    if (!rows[0]) throw notFound("Bet not found");
    try {
      const updated = await cashOutBetSvc({
        betId: id,
        userId: rows[0].userId,
        multiplier: input.multiplier,
      });
      res.json(partnerBet(updated));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "BET_NOT_FOUND") throw notFound("Bet not found");
      if (msg === "BET_ALREADY_SETTLED")
        throw badRequest("Bet already settled");
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

router.get("/wallet/balance", async (req, res, next) => {
  try {
    // /v1/wallet/balance only makes sense for partners using the Lunar
    // ledger. remote-wallet partners are the source of truth for their
    // own player balances and must query their own system.
    if (req.partner!.walletMode !== "local-credits") {
      throw badRequest(
        "wallet/balance is only available for local-credits partners",
      );
    }
    const playerRef =
      typeof req.query.playerRef === "string" ? req.query.playerRef : null;
    if (!playerRef) throw badRequest("playerRef query param required");
    const shadow = await ensurePartnerShadowUser(req.partner!.id, playerRef);
    // Partner credits/debits all post to the player's shadow ledger. Sum across
    // every wallet scope so the reported balance reflects the partner's full
    // credit position regardless of which game scope an entry landed on.
    const sum = await db
      .select({
        total: sql<string>`COALESCE(SUM(${walletLedgerTable.amount}), 0)::text`,
      })
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, shadow.id));
    const balance = sum[0]?.total ?? "0";
    res.json({ playerRef, currency: "INR", balance });
  } catch (err) {
    next(err);
  }
});

const CreditBody = z.object({
  playerRef: z.string().min(1).max(64),
  amount: StakeStr,
  reference: z.string().max(64).optional(),
});

router.post("/wallet/credit", async (req, res, next) => {
  try {
    if (req.partner!.walletMode !== "local-credits") {
      throw badRequest("Credit op only valid in local-credits mode");
    }
    const input = CreditBody.parse(req.body);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("amount must be positive");
    const shadow = await ensurePartnerShadowUser(
      req.partner!.id,
      input.playerRef,
    );
    const result = await postEntry({
      userId: shadow.id,
      type: "deposit",
      amount,
      refType: "partner_credit",
      refId: input.reference ?? null,
      memo: `Partner credit (${req.partner!.displayName})`,
    });
    res.json({
      playerRef: input.playerRef,
      balance: result.entry.balanceAfter.toString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/wallet/debit", async (req, res, next) => {
  try {
    if (req.partner!.walletMode !== "local-credits") {
      throw badRequest("Debit op only valid in local-credits mode");
    }
    const input = CreditBody.parse(req.body);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw badRequest("amount must be positive");
    const shadow = await ensurePartnerShadowUser(
      req.partner!.id,
      input.playerRef,
    );
    try {
      const result = await postEntry({
        userId: shadow.id,
        type: "withdraw",
        amount: -amount,
        refType: "partner_debit",
        refId: input.reference ?? null,
        memo: `Partner debit (${req.partner!.displayName})`,
      });
      res.json({
        playerRef: input.playerRef,
        balance: result.entry.balanceAfter.toString(),
      });
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS") {
        throw badRequest("Insufficient funds");
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

router.get("/rounds/:id/verify", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(gameRoundsTable)
      .where(eq(gameRoundsTable.id, id))
      .limit(1);
    const round = rows[0];
    if (!round) throw notFound("Round not found");
    if (round.partnerId && round.partnerId !== req.partner!.id) {
      throw forbidden("Round not owned by partner");
    }
    const computedHash = sha256Hex(round.serverSeed);
    const recomputed = deriveCrashPoint(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
      round.houseEdge,
      round.maxMultiplier,
    );
    res.json({
      id: round.id,
      gameCode: round.gameCode,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      crashPoint: round.crashPoint,
      computedCrashPoint: recomputed,
      computedHash,
      verified:
        computedHash === round.serverSeedHash &&
        Math.abs(recomputed - round.crashPoint) < 0.005,
    });
  } catch (err) {
    next(err);
  }
});

const SessionBody = z.object({
  playerRef: z.string().min(1).max(64),
  gameCode: z.string().min(1).max(32),
  currency: z.string().length(3).optional(),
});

/**
 * Mint a single-use launch token for the iframe launcher.
 *
 *   curl -X POST .../v1/sessions \
 *        -H "X-Partner-Key: ..." -H "X-Partner-Timestamp: ..." -H "X-Partner-Signature: ..." \
 *        -d '{"playerRef":"player-123","gameCode":"lunar"}'
 *
 * Returns { token, launchUrl, expiresAt }. The partner builds an iframe
 * pointing at `launchUrl`. Token is valid for 5 minutes and burns on
 * first /api/launcher/exchange call.
 */
router.post("/sessions", async (req, res, next) => {
  try {
    const input = SessionBody.parse(req.body);
    if (!gameAllowed(req.partner!.allowedGames, input.gameCode)) {
      throw forbidden("Game not allowed for this partner");
    }
    const ps = await issueLaunchToken({
      partnerId: req.partner!.id,
      playerRef: input.playerRef,
      gameCode: input.gameCode,
      currency: input.currency,
    });
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.headers.host;
    const launchUrl =
      process.env.LAUNCH_BASE_URL
        ? `${process.env.LAUNCH_BASE_URL}/launch?token=${encodeURIComponent(
            ps.token,
          )}&gameCode=${encodeURIComponent(input.gameCode)}`
        : `${proto}://${host}/launch?token=${encodeURIComponent(
            ps.token,
          )}&gameCode=${encodeURIComponent(input.gameCode)}`;
    res.json({
      token: ps.token,
      launchUrl,
      expiresAt: ps.expiresAt.toISOString(),
      gameCode: ps.gameCode,
      playerRef: ps.playerRef,
      currency: ps.currency,
    });
  } catch (err) {
    next(err);
  }
});

// Convenience: ensure partner wallet row exists and return its float.
router.get("/partner/wallet", async (req, res, next) => {
  try {
    const w = await ensurePartnerWallet(req.partner!.id);
    res.json({ balance: w.balancePaise.toString(), currency: "INR" });
  } catch (err) {
    next(err);
  }
});

export default router;
