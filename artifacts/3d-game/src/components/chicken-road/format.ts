/** Signed profit factor for display; server multipliers still include the stake. */
export function formatProfitFactor(totalMultiplier: number): string {
  const hundredths = Math.round(totalMultiplier * 100) - 100;
  return `${hundredths >= 0 ? "+" : ""}${(hundredths / 100).toFixed(2)}`;
}
