import { useEffect, useRef, useState } from "react";
import TowerSceneFallback from "./TowerSceneFallback";
import { towerAssetUrl } from "./towerAssets";
import type { TowerVisualState, createTowerRenderer } from "./tower3d/renderer";

export type TowerDrop = TowerVisualState["drop"];
type Controller = Awaited<ReturnType<typeof createTowerRenderer>>;

export default function TowerScene(props: TowerVisualState) {
  const canvas = useRef<HTMLCanvasElement>(null), controller = useRef<Controller | null>(null);
  const latest = useRef(props); latest.current = props;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const element = canvas.current;
    if (!element) return;
    void import("./tower3d/renderer").then(({ createTowerRenderer }) => cancelled ? null : createTowerRenderer(element, {
      state: latest.current,
      onReady: () => { if (!cancelled) setReady(true); },
      onFailure: () => { if (!cancelled) { setFailed(true); controller.current?.dispose(); controller.current = null; } },
    })).then(instance => {
      if (!instance) return;
      if (cancelled) instance.dispose();
      else { controller.current = instance; instance.update(latest.current); }
    }).catch(error => { if (!cancelled) { element.dataset.fallbackReason = error instanceof Error ? error.message : "Renderer unavailable"; setFailed(true); } });
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.update(props); }, [props.step, props.drop, props.motion, props.lost]);
  const active3d = ready && !failed;
  return <div className={`tr-scene tr-scene-3d ${props.motion ? "" : "tr-still"}`} data-testid="tower-scene"
    data-step={props.step} data-renderer={active3d ? "webgl" : failed ? "fallback" : "loading"}
    data-phase={props.drop ? props.drop.failed ? "fall" : "drop" : "idle"}
    role="img" aria-label={`3D tower with ${props.step} completed floors${props.lost ? ". Round ended" : ""}`}>
    <div className="tr-sky-ceiling" aria-hidden="true" style={{ backgroundImage: `url(${towerAssetUrl("site")})` }} />
    <div className="tr-3d-sky tr-photographic-sky" aria-hidden="true" style={{ backgroundImage: `url(${towerAssetUrl("site")})`, transform: `translateY(${Math.min(Math.max(0, props.step - 2) * 12, 40)}%) scale(1.02)` }} />
    {!active3d && <div className="tr-3d-fallback" aria-hidden="true"><TowerSceneFallback {...props} /></div>}
    <canvas ref={canvas} className="tr-3d-canvas" aria-hidden="true" />
    <span className="tr-scene-description">{props.step} completed floors. {Array.from({ length: Math.min(props.step, 12) }, (_, i) => <span key={i} data-testid="tower-floor">Floor {Math.max(0, props.step - 12) + i + 1} completed. </span>)}</span>
  </div>;
}
