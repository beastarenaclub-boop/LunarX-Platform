import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { DICE_FALLBACK_MS, DICE_FLIGHT_MS, DICE_PICKUP_START_MS, DICE_PICKUP_MS, DICE_RELEASE_MS, pickupPose, tableDicePlan, tableDiePose, type TableDiePose } from "./tableDiceMotion";
import { nativeDiceFootprints } from "./dealerDiceFootprints";
import { dealerHandOcclusion } from "./dealerHandOcclusion";
import felt from "@/assets/lucky7/cast/naina-bar-natural-felt.png";

type Point = [number, number];
type Vector = [number, number, number];
type Quad = [Vector, Vector, Vector, Vector];
export interface TableDiceHandle { frame: (scene: "idle" | "action", ms: number) => void }
interface Props {
  dice: [number, number] | null; restDice: [number, number] | null;
  roundId: string | null; restRoundId: string | null;
  motion: "shake" | "roll" | "rest"; fromHand: boolean;
  onProgress?: (fraction: number) => void;
}
const dots: Record<number, Point[]> = {
  1: [[.5,.5]], 2: [[.25,.25],[.75,.75]], 3: [[.25,.25],[.5,.5],[.75,.75]],
  4: [[.25,.25],[.75,.25],[.25,.75],[.75,.75]],
  5: [[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]],
  6: [[.25,.25],[.75,.25],[.25,.5],[.75,.5],[.25,.75],[.75,.75]],
};
// Top, bottom, front, back, right, left. Opposite faces sum to seven.
const sides: Record<number, number[]> = { 1:[1,6,2,5,3,4], 2:[2,5,6,1,3,4], 3:[3,4,2,5,6,1], 4:[4,3,2,5,1,6], 5:[5,2,1,6,3,4], 6:[6,1,5,2,3,4] };
const faces: { name: string; normal: Vector; corners: Quad }[] = [
  {name:"top", normal:[0,-1,0], corners:[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]},
  {name:"bottom", normal:[0,1,0], corners:[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]},
  {name:"front", normal:[0,0,1], corners:[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]},
  {name:"back", normal:[0,0,-1], corners:[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]},
  {name:"right", normal:[1,0,0], corners:[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]},
  {name:"left", normal:[-1,0,0], corners:[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]},
];
const xy = (p: Point) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const polygon = (points: Point[]) => points.map((p,i) => `${i ? "L" : "M"}${xy(p)}`).join("") + "Z";
function rounded(points: Point[]) {
  return points.map((p,i) => {
    const before = points[(i+3)%4], after = points[(i+1)%4];
    const a: Point = [p[0]+(before[0]-p[0])*.07,p[1]+(before[1]-p[1])*.07];
    const b: Point = [p[0]+(after[0]-p[0])*.07,p[1]+(after[1]-p[1])*.07];
    return `${i ? "L" : "M"}${xy(a)}Q${xy(p)} ${xy(b)}`;
  }).join("")+"Z";
}
function rotate([x,y,z]: Vector, pose: TableDiePose): Vector {
  const a = y*Math.cos(pose.rx)-z*Math.sin(pose.rx), b = y*Math.sin(pose.rx)+z*Math.cos(pose.rx);
  const c = x*Math.cos(pose.ry)+b*Math.sin(pose.ry), d = -x*Math.sin(pose.ry)+b*Math.cos(pose.ry);
  return [c*Math.cos(pose.rz)-a*Math.sin(pose.rz),c*Math.sin(pose.rz)+a*Math.cos(pose.rz),d];
}
function surface(quad: Point[], u: number, v: number): Point {
  return [0,1].map(axis => (1-u)*(1-v)*quad[0][axis]+u*(1-v)*quad[1][axis]+u*v*quad[2][axis]+(1-u)*v*quad[3][axis]) as Point;
}
function paintDie(group: SVGGElement, pose: TableDiePose, value: number) {
  group.setAttribute("transform", `translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)})`);
  group.dataset.value = String(value); group.dataset.size = pose.size.toFixed(2);
  group.dataset.x = pose.x.toFixed(2); group.dataset.y = pose.y.toFixed(2);
  group.dataset.rotation = [pose.rx, pose.ry, pose.rz].map(angle => angle.toFixed(4)).join(",");
  faces.forEach((face,index) => {
    const element = group.children[index] as SVGGElement;
    const normal = rotate(face.normal,pose);
    element.style.display = normal[2] > .015 ? "" : "none";
    if (normal[2] <= .015) return;
    const quad = face.corners.map(corner => rotate(corner,pose).slice(0,2).map(v => v*pose.size) as Point);
    const body = element.children[0], ink = element.children[1];
    body.setAttribute("d",rounded(quad));
    const light = Math.max(0,Math.min(1,.65-normal[1]*.25-normal[0]*.16));
    body.setAttribute("fill",`rgb(${Math.round(194+light*58)},${Math.round(180+light*60)},${Math.round(151+light*66)})`);
    ink.setAttribute("d",(dots[sides[value][index]] ?? []).map(([u,v]) => polygon(Array.from({length:12},(_,i) =>
      surface(quad,u+Math.cos(i*Math.PI/6)*.079,v+Math.sin(i*Math.PI/6)*.079)))).join(""));
  });
}

/** Two tiny SVG meshes: no canvas, extra decoder, resizing video or per-frame React state.
 * The felt repair is clipped to the two original dice footprints, never the hands.
 * Both repair and throw use the decoded action frame, including slow devices. */
