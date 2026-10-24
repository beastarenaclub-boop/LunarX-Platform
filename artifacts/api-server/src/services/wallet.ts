import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
import { db, walletsTable, walletLedgerTable, type LedgerEntryType } from "@workspace/db";
import { and, eq, desc, or, lt, sql } from "drizzle-orm";
import { bus } from "../realtime/eventBus";
import { DEMO_RUNTIME } from "../demo/runtime";
import { DEMO_COINS } from "../demo/sessions";

// Game codes remain accepted by legacy clients. All resolve to one wallet.
// "lunar" is the existing storage key, not a restriction on where funds work.
export const WALLET_SCOPES = [
  ...INSTANT_COLLECTION.map(g => g.code),
  "lunar",
  "mines",
  "chicken-road",
  "plinko",
  "dice",
  "aviator",
  "jetx",
  "fury",
  "horse-racing",
  "bike-racing",
  "roulette",
  "baccarat",
  "blackjack",
  "teen-patti",
  "teen-patti-live",
  "sic-bo",
  "andar-bahar",
  "lucky-7",
  "lucky-7-live",
  "wheel-2-live", "teen-patti-joker",
  "crazy-time",
  "vegetable-bowl",
  "dragon-tiger",
  "dragon-tiger-one-day",
  "rummy",
  "poker-one-day",
  "poker-20-20",
  "poker-six-players",
  "wingo",
  "forex-trading",
  "virtual-sports",
  "lottery",
  "prize-lotto",
] as const;
export type WalletScope = (typeof WALLET_SCOPES)[number];
export const DEFAULT_WALLET_SCOPE: WalletScope = "lunar";

// A demo grant is credited once to the shared wallet.
export const DEMO_STARTING_BALANCE = 1_000_000n; // ₹10,000 in paise
const DEMO_SIGNUP_REF_TYPE = "demo_signup";

/** Resolve every game and legacy alias to the shared wallet storage key. */
export function toWalletScope(_value: string | null | undefined): WalletScope {
  return DEFAULT_WALLET_SCOPE;
}

export async function ensureWallet(
  userId: string,
  scope: WalletScope = DEFAULT_WALLET_SCOPE,
  currency = "INR",
): Promise<{ id: string; userId: string; currency: string; scope: string }> {
  scope = DEFAULT_WALLET_SCOPE;
  const existing = await db
    .select()
    .from(walletsTable)
    .where(
      and(
        eq(walletsTable.userId, userId),
        eq(walletsTable.currency, currency),
        eq(walletsTable.scope, scope),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  // Race-safe: rely on the (user_id, currency, scope) unique index. If a
  // concurrent insert wins, swallow the conflict and re-select the winning row.
  const inserted = await db
    .insert(walletsTable)
    .values({ userId, currency, scope })
    .onConflictDoNothing({
      target: [walletsTable.userId, walletsTable.currency, walletsTable.scope],
    })
    .returning();
  if (inserted[0]) return inserted[0];
  const reselect = await db
    .select()
    .from(walletsTable)
    .where(
      and(
        eq(walletsTable.userId, userId),
        eq(walletsTable.currency, currency),
        eq(walletsTable.scope, scope),
      ),
    )
    .limit(1);
  return reselect[0]!;
}

export async function getBalance(walletId: string, tx: TxClient | typeof db = db): Promise<bigint> {
  if (DEMO_RUNTIME) return DEMO_COINS;
  const rows = await tx
    .select({
      // SUM over bigint returns numeric; coalesce to 0 string and parse.
      total: sql<string>`COALESCE(SUM(${walletLedgerTable.amount}), 0)::text`,
    })
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.walletId, walletId));
  const total = rows[0]?.total ?? "0";
  return BigInt(total);
}

