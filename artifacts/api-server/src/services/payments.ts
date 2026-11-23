import {
  db,
  paymentRequestsTable,
  depositSettingsTable,
  type PaymentRequest,
  type PaymentRequestKind,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { bus } from "../realtime/eventBus";
import { conflict } from "../lib/errors";

export interface CreatePaymentInput {
  userId: string;
  kind: PaymentRequestKind;
  amount: bigint;
  method?: "manual" | "auto";
  /** Per-game wallet this request targets. Defaults to "lunar". */
  game?: string;
  upiRef?: string | null;
  upiId?: string | null;
  notes?: string | null;
  /** Coin-pack SKU from the server catalog; null for custom amounts. */
  packageSku?: string | null;
  /** Coins granted by that SKU (server-derived). */
  coinQuantity?: number | null;
}

export async function createPaymentRequest(
  input: CreatePaymentInput,
): Promise<PaymentRequest> {
  const utr = input.upiRef?.trim().toLowerCase() ?? "";
  const checkUtr =
    input.kind === "deposit" && (input.method ?? "manual") === "manual" && utr.length > 0;
  const [row] = await db.transaction(async (tx) => {
    if (checkUtr) {
      // One bank transfer reference can back only one company deposit.
      // Without this a player could pay once and submit the same UTR many
      // times (or from several accounts) and have each approved. The
      // advisory lock serializes concurrent submissions of the same UTR.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"utr:" + utr}))`);
      const [dup] = await tx
        .select({ id: paymentRequestsTable.id })
        .from(paymentRequestsTable)
        .where(
          and(
            isNull(paymentRequestsTable.collectionMasterId),
            eq(paymentRequestsTable.kind, "deposit"),
            eq(paymentRequestsTable.method, "manual"),
            sql`lower(${paymentRequestsTable.upiRef}) = ${utr}`,
            inArray(paymentRequestsTable.status, ["pending", "approved"]),
          ),
        )
        .limit(1);
      if (dup) {
        throw conflict(
          "This UTR / transaction reference was already submitted. Contact support if this is a mistake.",
        );
      }
    }
    return tx
    .insert(paymentRequestsTable)
    .values({
      userId: input.userId,
      kind: input.kind,
      method: input.method ?? "manual",
      amount: input.amount,
      game: input.game ?? "lunar",
      packageSku: input.packageSku ?? null,
      coinQuantity: input.coinQuantity ?? null,
      upiRef: input.upiRef ?? null,
      upiId: input.upiId ?? null,
      notes: input.notes ?? null,
      status: "pending",
    })
    .returning();
  });
  // Increment the relevant pending counter on the admin dashboard.
  bus.publish({
    topic: "admin:metrics",
    type: "bump",
    reason: input.kind === "withdraw" ? "withdrawal_created" : "deposit_created",
    ts: Date.now(),
  });
  return row!;
}

export async function getDepositSettings() {
  const rows = await db.select().from(depositSettingsTable).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db
    .insert(depositSettingsTable)
    .values({ id: "singleton", manualEnabled: true, autoEnabled: false })
    .onConflictDoNothing({ target: depositSettingsTable.id })
    .returning();
  return created ?? (await db.select().from(depositSettingsTable).limit(1))[0]!;
}

export async function getWithdrawLimits(): Promise<{
  minAmountPaise: bigint;
  maxAmountPaise: bigint;
  dailyPerUserPaise: bigint;
  dailyPlatformPaise: bigint;
}> {
  const settings = await getDepositSettings();
  return {
    minAmountPaise: settings.withdrawMinAmountPaise,
    maxAmountPaise: settings.withdrawMaxAmountPaise,
    dailyPerUserPaise: settings.withdrawDailyPerUserPaise,
    dailyPlatformPaise: settings.withdrawDailyPlatformPaise,
  };
}

export async function listPaymentRequests(
  userId: string,
  kind: PaymentRequestKind,
): Promise<PaymentRequest[]> {
  return db
    .select()
    .from(paymentRequestsTable)
    .where(
      and(
        eq(paymentRequestsTable.userId, userId),
        eq(paymentRequestsTable.kind, kind),
      ),
    )
    .orderBy(desc(paymentRequestsTable.createdAt));
}
