import { test } from "node:test";
import assert from "node:assert/strict";
import {
  L7_SUITS,
  L7_SPOTS,
  wins,
  l7Payout,
  normalizeL7Bets,
  type L7Spot,
} from "@workspace/api-zod/lucky7-live";
import { deriveL7Card } from "../lucky7LiveMath";
test("all 52 cards give the reference paytable and correct rank, colour and parity", () => {
  const counts: Record<L7Spot, number> = {
    up: 0,
    seven: 0,
    down: 0,
    red: 0,
    black: 0,
    odd: 0,
    even: 0,
  };
  const returns = {
    up: 200n,
    seven: 1200n,
    down: 200n,
    red: 190n,
    black: 190n,
    odd: 180n,
    even: 200n,
  };
  for (const suit of L7_SUITS)
    for (let rank = 1; rank <= 13; rank++)
      for (const spot of L7_SPOTS) {
        const won = wins(spot, { rank, suit });
        counts[spot] += Number(won);
        assert.equal(
          l7Payout([{ spot, amountPaise: "100" }], { rank, suit }),
          won ? returns[spot] : 0n,
        );
      }
  assert.deepEqual(counts, {
    up: 24,
    down: 24,
    seven: 4,
    red: 26,
    black: 26,
    odd: 28,
    even: 24,
  });
  assert.equal(
    l7Payout(
      [
        { spot: "seven", amountPaise: "5000" },
        { spot: "odd", amountPaise: "5000" },
        { spot: "red", amountPaise: "5000" },
        { spot: "up", amountPaise: "5000" },
        { spot: "down", amountPaise: "5000" },
      ],
      { rank: 7, suit: "hearts" },
    ),
    78500n,
  );
});
test("stakes normalize for idempotency; invalid and duplicate bets are rejected", () => {
  assert.deepEqual(
    normalizeL7Bets([
      { spot: "up", amountPaise: "100" },
      { spot: "down", amountPaise: "200" },
    ]),
    [
      { spot: "down", amountPaise: "200" },
      { spot: "up", amountPaise: "100" },
    ],
  );
  for (const amountPaise of ["0", "-5", "1.5", "NaN", "9007199254740992"])
    assert.throws(() => normalizeL7Bets([{ spot: "up", amountPaise }]));
  assert.throws(() =>
    normalizeL7Bets([
      { spot: "up", amountPaise: "1" },
      { spot: "up", amountPaise: "2" },
    ]),
  );
  assert.throws(() =>
    l7Payout([{ spot: "up", amountPaise: "1" }], { rank: 14, suit: "hearts" }),
  );
  assert.throws(() =>
    l7Payout(
      [{ spot: "up", amountPaise: "1" }],
      { rank: 9, suit: "hearts" },
      2,
    ),
  );
  assert.equal(
    l7Payout([{ spot: "red", amountPaise: "101" }], {
      rank: 7,
      suit: "hearts",
    }),
    191n,
  );
});
test("committed seed replay is stable and draws all 52 cards", () => {
  assert.deepEqual(
    deriveL7Card("seed", "client", 4),
    deriveL7Card("seed", "client", 4),
  );
  const seen = new Set<string>();
  for (let n = 0; n < 2500; n++) {
    const card = deriveL7Card("test-seed", "client", n);
    assert.ok(card.rank >= 1 && card.rank <= 13);
    seen.add(`${card.rank}:${card.suit}`);
  }
  assert.equal(seen.size, 52);
});