export interface PostEntryInput {
  userId: string;
  type: LedgerEntryType;
  amount: bigint;
  refType?: string | null;
  refId?: string | null;
  memo?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
  currency?: string;
  /** Originating game; funds always use the shared wallet. */
  scope?: WalletScope;
  /** If true, debits cannot drive balance below 0. Default true. */
  enforceNonNegative?: boolean;
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function postEntryCore(tx: TxClient, input: PostEntryInput) {
  const enforceNonNegative = input.enforceNonNegative !== false;

  const scope = DEFAULT_WALLET_SCOPE;
  // Create before locking so concurrent first bets also serialize safely.
  await tx.insert(walletsTable)
    .values({ userId: input.userId, currency: input.currency ?? "INR", scope })
    .onConflictDoNothing({ target: [walletsTable.userId, walletsTable.currency, walletsTable.scope] });
  const wallets = await tx
    .select()
    .from(walletsTable)
    .where(
      and(
        eq(walletsTable.userId, input.userId),
        eq(walletsTable.currency, input.currency ?? "INR"),
        eq(walletsTable.scope, scope),
      ),
    )
    .for("update")
    .limit(1);

  let wallet = wallets[0];
  if (!wallet) {
    const [created] = await tx
      .insert(walletsTable)
      .values({ userId: input.userId, currency: input.currency ?? "INR", scope })
      .returning();
    wallet = created!;
  }

  const sumRows = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${walletLedgerTable.amount}), 0)::text`,
    })
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.walletId, wallet.id));
  const current = BigInt(sumRows[0]?.total ?? "0");
  const next = DEMO_RUNTIME ? DEMO_COINS : current + input.amount;

  if (enforceNonNegative && next < 0n) {
    throw new Error("INSUFFICIENT_FUNDS");
  }

  const [entry] = await tx
    .insert(walletLedgerTable)
    .values({
      walletId: wallet.id,
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      balanceAfter: next,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      memo: input.memo ?? null,
      metadata: (input.metadata as object | undefined) ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return { entry: entry!, wallet };
}

export type { TxClient };

/**
 * Post an immutable ledger entry. Acquires a row lock on the wallet to
 * serialize concurrent posts. Computes balanceAfter from the existing
 * ledger sum and stores the resulting row.
 *
 * If `externalTx` is provided the work runs inside that transaction
 * (caller owns the commit/rollback). Otherwise a fresh transaction is created.
 */
export async function postEntry(input: PostEntryInput, externalTx?: TxClient) {
  if (externalTx) {
    // Caller owns the transaction lifecycle. We must NOT publish here,
    // because the caller's transaction can still roll back after this
    // returns, and a published "balance" event for a balance that was
    // never committed would be observably wrong on the client.
    // Callers using externalTx are expected to publish via
    // `publishWalletBalance` after their transaction commits.
    return await postEntryCore(externalTx, input);
  }
  // We own the transaction here, so the post is durable by the time
  // db.transaction() resolves; only then do we publish.
  const result = await db.transaction(async (tx) => postEntryCore(tx, input));
  publishWalletBalance({
    userId: input.userId,
    scope: input.scope ?? DEFAULT_WALLET_SCOPE,
    balance: result.entry.balanceAfter,
    entryType: input.type,
    amount: input.amount,
  });
  return result;
}

/**
 * Best-effort post-commit notification. Safe to call multiple times; never
 * throws. Use this from callers of `postEntry(..., externalTx)` AFTER their
 * transaction has successfully committed.
 */
export function publishWalletBalance(input: {
  userId: string;
  scope?: WalletScope;
  balance: bigint;
  entryType: LedgerEntryType;
  amount: bigint;
}): void {
  try {
    bus.publish({
      topic: `wallet:${input.userId}`,
      type: "balance",
      scope: DEFAULT_WALLET_SCOPE,
      balance: input.balance.toString(),
      entryType: input.entryType,
      amount: input.amount.toString(),
      ts: Date.now(),
    });
  } catch {
    // ignore
  }
}

/**
 * Current shared balance for a user, regardless of the requested game.
 */
export async function getBalanceByUser(
  userId: string,
  scope: WalletScope = DEFAULT_WALLET_SCOPE,
  currency = "INR",
): Promise<{ walletId: string; currency: string; scope: WalletScope; balance: bigint }> {
  const wallet = await ensureWallet(userId, scope, currency);
  const balance = await getBalance(wallet.id);
  return { walletId: wallet.id, currency: wallet.currency, scope: DEFAULT_WALLET_SCOPE, balance };
}

/** Legacy response shape: every game alias points to the same balance. */
export async function getAllScopeBalances(
  userId: string,
  currency = "INR",
): Promise<Record<WalletScope, string>> {
  const { balance } = await getBalanceByUser(userId, DEFAULT_WALLET_SCOPE, currency);
  return Object.fromEntries(WALLET_SCOPES.map(scope => [scope, balance.toString()])) as Record<WalletScope, string>;
}

/**
 * Credit a demo grant to the shared wallet exactly once, under its row lock.
 */
export async function ensureDemoScopeFunded(
  userId: string,
  scope: WalletScope,
  amount: bigint = DEMO_STARTING_BALANCE,
  currency = "INR",
): Promise<boolean> {
  scope = DEFAULT_WALLET_SCOPE;
  const wallet = await ensureWallet(userId, scope, currency);
  // Race-safe: do the "already funded?" check and the credit in ONE transaction
  // that first locks the wallet row. Concurrent calls (e.g. two balance reads
  // for a legacy demo) serialize on the lock, so the scope is funded at most
  // once instead of double-credited.
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: walletsTable.id })
      .from(walletsTable)
      .where(eq(walletsTable.id, wallet.id))
      .for("update")
      .limit(1);
    const existing = await tx
      .select({ id: walletLedgerTable.id })
      .from(walletLedgerTable)
      .where(
        and(
          eq(walletLedgerTable.walletId, wallet.id),
          eq(walletLedgerTable.refType, DEMO_SIGNUP_REF_TYPE),
        ),
      )
      .limit(1);
    if (existing[0]) return null;
    const { entry } = await postEntryCore(tx, {
      userId,
      type: "bonus",
      amount,
      scope,
      refType: DEMO_SIGNUP_REF_TYPE,
      refId: userId,
      memo: "Demo account starting balance",
    });
    return entry;
  });
  if (!result) return false;
  // Transaction committed — now it's safe to publish the new balance.
  publishWalletBalance({
    userId,
    scope,
    balance: result.balanceAfter,
    entryType: "bonus",
    amount,
  });
  return true;
}

/**
 * Backward-compatible entry point; one grant per account, never per game.
 */
export async function ensureDemoAllScopesFunded(
  userId: string,
  amount: bigint = DEMO_STARTING_BALANCE,
  currency = "INR",
): Promise<void> {
  await ensureDemoScopeFunded(userId, DEFAULT_WALLET_SCOPE, amount, currency);
}

export interface ListEntriesInput {
  walletId: string;
  limit: number;
  cursor?: string | null;
}

/**
 * Cursor format: base64url("<ISO createdAt>|<id>"). Pagination is stable
 * because we sort and filter on the same composite key (createdAt DESC, id DESC).
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep < 0) return null;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listEntries(input: ListEntriesInput) {
  const conditions = [eq(walletLedgerTable.walletId, input.walletId)];
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      // (createdAt, id) < (cursorCreatedAt, cursorId) under DESC ordering.
      conditions.push(
        or(
          lt(walletLedgerTable.createdAt, decoded.createdAt),
          and(
            eq(walletLedgerTable.createdAt, decoded.createdAt),
            lt(walletLedgerTable.id, decoded.id),
          ),
        )!,
      );
    }
  }
  const rows = await db
    .select()
    .from(walletLedgerTable)
    .where(and(...conditions))
    .orderBy(desc(walletLedgerTable.createdAt), desc(walletLedgerTable.id))
    .limit(input.limit + 1);

  const entries = rows.slice(0, input.limit);
  const last = entries[entries.length - 1];
  const nextCursor =
    rows.length > input.limit && last ? encodeCursor(last.createdAt, last.id) : null;
  return { entries, nextCursor };
}
