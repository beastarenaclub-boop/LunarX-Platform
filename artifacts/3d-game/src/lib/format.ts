/**
 * Wallet amounts are stored in paise (₹/100) on the server and serialized as
 * decimal strings to preserve full bigint precision in JSON. The UI works in
 * rupees with two decimal places.
 */
export function paiseToRupees(paise: string | bigint | null | undefined): number {
  if (paise === null || paise === undefined) return 0;
  try {
    const big = typeof paise === "bigint" ? paise : BigInt(paise);
    // Avoid bigint -> number precision loss: split into rupees + remainder.
    const rupees = Number(big / 100n);
    const remainder = Number(big % 100n);
    return rupees + remainder / 100;
  } catch {
    return 0;
  }
}

export function rupeesToPaise(rupees: number): string {
  // Use rounding so e.g. 1.005 doesn't get truncated by floating-point error.
  return Math.round(rupees * 100).toString();
}

export function formatRupees(paise: string | bigint | null | undefined): string {
  const v = paiseToRupees(paise);
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRupeesShort(paise: string | bigint | null | undefined): string {
  const v = paiseToRupees(paise);
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
