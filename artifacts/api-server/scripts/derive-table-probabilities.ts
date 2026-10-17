// Exhaustive finite-deck enumeration; no random simulation or player bets.
import { dealBaccarat } from "../src/services/baccaratMath";
import { evaluateHand } from "../src/services/teenPattiMath";
const counts = [128, ...Array(9).fill(32)]; // Eight decks, by baccarat value.
const result = { player: 0, banker: 0, tie: 0 };
const cards: number[] = [];
function baccarat(depth: number, probability: number) {
  if (depth === 6) {
    result[dealBaccarat(cards).winner] += probability;
    return;
  }
  for (let value = 0; value < 10; value++) {
    const remaining = counts[value];
    if (!remaining) continue;
    counts[value]--;
    cards.push(value === 0 ? 9 : value - 1);
    baccarat(depth + 1, probability * remaining / (416 - depth));
    cards.pop(); counts[value]++;
  }
}
baccarat(0, 1);
const groups = new Map<number, number[][]>();
const categories: Record<string, number> = {};
for (let a = 0; a < 50; a++) for (let b = a + 1; b < 51; b++) for (let c = b + 1; c < 52; c++) {
  const hand = [a,b,c], rank = evaluateHand(hand);
  categories[rank.category] = (categories[rank.category] ?? 0) + 1;
  const group = groups.get(rank.score) ?? [];
  group.push(hand); groups.set(rank.score, group);
}
let ties = 0;
for (const group of groups.values()) for (const a of group) for (const b of group)
  if (a.every(card => !b.includes(card))) ties++;
console.log(JSON.stringify({ baccarat: result, teenPatti: { categories, tie: ties / (22100 * 18424), ties, total: 22100 * 18424 } }, null, 2));
