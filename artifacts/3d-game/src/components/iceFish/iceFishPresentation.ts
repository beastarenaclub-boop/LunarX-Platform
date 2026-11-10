import { ICE_FISH_SPIN_MS } from "@workspace/api-zod/ice-fish";

export type FishingStage = "intro" | "underwater" | "casting" | "reeling" | "catch" | "result";
export function fishingPresentation(elapsed: number, revealMs: number, settled = false) {
  const progress = settled ? 1 : Math.max(0, Math.min(1,
    (elapsed - ICE_FISH_SPIN_MS) / Math.max(1, revealMs - ICE_FISH_SPIN_MS)));
  const stage: FishingStage = progress < .05 ? "intro" : progress < .22 ? "underwater"
    : progress < .40 ? "casting" : progress < .73 ? "reeling" : progress < .92 ? "catch" : "result";
  return { progress, stage, cast: Math.max(0, Math.min(1, (progress - .22) / .18)),
    reel: Math.max(0, Math.min(1, (progress - .4) / .33)),
    lift: Math.max(0, Math.min(1, (progress - .73) / .16)) };
}
export function multiplierLabel(value: number) {
  return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`;
}