const TableDice = forwardRef<TableDiceHandle, Props>(function TableDice(props, ref) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, "");
  const plan = useMemo(() => tableDicePlan(props.roundId ?? "waiting"),[props.roundId]);
  const previous = useMemo(() => tableDicePlan(props.restRoundId ?? "waiting"),[props.restRoundId]);
  const latest = useRef({ ...props, plan, previous }); latest.current = {...props,plan,previous};
  const position = useRef<{scene:"idle"|"action";ms:number}>({scene:"idle",ms:0});
  const fallback = useRef(0);
  const painted = useRef("");
  const draw = (scene:"idle"|"action",ms:number) => {
    position.current={scene,ms};
    const svg=root.current; if (!svg) return;
    svg.dataset.mediaMs=String(ms);
    const p=latest.current;
    const rolling=p.motion==="roll" && !p.fromHand;
    let progress: number | undefined;
    let values=p.restDice, poses=p.previous.map(d=>tableDiePose(d,1));
    let visible=!!values, repair=visible, mode="rest";
    if (p.motion!=="rest") {
      if (rolling) {
        const t=Math.min(1,(performance.now()-fallback.current)/DICE_FALLBACK_MS);
        progress=t;
        values=p.dice; poses=p.plan.map(d=>tableDiePose(d,t)); visible=!!values;repair=true;mode="flight";
      } else if (scene==="action") {
        if (ms<DICE_PICKUP_MS) {
          poses=p.previous.map(d=>pickupPose(d,(ms-DICE_PICKUP_START_MS)/(DICE_PICKUP_MS-DICE_PICKUP_START_MS)));mode="pickup";
        } else if (ms<DICE_RELEASE_MS) { visible=false;repair=false;mode="hand"; }
        else {
          values=p.dice;poses=p.plan.map(d=>tableDiePose(d,(ms-DICE_RELEASE_MS)/DICE_FLIGHT_MS));
          if(p.motion==="roll")progress=Math.min(1,(ms-DICE_RELEASE_MS)/DICE_FLIGHT_MS);
          visible=!!values;repair=true;mode="flight";
        }
      }
    }
    if(progress!==undefined)p.onProgress?.(progress);
    const footprints=nativeDiceFootprints(scene,ms);
    const hands=dealerHandOcclusion(scene,ms);
    const key=`${mode}:${visible}:${repair}:${footprints}:${hands}:${values}:${poses.map(p=>[p.x,p.y,p.size,p.rx,p.ry,p.rz].join(","))}`;
    if(key===painted.current)return;painted.current=key;
    svg.dataset.phase=mode;
    (svg.querySelector("[data-felt-repair]") as SVGElement).style.visibility=repair?"visible":"hidden";
    svg.querySelectorAll("[data-hand-occlusion]").forEach(element=>element.setAttribute("d",hands));
    svg.querySelectorAll("[data-native-die-mask]").forEach((element,index)=>{
      const rect=footprints[index]; element.setAttribute("visibility",rect?"visible":"hidden");
      if(rect) ["x","y","width","height"].forEach((attribute,axis)=>element.setAttribute(attribute,String(rect[axis])));
    });
    const dice=svg.querySelector("[data-dice-bodies]") as SVGGElement;
    dice.style.visibility=visible?"visible":"hidden";
    if(visible && values) poses.forEach((pose,index)=>paintDie(dice.children[index] as SVGGElement,pose,values![index]));
  };
  useImperativeHandle(ref,()=>({frame:draw}));
  useLayoutEffect(()=>{
    if(props.motion!=="roll" || props.fromHand)return;
    fallback.current=performance.now();let frame=0;
    const tick=()=>{draw(position.current.scene,position.current.ms);if(performance.now()-fallback.current<DICE_FALLBACK_MS)frame=requestAnimationFrame(tick);};
    tick();return()=>cancelAnimationFrame(frame);
  },[props.motion,props.fromHand,props.roundId]);
  useLayoutEffect(()=>{draw(position.current.scene,position.current.ms);});
  return <svg ref={root} className="lucky7-table-dice" viewBox="0 0 1920 1080" aria-hidden="true" data-testid="lucky7-table-dice">
    <defs>
      <filter id={`${id}-edge`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
      <mask id={`${id}-felt`} maskUnits="userSpaceOnUse" x="720" y="780" width="576" height="210">
        <g fill="white" filter={`url(#${id}-edge)`}>{[0,1].map(index=><rect key={index} data-native-die-mask="" rx="4"/>)}</g>
        <path data-hand-occlusion="" fill="black" fillRule="evenodd"/>
      </mask>
      <mask id={`${id}-hands`} maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080">
        <rect width="1920" height="1080" fill="white"/>
        <path data-hand-occlusion="" fill="black" fillRule="evenodd"/>
      </mask>
    </defs>
    <image data-felt-repair="" href={felt} x="720" y="780" width="576" height="210" mask={`url(#${id}-felt)`} style={{visibility:"hidden"}}/>
    <g data-dice-bodies="" mask={`url(#${id}-hands)`} style={{visibility:"hidden"}}>
      {[0,1].map(index=><g key={index} data-testid={`static-die-${index+1}`}>
        {faces.map(face=><g key={face.name} data-face={face.name}>
          <path stroke="#f6e7c8" strokeOpacity=".65" strokeWidth=".65" strokeLinejoin="round"/>
          <path data-pips="" fill="#34291d"/>
        </g>)}
      </g>)}
    </g>
  </svg>;
});
export default TableDice;
