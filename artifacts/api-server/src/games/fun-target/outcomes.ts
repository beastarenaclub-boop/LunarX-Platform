import type { OutcomeSpace } from "../../services/tableAdapter";
import { isOutcome } from "./math";
import { WHEEL } from "./layout";
export const funTargetOutcomeSpace: OutcomeSpace = {
  choices: () => WHEEL.pockets.map(pocket => ({ id: String(pocket), label: String(pocket), group: "Digits", tone: "neutral" })),
  candidates: () => WHEEL.pockets.map(pocket => ({ choiceId: String(pocket), outcome: { pocket } })),
  // Each class has exactly one outcome; there is no within-class choice to sample.
  forChoice: (_seed, id) => /^[0-9]$/.test(id) ? { pocket: Number(id) } : null,
  classify: outcome => isOutcome(outcome) ? String(outcome.pocket) : null,
  naturalOdds: () => Object.fromEntries(WHEEL.pockets.map(pocket => [String(pocket), 1 / WHEEL.digits])),
};
