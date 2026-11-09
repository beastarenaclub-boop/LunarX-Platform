/**
 * What a wheel can be steered to and forced to.
 *
 * A pocket is the easy case and the one the whole contract was shaped around:
 * the space is small, every member is legal, and any of them can simply be
 * declared. The card games are the hard case — see their own spaces.
 */
import type { OutcomeChoice, OutcomeSeed, OutcomeSpace } from "../../services/tableAdapter";
import { pocketColor, pocketLabel, type Wheel } from "./wheel";

export function rouletteOutcomeSpace(wheel: Wheel): OutcomeSpace {
  const choices: OutcomeChoice[] = Array.from(
    { length: wheel.pocketCount },
    (_, p) => ({
      id: String(p),
      // "00", not "37". The operator reads the board, not the encoding.
      label: pocketLabel(wheel, p),
      group: p === 0 || p === wheel.doubleZero ? "Zeros" : "Numbers",
      tone: pocketColor(wheel, p),
    }),
  );
  const odds = Object.fromEntries(
    choices.map((c) => [c.id, 1 / wheel.pocketCount]),
  );

  return {
    choices: () => choices,
    candidates: () =>
      choices.map((c) => ({ choiceId: c.id, outcome: { pocket: Number(c.id) } })),
    forChoice: (_seed: OutcomeSeed, choiceId: string) => {
      const p = Number(choiceId);
      return Number.isInteger(p) && p >= 0 && p < wheel.pocketCount
        ? { pocket: p }
        : null;
    },
    classify: (outcome) => {
      const p = (outcome as { pocket?: unknown } | null)?.pocket;
      // Range-checked against THIS wheel, exactly as `forChoice` is. Without
      // it the two halves of the space disagreed: the mini wheel would classify
      // pocket 25 into a class its own `choices()` does not contain and
      // `forChoice` refuses, so a class could enter the streak history that
      // nothing could ever steer back to. Not reachable from `derive`, which is
      // bounded by the pocket count — but this is the guard that makes "one
      // wheel's pocket cannot mean something on the other" true by construction
      // rather than by every caller remembering.
      return typeof p === "number" &&
        Number.isInteger(p) &&
        p >= 0 &&
        p < wheel.pocketCount
        ? String(p)
        : null;
    },
    naturalOdds: () => odds,
    /**
     * A full window of one parity, which the generic count rule cannot see.
     *
     * The zeros are SKIPPED, not treated as breaking the run. "00" is not an
     * even number, so it cannot extend a run of evens — but it does not make
     * the run invisible either, and a player watching twenty spins come up odd
     * apart from one zero is looking at exactly the pattern this exists to
     * break.
     *
     * Disarming on any zero made the guard almost unreachable. Drawn honestly,
     * a window of twenty has no zero only about a third of the time on the
     * classic wheel and an eighth on the mini; under `collect` it is worse,
     * because the zeros carry the highest house net on any book holding
     * even-money, dozen, column, street, split, corner or sixline chips, so
     * they sit in the shortlist almost every round. The guard written for the
     * wheel was disarmed hardest in the mode most able to produce the pattern.
     *
     * At least eight NUMBERED results are still required, so a window that is
     * mostly zeros cannot trip it on a handful of samples.
     */
    extraStreak: (recent) => {
      if (recent.length < 8) return false;
      const window = recent.slice(0, 20).map(Number);
      if (window.some((p) => !Number.isInteger(p))) return false;
      const numbered = window.filter((p) => p !== 0 && p !== wheel.doubleZero);
      if (numbered.length < 8) return false;
      const first = numbered[0]! % 2;
      return numbered.every((p) => p % 2 === first);
    },
  };
}
