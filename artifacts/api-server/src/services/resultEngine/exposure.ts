/**
 * What the house stands to make or lose on each candidate outcome, given the
 * open book.
 *
 * This is the ONE input every steering selector reads, and it is computed from
 * the persisted slips rather than from anything held in memory: a bet that is
 * not committed is not on the book, and a decision made against a slip that
 * then rolls back would be a decision about a round that never happened.
 *
 * Payouts come from the GAME'S OWN `settle`, the same function that pays the
 * player. That is deliberate and it replaced a private copy of roulette's
 * payout arithmetic: with one function the engine's view of what a candidate
 * costs cannot drift from what settlement actually pays, which is the only
 * property that makes steering honest arithmetic rather than an estimate.
 */
import type { OutcomeChoice } from "../tableAdapter";

export interface OutcomePosition {
  /** Index into the candidate list this position came from. */
  index: number;
  /** The class this outcome belongs to, as the force dialog names it. */
  choiceId: string;
  label: string;
  /** Total credited if this candidate lands, stake included. */
  payoutPaise: bigint;
  /** Stake held by the slips that win something here. */
  backedPaise: bigint;
  /** Slips that win something here. `eligible()` reads it for the dead-round rule. */
  betCount: number;
  /** Distinct accounts winning here. */
  winnerCount: number;
  /** `totalStaked − payout`. Positive is what the house keeps. */
  houseNetPaise: bigint;
  /** The account collecting most here, or null. */
  topWinnerUserId: string | null;
  /**
   * Per PARTY (the partner whose wallet pays the slip; "local" for ours):
   * what that party's players staked on the round and what this result would
   * pay them. The balancing stage reads it; everything else ignores it.
   */
  parties?: Map<string, { stakePaise: bigint; payoutPaise: bigint }>;
  /** Per PLAYER: what this result would pay them. Absent = nothing. The player balance reads it. */
  players?: Map<string, bigint>;
}

export interface Exposure {
  outcomes: OutcomePosition[];
  totalStakedPaise: bigint;
  betCount: number;
  /** Stake on the round per party — the parties the balancing stage weighs. */
  partyStakes?: Map<string, bigint>;
  /** Stake on the round per player — the players the player balance weighs. */
  playerStakes?: Map<string, bigint>;
  /** The account staking more than `whaleThresholdPct` of the round, if any. */
  whaleUserId: string | null;
}

export interface ExposureSlip {
  userId: string;
  /** Who pays this slip: the bet's partner id, or "local". Absent = "local". */
  partyId?: string;
  /** The slip's bets, in whatever shape this game's `settle` reads. */
  bets: unknown;
  /** Total staked on the slip. */
  stakePaise: bigint;
  pricingConfig?: unknown;
}

export interface ExposureCandidate extends OutcomeChoice {
  outcome: unknown;
}

/**
 * Score every candidate against the book.
 *
 * `payoutFor` is the game's `settle` with the round's config already bound. It
 * must not throw: a candidate that cannot be settled is scored as paying
 * nothing rather than taken out, because removing it silently would make the
 * recorded pool a lie about what could have happened.
 */
export function computeExposure(
  candidates: readonly ExposureCandidate[],
  slips: readonly ExposureSlip[],
  whaleThresholdPct: number,
  payoutFor: (bets: unknown, outcome: unknown, slip?: ExposureSlip) => bigint,
  strict = false,
): Exposure {
  let totalStaked = 0n;
  let betCount = 0;
  const stakeByUser = new Map<string, bigint>();
  const partyStakes = new Map<string, bigint>();
  for (const slip of slips) {
    totalStaked += slip.stakePaise;
    betCount += 1;
    stakeByUser.set(
      slip.userId,
      (stakeByUser.get(slip.userId) ?? 0n) + slip.stakePaise,
    );
    const party = slip.partyId ?? "local";
    partyStakes.set(party, (partyStakes.get(party) ?? 0n) + slip.stakePaise);
  }

  const outcomes: OutcomePosition[] = candidates.map((c, index) => {
    let payout = 0n;
    let backed = 0n;
    let winners = 0;
    const perUser = new Map<string, bigint>();
    const parties = new Map<string, { stakePaise: bigint; payoutPaise: bigint }>();
    for (const [party, stake] of partyStakes) parties.set(party, { stakePaise: stake, payoutPaise: 0n });
    for (const slip of slips) {
      let paid = 0n;
      try {
        paid = payoutFor(slip.bets, c.outcome, slip);
      } catch (err) {
        // RTP must never rank an unpriceable result as a free house win.
        if (strict) throw err;
        // A slip this candidate cannot settle pays nothing on it. Skipping the
        // whole candidate instead would hide a real option from the pool.
        paid = 0n;
      }
      if (paid <= 0n) continue;
      payout += paid;
      backed += slip.stakePaise;
      winners += 1;
      perUser.set(slip.userId, (perUser.get(slip.userId) ?? 0n) + paid);
      parties.get(slip.partyId ?? "local")!.payoutPaise += paid;
    }
    let topWinnerUserId: string | null = null;
    let best = 0n;
    for (const [uid, amt] of perUser) {
      if (amt > best) {
        best = amt;
        topWinnerUserId = uid;
      }
    }
    return {
      index,
      choiceId: c.id,
      label: c.label,
      payoutPaise: payout,
      backedPaise: backed,
      betCount: winners,
      winnerCount: perUser.size,
      houseNetPaise: totalStaked - payout,
      topWinnerUserId,
      parties,
      players: perUser,
    };
  });

  let whaleUserId: string | null = null;
  if (totalStaked > 0n) {
    for (const [uid, amt] of stakeByUser) {
      if (Number(amt) / Number(totalStaked) >= whaleThresholdPct) {
        whaleUserId = uid;
        break;
      }
    }
  }

  return { outcomes, totalStakedPaise: totalStaked, betCount, whaleUserId, partyStakes, playerStakes: stakeByUser };
}
