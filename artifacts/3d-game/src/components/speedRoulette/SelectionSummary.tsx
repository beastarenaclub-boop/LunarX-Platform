import type { CSSProperties } from "react";
import { pocketColor, type PlacedBet } from "../roulette/wheelData";
import { coveredNumbers, type BetPreview } from "./layout";

export default function SelectionSummary({ preview, bets, chip, disabled }: { preview: BetPreview | null; bets: PlacedBet[]; chip: number; disabled: boolean }) {
  const activePreview = disabled ? null : preview;
  const numbers = coveredNumbers(activePreview?.spots ?? bets);
  if (!numbers.length) return null;
  const amount = activePreview ? activePreview.spots.length * chip : bets.reduce((total, bet) => total + bet.amount, 0);
  const coverage = new Map<number, number>();
  for (const bet of bets) for (const n of coveredNumbers([bet])) coverage.set(n, (coverage.get(n) ?? 0) + bet.amount);
  const format = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return <section className={`sar-selection-summary ${activePreview ? "preview" : "placed"}`} aria-label="Bet selection" data-testid="speed-selection-summary" data-mode={activePreview ? "preview" : "selected"}>
    <div className="sar-selection-heading"><span>{activePreview ? "BET PREVIEW" : "SELECTED NUMBERS"}</span><b>{numbers.length} {numbers.length === 1 ? "number" : "numbers"}</b></div>
    {activePreview && <p>{activePreview.label}</p>}
    <div className="sar-selection-numbers" data-testid="speed-selection-numbers" aria-label={numbers.join(", ")}>
      {numbers.map((n, i) => <span key={`${activePreview ? `preview:${activePreview.label}` : `placed:${coverage.get(n)}`}:${n}`} className={pocketColor(n)} data-number={n} style={{ "--selection-delay": `${i * Math.min(38, 170 / Math.max(1, numbers.length - 1))}ms` } as CSSProperties}>{n}</span>)}
    </div>
    <div className="sar-selection-total"><span>{activePreview ? `${activePreview.spots.length} ${activePreview.spots.length === 1 ? "chip" : "chips"} × ${format(chip)}` : "Total on table"}</span><strong key={`${activePreview ? "preview" : "placed"}:${amount}`}>{format(amount)}</strong></div>
    {activePreview && <small>Click once to add this group</small>}
  </section>;
}
