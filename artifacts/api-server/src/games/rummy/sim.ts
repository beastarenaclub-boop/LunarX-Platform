/**
 * The deal as the result engine sees it.
 *
 * Rummy has no single draw at "betting close": the result unfolds over turns
 * the player takes part in. What the house CAN choose is the deal — the order
 * of the 106 cards and who opens — and that is what the engine steers. A deal
 * is classified by playing it out with every seat on the computer policy
 * (`autoStep`, deterministic): the seat that declares first is the class,
 * `you` / `computer` / `draw`. For a player who plays exactly as the bots do
 * the prediction is the outcome; a better or worse player moves the real
 * result off it, which is why this is a bias the engine applies and not a
 * settlement it dictates — settlement is what really happened at the table.
 *
 * Candidates are real deals derived from the round's own seed with distinct
 * suffixes (the card games' `sampleDeals` shape), so a steered round is still
 * a fair-looking deal — just one chosen from a handful, not the first drawn.
 * The play-out is capped at PREDICT_TURNS; a table still open by then is
 * classed by whose hand is nearest to a declaration (fewest unmatched points).
 */
import { createSeedStream } from "../../lib/seedStream";
import type { OutcomeChoice, OutcomeSeed, OutcomeSpace } from "../../services/tableAdapter";
import { analyzeHand, autoStep, createDeck, dealTable, shuffle, SEATS, type Card, type TableState } from "./rules";
import type { RummyClass } from "./math";

/** A dealt round: the full shuffled deck (ids) and the opening seat. */
export interface RummyDeal {
  deck: string[];
  opener: number;
}

/** How many deals the engine scores when it steers. */
export const CANDIDATE_DEALS = 6;
/** Turns the classifier plays before judging by hand strength instead. */
export const PREDICT_TURNS = 40;
/**
 * How many suffixed deals `forChoice` tries before giving up on a class.
 * "you" lands about one deal in four, so 16 tries missed roughly one force
 * in a hundred — seen once as `rummy.integration` I1 dealt an honest, lost
 * hand under an armed "you" (2026-10-07). 48 tries is a one-in-a-million
 * miss at ~60 ms a try, paid only when a force is armed.
 */
const FORCE_TRIES = 48;

const BY_ID = new Map(createDeck().map((c) => [c.id, c]));

/** The honest deal for a seed tuple: a seeded Fisher-Yates, then the opener. */
export function deriveDeal(serverSeed: string, clientSeed: string, nonce: number): RummyDeal {
  const stream = createSeedStream(serverSeed, clientSeed, nonce);
  // `shuffle` wants a [0, 1) source; `uniform` is exact for the index it
  // needs, so hand it one that lands on exactly the integer Fisher-Yates
  // floors to — no float rounding on the way.
  let i = 106;
  const deck = shuffle(createDeck(), () => {
    // shuffle() asks for a value to multiply by (i + 1) for i = 105 .. 1.
    const n = i--;
    return stream.uniform(n) / n;
  });
  return { deck: deck.map((c) => c.id), opener: stream.uniform(SEATS) };
}

export function isDeal(value: unknown): value is RummyDeal {
  if (!value || typeof value !== "object") return false;
  const d = value as RummyDeal;
  return (
    Array.isArray(d.deck) && d.deck.length === 106 &&
    d.deck.every((id) => typeof id === "string" && BY_ID.has(id)) &&
    new Set(d.deck).size === 106 &&
    Number.isInteger(d.opener) && d.opener >= 0 && d.opener < SEATS
  );
}

export function cardsOf(deal: RummyDeal): Card[] {
  return deal.deck.map((id) => BY_ID.get(id)!);
}

export function tableFromDeal(deal: RummyDeal, playerName = "You"): TableState {
  return dealTable(cardsOf(deal), deal.opener, playerName);
}

/** Who wins this deal when every seat plays the computer policy. */
export function predictWinner(deal: RummyDeal, maxTurns = PREDICT_TURNS): RummyClass {
  let s = tableFromDeal(deal);
  // Each autoStep is half a turn (draw, then discard).
  for (let steps = 0; s.phase === "playing" && s.turns < maxTurns; steps++) {
    s = autoStep(s);
    if (steps > maxTurns * 2 + 4) break; // belt and braces against a stuck table
  }
  if (s.phase === "finished") {
    const w = s.result!.winner;
    return w === null ? "draw" : w === 0 ? "you" : "computer";
  }
  const points = s.players.map((p) => analyzeHand(p.hand, s.wild).points);
  const best = Math.min(...points);
  const leaders = points.filter((p) => p === best).length;
  if (points[0] === best) return leaders > 1 ? "draw" : "you";
  return "computer";
}

const CHOICES: OutcomeChoice[] = [
  { id: "you", label: "Player wins", group: "Result", tone: "green" },
  { id: "computer", label: "Computer wins", group: "Result", tone: "red" },
  { id: "draw", label: "Drawn table", group: "Result", tone: "neutral" },
];

/**
 * Bot-vs-bot, the four seats are symmetric, so the player's seat declares
 * first about a quarter of the time; drawn tables are rare at 200 turns.
 * Measured over 400 seeded deals (rummy.test.ts pins the sum, not the split).
 */
const ODDS: Record<string, number> = { you: 0.25, computer: 0.72, draw: 0.03 };

function suffixed(seed: OutcomeSeed, i: number): RummyDeal {
  // Suffix 0 IS the honest deal, so the round's own draw is always a candidate.
  return i === 0
    ? deriveDeal(seed.serverSeed, seed.clientSeed, seed.nonce)
    : deriveDeal(seed.serverSeed, `${seed.clientSeed}:${i}`, seed.nonce);
}

export const rummyOutcomeSpace: OutcomeSpace = {
  choices: () => CHOICES,
  candidates: (seed) =>
    Array.from({ length: CANDIDATE_DEALS }, (_, i) => {
      const deal = suffixed(seed, i);
      return { choiceId: predictWinner(deal), outcome: deal };
    }),
  forChoice: (seed, choiceId) => {
    if (!CHOICES.some((c) => c.id === choiceId)) return null;
    for (let i = 0; i < FORCE_TRIES; i++) {
      const deal = suffixed(seed, i);
      if (predictWinner(deal) === choiceId) return deal;
    }
    return null;
  },
  classify: (outcome) => (isDeal(outcome) ? predictWinner(outcome) : null),
  naturalOdds: () => ODDS,
};
