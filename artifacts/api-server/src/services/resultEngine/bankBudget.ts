/**
 * ONE loss budget for a whole scope, or a floor per game.
 *
 * `game_engine_config.min_bank_floor_paise` is the engine's one HARD limit,
 * and it is per STREAM: each game's floor is measured against that game's own
 * bank. With nine steerable games that is nine separate budgets, so an
 * operator who types −50,000 on each is really standing behind −450,000 —
 * which is not what "my loss budget is fifty thousand" means.
 *
 * This is the scope-level answer, and there are exactly three modes:
 *
 *   per_game    every game keeps its own floor, measured against its own
 *               bank. The shipped behaviour, and what an absent row means —
 *               so nothing changes for a scope nobody has configured.
 *   same_each   ONE BUDGET given to every game, each still measured against
 *               its OWN bank. Applied when it is saved: the scope's rows each
 *               get `min_bank_floor_paise = its own bank − the budget`.
 *   combined    ONE floor for the whole scope, measured against the SUM of
 *               its games' banks. The only mode that changes what the engine
 *               may choose: one game can run further down while the group as
 *               a whole still has room.
 *
 * **The operator types a BUDGET; the engine reads a FLOOR.** "A budget of
 * ₹5 lakh" on a game sitting ₹40 lakh up is the floor ₹35 lakh, and the
 * panels do that subtraction at the save. The stored column stays the
 * absolute floor it always was, so nothing in the decision path changed.
 *
 * THAT SUBTRACTION MAY NOT BE MOVED TO READ TIME, and this is the one thing
 * to understand here. `floor = bankNow − budget`, evaluated per decision,
 * makes the floor FOLLOW the bank down: the test collapses to
 * `houseNet >= −budget`, a per-ROUND cap that can be paid out again every
 * round for ever. Frozen at the save it is a real cumulative budget, and
 * `bank − floor` is then exactly what is LEFT of it — which is why re-saving
 * the figure the panel shows changes nothing rather than ratcheting the floor
 * down.
 *
 * `same_each` is therefore the one mode whose stored figure is a BUDGET and
 * not a floor: nine games at nine different banks have nine different floors,
 * so there is no single number to keep. It is applied at the save for the
 * same reason — derived per decision it would be the trailing stop above. A
 * game whose row is created LATER (`engineStateFor` makes them lazily, on a
 * stream's first spin) therefore starts at the shipped floor 0, exactly as it
 * does today; save again to give it the budget too. The card says so.
 *
 * A scope is a partner id, or the literal `local` for our own streams — the
 * same vocabulary Game Control and the settings export already use.
 */
import { db, gameEngineConfigTable, engineBankBudgetTable, partnersTable } from "@workspace/db";
import { RESULT_ENGINE_GAMES } from "./scope";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export const BANK_BUDGET_MODES = ["per_game", "same_each", "combined"] as const;
export type BankBudgetMode = (typeof BANK_BUDGET_MODES)[number];

/** Our own streams, which have no partner id — the sentinel both panels send. */
export const LOCAL_SCOPE = "local";

export class BankBudgetError extends Error {}

export interface BankBudget {
  mode: BankBudgetMode;
  /** The shared figure. Read by `same_each` and `combined`; ignored by `per_game`. */
  floorPaise: bigint;
}

/** What an unconfigured scope is, and what every failure falls back to. */
const PER_GAME: BankBudget = { mode: "per_game", floorPaise: 0n };

export function scopeOf(partnerId: string | null): string {
  return partnerId ?? LOCAL_SCOPE;
}
export function partnerOfScope(scope: string): string | null {
  return scope === LOCAL_SCOPE ? null : scope;
}
function toMode(v: unknown): BankBudgetMode | null {
  return (BANK_BUDGET_MODES as readonly string[]).includes(String(v))
    ? (v as BankBudgetMode)
    : null;
}

