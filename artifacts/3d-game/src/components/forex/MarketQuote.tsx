import type { Market } from "../../../../../lib/forex/store.mjs";

export function marketPrice(market: Market, value = market.quote?.price) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", {
    minimumFractionDigits: market.decimals, maximumFractionDigits: market.decimals,
  });
}
export function marketChange(market: Market) {
  const change = market.quote?.changePercent;
  return change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}
export function marketTone(market?: Market) {
  const change = market?.quote?.changePercent;
  return change == null || change === 0 ? "fx-flat" : change > 0 ? "fx-up" : "fx-down";
}
export function MarketQuoteStatus({ market }: { market?: Market }) {
  const quote = market?.quote;
  const label = !quote || quote.status === "unavailable" ? "Quote unavailable · retrying" :
    quote.status === "stale" ? "Last available quote" : `Delayed ~${quote.delayMinutes} min`;
  return <div className="fx-quote-source" data-testid="quote-source">
    {quote ? <a href={quote.sourceUrl} target="_blank" rel="noreferrer">Google Finance ↗</a> : <span>Google Finance</span>}
    <span>{label}</span>
    {quote?.quotedAt && <time dateTime={new Date(quote.quotedAt).toISOString()}
      title={`Quote time: ${new Date(quote.quotedAt).toLocaleString()}${quote.checkedAt ? ` · Checked: ${new Date(quote.checkedAt).toLocaleString()}` : ""}`}>
      As of {new Date(quote.quotedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </time>}
    <span>{quote?.unit || "Auto-refresh 30s"}</span>
  </div>;
}
