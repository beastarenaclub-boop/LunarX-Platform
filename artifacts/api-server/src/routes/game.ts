import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
import { ROULETTE_PAYOUT_BASE, ROULETTE_RTP_PERCENT } from "@workspace/api-zod/roulette-game";
import { BACCARAT_RETURNS, BACCARAT_PROBABILITIES, TEEN_PATTI_MAIN_RETURN, TEEN_PATTI_TIE_RETURN, TEEN_PATTI_PAIR_RETURNS, ANDAR_FIRST_RETURN, ANDAR_SECOND_RETURN, ANDAR_RANGE_RETURNS } from "@workspace/api-zod/game-economics";
import { Router, type IRouter } from "express";
import { db, gameRoundsTable, gameConfigTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { requireStepUp } from "../middlewares/stepUp";
import { recordAuditFromReq } from "../lib/audit";
import { notFound, badRequest } from "../lib/errors";
import { isRetiredGame } from "../lib/retiredGames";
import {
  getGameConfig,
  updateGameConfig,
  sha256Hex,
  deriveCrashPoint,
} from "../services/rtp";
import { isTableGame, getRoundCycleStatus } from "../services/tableRounds";
import { z } from "zod";
import { CRAZY_TIME_SPOTS, CRAZY_TIME_RTP } from "@workspace/api-zod/crazy-time-game";

const router: IRouter = Router();

const adminOnly = requireRole("admin", "super_admin");

// ── Static / non-parameterized routes must come first ─────────────────────
// Expose engine classification + editable fields + cap floors per game code.
// Public — no auth required; purely informational metadata.
// MUST be registered before /config/:gameCode to avoid Express routing it to
// the parameterized handler.
router.get("/config/game-type-meta", async (_req, res, next) => {
  try {
    const out: Record<string, ReturnType<typeof serializeGameTypeMeta>> = {};
    for (const code of Object.keys(GAME_TYPE_META)) {
      out[code] = serializeGameTypeMeta(code);
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Public read-only config used by the game client to align its local crash
// derivation with whatever the server is using to settle bets. Returns only
// the fields the engine needs — no audit metadata, no updatedBy.
router.get("/config/:gameCode/public", async (req, res, next) => {
  try {
    const config = await getGameConfig(String(req.params.gameCode));
    if (!config) throw notFound("Game not found");
    res.json({
      gameCode: config.gameCode,
      houseEdge: config.houseEdge,
      maxMultiplier: config.maxMultiplier,
      enabled: config.enabled,
      bettingWindowMs: config.bettingWindowMs,
      turboBettingWindowMs: config.turboBettingWindowMs,
      interRoundDelayMs: config.interRoundDelayMs,
      revealDurationMs: config.revealDurationMs,
      settleDurationMs: config.settleDurationMs,
      minStakePaise: config.minStakePaise.toString(),
      minAutoCashout: config.minAutoCashout,
      maxAutoCashout: config.maxAutoCashout,
      maxStakePaise: config.maxStakePaise.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// Admin: live round-cycle status for shared-round table games. Used by the
// Game Settings page to show the current phase/countdown immediately on load
// (the realtime topic only pushes future transitions, no state replay) and to
// verify that a saved config change was picked up by the next round via the
// per-round config snapshot.
router.get("/config/:gameCode/round-status", adminOnly, async (req, res, next) => {
  try {
    const gameCode = String(req.params.gameCode);
    if (!isTableGame(gameCode)) throw notFound("Not a shared-round table game");
    res.json(await getRoundCycleStatus(gameCode));
  } catch (err) {
    next(err);
  }
});

router.get("/config/:gameCode", adminOnly, async (req, res, next) => {
  try {
    const config = await getGameConfig(String(req.params.gameCode));
    if (!config) throw notFound("Game not found");
    res.json({
      id: config.id,
      gameCode: config.gameCode,
      rtpMin: config.rtpMin,
      rtpMax: config.rtpMax,
      maxMultiplier: config.maxMultiplier,
      maxStakePaise: config.maxStakePaise.toString(),
      houseEdge: config.houseEdge,
      enabled: config.enabled,
      bettingWindowMs: config.bettingWindowMs,
      turboBettingWindowMs: config.turboBettingWindowMs,
      interRoundDelayMs: config.interRoundDelayMs,
      revealDurationMs: config.revealDurationMs,
      settleDurationMs: config.settleDurationMs,
      minStakePaise: config.minStakePaise.toString(),
      minAutoCashout: config.minAutoCashout,
      maxAutoCashout: config.maxAutoCashout,
      updatedAt: config.updatedAt.toISOString(),
      updatedBy: config.updatedBy,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Per-game engine classification used by the admin panel UI and the server-
 * side validation layer. Each entry declares:
 *   - `engineType`   — which mathematical engine drives the game
 *   - `editableFields` — the subset of config fields that actually do
 *                        something for this engine (non-listed fields are
 *                        silently ignored on PUT — UI should not show them)
 *   - `capFloors`    — minimum allowed values for specific fields (enforced
 *                       server-side so admins cannot set a cap below the
 *                       paytable's maximum winning multiplier)
 */
export type EngineType =
  | "crash"
  | "skill"
  | "roulette"
  | "card_fixed"
  | "horse_racing"
  | "lucky7";

export interface GameTypeMeta {
  engineType: EngineType;
  label: string;          // friendly group label shown in admin UI
  editableFields: string[];
  capFloors: Record<string, number>;
  rtpNote: string;        // short explanation shown in admin UI
}

/** Fixed paytable data for card games (read-only, informational). */
export interface PaytableRow {
  outcome: string;
  pays: string;
  theoreticalRtp?: string;
}
export interface CardPaytable {
  rows: PaytableRow[];
  blendedEdge: string;
}

const returns = (table: Record<string, number>): PaytableRow[] => Object.entries(table).map(([outcome, value]) => ({ outcome, pays: (value / 100).toFixed(2) + "× total return", theoreticalRtp: "85% target; rounded down" }));
const teenTable: CardPaytable = { blendedEdge: "15% target, plus downward price rounding", rows: returns({ playerA: TEEN_PATTI_MAIN_RETURN, playerB: TEEN_PATTI_MAIN_RETURN, tie: TEEN_PATTI_TIE_RETURN, ...TEEN_PATTI_PAIR_RETURNS }) };
const CARD_PAYTABLES: Record<string, CardPaytable> = {
  "lucky-7": { blendedEdge: "15%", rows: returns({ under: 204, exactly: 510, over: 204 }) },
  roulette: { blendedEdge: "2.7027%", rows: [1,2,3,4,6,12,18].map(n => ({ outcome: n + " covered pockets", pays: (ROULETTE_PAYOUT_BASE / n).toFixed(4) + "× total return", theoreticalRtp: ROULETTE_RTP_PERCENT.toFixed(4) + "%" })) },
  baccarat: { blendedEdge: "15% target, plus downward price rounding", rows: Object.entries(BACCARAT_RETURNS).map(([outcome, value]) => ({ outcome, pays: (value / 100).toFixed(2) + "× total return", theoreticalRtp: ((BACCARAT_PROBABILITIES[outcome as keyof typeof BACCARAT_PROBABILITIES] * value / 100 + (["player", "banker"].includes(outcome) ? BACCARAT_PROBABILITIES.tie : 0)) * 100).toFixed(2) + "%" })) },
  "teen-patti": teenTable, "teen-patti-live": teenTable,
  "andar-bahar": { blendedEdge: "15% target, plus downward price rounding", rows: returns({ firstSide: ANDAR_FIRST_RETURN, secondSide: ANDAR_SECOND_RETURN, ...ANDAR_RANGE_RETURNS }) },
  blackjack: { blendedEdge: "Strategy dependent; 15% reduction of standard returns", rows: [{outcome:"Win",pays:"1.70× total"},{outcome:"Natural blackjack",pays:"2.125× total"},{outcome:"Draw",pays:"0.85× total"},{outcome:"Insurance win",pays:"2.55× total"}] },
  "vegetable-bowl": { blendedEdge: "15% target, plus downward price rounding", rows: returns({ normal:187, hard:187, risk:1896 }) },
  "crazy-time": { blendedEdge: "15% target, plus downward price rounding", rows: CRAZY_TIME_SPOTS.map(spot => ({outcome:spot.label,pays:"Prize total adjusted by 0.85 / original spot RTP",theoreticalRtp:"85% target"})) },
};

export const GAME_TYPE_META: Record<string, GameTypeMeta> = {
  "wheel-2-live": {
    engineType: "card_fixed", label: "Wheel 2.0 Live · fixed wheel",
    editableFields: ["maxStakePaise", "enabled", "bettingWindowMs", "revealDurationMs", "settleDurationMs", "minStakePaise"],
    capFloors: { maxMultiplier: 321 },
    rtpNote: "54 uniform wheel segments; nine number bets. One uniform bonus number receives a 2×/3×/5×/8× profit boost with 75/20/4/1 weights. Fixed versioned paytable; returns include stake. See player rules for per-selection RTP.",
  },
  "lucky-7-live": {
    engineType: "card_fixed", label: "Lucky 7 Live · cards",
    editableFields: ["maxStakePaise", "enabled", "bettingWindowMs", "revealDurationMs", "settleDurationMs", "minStakePaise"],
    capFloors: { maxMultiplier: 12 },
    rtpNote: "Uniform 52-card draw. Up/Down/Seven/Even RTP 92.3077%; Red/Black 95%; Odd 96.9231%. Fixed profit odds 1:1 / 11:1 / 0.9:1 / 0.8:1. A=1, J=11, Q=12, K=13; Seven loses Up/Down but counts Odd. Versioned paytable per round.",
  },
  ...Object.fromEntries(INSTANT_COLLECTION.map(g => [g.code, {
    engineType: "skill" as const, label: g.name, editableFields: ["enabled", "minStakePaise", "maxStakePaise"], capFloors: {},
    rtpNote: "97% target before payout rounding and multiplier caps. Rules are snapshotted when a round starts.",
  }])) ,
  lottery: {
    engineType: "card_fixed", label: "Irland Lotto",
    editableFields: ["enabled"], capFloors: {},
    rtpNote: "Fixed exact-match returns: 2D 80x, 3D 800x, Titli 8x (80% theoretical RTP). Manage sales, draw interval and ticket limits in the Irland Lotto panel. Scheduled draws retain their original rules.",
  },
  "chicken-road": {
    engineType: "skill", label: "Chicken Road",
    editableFields: ["minStakePaise", "maxStakePaise", "enabled"],
    capFloors: { minStakePaise: 100, maxMultiplier: 1000 },
    rtpNote: "Version 2: guaranteed wins with 100% safe lanes in all four modes. Cashout includes stake and follows the published paytable; the final lane collects automatically. There is no single 100% RTP: return depends on the chosen lane (101% to 100,000% before paise rounding). Generic house-edge and RTP controls do not govern this game. Historical version 1 rounds retain 98% RTP and their original seed replay.",
  },
  "crazy-time": {
    engineType: "card_fixed", label: "Crazy Time virtual wheel",
    editableFields: ["maxStakePaise", "enabled", "bettingWindowMs", "revealDurationMs", "settleDurationMs", "minStakePaise"],
    capFloors: { maxMultiplier: 5001, minStakePaise: 100 },
    rtpNote: "54 equally likely segments; versioned fixed prize distributions. Top Slot multiplies profit, capped at 5,000:1 plus the winning stake. The paytable shows exact per-spot theoretical RTP; house-edge controls do not change these odds. Bonus choices lock with the wager.",
  },
  "vegetable-bowl": {
    engineType: "lucky7", label: "Vegetable Bowl",
    editableFields: ["maxStakePaise", "enabled", "bettingWindowMs", "revealDurationMs", "settleDurationMs", "minStakePaise"],
    capFloors: { maxMultiplier: 20, minStakePaise: 100 },
    rtpNote: "Fixed returns include stake: Normal/Hard 1.98×, Risk 20×. Weighted chances are 1000/2099, 1000/2099 and 99/2099, giving 94.33% theoretical RTP per option before paise rounding. Payout and probability controls are fixed.",
  },
  "bike-racing": {
    engineType: "horse_racing",
    label: "Bike Racing",
    editableFields: ["houseEdge", "minStakePaise", "maxStakePaise", "enabled"],
    capFloors: {},
    rtpNote: "Six equally likely bikes. Return = stake × floor(6 × (1 − edge) × 100) / 100, including stake. " +
      "Odds are saved when each round opens. Shared rounds use 20 seconds betting, 20 seconds racing and 5 seconds results.",
  },
  // ── Crash / plane games ────────────────────────────────────────────────
  ...Object.fromEntries(
    ["jetx","fury"].map(
      (code) => [code, {
        engineType: "crash" as EngineType,
        label: "Crash",
        editableFields: [
          "houseEdge","maxMultiplier","maxStakePaise","enabled",
          "bettingWindowMs","turboBettingWindowMs","interRoundDelayMs",
          "revealDurationMs","settleDurationMs","minStakePaise",
          "minAutoCashout","maxAutoCashout",
        ],
        capFloors: { maxMultiplier: 2 },
        rtpNote:
          "Crash multiplier is derived from house edge: higher edge → earlier average crash. " +
          "Player RTP = (1 − edge). Timing controls govern the server-side round scheduler.",
      } satisfies GameTypeMeta]
    )
  ),
  // ── Skill games (mines / plinko / dice) ────────────────────────────────
  mines: {
    engineType: "skill",
    label: "Skill",
    editableFields: ["houseEdge","maxMultiplier","maxStakePaise","enabled"],
    capFloors: { maxMultiplier: 2 },
    rtpNote:
      "House edge scales the per-tile reveal multiplier. Max multiplier caps the maximum single-bet return. " +
      "Timing controls are not used — the player controls their own pace.",
  },
  plinko: {
    engineType: "skill",
    label: "Skill",
    editableFields: ["houseEdge","maxMultiplier","maxStakePaise","enabled"],
    capFloors: { maxMultiplier: 2 },
    rtpNote: "House edge scales the bucket multiplier table. Max multiplier caps worst-case single-row return.",
  },
  dice: {
    engineType: "skill",
    label: "Skill",
    editableFields: ["houseEdge","maxMultiplier","maxStakePaise","enabled"],
    capFloors: { maxMultiplier: 2 },
    rtpNote: "House edge is baked into the payout formula. Max multiplier caps the maximum win at any target.",
  },
  // ── Roulette (fixed paytable — classic European table) ────────────────
  roulette: {
    engineType: "card_fixed",
    label: "Roulette",
    editableFields: ["maxMultiplier", "maxStakePaise", "enabled", "bettingWindowMs", "revealDurationMs", "settleDurationMs"],
    capFloors: { maxMultiplier: ROULETTE_PAYOUT_BASE },
    rtpNote: "European single-zero roulette: straight 36x, split 18x, street 12x, corner 9x, line 6x, dozen/column 3x, outside 2x total return. RTP 97.2973%; house edge 2.7027%. Per selection per round: minimum Rs10, single number maximum Rs20,000, other selections maximum Rs1,00,000. Round/session profit is not guaranteed.",
  },
  // ── Fixed-paytable card games ──────────────────────────────────────────
  baccarat: {
    engineType: "card_fixed",
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled","bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise"],
    capFloors: { maxMultiplier: 12 }, // Pair side bets 11:1 → 12×
    rtpNote:
      "Baccarat uses a fixed paytable (Banker 0.95:1, Player 1:1, Tie 8:1). " +
      "The house edge and RTP are mathematically determined by the paytable — they cannot be changed from the admin panel. " +
      "Only the stake limit and maximum multiplier cap (must stay ≥ 12 to cover Pair side bets) are operator-adjustable.",
  },
  blackjack: {
    engineType: "card_fixed",
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled","bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise"],
    capFloors: { maxMultiplier: 3 }, // Blackjack 3:2 → 2.5×; splits can reach ~3×
    rtpNote:
      "Blackjack uses a fixed 3:2 paytable. The house edge (~1.5% realized) is set by the rules (S17, 6-deck), not this config. " +
      "Max multiplier must stay ≥ 3 to cover doubled/split hands.",
  },
  "teen-patti": {
    engineType: "card_fixed",
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled","bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise"],
    capFloors: { maxMultiplier: 876 }, // Tie pays 875:1 → 876× return
    rtpNote:
      "Teen Patti 20/20 uses a fixed paytable (main 0.95:1, tie 875:1, Pair Plus up to 35:1). " +
      "The house edge is fixed by the paytable. " +
      "Max multiplier MUST stay ≥ 876 — below that the 875:1 tie bet cannot pay out.",
  },
  "teen-patti-live": {
    engineType: "card_fixed",
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled","bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise"],
    capFloors: { maxMultiplier: 876 }, // Tie pays 875:1 → 876× return
    rtpNote:
      "Teen Patti 20-20 Live is a separate table from Teen Patti 20/20 (own round clock, wallet and history) " +
      "running the identical fixed paytable (main 0.95:1, tie 875:1, Pair Plus up to 35:1). " +
      "The house edge is fixed by the paytable. " +
      "Max multiplier MUST stay ≥ 876 — below that the 875:1 tie bet cannot pay out.",
  },
  "andar-bahar": {
    engineType: "card_fixed",
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled","bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise"],
    capFloors: { maxMultiplier: 130 }, // Top range pays 120:1 → 121×; leave headroom
    rtpNote:
      "Andar Bahar uses fixed asymmetric payouts (0.9:1 / 1:1) plus range side bets (up to 120:1). " +
      "The house edge is determined by the paytable. " +
      "Max multiplier must stay ≥ 130 to cover the top range side-bet (120:1).",
  },
  "sic-bo": {
    engineType: "card_fixed", // dice-based but fixed paytable, same treatment
    label: "Card / Table",
    editableFields: ["maxMultiplier","maxStakePaise","enabled"],
    capFloors: { maxMultiplier: 181 }, // Specific triple 180:1 → 181×
    rtpNote:
      "Sic Bo has a fixed paytable (Small/Big 1:1 through specific triple 180:1). " +
      "Max multiplier must stay ≥ 181 to cover specific triple bets.",
  },
  // ── Lucky 7 (fixed two-dice paytable) ─────────────────────────────────
  "lucky-7": {
    engineType: "lucky7",
    label: "Lucky 7",
    editableFields: [
      "maxMultiplier","maxStakePaise","enabled",
      "bettingWindowMs","revealDurationMs","settleDurationMs","minStakePaise",
    ],
    // The cap must cover the full fixed return on Exactly 7.
    capFloors: { maxMultiplier: 12 },
    rtpNote:
      "Lucky 7 pays 2× total return on Under 7 and Over 7, and 12× on Exactly 7, including stake. " +
      "A total of 7 loses both Under and Over bets. With two fair dice, theoretical RTP is " +
      "83.33% on Under/Over and 200% on Exactly 7. House-edge settings do not scale these fixed payouts. " +
      "Max multiplier must stay ≥ 12.",
  },
  // ── Horse racing (Wild Trails) ─────────────────────────────────────────
  "horse-racing": {
    engineType: "horse_racing",
    label: "Horse Racing",
    editableFields: ["houseEdge","maxStakePaise","enabled"],
    capFloors: {},
    rtpNote:
      "Wild Trails uses fixed-odds win bets: payout = stake × (1 − edge) / winProb. " +
      "Changing house edge shifts all odds simultaneously. " +
      "Round timings and multiplier cap are not used for pari-mutuel / fixed-odds racing.",
  },
};

for (const code of ["lucky-7", "baccarat", "teen-patti", "teen-patti-live", "andar-bahar", "vegetable-bowl", "crazy-time", "chicken-road"]) {
  GAME_TYPE_META[code].rtpNote = "New rounds target 85% theoretical RTP (15% expected house margin), before posted price rounding and caps. Accepted rounds retain their original version. RTP does not guarantee a round or session profit.";
}
GAME_TYPE_META.blackjack.rtpNote = "New hands pay 85% of standard total returns, including draws and insurance. Aborted games are fully refunded. Actual RTP depends on player strategy; it is not a fixed 85%.";

/** Serialisable subset — sent to the admin panel as GET /config/game-type-meta */
function serializeGameTypeMeta(code: string): (GameTypeMeta & { gameCode: string; paytable?: CardPaytable }) | null {
  const m = GAME_TYPE_META[code];
  if (!m) return null;
  return {
    gameCode: code,
    ...m,
    ...(CARD_PAYTABLES[code] ? { paytable: CARD_PAYTABLES[code] } : {}),
  };
}

export const UpdateConfigBody = z.object({
  rtpMin: z.number().min(0).max(100).optional(),
  rtpMax: z.number().min(0).max(100).optional(),
  maxMultiplier: z.number().min(2).max(100000).optional(),
  maxStakePaise: z.string().regex(/^\d{1,18}$/).optional(),
  houseEdge: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
  // Round timings, milliseconds. Bounded to keep the player UI responsive
  // and prevent absurd values (e.g. 0s betting window) from breaking the
  // engine. 1s..30s for windows, 0.5s..15s for inter-round delay.
  bettingWindowMs: z.number().int().min(1000).max(120000).optional(),
  // Table-round phases (reveal/"red" and settlement), milliseconds.
  revealDurationMs: z.number().int().min(1000).max(60000).optional(),
  settleDurationMs: z.number().int().min(1000).max(60000).optional(),
  // Minimum stake per wager slip, paise ("0" disables the minimum).
  minStakePaise: z.string().regex(/^\d{1,18}$/).optional(),
  turboBettingWindowMs: z.number().int().min(500).max(30000).optional(),
  interRoundDelayMs: z.number().int().min(500).max(15000).optional(),
  minAutoCashout: z.number().min(1.01).max(1000).optional(),
  maxAutoCashout: z.number().min(1.01).max(100000).optional(),
});

router.put(
  "/config/:gameCode",
  adminOnly,
  requireStepUp,
  async (req, res, next) => {
    try {
      const gameCode = String(req.params.gameCode);
      const input = UpdateConfigBody.parse(req.body);
      const before = await getGameConfig(gameCode);
      if (!before) throw notFound("Game not found");

      // ── Per-engine validation ──────────────────────────────────────────
      const typeMeta = GAME_TYPE_META[gameCode];
      if (typeMeta) {
        const editable = new Set(typeMeta.editableFields);
        // Reject fields that are not editable for this engine type.
        const ALL_FIELDS = [
          "rtpMin","rtpMax","houseEdge","maxMultiplier","maxStakePaise",
          "bettingWindowMs","turboBettingWindowMs","interRoundDelayMs",
          "revealDurationMs","settleDurationMs","minStakePaise",
          "minAutoCashout","maxAutoCashout",
        ] as const;
        for (const field of ALL_FIELDS) {
          if (input[field] !== undefined && !editable.has(field)) {
            throw badRequest(
              `Field "${field}" is not configurable for ${typeMeta.label} games (${gameCode}). ` +
              `Editable fields: ${[...editable].join(", ")}.`,
            );
          }
        }
        // Enforce cap floors (e.g. teen-patti maxMultiplier ≥ 876).
        if (input.maxMultiplier !== undefined) {
          for (const [field, floor] of Object.entries(typeMeta.capFloors)) {
            if (field === "maxMultiplier" && input.maxMultiplier < floor) {
              throw badRequest(
                `maxMultiplier for ${gameCode} cannot go below ${floor} ` +
                `(the paytable contains a winning bet that pays up to ${floor - 1}:1). ` +
                `Set a value ≥ ${floor}.`,
              );
            }
          }
        }
      }

      const patch: Record<string, unknown> = {};
      if (input.rtpMin !== undefined) patch.rtpMin = input.rtpMin;
      if (input.rtpMax !== undefined) patch.rtpMax = input.rtpMax;
      if (input.maxMultiplier !== undefined)
        patch.maxMultiplier = input.maxMultiplier;
      if (input.maxStakePaise !== undefined)
        patch.maxStakePaise = BigInt(input.maxStakePaise);
      if (input.houseEdge !== undefined) patch.houseEdge = input.houseEdge;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.bettingWindowMs !== undefined)
        patch.bettingWindowMs = input.bettingWindowMs;
      if (input.revealDurationMs !== undefined)
        patch.revealDurationMs = input.revealDurationMs;
      if (input.settleDurationMs !== undefined)
        patch.settleDurationMs = input.settleDurationMs;
      if (input.minStakePaise !== undefined)
        patch.minStakePaise = BigInt(input.minStakePaise);
      if (input.turboBettingWindowMs !== undefined)
        patch.turboBettingWindowMs = input.turboBettingWindowMs;
      if (input.interRoundDelayMs !== undefined)
        patch.interRoundDelayMs = input.interRoundDelayMs;
      if (input.minAutoCashout !== undefined)
        patch.minAutoCashout = input.minAutoCashout;
      if (input.maxAutoCashout !== undefined)
        patch.maxAutoCashout = input.maxAutoCashout;

      if (Object.keys(patch).length === 0) throw badRequest("No changes");

      // Cross-field sanity: max must be >= min for the auto-cashout band.
      const finalMin =
        input.minAutoCashout ?? before.minAutoCashout;
      const finalMax =
        input.maxAutoCashout ?? before.maxAutoCashout;
      if (finalMax < finalMin) {
        throw badRequest("maxAutoCashout must be >= minAutoCashout");
      }
      const finalMinStake =
        input.minStakePaise !== undefined
          ? BigInt(input.minStakePaise)
          : before.minStakePaise;
      const finalMaxStake =
        input.maxStakePaise !== undefined
          ? BigInt(input.maxStakePaise)
          : before.maxStakePaise;
      if (finalMinStake > finalMaxStake) {
        throw badRequest("minStakePaise must be <= maxStakePaise");
      }

      const updated = await updateGameConfig(
        gameCode,
        patch as never,
        req.user!.id,
      );

      await recordAuditFromReq(req, {
        action: "rtp.config_update",
        targetType: "game_config",
        targetId: gameCode,
        before: {
          rtpMin: before.rtpMin,
          rtpMax: before.rtpMax,
          maxMultiplier: before.maxMultiplier,
          maxStakePaise: before.maxStakePaise.toString(),
          houseEdge: before.houseEdge,
          enabled: before.enabled,
          bettingWindowMs: before.bettingWindowMs,
          turboBettingWindowMs: before.turboBettingWindowMs,
          interRoundDelayMs: before.interRoundDelayMs,
          revealDurationMs: before.revealDurationMs,
          settleDurationMs: before.settleDurationMs,
          minStakePaise: before.minStakePaise.toString(),
          minAutoCashout: before.minAutoCashout,
          maxAutoCashout: before.maxAutoCashout,
        },
        after: {
          rtpMin: updated.rtpMin,
          rtpMax: updated.rtpMax,
          maxMultiplier: updated.maxMultiplier,
          maxStakePaise: updated.maxStakePaise.toString(),
          houseEdge: updated.houseEdge,
          enabled: updated.enabled,
          bettingWindowMs: updated.bettingWindowMs,
          turboBettingWindowMs: updated.turboBettingWindowMs,
          interRoundDelayMs: updated.interRoundDelayMs,
          revealDurationMs: updated.revealDurationMs,
          settleDurationMs: updated.settleDurationMs,
          minStakePaise: updated.minStakePaise.toString(),
          minAutoCashout: updated.minAutoCashout,
          maxAutoCashout: updated.maxAutoCashout,
        },
      });

      res.json({
        id: updated.id,
        gameCode: updated.gameCode,
        rtpMin: updated.rtpMin,
        rtpMax: updated.rtpMax,
        maxMultiplier: updated.maxMultiplier,
        maxStakePaise: updated.maxStakePaise.toString(),
        houseEdge: updated.houseEdge,
        enabled: updated.enabled,
        bettingWindowMs: updated.bettingWindowMs,
        turboBettingWindowMs: updated.turboBettingWindowMs,
        interRoundDelayMs: updated.interRoundDelayMs,
        revealDurationMs: updated.revealDurationMs,
        settleDurationMs: updated.settleDurationMs,
        minStakePaise: updated.minStakePaise.toString(),
        minAutoCashout: updated.minAutoCashout,
        maxAutoCashout: updated.maxAutoCashout,
        updatedAt: updated.updatedAt.toISOString(),
        updatedBy: updated.updatedBy,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Public lobby registry — what games exist, their display titles, player-app
// routes, and live `enabled` status. Player apps consume this so the lobby
// hides/shows "SOON" badges based on real config rather than hard-coding.
const GAME_META: Record<string, { title: string; route: string }> = {
  ...Object.fromEntries(INSTANT_COLLECTION.map(g => [g.code, { title: g.name, route: `/${g.code}` }])),
  "crazy-time": { title: "Crazy Time", route: "/crazy-time" },
  "vegetable-bowl": { title: "Vegetable Bowl", route: "/vegetable-bowl" },
  lottery: { title: "Irland Lotto", route: "/lottery" },
  "chicken-road": { title: "Chicken Road", route: "/chicken-road" },
  mines: { title: "Mines", route: "/mines" },
  plinko: { title: "Plinko", route: "/plinko" },
  dice: { title: "Dice", route: "/dice" },
  jetx: { title: "JetX", route: "/jetx" },
  fury: { title: "Fury Flight", route: "/fury" },
  "bike-racing": { title: "Bike Racing", route: "/bike-racing" },
  "horse-racing": { title: "Wild Trails", route: "/horse-riding" },
  roulette: { title: "Roulette", route: "/roulette" },
  baccarat: { title: "Baccarat VIP", route: "/baccarat" },
  blackjack: { title: "Blackjack", route: "/blackjack" },
  "teen-patti": { title: "Teen Patti 20/20", route: "/teen-patti" },
  "teen-patti-live": { title: "Teen Patti 20-20 Live", route: "/teen-patti-live" },
  "sic-bo": { title: "Sic Bo", route: "/sic-bo" },
  "andar-bahar": { title: "Andar Bahar", route: "/andar-bahar" },
  "lucky-7": { title: "Lucky 7", route: "/lucky-7" },
  "wheel-2-live": { title: "Wheel 2.0 Live", route: "/wheel-2-live" },
  "lucky-7-live": { title: "Lucky 7 Live", route: "/lucky-7-live" },
};

router.get("/registry", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        gameCode: gameConfigTable.gameCode,
        enabled: gameConfigTable.enabled,
        maxMultiplier: gameConfigTable.maxMultiplier,
        maxStakePaise: gameConfigTable.maxStakePaise,
      })
      .from(gameConfigTable);
    const out = rows
      .filter((r) => !isRetiredGame(r.gameCode))
      .map((r) => {
        const meta = GAME_META[r.gameCode] ?? {
          title: r.gameCode,
          route: `/${r.gameCode}`,
        };
        return {
          gameCode: r.gameCode,
          title: meta.title,
          route: meta.route,
          enabled: r.enabled,
          maxMultiplier: r.maxMultiplier,
          maxStakePaise: r.maxStakePaise.toString(),
        };
      })
      .sort((a, b) => a.gameCode.localeCompare(b.gameCode));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get("/rounds", async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
      100,
    );
    const rows = await db
      .select()
      .from(gameRoundsTable)
      .orderBy(desc(gameRoundsTable.createdAt))
      .limit(limit);
    res.json(
      rows.map((r) => ({
        id: r.id,
        gameCode: r.gameCode,
        serverSeedHash: r.serverSeedHash,
        clientSeed: r.clientSeed,
        nonce: r.nonce,
        crashPoint: r.crashPoint,
        totalStake: r.totalStake.toString(),
        totalPayout: r.totalPayout.toString(),
        playerCount: r.playerCount,
        createdAt: r.createdAt.toISOString(),
      })),
    );
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

    const computedHash = sha256Hex(round.serverSeed);
    // Use the per-round config snapshot so historical verification stays
    // stable even after the live game_config is changed by an admin.
    const recomputed = deriveCrashPoint(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
      round.houseEdge,
      round.maxMultiplier,
      round.derivationVersion,
    );
    const hashMatch = computedHash === round.serverSeedHash;
    const crashMatch = Math.abs(recomputed - round.crashPoint) < 0.005;

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
      hashMatch,
      crashMatch,
      verified: hashMatch && crashMatch,
      createdAt: round.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
