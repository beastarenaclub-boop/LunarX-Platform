import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  matchDepositTier,
  isBonusEligibleGame,
  BONUS_GAMES,
  type DepositTier,
} from "../bonusWallet";

/**
 * Default tier ladder per Task #102 spec:
 *   < ₹5,000          → no bonus
 *   ₹5,000 – ₹9,999   → ₹1,000 bonus
 *   exactly ₹10,000   → ₹2,000 bonus
 *   > ₹10,000         → ₹2,500 bonus
 */
const TIERS: DepositTier[] = [
  { minPaise: "500000", maxPaise: "999999", bonusPaise: "100000" },
  { minPaise: "1000000", maxPaise: "1000000", bonusPaise: "200000" },
  { minPaise: "1000001", maxPaise: null, bonusPaise: "250000" },
];

test("deposit tier: ₹0 — no bonus", () => {
  assert.equal(matchDepositTier(0n, TIERS), null);
});
test("deposit tier: ₹49.99 (4999 paise) — no bonus", () => {
  assert.equal(matchDepositTier(499900n, TIERS), null);
});
test("deposit tier: ₹4,999.99 — no bonus (boundary just under ₹5,000)", () => {
  assert.equal(matchDepositTier(499999n, TIERS), null);
});
test("deposit tier: ₹5,000 → ₹1,000", () => {
  assert.equal(matchDepositTier(500000n, TIERS)!.bonusPaise, "100000");
});
test("deposit tier: ₹9,999.99 still ₹1,000 (boundary just under ₹10,000)", () => {
  assert.equal(matchDepositTier(999999n, TIERS)!.bonusPaise, "100000");
});
test("deposit tier: exactly ₹10,000 → ₹2,000", () => {
  assert.equal(matchDepositTier(1000000n, TIERS)!.bonusPaise, "200000");
});
test("deposit tier: ₹10,000.01 → ₹2,500 (just over ₹10,000)", () => {
  assert.equal(matchDepositTier(1000001n, TIERS)!.bonusPaise, "250000");
});
test("deposit tier: ₹50,000 → ₹2,500 (top, open-ended)", () => {
  assert.equal(matchDepositTier(5000000n, TIERS)!.bonusPaise, "250000");
});
test("deposit tier: empty list returns null", () => {
  assert.equal(matchDepositTier(1000000n, []), null);
});
test("deposit tier: overlapping tiers — picks the highest matching min", () => {
  const overlapping: DepositTier[] = [
    { minPaise: "500000", maxPaise: null, bonusPaise: "100000" },
    { minPaise: "1000000", maxPaise: null, bonusPaise: "200000" },
  ];
  assert.equal(matchDepositTier(1500000n, overlapping)!.bonusPaise, "200000");
});

/* ──────────────────────────────────────────────────────────────────
 * Bonus eligibility allowlist — bonus-wallet spend is restricted to
 * the four games defined in the spec (Lunar/Mines/Plinko/Dice).
 * ────────────────────────────────────────────────────────────────── */

test("bonus eligibility: BONUS_GAMES is exactly the four spec games", () => {
  assert.deepEqual([...BONUS_GAMES].sort(), ["dice", "lunar", "mines", "plinko"]);
});
test("bonus eligibility: every spec game is allowed", () => {
  for (const g of BONUS_GAMES) assert.equal(isBonusEligibleGame(g), true);
});
test("bonus eligibility: rejects non-allowlisted games", () => {
  for (const g of [
    "aviator",
    "crash",
    "blackjack",
    "roulette",
    "slots",
    "",
    "LUNAR", // case-sensitive
    "lunar2",
  ]) {
    assert.equal(isBonusEligibleGame(g), false, `should reject: ${g}`);
  }
});

/* ──────────────────────────────────────────────────────────────────
 * Wagering math — required = issued × multiplier, completion fires
 * exactly at remaining = 0, never before. These are the invariants
 * the bonus→cash conversion gate relies on.
 * ────────────────────────────────────────────────────────────────── */

interface WageringRow {
  totalIssued: bigint;
  requiredWager: bigint;
  wageredSoFar: bigint;
}
function status(row: WageringRow) {
  const remaining = row.requiredWager - row.wageredSoFar;
  return {
    remaining: remaining < 0n ? 0n : remaining,
    complete: row.totalIssued > 0n && row.wageredSoFar >= row.requiredWager,
  };
}

test("wagering: 1× multiplier — incomplete until full required wager met", () => {
  const r: WageringRow = {
    totalIssued: 100000n,
    requiredWager: 100000n,
    wageredSoFar: 99999n,
  };
  assert.equal(status(r).complete, false);
  assert.equal(status(r).remaining, 1n);
  r.wageredSoFar = 100000n;
  assert.equal(status(r).complete, true);
  assert.equal(status(r).remaining, 0n);
});

test("wagering: zero issuance never converts even if wagered>0", () => {
  // Race guard: if requiredWager and totalIssued are zero, conversion
  // must NOT fire. Mirrors the inside-lock check in convertBonusToCashIfReady.
  const r: WageringRow = {
    totalIssued: 0n,
    requiredWager: 0n,
    wageredSoFar: 5000n,
  };
  assert.equal(status(r).complete, false);
});

test("wagering: concurrent issuance raises bar — re-eval blocks premature conversion", () => {
  // Simulates: pre-check sees complete=true, then a new bonus issuance
  // bumps requiredWager. The inside-lock re-evaluation must observe the
  // bumped row and refuse to convert.
  const before: WageringRow = {
    totalIssued: 100000n,
    requiredWager: 100000n,
    wageredSoFar: 100000n,
  };
  assert.equal(status(before).complete, true); // pre-check
  // Inside the conversion lock, a concurrent creditBonus added ₹500
  // (50000 paise) at 1× multiplier:
  const after: WageringRow = {
    totalIssued: 150000n,
    requiredWager: 150000n,
    wageredSoFar: 100000n,
  };
  assert.equal(status(after).complete, false); // inside-lock re-check
  assert.equal(status(after).remaining, 50000n);
});

test("wagering: 3× multiplier requires 3× the issued amount before convertible", () => {
  const issued = 100000n;
  const mult = 3n;
  const r: WageringRow = {
    totalIssued: issued,
    requiredWager: issued * mult,
    wageredSoFar: issued * 2n,
  };
  assert.equal(status(r).complete, false);
  assert.equal(status(r).remaining, issued);
  r.wageredSoFar = issued * 3n;
  assert.equal(status(r).complete, true);
});
