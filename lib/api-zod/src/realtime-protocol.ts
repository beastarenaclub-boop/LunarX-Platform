/**
 * Realtime wire protocol shared between API server and browser clients.
 *
 * This file is the SINGLE SOURCE OF TRUTH for WebSocket event shapes. The
 * server's `realtime/eventBus` re-exports `AnyServerEvent` as its publish
 * type, and the browser hooks (`useRealtimeTopic<T>`) accept these same
 * union arms as their `T`. Any new topic/type must be added here so it is
 * checked on both sides.
 *
 * Pure TypeScript types only — no runtime code, no third-party deps —
 * so it can be safely consumed from any workspace package.
 */

export type ClientToServer =
  | { op: "subscribe"; topic: string }
  | { op: "unsubscribe"; topic: string }
  | { op: "ping"; ts?: number };

export type ServerToClient =
  | { op: "welcome"; userId: string; role: string; ts: number }
  | { op: "subscribed"; topic: string }
  | { op: "unsubscribed"; topic: string }
  | { op: "denied"; topic: string; reason: string }
  | { op: "event"; topic: string; payload: unknown }
  | { op: "pong"; ts?: number }
  | { op: "error"; reason: string };

export const ALLOWED_ROLES_PER_TOPIC: Record<
  string,
  ReadonlyArray<"player" | "agent" | "support" | "admin" | "super_admin">
> = {
  "bets:global": ["player", "agent", "support", "admin", "super_admin"],
  "rounds:lunar": ["player", "agent", "support", "admin", "super_admin"],
  // Roulette settled-spin feed (anonymized) — drives the live recent-pockets
  // strip on every connected roulette client.
  "rounds:roulette": ["player", "agent", "support", "admin", "super_admin"],
  "banners:active": ["player", "agent", "support", "admin", "super_admin"],
  "withdrawals:admin": ["support", "admin", "super_admin"],
  "admin:metrics": ["support", "admin", "super_admin"],
  // Per-game live config push. Public — every connected role may listen so
  // game clients pick up admin edits without a refresh.
  "game-config:lunar": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:mines": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:plinko": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:dice": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:aviator": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:jetx": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:fury": ["player", "agent", "support", "admin", "super_admin"],
  "admin:bonus-events": ["support", "admin", "super_admin"],
  "admin:bonus-metrics": ["support", "admin", "super_admin"],
  // Rain drops (free-bet giveaways) announced in chat — public broadcast.
  "rain:lunar": ["player", "agent", "support", "admin", "super_admin"],
  // Table-game config topics (round timings / limits pushed live).
  "game-config:roulette": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:baccarat": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:blackjack": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:teen-patti": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:teen-patti-live": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:andar-bahar": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:lucky-7": ["player", "agent", "support", "admin", "super_admin"],
  // Shared server-scheduled table rounds: phase clock, live bets feed,
  // results. Public — anonymized aside from player display names on bets.
  "table-rounds:roulette": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:baccarat": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:blackjack": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:teen-patti": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:teen-patti-live": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:andar-bahar": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:lucky-7": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:teen-patti-joker": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:teen-patti-joker": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:wheel-2-live": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:lucky-7-live": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:crazy-time": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:crazy-time": ["player", "agent", "support", "admin", "super_admin"],
  "table-rounds:vegetable-bowl": ["player", "agent", "support", "admin", "super_admin"],
  "game-config:vegetable-bowl": ["player", "agent", "support", "admin", "super_admin"],
};

export type BetsGlobalEvent =
  | {
      topic: "bets:global";
      type: "placed";
      id: string;
      userId: string;
      displayName: string | null;
      gameCode: string;
      stakeAmount: string;
      ts: number;
    }
  | {
      topic: "bets:global";
      type: "settled";
      id: string;
      userId: string;
      displayName: string | null;
      gameCode: string;
      stakeAmount: string;
      payoutAmount: string;
      multiplier: number | null;
      status: "cashed_out" | "lost";
      ts: number;
    };

export type RoundsLunarEvent = {
  topic: "rounds:lunar";
  type: "result";
  roundId: string;
  gameCode: string;
  crashMultiplier: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  totalStake: string;
  totalPayout: string;
  playerCount: number;
  ts: number;
};

/**
 * Authoritative roulette spin result, broadcast once per settled spin.
 * Strictly anonymous: only the pocket, an opaque round id, and the
 * settlement timestamp — no identity- or stake-derived data.
 */
export type RoundsRouletteEvent = {
  topic: "rounds:roulette";
  type: "result";
  roundId: string;
  pocket: number;
  ts: number;
};

export type BannersActiveEvent = {
  topic: "banners:active";
  type: "changed";
  ts: number;
};

export type WalletEvent = {
  topic: `wallet:${string}`;
  type: "balance";
  // Per-game wallet scope. Matches the server WALLET_SCOPES set (lunar,
  // mines, plinko, dice + every crash variant); kept open as string so new
  // games don't require a protocol bump.
  scope: string;
  balance: string;
  entryType: string;
  amount: string;
  ts: number;
};

export type NotificationEvent = {
  topic: `notifications:${string}`;
  type: "new";
  id: string;
  title: string;
  message: string;
  ts: number;
};

export type WithdrawalsAdminEvent =
  | {
      topic: "withdrawals:admin";
      type: "created";
      id: string;
      userId: string;
      amount: string;
      status: "pending";
      ts: number;
    }
  | {
      topic: "withdrawals:admin";
      type: "decided";
      id: string;
      userId: string;
      amount: string;
      status: string;
      ts: number;
    };

