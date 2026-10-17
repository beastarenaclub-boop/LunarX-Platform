import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CHIP_DENOMINATIONS,
  COINS_PER_CHIP_MULTIPLIER,
  COIN_PACK_COUNT,
  PAISE_PER_COIN,
  findCoinPack,
  listCoinPacks,
  resolveCoinPack,
  serializeCoinPack,
} from "../coinPacks";
import { WALLET_SCOPES } from "../wallet";

/**
 * The coin catalog is the price list. It is server-owned on purpose: the
 * client picks a SKU and the server decides what it costs, so a tampered
 * price in the browser can never buy coins cheaply.
 *
 * These tests pin the ladder itself (ten packs, coins = chip × 10, ₹1/coin)
 * and every rejection path of `resolveCoinPack`.
 */

test("every game sells exactly ten packs on the shared ladder", () => {
  assert.equal(COIN_PACK_COUNT, 10);
  assert.equal(CHIP_DENOMINATIONS.length, 10);

  for (const game of WALLET_SCOPES) {
    const packs = listCoinPacks(game);
    assert.equal(packs.length, 10, `${game} should sell ten packs`);

    packs.forEach((pack, i) => {
      const chip = CHIP_DENOMINATIONS[i]!;
      assert.equal(pack.chipValue, chip);
      assert.equal(pack.coins, chip * COINS_PER_CHIP_MULTIPLIER);
      assert.equal(pack.amountPaise, BigInt(pack.coins) * PAISE_PER_COIN);
      assert.equal(pack.game, game);
      assert.equal(pack.sku, `COINS-${game.toUpperCase()}-${pack.coins}`);
    });

    // Cheapest first, strictly increasing — the UI renders them in order.
    const prices = packs.map((p) => p.amountPaise);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i]! > prices[i - 1]!, `${game} packs must ascend`);
    }
  }
});

test("the ladder spans ₹100 to ₹100,000 with 1:1 coins", () => {
  const packs = listCoinPacks("lunar");
  assert.deepEqual(
    packs.map((p) => p.coins),
    [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
  );
  // Coins are rupees, so the paise price is always coins × 100.
  assert.equal(packs[0]!.amountPaise, 10_000n);
  assert.equal(packs[9]!.amountPaise, 10_000_000n);
});

test("SKUs are unique across the whole catalog and resolvable", () => {
  const seen = new Set<string>();
  for (const game of WALLET_SCOPES) {
    for (const pack of listCoinPacks(game)) {
      assert.ok(!seen.has(pack.sku), `duplicate SKU ${pack.sku}`);
      seen.add(pack.sku);
      assert.deepEqual(findCoinPack(pack.sku), pack);
    }
  }
  assert.equal(seen.size, WALLET_SCOPES.length * 10);
  assert.equal(findCoinPack("COINS-LUNAR-999"), null);
  assert.equal(findCoinPack(""), null);
});

test("resolveCoinPack accepts an exact, in-scope selection", () => {
  const pack = resolveCoinPack({
    sku: "COINS-MINES-5000",
    game: "mines",
    amount: 500_000n,
    coinQuantity: 5000,
  });
  assert.equal(pack?.sku, "COINS-MINES-5000");
  assert.equal(pack?.coins, 5000);
  assert.equal(pack?.chipValue, 500);
});

test("resolveCoinPack returns null for a custom amount (no SKU)", () => {
  // Legacy clients and players entering their own amount stay supported.
  assert.equal(
    resolveCoinPack({ sku: null, game: "lunar", amount: 123_400n }),
    null,
  );
  assert.equal(
    resolveCoinPack({ sku: undefined, game: "lunar", amount: 123_400n }),
    null,
  );
  assert.equal(
    resolveCoinPack({ sku: "   ", game: "lunar", amount: 123_400n }),
    null,
  );
});

test("resolveCoinPack rejects unknown, cross-game and mispriced selections", () => {
  // Unknown SKU.
  assert.throws(
    () => resolveCoinPack({ sku: "COINS-LUNAR-777", game: "lunar", amount: 77_700n }),
    /Unknown coin pack/,
  );
  // Right SKU, wrong wallet — packs are game-scoped because wallets are.
  assert.throws(
    () => resolveCoinPack({ sku: "COINS-LUNAR-500", game: "mines", amount: 50_000n }),
    /belongs to lunar/,
  );
  // Client tried to pay less than the catalog price.
  assert.throws(
    () => resolveCoinPack({ sku: "COINS-LUNAR-500", game: "lunar", amount: 100n }),
    /costs ₹500/,
  );
  // …or more.
  assert.throws(
    () => resolveCoinPack({ sku: "COINS-LUNAR-500", game: "lunar", amount: 60_000n }),
    /costs ₹500/,
  );
  // Coin count must agree with the SKU when it is supplied.
  assert.throws(
    () =>
      resolveCoinPack({
        sku: "COINS-LUNAR-500",
        game: "lunar",
        amount: 50_000n,
        coinQuantity: 999999,
      }),
    /grants 500 coins/,
  );
});

test("serializeCoinPack emits JSON-safe paise strings", () => {
  const [first] = listCoinPacks("dice");
  assert.deepEqual(serializeCoinPack(first!), {
    sku: "COINS-DICE-100",
    game: "dice",
    coins: 100,
    amount: "10000",
    chipValue: 10,
  });
});
