import { RETIRED_GAME_CODES } from "./retiredGames";
import { POKER_GAMES, POKER_CONFIG } from "@workspace/api-zod/poker";
import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
import { JOKER_GAME, JOKER_TIMING } from "@workspace/api-zod/teenpatti-joker";
import { W20_GAME, W20_TIMING, W20_RTP } from "@workspace/api-zod/wheel20-live";
import { L7_GAME, L7_TIMING } from "@workspace/api-zod/lucky7-live";
import { db, usersTable, rolesTable, gameConfigTable } from "@workspace/db";
import { ROULETTE_HOUSE_EDGE, ROULETTE_PAYOUT_BASE, ROULETTE_RTP_PERCENT, ROULETTE_LIMITS } from "@workspace/api-zod/roulette-game";
import { and, eq, inArray } from "drizzle-orm";
import { hashPassword } from "./password";
import { normalizeEmail } from "../services/auth";
import { logger } from "./logger";
import { VEGETABLE_RTP } from "@workspace/api-zod/vegetable-game";
import { MEGA_BALL_TIMING, MEGA_BALL_MAX_RETURN } from "@workspace/api-zod/mega-ball";
import { CRAZY_TIME_RTP, CRAZY_TIME_ROUND_TIMING } from "@workspace/api-zod/crazy-time-game";

/**
 * Print a safe identifier for the connected DB so operators can confirm at a
 * glance that all artifacts are pointing at the production database. The
 * password and any query string are stripped before logging.
 */
export function logDatabaseTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  let safe = "<unset>";
  try {
    const u = new URL(url);
    const host = u.hostname || "<no-host>";
    const port = u.port ? `:${u.port}` : "";
    const dbName = u.pathname.replace(/^\//, "") || "<no-db>";
    const user = u.username ? `${u.username}@` : "";
    safe = `${u.protocol}//${user}${host}${port}/${dbName}`;
  } catch {
    safe = "<invalid DATABASE_URL>";
  }
  logger.info({ database: safe }, "Connected to database");
}

/**
 * Seed game defaults and retire removed games. Idempotent on every boot;
 * existing config and historical settlement data are preserved.
 */
