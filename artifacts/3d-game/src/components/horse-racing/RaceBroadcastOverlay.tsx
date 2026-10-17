import {
  RACING_HORSES,
  horseOrder,
  type RacingLiveRound,
} from "@workspace/api-zod/horse-racing-game";
import { presentationHorse, raceGap } from "./racePresentation";
import type { RaceCameraMode } from "./raceCamera";

export default function RaceBroadcastOverlay({
  race,
  now,
  camera,
}: {
  race: RacingLiveRound | null;
  now: number;
  camera: RaceCameraMode;
}) {
  if (!race) return null;
  const elapsed = (now - race.startedAt) / 1000;
  const betting = elapsed < 0;
  const seconds = Math.max(0, Math.ceil(-elapsed));
  const featured = camera === "auto" ? presentationHorse(race, now) : null;
  const horse = featured ? RACING_HORSES[featured - 1] : null;
  const order = race.plan ? horseOrder(race.plan, Math.max(0, elapsed)) : [];
  const winner =
    race.plan &&
    elapsed >=
      race.plan.runners.find((runner) => runner.id === race.plan!.order[0])!
        .finishTime;
  return (
    <>
      {betting && (
        <div className="hr-broadcast-clock" data-urgent={seconds <= 5}>
          <span>STARTS IN</span>
          <strong data-testid="horse-betting-countdown">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </strong>
        </div>
      )}
      {horse && (
        <div
          className="hr-runner-intro"
          data-testid="horse-runner-intro"
          data-horse-id={horse.id}
          key={`${race.id}-${horse.id}`}
        >
          <span className="hr-intro-eyebrow">
            MEET THE FIELD · {horse.id} / {RACING_HORSES.length}
          </span>
          <div className="hr-intro-title">
            <b style={{ background: horse.color }}>{horse.id}</b>
            <strong>{horse.name}</strong>
          </div>
          <div className="hr-intro-meta">
            <span>WIN ODDS</span>
            <strong>
              {race.config.horses
                .find((entry) => entry.id === horse.id)
                ?.multiplier.toFixed(2)}
              ×
            </strong>
            <span>
              {race.venueId === "royal" || race.venueId === "alpine"
                ? "TURF"
                : "DIRT"}{" "}
              RACING
            </span>
          </div>
        </div>
      )}
      {betting && seconds <= 3 && camera === "auto" && (
        <div className="hr-starting-field" data-testid="horse-starting-field">
          <span>AT THE START</span>
          <div>
            {RACING_HORSES.map((runner) => (
              <div key={runner.id}>
                <b style={{ background: runner.color }}>{runner.id}</b>
                <strong>{runner.name}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      {!betting && !winner && race.plan && (
        <div
          className="hr-live-leaderboard"
          aria-label="Live race leaderboard"
          data-testid="horse-broadcast-leaderboard"
        >
          <strong>LEADERBOARD</strong>
          {order.map((id, index) => (
            <div key={id}>
              <em>{index + 1}</em>
              <b style={{ background: RACING_HORSES[id - 1].color }}>{id}</b>
              <span>
                {index === 0
                  ? "LEADER"
                  : `+${raceGap(race.plan!, order[0], id, elapsed).toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