/**
 * The scope's budget, or `per_game` when it has none.
 *
 * Read on every decision, so it falls back to `per_game` on an unreadable
 * mode rather than throwing: an unknown string in that column must leave the
 * engine on the shipped behaviour, not stop the round.
 */
export async function readBankBudget(scope: string): Promise<BankBudget> {
  const [row] = await db
    .select()
    .from(engineBankBudgetTable)
    .where(eq(engineBankBudgetTable.scope, scope))
    .limit(1);
  if (!row) return PER_GAME;
  return { mode: toMode(row.mode) ?? "per_game", floorPaise: row.floorPaise };
}

/**
 * Every bank in the scope, added up — the figure a `combined` floor is
 * measured against.
 *
 * One grouped read over the scope's own rows. `partner_id IS NULL` is OUR
 * streams and `= $1` is one partner's; there is no form of this that sums
 * across partners, which is what keeps one operator's budget out of
 * another's.
 */
export async function combinedBankFor(partnerId: string | null): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${gameEngineConfigTable.bankPaise}), 0)::text` })
    .from(gameEngineConfigTable)
    .where(
      and(inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES]), partnerId === null
        ? isNull(gameEngineConfigTable.partnerId)
        : eq(gameEngineConfigTable.partnerId, partnerId)),
    );
  return BigInt(row?.total ?? "0");
}

/**
 * The scope's own streams, for the panel's breakdown: what each game's bank
 * and floor are, so an operator can see which game is spending the budget.
 */
export async function scopeStreams(partnerId: string | null): Promise<
  { gameCode: string; bankPaise: string; minBankFloorPaise: string }[]
> {
  const rows = await db
    .select({
      gameCode: gameEngineConfigTable.gameCode,
      bankPaise: gameEngineConfigTable.bankPaise,
      minBankFloorPaise: gameEngineConfigTable.minBankFloorPaise,
    })
    .from(gameEngineConfigTable)
    .where(
      and(inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES]), partnerId === null
        ? isNull(gameEngineConfigTable.partnerId)
        : eq(gameEngineConfigTable.partnerId, partnerId)),
    );
  return rows
    .map((r) => ({
      gameCode: r.gameCode,
      bankPaise: r.bankPaise.toString(),
      minBankFloorPaise: r.minBankFloorPaise.toString(),
    }))
    .sort((a, b) => a.gameCode.localeCompare(b.gameCode));
}

export interface BankBudgetView {
  scope: string;
  mode: BankBudgetMode;
  /** The stored figure: a floor under `combined`, a budget under `same_each`. */
  floorPaise: string;
  /**
   * What the panel's box should show: the budget as it stands. Under
   * `combined` that is what is LEFT of it (`combined bank − floor`); under
   * `same_each` the figure that was set; `null` under `per_game`, which has no
   * shared box. Computed here so neither panel does money arithmetic.
   */
  budgetPaise: string | null;
  /**
   * Every bank in the scope, added up.
   *
   * The headroom is deliberately NOT here: the panel works it out against the
   * figure in the box, which is what the operator is about to save, and a
   * stored-value headroom beside it would disagree with the box by whatever
   * they have just typed.
   */
  combinedBankPaise: string;
  games: { gameCode: string; bankPaise: string; minBankFloorPaise: string }[];
}

export async function bankBudgetView(partnerId: string | null): Promise<BankBudgetView> {
  const scope = scopeOf(partnerId);
  const [budget, combined, games] = await Promise.all([
    readBankBudget(scope),
    combinedBankFor(partnerId),
    scopeStreams(partnerId),
  ]);
  return {
    scope,
    mode: budget.mode,
    floorPaise: budget.floorPaise.toString(),
    budgetPaise:
      budget.mode === "combined"
        ? (combined - budget.floorPaise).toString()
        : budget.mode === "same_each"
          ? budget.floorPaise.toString()
          : null,
    combinedBankPaise: combined.toString(),
    games,
  };
}

/**
 * Store a scope's budget.
 *
 * "A partner that shares another's streams has no budget of its own" is
 * checked by the CALLERS, not here, and that is structural rather than
 * forgetfulness: the check needs `partnerStreams`, which reaches the game
 * registry and from there back into the engine that imports this file. One
 * import would close that cycle and the roulette outcome space would be
 * evaluated in its own temporal dead zone. Both routes make the check, and
 * `bankBudget.integration` G3 is what keeps them making it.
 */
export async function writeBankBudget(args: {
  partnerId: string | null;
  mode?: unknown;
  /**
   * A BUDGET — what the operator is prepared to lose from where the scope
   * stands at this moment — never a floor. The subtraction from the bank
   * happens HERE, against the bank as it is now, not in a browser against a
   * bank it fetched some minutes ago: the first cut did it in the panel and
   * "₹5 lakh from now" was ₹5 lakh from whenever the page had last polled.
   */
  budgetPaise?: unknown;
  updatedBy: string | null;
}): Promise<BankBudgetView> {
  if (args.partnerId) {
    const [p] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, args.partnerId))
      .limit(1);
    if (!p) throw new BankBudgetError("No such partner");
  }
  const current = await readBankBudget(scopeOf(args.partnerId));
  const mode = args.mode === undefined ? current.mode : toMode(args.mode);
  if (!mode) {
    throw new BankBudgetError(`mode must be one of ${BANK_BUDGET_MODES.join(", ")}`);
  }
  let budget: bigint | null = null;
  if (args.budgetPaise !== undefined) {
    const n = typeof args.budgetPaise === "string" ? args.budgetPaise : String(args.budgetPaise);
    // Whole paise, refused rather than clamped. A NEGATIVE budget is legal
    // and means "already past it by this much" — it is what the box shows on
    // an overspent game, and refusing it would refuse that game's own figure.
    if (!/^-?\d{1,18}$/u.test(n)) {
      // Both panels print this to whoever pressed Save, and they typed
      // RUPEES into a box labelled ₹ — so it names the box and their unit,
      // not this column. The wire stays paise like every other money field.
      throw new BankBudgetError(
        "Loss budget: enter an amount in rupees, digits only, with at most two decimal places",
      );
    }
    budget = BigInt(n);
  }
  // The stored figure means something DIFFERENT in each shared mode (a floor
  // under combined, a budget under same_each), so a mode change that carries
  // no figure would silently re-read the old number as the other kind: ₹35
  // lakh of floor becoming ₹35 lakh of budget per game. A shared mode is
  // therefore never written without its figure.
  let floorPaise = current.floorPaise;
  if (mode === "combined") {
    if (budget === null) throw new BankBudgetError("Loss budget: enter the budget for all games together");
    // Calculated against locked bank rows in the transaction below.
  } else if (mode === "same_each") {
    if (budget === null) throw new BankBudgetError("Loss budget: enter the budget to give every game");
    floorPaise = budget;
  }
  const scope = scopeOf(args.partnerId);
  await db.transaction(async tx => {
  const scopeFilter = and(inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES]), args.partnerId === null ? isNull(gameEngineConfigTable.partnerId) : eq(gameEngineConfigTable.partnerId, args.partnerId));
  const streams = await tx.select({bank:gameEngineConfigTable.bankPaise}).from(gameEngineConfigTable)
    .where(scopeFilter).orderBy(gameEngineConfigTable.streamKey).for("update");
  if (mode === "combined") floorPaise = streams.reduce((sum,row)=>sum+row.bank,0n) - budget!;
  await tx
    .insert(engineBankBudgetTable)
    .values({ scope, mode, floorPaise, updatedBy: args.updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: engineBankBudgetTable.scope,
      set: { mode, floorPaise, updatedBy: args.updatedBy, updatedAt: new Date() },
    });
  // `same_each` IS this write. The figure is a budget, so each game's floor is
  // its OWN bank less the budget — computed in SQL against the bank as it
  // stands right now, in one statement, so two games cannot be frozen against
  // banks read a second apart.
  if (mode === "same_each") {
    await tx
      .update(gameEngineConfigTable)
      .set({ minBankFloorPaise: sql`${gameEngineConfigTable.bankPaise} - ${floorPaise}`, updatedBy:args.updatedBy, updatedAt:new Date() })
      .where(
        and(inArray(gameEngineConfigTable.gameCode, [...RESULT_ENGINE_GAMES]), args.partnerId === null
          ? isNull(gameEngineConfigTable.partnerId)
          : eq(gameEngineConfigTable.partnerId, args.partnerId)),
      );
  }
  });
  return bankBudgetView(args.partnerId);
}

/** The floor a stream is actually judged by, and what it is judged against. */
export interface EffectiveFloor {
  /** Set only when the scope overrides the stream's own floor. */
  budgetFloorPaise?: bigint;
  /** Set only under `combined`, where the test reads the scope's whole bank. */
  budgetBankPaise?: bigint;
}

/**
 * What the floor test should read for this stream, given its scope's budget.
 *
 * Returns an EMPTY object for `per_game`, which is the shipped path: a scope
 * nobody has configured adds one indexed lookup per decision and changes
 * nothing else.
 */
export async function effectiveFloorFor(partnerId: string | null): Promise<EffectiveFloor> {
  const budget = await readBankBudget(scopeOf(partnerId));
  // `same_each` was WRITTEN into each game's own floor at the save, so the
  // stream's own column is already the answer — overriding here with the
  // stored figure would hand the engine a BUDGET where it expects a FLOOR,
  // which on a game ₹40 lakh up means refusing every losing result at once.
  if (budget.mode !== "combined") return {};
  return {
    budgetFloorPaise: budget.floorPaise,
    budgetBankPaise: await combinedBankFor(partnerId),
  };
}

/** What the floor test will ACTUALLY read for a stream, given its scope. */
export interface FloorReadout {
  floorMode: BankBudgetMode;
  /** The figure a result is judged against. */
  effectiveFloorPaise: string;
  /** What that figure is measured against: this stream's bank, or the scope's whole bank. */
  effectiveBankPaise: string;
}

/**
 * Annotate streams with the floor that will actually gate them.
 *
 * Every surface that prints a floor or a headroom reads THIS rather than the
 * stored per-game column, because under `same_each` or `combined` that column
 * is not the one the engine is using — and a money figure contradicting the
 * control beside it is worse than no figure at all. `EngineView` is
 * `EngineViewBase & FloorReadout` for the same reason: there is no way to
 * hand a panel a stream without having resolved its floor first.
 *
 * One budget read per distinct scope, and one combined-bank read for each
 * scope actually running `combined`.
 */
export async function withEffectiveFloor<
  T extends { partnerId: string | null; bankPaise: string; minBankFloorPaise: string },
>(streams: readonly T[]): Promise<(T & FloorReadout)[]> {
  const scopes = [...new Set(streams.map((s) => scopeOf(s.partnerId)))];
  const budgets = new Map<string, BankBudget>(
    await Promise.all(scopes.map(async (sc) => [sc, await readBankBudget(sc)] as const)),
  );
  const combined = new Map<string, bigint>();
  await Promise.all(
    scopes
      .filter((sc) => budgets.get(sc)!.mode === "combined")
      .map(async (sc) => {
        combined.set(sc, await combinedBankFor(partnerOfScope(sc)));
      }),
  );
  return streams.map((s) => {
    const sc = scopeOf(s.partnerId);
    const b = budgets.get(sc)!;
    return {
      ...s,
      floorMode: b.mode,
      // Only `combined` redirects the pair — see `effectiveFloorFor`.
      effectiveFloorPaise: (b.mode === "combined" ? b.floorPaise : BigInt(s.minBankFloorPaise)).toString(),
      effectiveBankPaise: (b.mode === "combined" ? combined.get(sc)! : BigInt(s.bankPaise)).toString(),
    };
  });
}
