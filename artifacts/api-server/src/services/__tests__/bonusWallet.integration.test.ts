import { strict as assert } from "node:assert";
import { test, before, after } from "node:test";
import { nanoid } from "nanoid";
import {
  db,
  pool,
  usersTable,
  bonusLedgerTable,
  bonusWageringTable,
  bonusEventsTable,
  signupBonusClaimsTable,
  referralsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  creditBonus,
  debitForBet,
  creditForWin,
  convertBonusToCashIfReady,
  revokeBonus,
  getBonusBalance,
  getWageringStatus,
  updatePromotionSettings,
  getPromotionSettings,
  type PromotionSettingsView,
  type DepositTier,
} from "../bonusWallet";
import {
  applySignupBonusAndReferral,
  applyDepositBonus,
} from "../promotions";

/**
 * DB-backed integration tests for the bonus wallet & promotions flows.
 *
 * These exercise the real Postgres-backed paths that pure-math tests
 * (promotions.test.ts) cannot cover: signup IP/email dedup, deposit
 * webhook replay idempotency, referral qualifying on first ≥₹5k recharge,
 * wagering accrual + auto-conversion to cash, and admin revoke.
 *
 * Tests use unique nanoid users per case so they do not collide with
 * each other or with existing data. Promotion settings are snapshotted
 * in `before` and restored in `after` so this file is safe to run
 * against a shared dev database.
 */

const SKIP = !process.env.DATABASE_URL;
if (SKIP) {
  test("bonus wallet integration — skipped (no DATABASE_URL)", () => {});
}

const STD_TIERS: DepositTier[] = [
  { minPaise: "500000", maxPaise: "999999", bonusPaise: "100000" },
  { minPaise: "1000000", maxPaise: "1000000", bonusPaise: "200000" },
  { minPaise: "1000001", maxPaise: null, bonusPaise: "250000" },
];

let adminUserId: string;
let savedSettings: PromotionSettingsView | null = null;
const createdUserIds: string[] = [];

async function makeUser(opts?: {
  withReferralCode?: boolean;
  referredByCode?: string | null;
  email?: string;
}): Promise<{ id: string; email: string; referralCode: string | null }> {
  const id = nanoid();
  const email = opts?.email ?? `t_${id}@example.test`;
  const referralCode = opts?.withReferralCode ? `R_${id.slice(0, 8)}` : null;
  await db.insert(usersTable).values({
    id,
    email,
    emailNormalized: email.toLowerCase(),
    passwordHash: "x",
    role: "player",
    referralCode,
    referredBy: opts?.referredByCode ?? null,
  });
  createdUserIds.push(id);
  return { id, email, referralCode };
}

