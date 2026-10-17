import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import {
  makeHorsePlan,
  RACING_HORSES,
} from "@workspace/api-zod/horse-racing-game";
import type { Race3dState } from "./horse3dRenderer";
import { activeCamera } from "./raceCamera";
import {
  displayedProgress,
  raceFinish,
  trackPoint,
  venue3d,
} from "./race3dMath";
import { presentationHorse } from "./racePresentation";
import { unityStadiumAds } from "./unityStadiumAds";

const idlePlan = makeHorsePlan("unity-parade", "royal");

/** Unity receives presentation positions only; server settlement remains authoritative. */
export function unityRaceFrame(state: Race3dState, now = Date.now()) {
  const venue = venue3d(state.venueId);
  const race = state.race?.venueId === venue.id ? state.race : null;
  const plan = race?.plan ?? idlePlan;
  const elapsed = race?.plan
    ? (now + state.serverOffset - race.startedAt) / 1000
    : -1;
  const winner = raceFinish(race?.plan, elapsed)?.id ?? 0;
  const featured =
    state.camera === "auto"
      ? (presentationHorse(race, now + state.serverOffset) ?? 0)
      : 0;
  const pack = Math.max(0, Math.min(1, (elapsed - 0.4) / 3));
  return {
    venue: venue.id,
    camera: activeCamera(state.camera, Math.max(0, elapsed)),
    round: race?.id ?? "idle",
    running: elapsed >= 0,
    elapsed,
    winner,
    featured,
    runners: [...plan.runners]
      .sort((a, b) => a.id - b.id)
      .map((runner) => {
        const progress =
          elapsed < 0
            ? 0
            : displayedProgress(plan, runner.id, elapsed) * venue.laps;
        const point =
          featured === runner.id
            ? trackPoint(0.08, 3.2)
            : trackPoint(
                progress,
                runner.lane * (1 - pack * 0.26) + pack * 0.35,
              );
        const after = Math.max(0, elapsed - runner.finishTime);
        const gaitTime =
          elapsed < 0
          ? (now % 60000) / 1000
            : after > 0
              ? runner.finishTime +
                (1 - Math.exp(-after * 1.5)) * 0.55 +
                after * 0.3
              : elapsed;
        return {
          id: runner.id,
          x: point.x,
          z: point.z,
          heading: (point.heading * 180) / Math.PI,
          gait: gaitTime * runner.stride * 1.65 + runner.phase,
        };
      }),
  };
}

export default function UnityHorseRaceScene(
  props: Race3dState & {
    onReady: (ready: boolean) => void;
    onFailure: () => void;
  },
) {
  const iframe = useRef<HTMLIFrameElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [progress, setProgress] = useState(0),
    [winner, setWinner] = useState(0);
  useEffect(() => {
    let loaded = false,
      last = 0,
      animation = 0,
      previousWinner = 0,
      stopAds: (() => void) | undefined;
    latest.current.onReady(false);
    const timeout = window.setTimeout(() => latest.current.onFailure(), 180000);
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== iframe.current?.contentWindow
      )
        return;
      if (event.data?.type === "horse-unity-loaded") {
        if (loaded) return;
        loaded = true;
        setReady(true);
        latest.current.onReady(true);
        window.clearTimeout(timeout);
        stopAds = unityStadiumAds(
          () => latest.current.venueId,
          (slot, image) =>
            iframe.current?.contentWindow?.postMessage(
              { type: "horse-unity-sponsor", sponsor: { slot, image } },
              location.origin,
            ),
        );
      } else if (event.data?.type === "horse-unity-progress")
        setProgress(Math.max(0, Math.min(1, Number(event.data.progress) || 0)));
      else if (event.data?.type === "horse-unity-error")
        latest.current.onFailure();
    };
    const tick = (time: number) => {
      if (!document.hidden && time - last >= 1000 / 30) {
        last = time;
        const frame = unityRaceFrame(latest.current);
        if (loaded)
          iframe.current?.contentWindow?.postMessage(
            { type: "horse-unity-state", state: frame },
            location.origin,
          );
        if (previousWinner !== frame.winner) {
          previousWinner = frame.winner;
          setWinner(frame.winner);
        }
      }
      animation = requestAnimationFrame(tick);
    };
    window.addEventListener("message", receive);
    animation = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("message", receive);
      cancelAnimationFrame(animation);
      window.clearTimeout(timeout);
      stopAds?.();
    };
  }, []);
  return (
    <div
      className="hr-scene hr-unity-stage"
      data-testid="horse-race-stage"
      data-renderer="unity-urp"
      data-ready={ready}
    >
      <iframe
        ref={iframe}
        src="/unity-horse/index.html"
        title="Live Unity horse race stadium"
        allow="autoplay; fullscreen"
        style={{
          border: 0,
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
        }}
      />
      {!ready && (
        <div className="hr-scene-loading">
          <span className="hr-loader" />
          Preparing horses and stadium · {Math.round(progress * 100)}%
        </div>
      )}
      {winner > 0 && (
        <div
          className="hr-winner-shot"
          data-testid="horse-winner-shot"
          role="status"
        >
          <span>
            <Trophy size={18} /> WINNER
          </span>
          <strong>
            <b style={{ background: RACING_HORSES[winner - 1].color }}>
              {winner}
            </b>
            {RACING_HORSES[winner - 1].name}
          </strong>
          <small>FIRST ACROSS THE FINISH</small>
        </div>
      )}
    </div>
  );
}
