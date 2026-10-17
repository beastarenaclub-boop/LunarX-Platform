import { useEffect, useRef, useState } from "react";
import {
  racingVenue,
  makeHorsePlan,
  horseProgress,
  horseOrder,
  RACING_HORSES,
  type RacingLiveRound,
} from "@workspace/api-zod/horse-racing-game";
import { loadHorsePack } from "./horseAssets";
import {
  activeCamera,
  CAMERA_POSES,
  raceProjection,
  WORLD_METRES,
  type RaceCameraMode,
  type CameraPose,
} from "./raceCamera";
import { paintRaceTrack, type TrackMaterials } from "./raceTrack";
import { raceFinish } from "./race3dMath";

export default function HorseRaceScene({
  race,
  venueId,
  serverOffset,
  selected,
  camera,
  onReady,
}: {
  race: RacingLiveRound | null;
  venueId: string;
  serverOffset: number;
  selected: number[];
  camera: RaceCameraMode;
  onReady: (ready: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef({
      race,
      venueId,
      serverOffset,
      selected,
      camera,
    });
  latest.current = {
    race,
    venueId,
    serverOffset,
    selected,
    camera,
  };
  const [failed, setFailed] = useState(false),
    [winner, setWinner] = useState<number | null>(null),
    [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false,
      frame = 0;
    onReady(false);
    setReady(false);
    setFailed(false);
    loadHorsePack()
      .then((pack) => {
        if (disposed) return;
        const surface = canvas.current!,
          ctx = surface.getContext("2d", { alpha: false })!;
        surface.width = 1280;
        surface.height = 720;
        const idle = makeHorsePlan("paddock", venueId),
          materials: TrackMaterials = new Map();
        const pose: CameraPose = {
          ...CAMERA_POSES[activeCamera(latest.current.camera, 0)],
        };
        const previewStart = performance.now(),
          reducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
        let previous = previewStart,
          lastPaint = 0;
        let subjectZ: number | null = null;
        let paintedIdle: string | null = null;
        let reportedWinner: number | null = null;
        const draw = (time: number) => {
          if (disposed) return;
          frame = requestAnimationFrame(draw);
          if (time >= lastPaint && time - lastPaint < 1000 / 30) return;
          lastPaint = time;
          const state = latest.current,
            v = racingVenue(state.venueId),
            r = state.race?.venueId === state.venueId ? state.race : null;
          const elapsed = r?.plan
            ? Math.min(
                r.plan.duration,
                (Date.now() + state.serverOffset - r.startedAt) / 1000,
              )
            : -3;
          const plan = r?.plan ?? idle,
            running = !!r?.plan && elapsed >= 0 && elapsed < r.plan.duration;
          const finish = raceFinish(r?.plan, elapsed),
            winnerId = finish?.id ?? null;
          if (reportedWinner !== winnerId) {
            reportedWinner = winnerId;
            setWinner(winnerId);
          }
          const focus = winnerId ?? horseOrder(plan, Math.max(0, elapsed))[0];
          const mode = winnerId
              ? "closeup"
              : activeCamera(
                  state.camera,
                  r ? elapsed : (time - previewStart) / 1000,
                ),
            target = CAMERA_POSES[mode];
          const delta = Math.min(
            0.1,
            Math.max(0.001, (time - previous) / 1000),
          );
          previous = time;
          const blend =
            reducedMotion || winnerId ? 1 : 1 - Math.exp(-delta * 8);
          for (const key of [
            "elevation",
            "distance",
            "span",
            "centerY",
            "follow",
          ] as const)
            pose[key] += (target[key] - pose[key]) * blend;
          const progress = plan.runners.map((h) => horseProgress(h, elapsed)),
            lead = Math.max(0, ...progress);
          const distance = v.distance * WORLD_METRES,
            spread = (lead - Math.min(...progress)) * distance;
          const subject = plan.runners.find((h) => h.id === focus)!;
          const nextZ = (subject.lane - 3.5) * 2.7;
          subjectZ =
            subjectZ === null ? nextZ : subjectZ + (nextZ - subjectZ) * blend;
          const idleKey =
            elapsed < 0
              ? `${v.id}:${mode}:${focus}:${state.selected.join(",")}:${r?.id ?? "paddock"}`
              : null;
          const settled =
            Math.abs(subjectZ - nextZ) < 0.01 &&
            (Object.keys(target) as (keyof CameraPose)[]).every(
              (key) => Math.abs(pose[key] - target[key]) < 0.005,
            );
          // A standing field is static. Avoid repainting large photographs and the
          // projected soil until a camera, selection, location or race changes.
          if (idleKey !== null && idleKey === paintedIdle && settled) return;
          paintedIdle = idleKey;
          const projection = raceProjection(
            pose,
            lead * distance,
            spread,
            1280,
            720,
            {
              x: horseProgress(subject, elapsed) * distance,
              z: subjectZ,
            },
          );
          const bounds = paintRaceTrack(ctx, pack, projection, materials, {
            plan,
            elapsed,
            distance: v.distance,
            venueId: v.id,
            selected: state.selected,
            running,
            focusHorse: focus,
          });
          surface.dataset.order = horseOrder(plan, Math.max(0, elapsed)).join(
            ",",
          );
          surface.dataset.elapsed = elapsed.toFixed(2);
          surface.dataset.venue = v.id;
          surface.dataset.positions = progress
            .map((n) => n.toFixed(5))
            .join(",");
          surface.dataset.camera = winnerId ? "winner" : mode;
          surface.dataset.renderer = "canvas-compatibility";
          surface.dataset.winner = winnerId ? String(winnerId) : "";
          surface.dataset.cameraMode = state.camera;
          surface.dataset.elevation = (
            (pose.elevation * 180) /
            Math.PI
          ).toFixed(2);
          surface.dataset.runnerBounds = JSON.stringify(
            bounds.map((b) => b.map((n) => Math.round(n))),
          );
          surface.dataset.raceId = r?.id ?? "paddock";
          surface.dataset.focusHorse = String(focus);
          surface.dataset.characterSet = "shared-horse-v1";
          surface.dataset.characterPresentation = "higgsfield-side-profile";
          surface.dataset.characterAsset = "shared-horse-v1";
          surface.dataset.visibleRunners = "1,2,3,4,5,6,7,8";
          surface.dataset.packView = "8";
          surface.dataset.frontAvailable = "false";
          surface.dataset.pose =
            elapsed < 0 ? "standing" : winnerId ? "winner" : "galloping";
        };
        frame = requestAnimationFrame(draw);
        setReady(true);
        onReady(true);
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          setReady(false);
          onReady(false);
        }
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [attempt, onReady]);
  return (
    <div
      className="hr-scene lucky7-studio-table"
      data-testid="horse-race-stage"
    >
      {winner && (
        <div
          className="hr-winner-shot"
          data-testid="horse-winner-shot"
          role="status"
        >
          <span>WINNER</span>
          <strong>
            <b style={{ background: RACING_HORSES[winner - 1].color }}>
              {winner}
            </b>
            {RACING_HORSES[winner - 1].name}
          </strong>
          <small>FIRST ACROSS THE FINISH</small>
        </div>
      )}
      <canvas
        ref={canvas}
        aria-label="Live horse race: eight runners with selectable camera views"
        data-testid="horse-race-canvas"
      />
      {!ready && (
        <div className="hr-scene-loading">
          {failed ? (
            <>
              <span>Race assets could not load.</span>
              <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            </>
          ) : (
            <>
              <span className="hr-loader" />
              Preparing the racecourse…
            </>
          )}
        </div>
      )}
    </div>
  );
}
