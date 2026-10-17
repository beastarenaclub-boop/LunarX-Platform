import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";

type Point = [number, number];
type Quad = [Point, Point, Point, Point];
export interface PipFrame { ms: number; quads?: [Quad[], Quad[]]; previous?: boolean }
export interface PipTrack { idle: PipFrame[]; action: PipFrame[] }
export interface PhotographicDiceHandle { frame: (scene: "idle" | "action", ms: number) => void }
interface Props { dice: [number, number] | null; restDice: [number, number] | null; previousDice: [number, number] | null; track: PipTrack }

const dots: Record<number, Point[]> = {
  1: [[.5, .5]], 2: [[.25, .25], [.75, .75]],
  3: [[.25, .25], [.5, .5], [.75, .75]],
  4: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]],
  5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]],
  6: [[.25, .25], [.75, .25], [.25, .5], [.75, .5], [.25, .75], [.75, .75]],
};
function point(quad: Quad, u: number, v: number): Point {
  return [0, 1].map(axis => (1-u)*(1-v)*quad[0][axis] + u*(1-v)*quad[1][axis]
    + u*v*quad[2][axis] + (1-u)*v*quad[3][axis]) as Point;
}
const polygon = (points: Point[]) => points.map(([x,y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("") + "Z";
function pipPath(quad: Quad, value: number | null) {
  return (dots[value ?? 0] ?? []).map(([u,v]) => polygon(Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    return point(quad, u + Math.cos(angle)*.083, v + Math.sin(angle)*.083);
  }))).join("");
}

// Physically adjacent top/front/right values; opposite faces always add to 7.
const sides: Record<number, number[]> = { 1: [1,2,3], 2: [2,6,3], 3: [3,2,6], 4: [4,2,1], 5: [5,1,3], 6: [6,5,3] };

/** Change only the photographed dice ink. The filmed dice, hands,
 * shadows and landing stay in the original continuous shot. */
const PhotographicDice = forwardRef<PhotographicDiceHandle, Props>(function PhotographicDice({ dice, restDice, previousDice, track }, ref) {
  const root = useRef<SVGSVGElement>(null);
  const props = useRef({ dice, restDice, previousDice, track });
  props.current = { dice, restDice, previousDice, track };
  const position = useRef<{ scene: "idle" | "action"; ms: number }>({ scene: "idle", ms: 0 });
  const painted = useRef("");
  const draw = (scene: "idle" | "action", ms: number) => {
    position.current = { scene, ms };
    const svg = root.current;
    if (!svg) return;
    const frames = props.current.track[scene];
    let index = frames.findIndex(frame => frame.ms > ms) - 1;
    if (index < -1) index = frames.length - 1;
    if (index === -1) index = 0;
    const left = frames[index];
    const right = frames[index + 1];
    const quads = left?.quads;
    const mix = right?.quads && right.ms > left.ms ? Math.min(1, Math.max(0, (ms-left.ms)/(right.ms-left.ms))) : 0;
    const values = scene === "idle" ? props.current.restDice : left.previous ? props.current.previousDice : props.current.dice;
    const key = `${scene}:${index}:${mix}:${values?.join(",")}`;
    // Stationary dice need no repeated DOM work while the video advances.
    if (painted.current === key) return;
    painted.current = key;
    svg.style.visibility = quads ? "visible" : "hidden";
    svg.dataset.scene = scene;
    if (!quads) return;
    // Before pickup, retain the previous round's ink until the hands cover it.
    quads.forEach((faces, die) => {
      const group = svg.children[die] as SVGGElement;
      group.setAttribute("data-value", String(values?.[die] ?? ""));
      faces.forEach((quad, side) => {
        const projected = quad.map((p, corner) => p.map((value, axis) =>
          value + ((right?.quads?.[die][side][corner][axis] ?? value)-value)*mix)) as Quad;
        const value = values?.[die];
        group.children[side].setAttribute("d", pipPath(projected, value == null ? null : sides[value]?.[side] ?? null));
      });
    });
  };
  useImperativeHandle(ref, () => ({ frame: draw }));
  useLayoutEffect(() => { draw(position.current.scene, position.current.ms); }, [dice, restDice, previousDice, track]);
  return <svg ref={root} className="lucky7-photographic-dice" viewBox="0 0 1920 1080" aria-hidden="true" data-testid="lucky7-photographic-dice">
    {[0,1].map(index => <g key={index} data-testid={`static-die-${index + 1}`}>
      <path fill="#47351f" /><path fill="#2c251c" /><path fill="#43321d" />
    </g>)}
  </svg>;
});
export default PhotographicDice;
