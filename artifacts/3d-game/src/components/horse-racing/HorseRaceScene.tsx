import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { RACING_HORSES } from "@workspace/api-zod/horse-racing-game";
import type { Race3dState } from "./horse3dRenderer";
import HorseRaceFallback from "./HorseRaceFallback";
import UnityHorseRaceScene from "./UnityHorseRaceScene";

export default function HorseRaceScene(
  props: Race3dState & { onReady: (ready: boolean) => void },
) {
  const [renderer, setRenderer] = useState<"checking" | "unity" | "three">(
    "checking",
  );
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    fetch("/unity-horse/ready.json", {
      signal: controller.signal,
      cache: "no-cache",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unity build not installed");
        const manifest = await response.json();
        if (!disposed)
          setRenderer(
            manifest.engine === "unity-urp" && manifest.version === 1
              ? "unity"
              : "three",
          );
      })
      .catch(() => {
        if (!disposed) setRenderer("three");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);
  if (renderer === "unity")
    return (
      <UnityHorseRaceScene {...props} onFailure={() => setRenderer("three")} />
    );
  if (renderer === "checking")
    return (
      <div className="hr-scene">
        <div className="hr-scene-loading">
          <span className="hr-loader" />
          Preparing the racecourse…
        </div>
      </div>
    );
  return <ThreeHorseRaceScene {...props} />;
}

function ThreeHorseRaceScene(
  props: Race3dState & { onReady: (ready: boolean) => void },
) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [winner, setWinner] = useState<number | null>(null);
  useEffect(() => {
    let disposed = false,
      cleanup: (() => void) | undefined;
    latest.current.onReady(false);
    const lost = (event: Event) => {
      event.preventDefault();
      if (disposed) return;
      disposed = true;
      surface.removeEventListener("webglcontextlost", lost);
      cleanup?.();
      setFailed(true);
    };
    const surface = canvas.current!;
    surface.addEventListener("webglcontextlost", lost);
    import("./horse3dRenderer")
      .then((m) => {
        if (disposed) return;
        return m.createHorse3d(surface, () => latest.current, setWinner);
      })
      .then((stop) => {
        if (disposed) stop?.();
        else if (stop) {
          cleanup = stop;
          setReady(true);
          latest.current.onReady(true);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      surface.removeEventListener("webglcontextlost", lost);
      cleanup?.();
    };
  }, []);
  if (failed) return <HorseRaceFallback {...props} />;
  return (
    <div
      className="hr-scene lucky7-studio-table"
      data-testid="horse-race-stage"
    >
      <canvas
        ref={canvas}
        aria-label="Live realistic horse race with automatic winner close-up"
        data-testid="horse-race-canvas"
      />
      {!ready && (
        <div className="hr-scene-loading">
          <span className="hr-loader" />
          Preparing the horses and racecourse…
        </div>
      )}
      {winner && (
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
