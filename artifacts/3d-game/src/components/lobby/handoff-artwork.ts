import banner from "@/assets/handoff/lobby/collection-banner-v1.jpg";
import american from "@/assets/handoff/lobby/roulette-american-v2.webp";
import mini from "@/assets/handoff/lobby/roulette-mini-v2.webp";
import target from "@/assets/handoff/lobby/fun-target-v2.webp";
import aviator from "@/assets/handoff/lobby/aviator-lunar-v2.webp";

export const HANDOFF_BANNER = banner;
export const HANDOFF_ART: Record<string, string> = {
  lunar: aviator,
  "roulette-american": american,
  "roulette-mini": mini,
  "fun-target": target,
};