async function cleanupUser(userId: string) {
  // bonus_wagering cascades on user delete; bonus_ledger restricts so
  // delete ledger first, then events (set null), then claims (cascade),
  // then referrals (cascade), then user.
  await db.delete(bonusLedgerTable).where(eq(bonusLedgerTable.userId, userId));
  await db
    .delete(bonusWageringTable)
    .where(eq(bonusWageringTable.userId, userId));
  await db
    .delete(signupBonusClaimsTable)
    .where(eq(signupBonusClaimsTable.userId, userId));
  await db
    .delete(referralsTable)
    .where(eq(referralsTable.refereeId, userId));
  await db
    .delete(referralsTable)
    .where(eq(referralsTable.referrerId, userId));
  await db
    .delete(bonusEventsTable)
    .where(eq(bonusEventsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

before(async () => {
  if (SKIP) return;
  // Create an admin user we can use as `updatedBy` for settings updates.
  const adminId = nanoid();
  await db.insert(usersTable).values({
    id: adminId,
    email: `admin_${adminId}@test.local`,
    emailNormalized: `admin_${adminId}@test.local`,
    passwordHash: "x",
    role: "admin",
  });
  adminUserId = adminId;
  createdUserIds.push(adminId);

  savedSettings = await getPromotionSettings();
  await updatePromotionSettings({
    enabled: true,
    signupBonusPaise: "100000", // ₹1,000
    depositTiers: STD_TIERS,
    referrerRewardPaise: "50000", // ₹500
    referrerMinDepositPaise: "500000", // ₹5,000
    wageringMultiplier: 1,
    updatedBy: adminId,
  });
});

after(async () => {
  if (SKIP) return;
  // Restore prior promotion settings.
  if (savedSettings) {
    await updatePromotionSettings({
      enabled: savedSettings.enabled,
      signupBonusPaise: savedSettings.signupBonusPaise,
      depositTiers: savedSettings.depositTiers,
      referrerRewardPaise: savedSettings.referrerRewardPaise,
      referrerMinDepositPaise: savedSettings.referrerMinDepositPaise,
      wageringMultiplier: savedSettings.wageringMultiplier,
      updatedBy: adminUserId,
    });
  }
  // Clean up any rows we may have left referencing test users.
  for (const uid of createdUserIds) {
    try {
      await cleanupUser(uid);
    } catch {
      /* best-effort */
    }
  }
  await pool.end();
});

/* ──────────────────────────────────────────────────────────────────
 * Signup IP / email dedup — only the first user from a given IP or
 * email is granted the welcome bonus; subsequent attempts are blocked
 * and recorded but do NOT credit.
 * ────────────────────────────────────────────────────────────────── */

test("signup: first claim from an IP is granted, second is blocked_ip", async (t) => {
  if (SKIP) return t.skip();
  const ip = `10.${Math.floor(Math.random() * 200)}.${Math.floor(
    Math.random() * 200,
  )}.${Math.floor(Math.random() * 200)}`;
  const u1 = await makeUser();
  const u2 = await makeUser();

  const r1 = await applySignupBonusAndReferral({
    userId: u1.id,
    email: u1.email,
    emailNormalized: u1.email.toLowerCase(),
    ip,
    referredBy: null,
  });
  assert.equal(r1.granted, true);
  assert.equal(r1.blockedReason, null);
  assert.equal(await getBonusBalance(u1.id), 100000n);

  const r2 = await applySignupBonusAndReferral({
    userId: u2.id,
    email: u2.email,
    emailNormalized: u2.email.toLowerCase(),
    ip,
    referredBy: null,
  });
  assert.equal(r2.granted, false);
  assert.equal(r2.blockedReason, "duplicate_ip");
  assert.equal(await getBonusBalance(u2.id), 0n);
});

test("signup: duplicate email is blocked even on a different IP", async (t) => {
  if (SKIP) return t.skip();
  const sharedEmail = `dup_${nanoid()}@example.test`.toLowerCase();
  const u1 = await makeUser({ email: sharedEmail });
  // Second user must have a different email row (unique idx on users), so
  // we'll just reuse the *normalized* email passed into the signup helper.
  const u2 = await makeUser();

  const r1 = await applySignupBonusAndReferral({
    userId: u1.id,
    email: u1.email,
    emailNormalized: sharedEmail,
    ip: "203.0.113.10",
    referredBy: null,
  });
  assert.equal(r1.granted, true);

  const r2 = await applySignupBonusAndReferral({
    userId: u2.id,
    email: u2.email,
    emailNormalized: sharedEmail, // same normalized email as u1
    ip: "203.0.113.99", // different IP
    referredBy: null,
  });
  assert.equal(r2.granted, false);
  assert.equal(r2.blockedReason, "duplicate_email");
  assert.equal(await getBonusBalance(u2.id), 0n);
});

test("signup: calling twice for the same user is idempotent", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  const ip = `10.50.${Math.floor(Math.random() * 200)}.1`;
  const r1 = await applySignupBonusAndReferral({
    userId: u.id,
    email: u.email,
    emailNormalized: u.email.toLowerCase(),
    ip,
    referredBy: null,
  });
  assert.equal(r1.granted, true);
  // Second call: signup_bonus_claims has unique on user_id, so the second
  // insert no-ops; creditBonus then sees the existing ledger row via the
  // partial unique idem index and returns alreadyApplied=true.
  await applySignupBonusAndReferral({
    userId: u.id,
    email: u.email,
    emailNormalized: u.email.toLowerCase(),
    ip,
    referredBy: null,
  });
  // Balance should still be exactly the signup bonus once.
  assert.equal(await getBonusBalance(u.id), 100000n);
});

/* ──────────────────────────────────────────────────────────────────
 * Deposit-tier idempotency on webhook replay — applyDepositBonus is
 * keyed by paymentRequestId via the bonus_ledger partial unique idem
 * index. A replayed webhook MUST NOT credit twice.
 * ────────────────────────────────────────────────────────────────── */

test("deposit bonus: webhook replay is idempotent — credited exactly once", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  const paymentRequestId = `pr_${nanoid()}`;
  const r1 = await applyDepositBonus({
    paymentRequestId,
    userId: u.id,
    amountPaise: 500000n, // ₹5,000 → ₹1,000 bonus
  });
  assert.equal(r1.tierBonus, 100000n);
  assert.equal(await getBonusBalance(u.id), 100000n);

  // Replay the same webhook
  const r2 = await applyDepositBonus({
    paymentRequestId,
    userId: u.id,
    amountPaise: 500000n,
  });
  // Second call returns 0 (already applied); balance unchanged.
  assert.equal(r2.tierBonus, 0n);
  assert.equal(await getBonusBalance(u.id), 100000n);
});

test("deposit bonus: under-tier deposit grants nothing", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  const r = await applyDepositBonus({
    paymentRequestId: `pr_${nanoid()}`,
    userId: u.id,
    amountPaise: 499999n, // just under ₹5,000
  });
  assert.equal(r.tierBonus, 0n);
  assert.equal(await getBonusBalance(u.id), 0n);
});

