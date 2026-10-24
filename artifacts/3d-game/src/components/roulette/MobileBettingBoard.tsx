import { useState } from "react";
import { betKey, betLabel, pocketColor, type BetType, type PlacedBet } from "./wheelData";
import { formatChip } from "@/components/table/chips";
import type { BettingBoardProps } from "./BettingBoard";

type Selection = Omit<PlacedBet, "amount">;
type Combination = "split" | "street" | "corner" | "line";

// Explicit choices keep edge bets usable without overlapping tiny phone targets.
const combinations: Record<Combination, Selection[]> = {
  split: [
    ...[1, 2, 3].map(n => ({ type: "split" as const, numbers: [0, n] })),
    ...Array.from({ length: 36 }, (_, i) => i + 1).flatMap(n => [
      ...(n % 3 ? [{ type: "split" as const, numbers: [n, n + 1] }] : []),
      ...(n <= 33 ? [{ type: "split" as const, numbers: [n, n + 3] }] : []),
    ]),
  ],
  street: [[0, 1, 2], [0, 2, 3], ...Array.from({ length: 12 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3])].map(numbers => ({ type: "street", numbers })),
  corner: [[0, 1, 2, 3], ...Array.from({ length: 33 }, (_, i) => i + 1).filter(n => n % 3).map(n => [n, n + 1, n + 3, n + 4])].map(numbers => ({ type: "corner", numbers })),
  line: Array.from({ length: 11 }, (_, i) => ({ type: "line", numbers: Array.from({ length: 6 }, (_, j) => i * 3 + j + 1) })),
};

export default function MobileBettingBoard({ bets, onPlace, disabled, highlight }: BettingBoardProps) {
  const [tab, setTab] = useState<"numbers" | "outside" | "combinations">("numbers");
  const [combination, setCombination] = useState<Combination>("split");
  const choice = (selection: Selection, label: string, id: string) => {
    const amount = bets.get(betKey(selection))?.amount;
    const number = selection.type === "straight" ? selection.numbers![0] : null;
    const color = number !== null ? pocketColor(number) : selection.type;
    return <button key={id} type="button" disabled={disabled}
      className={`roulette-phone-choice is-${color}${number === 0 ? " is-zero" : ""}${number !== null && highlight === number ? " is-winning" : ""}`}
      aria-label={betLabel(selection)} aria-pressed={amount !== undefined}
      data-testid={`mobile-${id}`} onClick={() => onPlace(selection)}>
      <span>{label}</span>{amount !== undefined && <b className="roulette-phone-chip">{formatChip(amount)}</b>}
    </button>;
  };
  return <div className="roulette-phone-board hidden">
    <div className="roulette-phone-tabs" aria-label="Betting options">
      {([['numbers', 'Numbers'], ['outside', 'Outside'], ['combinations', 'Combinations']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {tab === 'numbers' && <div className="roulette-phone-numbers" aria-label="Numbers 0 to 36">
      {Array.from({ length: 37 }, (_, n) => choice({ type: 'straight', numbers: [n] }, String(n), `cell-${n}`))}
    </div>}
    {tab === 'outside' && <div className="roulette-phone-outside" aria-label="Outside bets">
      {[1, 2, 3].map(n => choice({ type: 'dozen', selection: n }, `${n === 1 ? '1st' : n === 2 ? '2nd' : '3rd'} 12`, `dozen-${n}`))}
      {[1, 2, 3].map(n => choice({ type: 'column', selection: n }, `Column ${n}`, `column-${n}`))}
      {([['low', '1–18'], ['even', 'Even'], ['red', 'Red'], ['black', 'Black'], ['odd', 'Odd'], ['high', '19–36']] as [BetType, string][]).map(([type, label]) => choice({ type }, label, `outside-${type}`))}
    </div>}
    {tab === 'combinations' && <div className="roulette-phone-combinations">
      <select aria-label="Combination bet type" value={combination} onChange={e => setCombination(e.target.value as Combination)}>
        <option value="split">Split · 2 numbers</option><option value="street">Street · 3 numbers</option>
        <option value="corner">Corner · 4 numbers</option><option value="line">Line · 6 numbers</option>
      </select>
      <div className="roulette-phone-combination-list" aria-label={`${combination} bets`}>
        {combinations[combination].map(selection => choice(selection, selection.numbers!.join('–'), `${combination}-${selection.numbers!.join('-')}`))}
      </div>
    </div>}
  </div>;
}
