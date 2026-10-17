const unit = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

/** Public elapsed flight time only: roll on the runway, lift off, then level out. */
export function furyMotion(flyMs: number) {
  const elapsed = Number.isFinite(flyMs) ? Math.max(0, flyMs) : 0;
  const roll = unit(elapsed / 1400);
  const airborne = unit((elapsed - 1400) / 6000);
  const climb = ease(airborne);
  // Acceleration on the ground joins a slower horizontal track during ascent.
  const travel = (12 * roll * roll + 50 * (1 - (1 - airborne) ** 2)) / 62;
  return {
    stage: elapsed < 1400 ? "runway" : elapsed < 7400 ? "climb" : "cruise",
    travel,
    climb,
    pitch: -12 * ease((elapsed - 1400) / 1400) + 7 * ease((elapsed - 4600) / 2800),
    groundX: -11 * travel,
    groundY: 58 * climb,
    groundOpacity: 1 - ease((elapsed - 3000) / 2600),
    shadow: 1 - ease((elapsed - 1400) / 850),
    dust: ease(elapsed / 500) * (1 - ease((elapsed - 1400) / 800)),
  };
}