export async function ensureGameConfigDefaults(): Promise<void> {
  await db.insert(gameConfigTable).values({ gameCode:"ludo", enabled:true, settlementMode:"house_edge", houseEdge:0.10, rtpMin:90, rtpMax:90, maxMultiplier:3.6, minStakePaise:1000n, maxStakePaise:50000n, bettingWindowMs:20000 }).onConflictDoNothing();
  for (const gameCode of POKER_GAMES) {
    await db.insert(gameConfigTable).values({ gameCode, enabled: true, settlementMode: "house_edge",
      minStakePaise: BigInt(POKER_CONFIG.minStakePaise), maxStakePaise: BigInt(POKER_CONFIG.maxStakePaise),
      maxMultiplier: 3000, bettingWindowMs: POKER_CONFIG.bettingMs[gameCode],
    }).onConflictDoNothing();
  }
  await db.insert(gameConfigTable).values({ gameCode: JOKER_GAME, enabled: true, settlementMode: "house_edge", houseEdge: 0.02, rtpMin: 93.75, rtpMax: 100, maxMultiplier: 3.75, minStakePaise: 1000n, maxStakePaise: 20_000_000n, ...JOKER_TIMING }).onConflictDoNothing();
  // Upgrade only the original studio timing. Custom settings and the saved
  // deadlines of rounds already in progress remain intact.
  await db.update(gameConfigTable).set(JOKER_TIMING).where(and(
    eq(gameConfigTable.gameCode, JOKER_GAME),
    eq(gameConfigTable.bettingWindowMs, 20_000),
    eq(gameConfigTable.revealDurationMs, 7_000),
    eq(gameConfigTable.settleDurationMs, 6_000),
  ));
  await db.insert(gameConfigTable).values({ gameCode: W20_GAME, enabled: true, settlementMode: "house_edge", houseEdge: 1 - Math.max(...Object.values(W20_RTP)), rtpMin: Math.min(...Object.values(W20_RTP)) * 100, rtpMax: Math.max(...Object.values(W20_RTP)) * 100, maxMultiplier: 321, minStakePaise: 1000n, maxStakePaise: 20_000_000n, ...W20_TIMING }).onConflictDoNothing();
  // Remove retired games from player/admin registries without touching bet history.
  await db.delete(gameConfigTable).where(inArray(gameConfigTable.gameCode, ["redjet", "redy", "vortex-2", "propel-x", "nomad", "aviatrix", "aviajet", "skydot", "vortex", "orizon"]));
  await db.insert(gameConfigTable).values({
    gameCode: L7_GAME, enabled: true, rtpMin: 1200 / 13, rtpMax: 1260 / 13,
    houseEdge: 1 / 13, maxMultiplier: 12, settlementMode: "house_edge",
    minStakePaise: 5000n, maxStakePaise: 20_000_000n, ...L7_TIMING,
  }).onConflictDoNothing();
  for (const game of INSTANT_COLLECTION) {
    await db.insert(gameConfigTable).values({ gameCode: game.code, enabled: true, rtpMin: 97, rtpMax: 97,
      houseEdge: .03, maxMultiplier: 1000, settlementMode: "house_edge", minStakePaise: 100n, maxStakePaise: 1_000_000n,
      ...(game.code === "7up7down" ? { bettingWindowMs: 12_000, revealDurationMs: 3_000, settleDurationMs: 4_000 } : {}),
    }).onConflictDoNothing();
  }
  const [sevenTiming] = await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode, "7up7down"));
  if (sevenTiming?.bettingWindowMs === 5_000 && sevenTiming.revealDurationMs === 5_000 && sevenTiming.settleDurationMs === 5_000) {
    await db.update(gameConfigTable).set({ bettingWindowMs: 12_000, revealDurationMs: 3_000, settleDurationMs: 4_000 }).where(eq(gameConfigTable.gameCode, "7up7down"));
  }
  await db.insert(gameConfigTable).values({
    gameCode: "lottery", enabled: true, rtpMin: 80, rtpMax: 80,
    houseEdge: 0.20, maxMultiplier: 800, settlementMode: "house_edge",
    minStakePaise: 10000n, maxStakePaise: 2000000n,
  }).onConflictDoNothing();
  await db.insert(gameConfigTable).values({
    gameCode: "chicken-road", enabled: true, rtpMin: 98, rtpMax: 98,
    houseEdge: 0.02, maxMultiplier: 1000, settlementMode: "house_edge",
    minStakePaise: 100n, maxStakePaise: 1_000_000n,
  }).onConflictDoNothing();
  await db.insert(gameConfigTable).values({
    gameCode: "vegetable-bowl", enabled: true,
    rtpMin: VEGETABLE_RTP * 100, rtpMax: VEGETABLE_RTP * 100,
    houseEdge: 1 - VEGETABLE_RTP, maxMultiplier: 20,
    settlementMode: "house_edge", minStakePaise: 100n, maxStakePaise: 1_000_000n,
    bettingWindowMs: 20_000, revealDurationMs: 18_000, settleDurationMs: 5_000,
  }).onConflictDoNothing();
  const [vegetableConfig] = await db.select().from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, "vegetable-bowl")).limit(1);
  if (vegetableConfig && vegetableConfig.revealDurationMs < 18_000) {
    await db.update(gameConfigTable).set({ revealDurationMs: 18_000 })
      .where(eq(gameConfigTable.gameCode, "vegetable-bowl"));
  }
  // Preserve old config for settlement, but never reopen retired games.
  await db.update(gameConfigTable).set({ enabled: false })
    .where(inArray(gameConfigTable.gameCode, [...RETIRED_GAME_CODES]));

  // Per-game defaults for games that aren't shipped yet. Disabled by default;
  // each game's own task flips `enabled` once its engine + UI lands.
  const otherGames: Array<{
    gameCode: string;
    rtpMin: number;
    rtpMax: number;
    houseEdge: number;
    maxMultiplier: number;
    maxStakePaise: bigint;
    settlementMode?: string;
    minStakePaise?: bigint;
    bettingWindowMs?: number;
    revealDurationMs?: number;
    settleDurationMs?: number;
  }> = [
    {
      gameCode: "mines",
      rtpMin: 96,
      rtpMax: 96,
      houseEdge: 0.04,
      maxMultiplier: 1000,
      maxStakePaise: 50_000_000n,
    },
    {
      gameCode: "plinko",
      rtpMin: 96,
      rtpMax: 96,
      houseEdge: 0.04,
      maxMultiplier: 1000,
      maxStakePaise: 50_000_000n,
    },
    {
      gameCode: "dice",
      rtpMin: 96,
      rtpMax: 96,
      houseEdge: 0.04,
      maxMultiplier: 9900,
      maxStakePaise: 50_000_000n,
    },
    // Remaining crash games share an engine, with separate RTP config.
    ...[
      "jetx",
      "fury",
    ].map((gameCode) => ({
      gameCode,
      rtpMin: 97,
      rtpMax: 97,
      houseEdge: 0.03,
      maxMultiplier: 1000,
      maxStakePaise: 50_000_000n,
    })),
    // Horse racing (Wild Trails) — fixed-odds win bets, 3% house edge.
    // Payout multipliers are derived per horse as (1 - houseEdge) / winProb,
    // so maxMultiplier just needs to cover the longest shot (~12x).
    {
      gameCode: "horse-racing",
      rtpMin: 97,
      rtpMax: 97,
      houseEdge: 0.03,
      maxMultiplier: 20,
      maxStakePaise: 50_000_000n,
      // Fixed-odds win bets pay stake × odds immediately — NOT pari-mutuel.
      // Without this the cashout defers the credit to a round settlement
      // that never happens for one-shot games.
      settlementMode: "house_edge",
    },
    // Table games — seeded disabled; each game's build task flips `enabled`
    // when its engine + UI ships. All are one-shot house-edge games (bets pay
    // immediately at settlement, not pari-mutuel). House edges follow real
    // casino math per game; see docs/table-games-economics.md.
    {
      // Fixed European paytable: 36x straight return, 1/37 house edge.
      gameCode: "roulette",
      bettingWindowMs: 25_000,
      rtpMin: ROULETTE_RTP_PERCENT,
      rtpMax: ROULETTE_RTP_PERCENT,
      houseEdge: ROULETTE_HOUSE_EDGE,
      maxMultiplier: ROULETTE_PAYOUT_BASE,
      minStakePaise: BigInt(ROULETTE_LIMITS.minBetPaise),
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Baccarat (8-deck): Banker ~1.06%, Player ~1.24% — blended ~1.2%.
      gameCode: "baccarat",
      rtpMin: 98,
      rtpMax: 99,
      houseEdge: 0.012,
      maxMultiplier: 12, // Pair side bets pay 11:1 → 12x total return (Tie 8:1 → 9x)
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Blackjack (6-deck, 3:2, S17): ~0.6% base edge; player mistakes push
      // realized hold higher — we budget 1.5% realized.
      gameCode: "blackjack",
      rtpMin: 98,
      rtpMax: 99,
      houseEdge: 0.015,
      maxMultiplier: 3, // blackjack 3:2 → 2.5x total return; splits/doubles < 3x per unit
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Teen Patti 20/20 style (Player A vs Player B + side bets): ~3%.
      gameCode: "teen-patti",
      rtpMin: 96,
      rtpMax: 97,
      houseEdge: 0.03,
      maxMultiplier: 1000, // tie bet pays 875:1 (876x return) — must fit
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Teen Patti 20-20 LIVE (3D live table): a separate game from the flat
      // teen-patti table with its own clock, wallet and history, but the
      // identical five markets and fixed paytable — so the same ~3% budget
      // and the same 876x tie headroom apply.
      gameCode: "teen-patti-live",
      rtpMin: 96,
      rtpMax: 97,
      houseEdge: 0.03,
      maxMultiplier: 1000, // tie bet pays 875:1 (876x return) — must fit
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Sic Bo (3 dice): Small/Big ~2.78%; exotic bets higher — ~2.8% budget.
      gameCode: "sic-bo",
      rtpMin: 97,
      rtpMax: 97,
      houseEdge: 0.028,
      maxMultiplier: 181, // specific triple pays 180:1 → 181x total return
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Andar Bahar: ~2.5% via asymmetric payouts (0.9:1 / 1:1 by side).
      gameCode: "andar-bahar",
      rtpMin: 97,
      rtpMax: 98,
      houseEdge: 0.025,
      maxMultiplier: 130, // range side bet 41–49 pays 120:1 → 121x total return
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
    {
      // Fixed total returns: Under/Over 2×, Exactly 7 12×. The legacy RTP
      // fields remain for compatibility; the per-spot paytable defines RTP.
      gameCode: "lucky-7",
      rtpMin: 97,
      rtpMax: 97,
      houseEdge: 0.03,
      maxMultiplier: 12, // cover the full Exactly 7 return
      maxStakePaise: 50_000_000n,
      settlementMode: "house_edge",
    },
  ];

  // Games that have shipped their engine + UI — fresh inserts default to
  // enabled=true. Admins can disable any game at runtime via /admin and
  // their choice persists across restarts (we never overwrite an existing
  // row's `enabled` flag — onConflictDoNothing protects admin intent).
  const SHIPPED: ReadonlySet<string> = new Set([
    "mines",
    "plinko",
    "dice",
    "jetx",
    "fury",
    "horse-racing",
    "roulette",
    "baccarat",
    "teen-patti",
    "teen-patti-live",
    "blackjack",
    "andar-bahar",
    "lucky-7",
  ]);

  for (const g of otherGames) {
    await db
      .insert(gameConfigTable)
      .values({
        gameCode: g.gameCode,
        rtpMin: g.rtpMin,
        rtpMax: g.rtpMax,
        houseEdge: g.houseEdge,
        maxMultiplier: g.maxMultiplier,
        maxStakePaise: g.maxStakePaise,
        enabled: SHIPPED.has(g.gameCode),
        ...(g.gameCode === "jetx" || g.gameCode === "fury"
          ? { bettingWindowMs: 15_000, turboBettingWindowMs: 15_000 }
          : {}),
        ...(g.settlementMode ? { settlementMode: g.settlementMode } : {}),
      })
      .onConflictDoNothing();
  }
  await db.insert(gameConfigTable).values({
    gameCode: "bike-racing", enabled: true, rtpMin: 96, rtpMax: 98,
    houseEdge: 0.03, maxMultiplier: 6, minStakePaise: 100n,
    maxStakePaise: 1_000_000_000_000n, bettingWindowMs: 20_000,
    revealDurationMs: 20_000, settleDurationMs: 5_000,
  }).onConflictDoNothing();
  // Upgrade older Lucky 7 caps so a 12× return can never be truncated.
  const [lucky7Config] = await db.select().from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, "lucky-7")).limit(1);
  if (lucky7Config && lucky7Config.maxMultiplier < 12) {
    await db.update(gameConfigTable).set({ maxMultiplier: 12 })
      .where(eq(gameConfigTable.gameCode, "lucky-7"));
  }

  // One-time enablement: if a SHIPPED game was previously seeded with
  // enabled=false from an older deploy AND has no settled rounds yet, flip
  // it on. Once any round exists OR an admin has touched the row
  // (updatedBy is set), we never auto-overwrite — admin intent wins.
  for (const code of SHIPPED) {
    const row = (
      await db
        .select()
        .from(gameConfigTable)
        .where(eq(gameConfigTable.gameCode, code))
        .limit(1)
    )[0];
    if (row && !row.enabled && row.updatedBy === null) {
      await db
        .update(gameConfigTable)
        .set({ enabled: true })
        .where(eq(gameConfigTable.gameCode, code));
    }
  }
  // One-time upgrade: teen-patti was originally seeded with maxMultiplier
  // 100, but its tie bet pays 875:1 (876x return). Raise any existing row
  // below 876 to 1000 so tie settlements aren't silently truncated. An
  // operator cap intentionally set >= 876 is preserved.
  const tpRow = (
    await db
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, "teen-patti"))
      .limit(1)
  )[0];
  if (tpRow && tpRow.maxMultiplier < 876) {
    await db
      .update(gameConfigTable)
      .set({ maxMultiplier: 1000 })
      .where(eq(gameConfigTable.gameCode, "teen-patti"));
    logger.info(
      { from: tpRow.maxMultiplier, to: 1000 },
      "Upgraded teen-patti maxMultiplier for 875:1 tie payout",
    );
  }
  // One-time correction: andar-bahar was pre-seeded with maxMultiplier=4
  // before the range side bets (top range pays 120:1 → 121x return) were
  // designed. Bump untouched rows to the shipped default; admin-edited rows
  // (updatedBy set) are left alone.
  {
    const ab = (
      await db
        .select()
        .from(gameConfigTable)
        .where(eq(gameConfigTable.gameCode, "andar-bahar"))
        .limit(1)
    )[0];
    if (ab && ab.updatedBy === null && ab.maxMultiplier < 130) {
      await db
        .update(gameConfigTable)
        .set({ maxMultiplier: 130 })
        .where(eq(gameConfigTable.gameCode, "andar-bahar"));
      logger.info("andar-bahar maxMultiplier raised to 130 (range side bets)");
    }
  }
  // One-time upgrade: the table games run shared server-scheduled rounds
  // with 30s betting for Andar Bahar, 25s for roulette, 20s for Lucky 7 and
  // Teen Patti Live, and 50s for the remaining tables.
  // The client shows reveal+settle as one result window. Rows untouched by an
  // admin are bumped to these defaults; admin-edited rows are left alone.
  // Stakes are effectively uncapped per operator request (server still
  // validates the value is a positive amount).
  const TABLE_ROUND_GAMES = [
    "roulette",
    "baccarat",
    "blackjack",
    "teen-patti",
    "teen-patti-live",
    "andar-bahar",
    "lucky-7",
  ] as const;
  // ₹100 crore per slip — effectively no limit for players, while keeping
  // stake × maxMultiplier (up to 1000×) within JS safe-integer arithmetic
  // used by the shared settlement path (1e12 × 1000 = 1e15 < 2^53).
  const TABLE_MAX_STAKE_PAISE = 1_000_000_000_000n;
  for (const code of TABLE_ROUND_GAMES) {
    const row = (
      await db
        .select()
        .from(gameConfigTable)
        .where(eq(gameConfigTable.gameCode, code))
        .limit(1)
    )[0];
    if (!row || row.updatedBy !== null) continue;
    const set: Record<string, unknown> = {};
    const bettingWindowMs = code === "andar-bahar" ? 30_000 : code === "roulette" ? 25_000 : code === "lucky-7" || code === "teen-patti-live" ? 20_000 : 50_000;
    if (row.bettingWindowMs !== bettingWindowMs) {
      set.bettingWindowMs = bettingWindowMs;
      set.settleDurationMs = 5_000;
    }
    const revealDurationMs = code === "teen-patti-live" ? 9_000 : 5_000;
    if (row.revealDurationMs !== revealDurationMs) set.revealDurationMs = revealDurationMs;
    if (BigInt(row.maxStakePaise) < TABLE_MAX_STAKE_PAISE) {
      set.maxStakePaise = TABLE_MAX_STAKE_PAISE;
    }
    if (Object.keys(set).length > 0) {
      await db
        .update(gameConfigTable)
        .set(set)
        .where(eq(gameConfigTable.gameCode, code));
      logger.info(
        { gameCode: code, set },
        "Table game round timing defaults and stake limit applied",
      );
    }
  }
  logger.info(
    { games: otherGames.map((g) => g.gameCode) },
    "Multi-game config seeded (disabled until each game ships)",
  );
  await db.insert(gameConfigTable).values({ gameCode: "mega-ball", enabled: true, settlementMode: "house_edge", minStakePaise: 100n, maxStakePaise: 1_000_000n, maxMultiplier: MEGA_BALL_MAX_RETURN, ...MEGA_BALL_TIMING }).onConflictDoNothing();
  // Crazy Time has its own filmed-show pacing; coin limits stay shared.
  const [luckyTiming] = await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode, "lucky-7")).limit(1);
  await db.insert(gameConfigTable).values({
    gameCode: "crazy-time", enabled: true, settlementMode: "house_edge",
    houseEdge: 1 - Math.max(...Object.values(CRAZY_TIME_RTP)),
    rtpMin: Math.min(...Object.values(CRAZY_TIME_RTP)) * 100,
    rtpMax: Math.max(...Object.values(CRAZY_TIME_RTP)) * 100, maxMultiplier: 5001,
    minStakePaise: luckyTiming?.minStakePaise ?? 100n,
    maxStakePaise: luckyTiming?.maxStakePaise ?? 1_000_000_000_000n,
    ...CRAZY_TIME_ROUND_TIMING,
  }).onConflictDoNothing();
  // Upgrade the original uncustomized defaults once. Subsequent operator
  // timing choices continue to survive restarts.
  const [crazyTiming] = await db.select().from(gameConfigTable)
    .where(eq(gameConfigTable.gameCode, "crazy-time")).limit(1);
  if (crazyTiming && crazyTiming.updatedBy == null
      && ((crazyTiming.bettingWindowMs === 20_000
      && crazyTiming.revealDurationMs === 5_000
      && crazyTiming.settleDurationMs === 5_000)
      || (crazyTiming.bettingWindowMs === 30_000
      && crazyTiming.revealDurationMs === 12_000
      && crazyTiming.settleDurationMs === 8_000))) {
    await db.update(gameConfigTable).set({ ...CRAZY_TIME_ROUND_TIMING, updatedAt: new Date() })
      .where(eq(gameConfigTable.gameCode, "crazy-time"));
    logger.info(CRAZY_TIME_ROUND_TIMING, "Crazy Time studio timings upgraded");
  }
  // Apply the operator's 85% target to future rounds only. Every open round
  // retains its persisted payout version/configuration.
  await db.update(gameConfigTable).set({ houseEdge: 0.15, rtpMin: 85, rtpMax: 85, settlementMode: "house_edge" })
    .where(inArray(gameConfigTable.gameCode, ["lunar", "aviator", "jetx", "fury", "mines", "dice", "plinko", "horse-racing", "bike-racing", "lucky-7", "chicken-road", "baccarat", "blackjack", "teen-patti", "teen-patti-live", "andar-bahar", "vegetable-bowl", "crazy-time"]));
  // Fixed European roulette terms apply only to newly created rounds.
  await db.update(gameConfigTable).set({ houseEdge: ROULETTE_HOUSE_EDGE,
    rtpMin: ROULETTE_RTP_PERCENT, rtpMax: ROULETTE_RTP_PERCENT,
    maxMultiplier: ROULETTE_PAYOUT_BASE, minStakePaise: BigInt(ROULETTE_LIMITS.minBetPaise), settlementMode: "house_edge" })
    .where(eq(gameConfigTable.gameCode, "roulette"));
}

