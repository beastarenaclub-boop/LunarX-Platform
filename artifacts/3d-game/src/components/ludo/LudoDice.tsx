import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { LudoRoll } from "./useLudoRoll";
const dots: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
// Opposite faces sum to seven. Rotate the authoritative face towards the camera.
const rotations: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateX(0deg) rotateY(-90deg)",
  3: "rotateX(-90deg) rotateY(0deg)",
  4: "rotateX(90deg) rotateY(0deg)",
  5: "rotateX(0deg) rotateY(90deg)",
  6: "rotateX(0deg) rotateY(180deg)",
};
export function LudoDice({
  value,
  roll,
}: {
  value?: number;
  roll?: LudoRoll | null;
}) {
  const cube = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const face = roll?.value ?? value ?? 6;
  const restingFace = useRef(face);
  useLayoutEffect(() => {
    if (!roll) restingFace.current = face;
  }, [face, roll]);
  useLayoutEffect(() => {
    const node = cube.current;
    if (!node) return;
    const from = getComputedStyle(node).transform;
    // The server can deliver a new result before an observer starts the roll.
    // Start at the face they were seeing, or continue an interrupted animation.
    const start = animation.current ? from : rotations[restingFace.current];
    animation.current?.cancel();
    animation.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (roll?.phase === "rolling") {
      animation.current = node.animate(
        [
          { transform: `${start} rotateX(0deg) rotateY(0deg) rotateZ(0deg)` },
          {
            transform: `${start} rotateX(180deg) rotateY(180deg) rotateZ(35deg)`,
          },
          {
            transform: `${start} rotateX(360deg) rotateY(360deg) rotateZ(0deg)`,
          },
        ],
        { duration: 560, iterations: Infinity, easing: "linear" },
      );
    } else if (roll?.phase === "landing") {
      animation.current = node.animate(
        [{ transform: from }, { transform: rotations[face] }],
        {
          duration: 240,
          easing: "cubic-bezier(.16,.75,.25,1)",
          fill: "forwards",
        },
      );
    }
  }, [roll?.key, roll?.phase]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return (
    <span
      className="ld-die"
      data-phase={roll?.phase ?? "idle"}
      data-value={roll ? undefined : value}
      role="img"
      aria-label={
        roll ? "Dice rolling" : value ? `Dice ${value}` : "Dice ready"
      }
      style={{ "--die-result": rotations[face] } as CSSProperties}
    >
      <span className="ld-die-shadow" />
      <span className="ld-die-lift">
        <span className="ld-die-cube" ref={cube}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span className={`ld-die-face ld-die-face-${n}`} key={n}>
              {Array.from({ length: 9 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    visibility: dots[n].includes(i) ? "visible" : "hidden",
                  }}
                />
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
