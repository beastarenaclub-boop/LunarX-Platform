import { money, SERIES } from "./api";
import type { Settings } from "./types";

export function seriesPrice(config: Settings, series: string) {
  return config.seriesPrices?.[series] ?? config.unitPrice;
}

export function priceRange(config: Settings, series: string[] = SERIES) {
  const values = series.map((s) => seriesPrice(config, s));
  if (!values.length) return "—";
  const min = Math.min(...values),
    max = Math.max(...values);
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}
