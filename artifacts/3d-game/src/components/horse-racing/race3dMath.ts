import {
  racingVenue,
  horseProgress,
  type HorsePlan,
} from "@workspace/api-zod/horse-racing-game";

export function venue3d(id: string) {
  const v = racingVenue(id);
  return {
    ...v,
    theme: id === "dubai" ? "desert" : id,
    grass: id === "dubai" ? "#7e8142" : id === "alpine" ? "#45694b" : "#4f7636",
    track: v.tint,
  };
}
export type Venue = ReturnType<typeof venue3d>;
export function trackPoint(progress: number, lane: number) {
  const radius = 35 + lane * 2.15,
    straight = 140;
  const circumference = straight * 2 + Math.PI * 2 * radius;
  let s =
    ((((progress % 1) + 1) % 1) * circumference + straight / 2) % circumference;
  if (s < straight) return { x: -70 + s, z: -radius, heading: Math.PI / 2 };
  s -= straight;
  if (s < Math.PI * radius) {
    const a = -Math.PI / 2 + s / radius;
    return {
      x: 70 + Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      heading: -a,
    };
  }
  s -= Math.PI * radius;
  if (s < straight) return { x: 70 - s, z: radius, heading: -Math.PI / 2 };
  s -= straight;
  const a = Math.PI / 2 + s / radius;
  return {
    x: -70 + Math.cos(a) * radius,
    z: Math.sin(a) * radius,
    heading: -a,
  };
}
/** The winner camera is driven by the same crossing time as the actual race. */
export function raceFinish(
  plan: HorsePlan | null | undefined,
  elapsed: number,
) {
  if (!plan) return null;
  const winner = plan.runners.find((h) => h.id === plan.order[0])!;
  return elapsed >= winner.finishTime
    ? {
        id: winner.id,
        since: elapsed - winner.finishTime,
        crossingTime: winner.finishTime,
      }
    : null;
}
export function displayedProgress(
  plan: HorsePlan,
  id: number,
  elapsed: number,
) {
  const runner = plan.runners.find((h) => h.id === id)!;
  if (elapsed <= runner.finishTime) return horseProgress(runner, elapsed);
  // Decelerate beyond the finish instead of galloping away during the result shot.
  const after = elapsed - runner.finishTime;
  return 1 + 0.009 * (1 - Math.exp(-after * 1.7)) + 0.007 * after;
}