/* ──────────────────────────────────────────────────────────────────
 * Referral qualifying on first ≥₹5k recharge — referrer gets the
 * referral reward and the referrals row flips to 'qualified'.
 * ────────────────────────────────────────────────────────────────── */

test("referral: referee's first ≥₹5k deposit qualifies and pays the referrer", async (t) => {
  if (SKIP) return t.skip();
  const referrer = await makeUser({ withReferralCode: true });
  assert.ok(referrer.referralCode);
  const referee = await makeUser({ referredByCode: referrer.referralCode });

  // Signup creates the referrals row (status=signed_up) for the referee.
  await applySignupBonusAndReferral({
    userId: referee.id,
    email: referee.email,
    emailNormalized: referee.email.toLowerCase(),
    ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    referredBy: referrer.referralCode,
  });

  const refRowsBefore = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.refereeId, referee.id))
    .limit(1);
  assert.equal(refRowsBefore[0]?.status, "signed_up");

  // Referee makes a qualifying deposit.
  const paymentRequestId = `pr_${nanoid()}`;
  const r = await applyDepositBonus({
    paymentRequestId,
    userId: referee.id,
    amountPaise: 500000n,
  });
  assert.equal(r.referralReward, 50000n);

  // Referrer wallet credited; referrals row flipped to 'qualified'.
  assert.equal(await getBonusBalance(referrer.id), 50000n);
  const refRowsAfter = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.refereeId, referee.id))
    .limit(1);
  assert.equal(refRowsAfter[0]?.status, "qualified");
  assert.equal(refRowsAfter[0]?.qualifyingDepositId, paymentRequestId);

  // Replay the deposit webhook — referral reward must NOT pay twice.
  const r2 = await applyDepositBonus({
    paymentRequestId,
    userId: referee.id,
    amountPaise: 500000n,
  });
  assert.equal(r2.referralReward, 0n);
  assert.equal(await getBonusBalance(referrer.id), 50000n);
});

test("referral: under-threshold deposit does not qualify the referrer", async (t) => {
  if (SKIP) return t.skip();
  const referrer = await makeUser({ withReferralCode: true });
  const referee = await makeUser({ referredByCode: referrer.referralCode });
  await applySignupBonusAndReferral({
    userId: referee.id,
    email: referee.email,
    emailNormalized: referee.email.toLowerCase(),
    ip: `198.51.101.${Math.floor(Math.random() * 250) + 1}`,
    referredBy: referrer.referralCode,
  });

  const r = await applyDepositBonus({
    paymentRequestId: `pr_${nanoid()}`,
    userId: referee.id,
    amountPaise: 499999n, // under ₹5,000
  });
  assert.equal(r.referralReward, 0n);
  assert.equal(await getBonusBalance(referrer.id), 0n);
  const refRows = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.refereeId, referee.id))
    .limit(1);
  assert.equal(refRows[0]?.status, "signed_up");
});

/* ──────────────────────────────────────────────────────────────────
 * Wagering accrual via debit/credit + auto-conversion to cash on
 * completion. Multiplier = 1× → required wager == issued bonus.
 * ────────────────────────────────────────────────────────────────── */

