import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  bigint,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { partnersTable } from "./partners";

export const gameConfigTable = pgTable("game_config", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  gameCode: text("game_code").notNull().unique(),
  rtpMin: doublePrecision("rtp_min").notNull().default(85),
  rtpMax: doublePrecision("rtp_max").notNull().default(85),
  maxMultiplier: doublePrecision("max_multiplier").notNull().default(1000),
  maxStakePaise: bigint("max_stake_paise", { mode: "bigint" })
    .notNull()
    .default(sql`50000000`),
  houseEdge: doublePrecision("house_edge").notNull().default(0.15),
  // Per-game settlement engine. "house_edge" preserves the legacy per-bet
  // multiplier credit at cashout. "pari_mutuel" pools every bet in the
  // round, takes 5% as company profit, and splits 95% across winners
  // weighted by stake×cashoutMultiplier (see services/roundSettlement.ts).
  // Default is pari_mutuel for the lunar game per task #87.
  settlementMode: text("settlement_mode").notNull().default("house_edge"),
  enabled: boolean("enabled").notNull().default(true),
  // Live, admin-editable round timings (milliseconds). Defaults match the
  // legacy hardcoded constants previously baked into the 3d-game engine so
  // existing rows behave identically after the migration.
  bettingWindowMs: bigint("betting_window_ms", { mode: "number" })
    .notNull()
    .default(5000),
  turboBettingWindowMs: bigint("turbo_betting_window_ms", { mode: "number" })
    .notNull()
    .default(2500),
  interRoundDelayMs: bigint("inter_round_delay_ms", { mode: "number" })
    .notNull()
    .default(2500),
  // Table-game round phases (milliseconds). Only used by the shared
  // table-round engine (roulette/baccarat/blackjack/teen-patti/andar-bahar):
  // bettingWindowMs (above) is the open-bets window, then revealDurationMs
  // ("red" phase — outcome shown), then settleDurationMs (payouts credited)
  // before the next round starts automatically.
  revealDurationMs: bigint("reveal_duration_ms", { mode: "number" })
    .notNull()
    .default(5000),
  settleDurationMs: bigint("settle_duration_ms", { mode: "number" })
    .notNull()
    .default(5000),
  // Minimum stake per wager slip in paise (0 = no minimum).
  minStakePaise: bigint("min_stake_paise", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  // Inclusive bounds for the player-side auto-cashout multiplier.
  minAutoCashout: doublePrecision("min_auto_cashout").notNull().default(1.01),
  maxAutoCashout: doublePrecision("max_auto_cashout").notNull().default(1000),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"),
});

export type GameConfig = typeof gameConfigTable.$inferSelect;

export const gameRoundsTable = pgTable(
  "game_rounds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    gameCode: text("game_code").notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    crashPoint: doublePrecision("crash_point").notNull(),
    // Snapshot of the config used to derive THIS round's crash. Persisting
    // these makes /rounds/:id/verify stable even after admins change the live
    // game_config later.
    houseEdge: doublePrecision("house_edge").notNull().default(0.15),
    maxMultiplier: doublePrecision("max_multiplier").notNull().default(1000),
    totalStake: bigint("total_stake", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalPayout: bigint("total_payout", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    playerCount: bigint("player_count", { mode: "number" })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    partnerId: text("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    partnerRoundId: text("partner_round_id"),
    // Version of the crash-derivation formula used for THIS round. Bump the
    // constant in api-server rtp.ts whenever the formula changes so
    // /rounds/:id/verify can recompute historical rounds with the right math.
    derivationVersion: bigint("derivation_version", { mode: "number" })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    index("game_rounds_game_code_idx").on(t.gameCode),
    index("game_rounds_created_at_idx").on(t.createdAt),
    index("game_rounds_server_seed_hash_idx").on(t.serverSeedHash),
    index("game_rounds_partner_id_idx").on(t.partnerId),
  ],
);

export type GameRound = typeof gameRoundsTable.$inferSelect;
