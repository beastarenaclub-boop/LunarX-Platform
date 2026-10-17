export function paiseToINR(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "₹0.00";
  let n: bigint;
  try {
    n = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    return String(value);
  }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const major = abs / 100n;
  const minor = abs % 100n;
  const formatted = `₹${major.toString()}.${minor.toString().padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