test("wagering: debit accrues, credit does not, conversion fires only when met", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  // Issue a ₹1,000 bonus
  await creditBonus({
    userId: u.id,
    type: "signup",
    amount: 100000n,
    refType: "signup",
    refId: u.id,
    memo: "test",
  });
  let status = await getWageringStatus(u.id);
  assert.equal(status.totalIssued, "100000");
  assert.equal(status.requiredWager, "100000");
  assert.equal(status.wageredSoFar, "0");
  assert.equal(status.complete, false);

  // Place a partial bonus bet (debit) — accrues wagering.
  await debitForBet({
    userId: u.id,
    amount: 40000n,
    betId: `bet_${nanoid()}`,
    gameCode: "lunar",
  });
  // Win some back — credit must NOT add to wagering.
  await creditForWin({
    userId: u.id,
    amount: 30000n,
    betId: `bet_${nanoid()}`,
    gameCode: "lunar",
  });
  status = await getWageringStatus(u.id);
  assert.equal(status.wageredSoFar, "40000");
  assert.equal(status.complete, false);

  // Pre-completion conversion is a no-op.
  const conv0 = await convertBonusToCashIfReady(u.id, async () => {
    throw new Error("must not credit cash before wagering met");
  });
  assert.equal(conv0, null);

  // Finish the wagering requirement.
  await debitForBet({
    userId: u.id,
    amount: 60000n,
    betId: `bet_${nanoid()}`,
    gameCode: "mines",
  });
  status = await getWageringStatus(u.id);
  assert.equal(status.wageredSoFar, "100000");
  assert.equal(status.complete, true);

  // Conversion now fires: bonus balance debited to zero, cash credit
  // callback invoked exactly once with the remaining balance.
  const balanceBeforeConv = await getBonusBalance(u.id);
  let cashCalls = 0;
  let cashCreditedAmount = 0n;
  const conv = await convertBonusToCashIfReady(u.id, async (input) => {
    cashCalls++;
    cashCreditedAmount = input.amount;
  });
  assert.ok(conv);
  assert.equal(conv!.converted, balanceBeforeConv);
  assert.equal(cashCalls, 1);
  assert.equal(cashCreditedAmount, balanceBeforeConv);
  assert.equal(await getBonusBalance(u.id), 0n);

  // Wagering tracker reset, second invocation no-ops (idempotent).
  const conv2 = await convertBonusToCashIfReady(u.id, async () => {
    throw new Error("second conversion must not credit cash");
  });
  assert.equal(conv2, null);
});

test("wagering: cash credit failure rolls back the bonus debit atomically", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  await creditBonus({
    userId: u.id,
    type: "signup",
    amount: 50000n,
    refType: "signup",
    refId: u.id,
    memo: "test",
  });
  await debitForBet({
    userId: u.id,
    amount: 50000n,
    betId: `bet_${nanoid()}`,
    gameCode: "lunar",
  });
  await creditForWin({
    userId: u.id,
    amount: 20000n,
    betId: `bet_${nanoid()}`,
    gameCode: "lunar",
  });
  const before = await getBonusBalance(u.id);
  assert.ok(before > 0n);

  await assert.rejects(
    convertBonusToCashIfReady(u.id, async () => {
      throw new Error("simulated cash credit failure");
    }),
    /simulated cash credit failure/,
  );
  // Bonus debit must have rolled back; balance is unchanged.
  assert.equal(await getBonusBalance(u.id), before);
});

/* ──────────────────────────────────────────────────────────────────
 * Admin revoke — zeros the bonus balance, resets wagering, writes
 * an immutable revoke ledger row, idempotent on empty.
 * ────────────────────────────────────────────────────────────────── */

test("revoke: zeros positive bonus and resets wagering tracker", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  await creditBonus({
    userId: u.id,
    type: "signup",
    amount: 100000n,
    refType: "signup",
    refId: u.id,
    memo: "test",
  });
  await debitForBet({
    userId: u.id,
    amount: 30000n,
    betId: `bet_${nanoid()}`,
    gameCode: "lunar",
  });
  assert.equal(await getBonusBalance(u.id), 70000n);

  const revoked = await revokeBonus({
    userId: u.id,
    reason: "test revoke",
    actorId: adminUserId,
  });
  assert.equal(revoked, 70000n);
  assert.equal(await getBonusBalance(u.id), 0n);

  const status = await getWageringStatus(u.id);
  assert.equal(status.totalIssued, "0");
  assert.equal(status.requiredWager, "0");
  assert.equal(status.wageredSoFar, "0");

  // A revoke ledger row exists with negative amount and balanceAfter=0.
  const rows = await db
    .select()
    .from(bonusLedgerTable)
    .where(
      and(eq(bonusLedgerTable.userId, u.id), eq(bonusLedgerTable.type, "revoke")),
    );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.amount, -70000n);
  assert.equal(rows[0]!.balanceAfter, 0n);
});

test("revoke: zero balance is a no-op (no ledger row written)", async (t) => {
  if (SKIP) return t.skip();
  const u = await makeUser();
  const revoked = await revokeBonus({
    userId: u.id,
    reason: "noop",
    actorId: adminUserId,
  });
  assert.equal(revoked, 0n);
  const rows = await db
    .select()
    .from(bonusLedgerTable)
    .where(eq(bonusLedgerTable.userId, u.id));
  assert.equal(rows.length, 0);
});
