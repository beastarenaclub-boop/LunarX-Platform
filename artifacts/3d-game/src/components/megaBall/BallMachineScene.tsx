import { useEffect, useRef, useState } from "react";
import type { MachineFrame } from "./machineTimeline";
import type { MachineSceneState } from "./machineRenderer";

function StandardMachine({ frame }: { frame: MachineFrame }) {
  return (
    <svg
      className="mb-machine-standard"
      viewBox="0 0 900 500"
      role="img"
      aria-label="Numbered ball machine"
    >
      <defs>
        <radialGradient id="mb-glass">
          <stop stopColor="#bdf8e4" stopOpacity=".05" />
          <stop offset=".85" stopColor="#9ab5a9" stopOpacity=".12" />
          <stop offset="1" stopColor="#c5eee3" stopOpacity=".5" />
        </radialGradient>
        <radialGradient id="mb-pearl" cx=".3" cy=".2">
          <stop stopColor="#fff" />
          <stop offset=".6" stopColor="#f5efac" />
          <stop offset="1" stopColor="#398e64" />
        </radialGradient>
        <linearGradient id="mb-brass">
          <stop stopColor="#6a4b20" />
          <stop offset=".35" stopColor="#e6d29a" />
          <stop offset=".6" stopColor="#8b7136" />
          <stop offset="1" stopColor="#f5e9b9" />
        </linearGradient>
      </defs>
      <rect width="900" height="500" fill="#06342a" />
      {Array.from({ length: 24 }, (_, i) => (
        <circle
          key={i}
          cx={(i % 8) * 128 + 10}
          cy={Math.floor(i / 8) * 155 + 55}
          r="61"
          fill="none"
          stroke="#c9ac5f"
          strokeWidth="5"
          opacity=".3"
        />
      ))}
      <rect
        x="135"
        y="25"
        width="630"
        height="405"
        rx="30"
        fill="#735b32"
        stroke="url(#mb-brass)"
        strokeWidth="12"
      />
      <rect
        x="140"
        y="385"
        width="620"
        height="75"
        rx="16"
        fill="#034332"
        stroke="url(#mb-brass)"
        strokeWidth="7"
      />
      <path
        d="M330 134V90Q330 70 380 70H610Q690 80 610 126L520 170Q455 194 610 207Q700 220 570 260L500 290Q455 325 600 340"
        fill="none"
        stroke="#e0fff680"
        strokeWidth="24"
      />
      <path
        d="M330 134V90Q330 70 380 70H610Q690 80 610 126L520 170Q455 194 610 207Q700 220 570 260L500 290Q455 325 600 340"
        fill="none"
        stroke="#052d2430"
        strokeWidth="18"
      />
      <ellipse cx="330" cy="387" rx="92" ry="16" fill="url(#mb-brass)" />
      <circle
        cx="330"
        cy="260"
        r="126"
        fill="url(#mb-glass)"
        stroke="#e8fff7a0"
        strokeWidth="3"
      />
      {frame.bowl.map((n, i) => {
        const angle = i * 2.39996,
          radius = Math.sqrt(i / 51) * 105;
        const x = 330 + Math.cos(angle) * radius,
          y = 260 + Math.sin(angle) * radius;
        return (
          <g key={n} transform={`translate(${x},${y})`}>
            <circle r="12" fill="url(#mb-pearl)" />
            <text
              y="4"
              textAnchor="middle"
              fill="#08271d"
              fontSize="10"
              fontWeight="bold"
            >
              {n}
            </text>
          </g>
        );
      })}
      {frame.chute != null && (
        <g transform="translate(600,340)">
          <circle r="15" fill="url(#mb-pearl)" />
          <text
            y="5"
            textAnchor="middle"
            fill="#08271d"
            fontSize="13"
            fontWeight="bold"
          >
            {frame.chute}
          </text>
        </g>
      )}
      {frame.rack.map((n, i) => (
        <g
          key={n}
          transform={`translate(${478 + (i % 10) * 26},${385 + Math.floor(i / 10) * 27})`}
        >
          <circle r="11" fill="url(#mb-pearl)" />
          <text
            y="4"
            textAnchor="middle"
            fill="#08271d"
            fontSize="10"
            fontWeight="bold"
          >
            {n}
          </text>
        </g>
      ))}
      <path
        d="M251 205Q278 157 331 153"
        fill="none"
        stroke="white"
        strokeOpacity=".6"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Entirely generated geometry. The same timeline controls all 51 physical balls. */
export default function BallMachineScene(props: MachineSceneState) {
  const latest = useRef(props);
  latest.current = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false,
      cleanup: (() => void) | undefined;
    const target = canvas.current!;
    setReady(false);
    setFailed(false);
    const lost = (event: Event) => {
      event.preventDefault();
      cleanup?.();
      cleanup = undefined;
      if (!disposed) {
        setReady(false);
        setFailed(true);
      }
    };
    target.addEventListener("webglcontextlost", lost);
    void import("./machineRenderer")
      .then(({ createMachineRenderer }) => {
        if (disposed) return;
        cleanup = createMachineRenderer(target, () => latest.current);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      target.removeEventListener("webglcontextlost", lost);
      cleanup?.();
    };
  }, [attempt]);
  const { frame } = props;
  return (
    <div
      className="mb-studio-scene"
      data-motion={props.motion}
      data-renderer={ready ? "webgl" : failed ? "standard" : "loading"}
      data-show-stage={props.frame.stage}
      data-camera-shot={props.frame.camera}
    >
      {!ready && <StandardMachine frame={frame} />}
      <canvas
        key={attempt}
        ref={canvas}
        className={`mb-machine-canvas${ready ? " is-ready" : ""}`}
        role="img"
        aria-label={`Mega Ball machine. ${frame.bowl.length} balls in the bowl. ${frame.drawn.length} drawn.`}
      />
      <div className="mb-machine-inventory" aria-live="off">
        <span>
          IN BOWL <b>{frame.bowl.length}</b>
        </span>
        <span>
          DRAWN{" "}
          <b>
            {frame.normalCount}/20{frame.megaVisible ? " + MEGA" : ""}
          </b>
        </span>
      </div>
      {failed && (
        <button
          className="mb-retry-machine"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Enable 3D view
        </button>
      )}
    </div>
  );
}
