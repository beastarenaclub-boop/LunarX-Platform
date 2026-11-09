export interface OutcomeChoice {
  /** Stable and wire-safe. Roulette uses the pocket number as a string. */
  id: string;
  /** What an operator reads: "17", "00", "Banker", "Andar". */
  label: string;
  /** Groups the force dialog lays out together. */
  group?: string;
  /** Colour hint, so a board-shaped game renders as its board. */
  tone?: "red" | "black" | "green" | "neutral";
}

/** The round's seed tuple, for a space that derives its outcomes. */
export interface OutcomeSeed {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * What the result engine and the force dialog need from a game.
 *
 * A game without one is never steered and cannot be forced. That is the whole
 * gate: `blackjack` has no space and cannot have one, because its outcome is
 * not decided when betting closes — the player is still acting.
 *
 * `candidates` is ONLY read when the engine is actually steering. The honest
 * path never comes through here: a round the engine does not steer resolves
 * exactly as it does with no engine at all, through the game's own derivation.
 * That is what keeps every game's published odds true in `random` mode, on a
 * noise round, on a round nobody bet into, and on every failure fallback.
 */
export interface OutcomeSpace {
  /** Every class an operator may force, ordered for display. */
  choices(): OutcomeChoice[];
  /**
   * Concrete outcomes for the engine to score. Exhaustive where the space is
   * small, a sample of real deals where it is not.
   */
  candidates(seed: OutcomeSeed): { choiceId: string; outcome: unknown }[];
  /** A real outcome in that class, or null when none could be produced. */
  forChoice(seed: OutcomeSeed, choiceId: string): unknown | null;
  /**
   * Which class an outcome belongs to.
   *
   * Needed for the rounds the engine does NOT steer, which is most of them: an
   * honestly drawn outcome still has to be filed under a class so the streak
   * history means anything. Null for an outcome this space does not recognise.
   */
  classify(outcome: unknown): string | null;
  /**
   * A pattern this game considers suspicious, beyond the generic
   * count-against-expectation rule every space gets. Roulette's run of one
   * colour or parity is the example; most games have no analogue.
   */
  extraStreak?(recentChoiceIds: readonly string[]): boolean;
  /**
   * The natural chance of each class under honest play, keyed by choice id.
   *
   * The generic streak guard needs it: "banker six times in twenty" is BELOW
   * banker's natural rate and must not read as a pattern, while one roulette
   * pocket six times in twenty is far past chance and must. Omit a class and
   * it is treated as uniform over the space.
   */
  naturalOdds?(): Record<string, number>;
}

// ---------------------------------------------------------------------------
// Per-game adapters (validation, derivation, settlement, audit persistence)
// ---------------------------------------------------------------------------
