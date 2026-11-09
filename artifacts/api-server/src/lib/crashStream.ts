/**
 * Crash round STREAMS.
 *
 * A crash game runs one round at a time and every watcher shares its crash
 * point, so the game's whole house edge lives in that single number. A partner
 * who sets a different crash edge therefore cannot share a round with anyone
 * else — they need their own stream: their own rounds, their own crash points,
 * their own seed chain.
 *
 * A stream is identified by (gameCode, partnerId|null):
 *   - `lunar`            the SHARED stream. Local players, and every partner
 *                        without a crash override, watch this one.
 *   - `lunar#<partnerId>` that partner's private stream.
 *
 * `gameCode` is deliberately NOT overloaded to encode the partner. Wallet scope
 * (`toWalletScope`) and every report key off `bets.game_code`, and a synthetic
 * per-partner code would silently corrupt both — `toWalletScope` in particular
 * fails open to `lunar`. The stream is a separate axis, carried alongside.
 *
 * Kept dependency-free so the key derivation can be checked in isolation; it is
 * the thing that decides which round a bet joins, and a bet joining the wrong
 * stream would settle against a crash point its player never watched.
 */

/** Separator that cannot appear in a game code or a nanoid partner id. */
const SEP = "#";

export interface CrashStream {
  gameCode: string;
  /** null = the shared stream. */
  partnerId: string | null;
}

/** The key used for the in-memory round map, the seed chain, and the topic. */
export function streamKey(gameCode: string, partnerId?: string | null): string {
  return partnerId ? `${gameCode}${SEP}${partnerId}` : gameCode;
}

/** Inverse of `streamKey`. */
export function parseStreamKey(key: string): CrashStream {
  const at = key.indexOf(SEP);
  if (at === -1) return { gameCode: key, partnerId: null };
  return { gameCode: key.slice(0, at), partnerId: key.slice(at + 1) || null };
}

/** True when this key names a partner's private stream. */
export function isPartnerStream(key: string): boolean {
  return key.includes(SEP);
}

/**
 * Which stream a player watches.
 *
 * EVERY partner gets its own stream. A partner's rounds are its own, derived at
 * its own configured edge — and a partner inheriting the platform edge today
 * still gets its own rounds, so changing that edge later never mixes its
 * players into someone else's flight mid-stream.
 *
 * Only local players (no partner) watch the shared stream.
 *
 * Cost is bounded by LIFECYCLE, not by this function: streams start when a
 * partner actually has a player and retire when idle (see `crashRounds.ts`).
 * Running one eagerly per partner row is not viable — a crash loop emits
 * roughly 170 rounds an hour whether or not anyone is watching (the note in
 * lib/bootstrap.ts), and a partner table of ~640 active rows would be ~109,000
 * rounds an hour of pure waste.
 */
export function streamFor(args: {
  gameCode: string;
  partnerId?: string | null;
  /**
   * `partners.stream_owner_id` of that partner, when the caller has the row
   * in hand: a partner that shares another's stream bets into the OWNER's
   * rounds. Pass it wherever `partnerId` came from a partner row; a caller
   * holding only an id resolves it through `services/partnerStreams.ts`.
   * Absent or null = the partner's own stream, exactly as before.
   */
  streamOwnerId?: string | null;
  /**
   * Accepted for call-site symmetry and kept deliberately unused: which stream
   * a player belongs to must NOT depend on whether an override happens to be
   * set, or a partner would migrate between streams the moment an operator
   * edited their RTP — moving them off a flight their bets were already in.
   */
  overrides?: Record<string, number> | null;
}): string {
  const partnerId = args.streamOwnerId ?? args.partnerId;
  return partnerId ? streamKey(args.gameCode, partnerId) : args.gameCode;
}
