import { useEffect, useRef, useState } from "react";
import { RotateCcw, Trophy } from "lucide-react";
import { RACING_BIKES, bikeOrder, bikeProgress, type RacingLiveRound } from "@workspace/api-zod/bike-racing-game";
import type { RaceCameraMode } from "./raceCamera";

export interface BikeSceneState {
  race: RacingLiveRound | null; venueId: string; serverOffset: number;
  selected: number[]; camera: RaceCameraMode; focusBike: number;
}
type Props = BikeSceneState & {
  phase: RacingLiveRound["phase"] | "loading";
  onReady: (ready: boolean) => void;
};

export default function BikeRaceScene(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
  latest.current = props;
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);

  useEffect(() => {
    const surface = canvas.current!;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    setReady(false); setFailed(false);
    // The shared round and wallet stay available even on devices without WebGL.
    latest.current.onReady(true);
    const fail = () => {
      if (controller.signal.aborted) return;
      controller.abort(); clearTimeout(timeout); dispose?.(); dispose = undefined;
      setFailed(true); setReady(false);
    };
    const lost = (event: Event) => { event.preventDefault(); fail(); };
    const timeout = window.setTimeout(fail, 20000);
    surface.addEventListener("webglcontextlost", lost);
    void import("./bike3dRenderer")
      .then(module => module.createBike3d(surface, () => latest.current, controller.signal))
      .then(cleanup => {
        if (controller.signal.aborted) { cleanup(); return; }
        dispose = cleanup; clearTimeout(timeout); setReady(true);
      }).catch(fail);
    return () => {
      controller.abort(); clearTimeout(timeout);
      surface.removeEventListener("webglcontextlost", lost); dispose?.();
    };
  }, [attempt]);

  const { race, phase } = props;
  const elapsed = race ? Math.max(0, (Date.now() + props.serverOffset - race.startedAt) / 1000) : 0;
  const plan = phase === "racing" || phase === "results" ? race?.plan : null;
  const order = plan ? bikeOrder(plan, elapsed) : RACING_BIKES.map(b => b.id);
  const winner = phase === "results" ? race?.winnerId : null;
  return <div className="hr-scene lucky7-studio-table br-scene" data-testid="bike-race-stage" data-presentation="live-3d-race">
    <canvas key={attempt} ref={canvas} hidden={failed} data-testid="bike-race-canvas"
      aria-label="Live 3D superbike race, six numbered bikes following the shared round" />
    {!ready && !failed && <div className="hr-scene-loading" role="status"><span className="hr-loader" />Loading circuit and bikes…</div>}
    {failed && <div className="br-timing-fallback" data-testid="bike-race-fallback">
      <div className="br-fallback-heading"><span role="status">3D view unavailable · Live timing</span>
        <button type="button" onClick={() => setAttempt(n => n + 1)}><RotateCcw size={13} /> Retry 3D</button>
      </div>
      {RACING_BIKES.map(bike => <div className="br-timing-lane" key={bike.id}>
        <span>{bike.name}</span><div><b style={{ background: bike.color,
          left: `${Math.min(1, plan ? bikeProgress(plan.runners.find(r => r.id === bike.id)!, elapsed) : 0) * 90}%`,
        }}>{bike.id}</b></div>
      </div>)}
    </div>}
    {(ready || failed) && <ol className="br-live-order" aria-label={plan ? "Race positions" : "Starting grid"} data-testid="bike-race-order">
      {order.map((id, index) => <li key={id} data-bike={id} data-selected={props.selected.includes(id)}>
        <small>{index + 1}</small><b style={{ background: RACING_BIKES[id - 1].color }}>{id}</b>
        <span>{RACING_BIKES[id - 1].name}</span>
      </li>)}
    </ol>}
    {phase === "racing" && !plan && <span className="br-sync-status" role="status">Syncing race positions…</span>}
    {winner && <div className="hr-winner-shot" data-testid="bike-winner-shot" role="status">
      <span><Trophy size={18} /> OFFICIAL RESULT</span>
      <strong><b style={{ background: RACING_BIKES[winner - 1].color }}>{winner}</b>{RACING_BIKES[winner - 1].name}</strong>
      <small>FINISHED FIRST</small>
    </div>}
  </div>;
}