const ROLE_SEED: Array<{ name: string; description: string; permissions: string[] }> = [
  { name: "player",      description: "Standard end-user playing on the platform.",         permissions: ["wallet:read:self", "kyc:submit:self", "bet:place:self"] },
  { name: "agent",       description: "Affiliate / agent who manages downstream players.",  permissions: ["wallet:read:self", "agent:dashboard"] },
  { name: "support",     description: "Read-only support staff handling user issues.",      permissions: ["user:read", "kyc:read", "audit:read"] },
  { name: "admin",       description: "Operations admin with KYC + wallet adjust powers.",  permissions: ["user:read", "kyc:review", "wallet:adjust", "audit:read"] },
  { name: "super_admin", description: "Full administrative access, including role grants.", permissions: ["*"] },
];

export async function seedRoles(): Promise<void> {
  for (const r of ROLE_SEED) {
    await db.insert(rolesTable).values(r).onConflictDoNothing();
  }
}

/**
 * Seed a super_admin account from env vars (idempotent).
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
 */
export async function bootstrapSuperAdmin(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    logger.info(
      "SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD not set; skipping super_admin bootstrap",
    );
    return;
  }
  const normalized = normalizeEmail(email);
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailNormalized, normalized))
    .limit(1);
  if (existing[0]) {
    if (existing[0].role !== "super_admin") {
      await db
        .update(usersTable)
        .set({ role: "super_admin", status: "active" })
        .where(eq(usersTable.id, existing[0].id));
      logger.info({ email: normalized }, "Promoted existing user to super_admin");
    }
    return;
  }
  const passwordHash = await hashPassword(password);
  await db.insert(usersTable).values({
    email,
    emailNormalized: normalized,
    passwordHash,
    role: "super_admin",
    status: "active",
    displayName: "Super Admin",
  });
  logger.info({ email: normalized }, "Bootstrapped super_admin account");
}
