import type { OutcomeSpace, OutcomeSeed } from "../tableAdapter";
import { ICE_FISH_WHEEL, ICE_FISH_SPOTS, ICE_FISH_LABELS } from "@workspace/api-zod/ice-fish";

/** Candidates are genuine draws; an unsteered round never uses this sample. */
export function tableOutcomeSpace(
  gameCode: string,
  derive: (seed: OutcomeSeed) => unknown,
): OutcomeSpace {
  const classify = (raw: unknown): string | null => {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (gameCode === "ice-fish" && typeof o.segment === "number")
      return ICE_FISH_WHEEL[o.segment] ?? null;
    if (gameCode === "mega-ball" && typeof o.multiplier === "number")
      return `multiplier:${o.multiplier}`;
    for (const key of [
      "pocket",
      "winner",
      "side",
      "total",
      "segment",
      "rank",
      "value",
      "symbol",
      "number",
    ]) {
      if (typeof o[key] === "string" || typeof o[key] === "number")
        return String(o[key]);
    }
    return "draw";
  };
  const exhaustive =
    gameCode === "roulette" || gameCode === "speed-auto-roulette"
      ? Array.from({ length: 37 }, (_, pocket) => ({ pocket }))
      : gameCode === "roulette-american"
        ? Array.from({ length: 38 }, (_, pocket) => ({ pocket }))
        : gameCode === "roulette-mini"
          ? Array.from({ length: 19 }, (_, pocket) => ({ pocket }))
          : gameCode === "fun-target"
            ? Array.from({ length: 10 }, (_, pocket) => ({ pocket }))
            : null;
  const sample = (seed: OutcomeSeed, count: number) =>
    exhaustive ??
    Array.from({ length: count }, (_, i) =>
      derive({ ...seed, clientSeed: `${seed.clientSeed}:candidate:${i}` }),
    );
  let choices: ReturnType<OutcomeSpace["choices"]> | undefined;
  return {
    classify,
    choices: () => gameCode === "ice-fish" ? ICE_FISH_SPOTS.map(id => ({ id, label: ICE_FISH_LABELS[id] })) :
      (choices ??= [
        ...new Set(
          sample(
            { serverSeed: "engine-classes", clientSeed: "classes", nonce: 0 },
            128,
          ).map(classify),
        ),
      ]
        .filter((id): id is string => id !== null)
        .map((id) => ({
          id,
          label:
            gameCode === "roulette-american" && id === "37"
              ? "00"
              : id.startsWith("multiplier:")
                ? `${id.slice(11)}× Mega multiplier`
                : id,
        }))),
    candidates: (seed) =>
      sample(seed, 64).map((outcome) => ({
        choiceId: classify(outcome) ?? "draw",
        outcome,
      })),
    forChoice: (seed, id) => {
      if (gameCode === "ice-fish") {
        if (!(ICE_FISH_SPOTS as readonly string[]).includes(id)) return null;
        // Search genuine draws without allocating thousands of unused outcomes.
        for (let i = 0; i < 4096; i++) {
          const outcome = derive({ ...seed, clientSeed: `${seed.clientSeed}:candidate:${i}` });
          if (classify(outcome) === id) return outcome;
        }
        return null;
      }
      return sample(seed, 400).find((outcome) => classify(outcome) === id) ?? null;
    },
  };
}