/**
 * Admin live counter signal. Each event is a "something changed, refetch
 * the dashboard" hint. We deliberately do NOT carry per-field deltas:
 * the dashboard endpoint is the single source of truth and clients re-fetch
 * on bumps to avoid drift.
 */
export type AdminMetricsEvent = {
  topic: "admin:metrics";
  type: "bump";
  reason:
    | "bet_placed"
    | "bet_settled"
    | "withdrawal_created"
    | "withdrawal_decided"
    | "deposit_created"
    | "deposit_decided"
    | "kyc_changed"
    | "flag_opened"
    | "game_config_updated";
  ts: number;
};

/**
 * Live push of a game's full public config payload after an admin save.
 * Carries the new values directly so clients update in-place — no follow-up
 * REST fetch required.
 */
export type GameConfigUpdatedEvent = {
  topic: `game-config:${string}`;
  type: "updated";
  gameCode: string;
  config: {
    gameCode: string;
    houseEdge: number;
    maxMultiplier: number;
    enabled: boolean;
    bettingWindowMs: number;
    turboBettingWindowMs: number;
    interRoundDelayMs: number;
    minAutoCashout: number;
    maxAutoCashout: number;
    /** Max stake per bet in paise, as a decimal string (bigint-safe). */
    maxStakePaise?: string;
    /** Table-round phase durations (ms) — present for table games. */
    revealDurationMs?: number;
    settleDurationMs?: number;
    /** Min stake per wager slip in paise, as a decimal string. */
    minStakePaise?: string;
  };
  ts: number;
};

export type AgentEvent =
  | {
      topic: `agent:${string}`;
      type: "commission";
      agentId: string;
      deltaPaise: string;
      ts: number;
    }
  | {
      topic: `agent:${string}`;
      type: "player_added";
      playerId: string;
      ts: number;
    };

export type BonusEvent = {
  topic: `bonus:${string}`;
  type: "balance";
  balance: string;
  entryType: string;
  amount: string;
  ts: number;
};

export type AdminBonusEventsEvent = {
  topic: "admin:bonus-events";
  type: "bump";
  eventType: string;
  userId: string | null;
  amount: string;
  ts: number;
};

export type AdminBonusMetricsEvent = {
  topic: "admin:bonus-metrics";
  type: "bump";
  reason: string;
  ts: number;
};

/**
 * Rain drop lifecycle. A "drop" announces a claimable giveaway in chat; a
 * "claimed" event updates the live claimed/max counter on every client.
 */
export type RainEventWire =
  | {
      topic: "rain:lunar";
      type: "drop";
      id: string;
      gameCode: string;
      amountPaise: string;
      betsPerClaim: number;
      maxClaims: number;
      claimedCount: number;
      message: string | null;
      expiresAt: string;
      ts: number;
    }
  | {
      topic: "rain:lunar";
      type: "claimed";
      id: string;
      gameCode: string;
      claimedCount: number;
      maxClaims: number;
      ts: number;
    };

/** Per-user free-bets change signal: client re-fetches its summary. */
export type FreeBetsChangedEvent = {
  topic: `free-bets:${string}`;
  type: "changed";
  ts: number;
};

/**
 * Shared server-scheduled table-game rounds (roulette, baccarat, blackjack,
 * teen-patti, teen-patti-live, andar-bahar, lucky-7). All connected clients
 * follow the same clock:
 *
 *  - "phase":  authoritative phase change with the absolute deadline
 *              (endsAt, epoch ms) so clients render a countdown that
 *              survives reconnects. The provably-fair serverSeedHash is
 *              committed on the betting phase event.
 *  - "bet":    a player's wager slip landed during the betting window
 *              (live-bets feed; display name only, no user ids).
 *  - "result": outcome revealed + serverSeed disclosed for verification.
 *  - "settled": round fully paid out, with anonymous totals.
 */
export type TableRoundsEvent =
  | {
      topic: `table-rounds:${string}`;
      type: "phase";
      roundId: string;
      gameCode: string;
      phase: "betting" | "reveal" | "settling";
      endsAt: number;
      serverSeedHash: string;
      clientSeed: string;
      nonce: number;
      ts: number;
    }
  | {
      topic: `table-rounds:${string}`;
      type: "bet";
      roundId: string;
      gameCode: string;
      displayName: string | null;
      totalStake: string;
      bets: unknown;
      playerCount: number;
      totalStakeAll: string;
      ts: number;
    }
  | {
      topic: `table-rounds:${string}`;
      type: "result";
      roundId: string;
      gameCode: string;
      outcome: unknown;
      serverSeed: string;
      serverSeedHash: string;
      clientSeed: string;
      nonce: number;
      ts: number;
    }
  | {
      topic: `table-rounds:${string}`;
      type: "settled";
      roundId: string;
      gameCode: string;
      totalStake: string;
      totalPayout: string;
      playerCount: number;
      ts: number;
    };

export type AnyServerEvent =
  | { topic: `ludo:${string}`; type: "changed"; matchId: string; version: number; ts: number }
  | { topic: `ludo-chat:${string}`; type: "changed"; matchId: string; ts: number }
  | BetsGlobalEvent
  | RoundsLunarEvent
  | RoundsRouletteEvent
  | BannersActiveEvent
  | WalletEvent
  | NotificationEvent
  | WithdrawalsAdminEvent
  | AdminMetricsEvent
  | AgentEvent
  | GameConfigUpdatedEvent
  | BonusEvent
  | AdminBonusEventsEvent
  | AdminBonusMetricsEvent
  | RainEventWire
  | FreeBetsChangedEvent
  | TableRoundsEvent;
