import {
  RACING_HORSES,
  horseProgress,
  type HorsePlan,
  type RacingLiveRound,
} from "@workspace/api-zod/horse-racing-game";

/** Shared by the camera and title card so both feature the same runner. */
export function presentationHorse(
  race: RacingLiveRound | null,
  now: number,
): number | null {
  if (!race || now < race.bettingOpensAt || now >= race.startedAt - 3000)
    return null;
  const window = Math.max(1, race.startedAt - race.bettingOpensAt - 3000);
  const index = Math.min(
    RACING_HORSES.length - 1,
    Math.floor(((now - race.bettingOpensAt) / window) * RACING_HORSES.length),
  );
  return RACING_HORSES[index].id;
}

/** Time since the leader passed this runner's current distance. */
export function raceGap(
  plan: HorsePlan,
  leaderId: number,
  runnerId: number,
  elapsed: number,
) {
  if (leaderId === runnerId || elapsed <= 0) return 0;
  const leader = plan.runners.find((runner) => runner.id === leaderId)!;
  const runner = plan.runners.find((runner) => runner.id === runnerId)!;
  const distance = horseProgress(runner, elapsed);
  let low = 0,
    high = Math.min(elapsed, leader.finishTime);
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (horseProgress(leader, middle) < distance) low = middle;
    else high = middle;
  }
  return Math.max(0, elapsed - high);
}
