import { WALLET_SCOPES, type WalletScope } from "./wallet";
import { badRequest } from "../lib/errors";

/**
 * Server-owned coin & coin-pack catalog.
 *
 * ONE ladder drives both halves of the coin economy so a player sees the same
 * numbers when betting and when topping up:
 *
 *   chip denominations (₹, what you stake) :  10   20   50  100  200  500  1k  2k  5k  10k
 *   coin packs (coins, what you buy)       : 100  200  500   1k   2k   5k 10k 20k 50k 100k
 *
 * The mapping is exact and intentional: **pack coins = chip denomination × 10**,
 * i.e. every pack is worth exactly ten bets at its matching chip. Coins are
 * 1:1 with rupees (the wallet already stores INR paise), so:
 *
 *   price in paise = coins × 100
 *
 * This module is the single source of truth. Clients never send a price — they
 * send a SKU and the server derives/validates the amount from this catalog.
 * Prices are not admin-configurable (by design, out of scope for pricing
 * experiments); changing the ladder here changes it everywhere.
 *
 * Packs are game-scoped because every game has a FULLY separate wallet: buying
 * `COINS-MINES-500` credits the mines wallet and nothing else. The SKU carries
 * that scope so a purchase can be reconciled to the wallet it funded.
 */

/** Chip denominations, in whole rupees. Ten entries, classic 1-2-5 ladder. */
export const CHIP_DENOMINATIONS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
] as const;

/** Every pack is worth ten bets at its matching chip denomination. */
export const COINS_PER_CHIP_MULTIPLIER = 10;

/** 1 coin = ₹1 = 100 paise. Coins are not a separate currency. */
export const PAISE_PER_COIN = 100n;

export const COIN_PACK_COUNT = CHIP_DENOMINATIONS.length;

export interface CoinPack {
  /** Stable, human-readable catalog id, e.g. `COINS-LUNAR-500`. */
  sku: string;
  /** Which game's separate wallet this pack credits. */
  game: WalletScope;
  /** Coins granted by the pack (equals rupees, 1:1). */
  coins: number;
  /** Exact price in paise — the only price the server will accept. */
  amountPaise: bigint;
  /** Chip denomination this pack is sized for (coins / 10). */
  chipValue: number;
}

function skuFor(game: WalletScope, coins: number): string {
  return `COINS-${game.toUpperCase()}-${coins}`;
}

function buildPacks(game: WalletScope): CoinPack[] {
  return CHIP_DENOMINATIONS.map((chipValue) => {
    const coins = chipValue * COINS_PER_CHIP_MULTIPLIER;
    return {
      sku: skuFor(game, coins),
      game,
      coins,
      amountPaise: BigInt(coins) * PAISE_PER_COIN,
      chipValue,
    };
  });
}

const PACKS_BY_GAME: ReadonlyMap<WalletScope, readonly CoinPack[]> = new Map(
  WALLET_SCOPES.map((game) => [game, buildPacks(game)] as const),
);

const PACKS_BY_SKU: ReadonlyMap<string, CoinPack> = new Map(
  [...PACKS_BY_GAME.values()].flatMap((packs) =>
    packs.map((pack) => [pack.sku, pack] as const),
  ),
);

/** The ten packs on sale for one game, cheapest first. */
export function listCoinPacks(game: WalletScope): readonly CoinPack[] {
  return PACKS_BY_GAME.get(game) ?? [];
}

/** Look up a pack by SKU across every game. Returns null for unknown SKUs. */
export function findCoinPack(sku: string): CoinPack | null {
  return PACKS_BY_SKU.get(sku) ?? null;
}

/**
 * Validate a client-supplied coin-pack selection against the catalog.
 *
 * Returns the catalog entry when `sku` is present and consistent with the
 * request, or `null` when no SKU was supplied (custom amount / legacy client).
 * Throws 400 when the SKU is unknown, belongs to a different game, or its
 * catalog price does not match the submitted paise amount — the client price
 * is never trusted, only compared.
 */
export function resolveCoinPack(input: {
  sku?: string | null;
  game: WalletScope;
  amount: bigint;
  coinQuantity?: number | null;
}): CoinPack | null {
  const sku = input.sku?.trim();
  if (!sku) return null;

  const pack = findCoinPack(sku);
  if (!pack) throw badRequest(`Unknown coin pack "${sku}"`);
  if (pack.game !== input.game) {
    throw badRequest(
      `Coin pack "${sku}" belongs to ${pack.game}, not ${input.game}`,
    );
  }
  if (pack.amountPaise !== input.amount) {
    throw badRequest(
      `Coin pack "${sku}" costs ₹${(Number(pack.amountPaise) / 100).toLocaleString("en-IN")}, but ₹${(Number(input.amount) / 100).toLocaleString("en-IN")} was submitted`,
    );
  }
  if (
    input.coinQuantity !== undefined &&
    input.coinQuantity !== null &&
    input.coinQuantity !== pack.coins
  ) {
    throw badRequest(
      `Coin pack "${sku}" grants ${pack.coins} coins, but ${input.coinQuantity} was submitted`,
    );
  }
  return pack;
}

/** Wire shape for the public catalog endpoint. */
export function serializeCoinPack(pack: CoinPack) {
  return {
    sku: pack.sku,
    game: pack.game,
    coins: pack.coins,
    amount: pack.amountPaise.toString(),
    chipValue: pack.chipValue,
  };
}
