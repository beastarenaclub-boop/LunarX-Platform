import { useEffect, useRef, useState } from "react";
import { fishingPresentation } from "./iceFishPresentation";

type Point = { x: number; y: number };
type Color = "blue" | "green" | "red";
const parts = "/media/ice-fish/fisher-parts-v6.webp";
const fishArt = "/media/ice-fish/fish-species-v6.webp";
const fishGeometry = {
  blue: { cell: 0, mouth: 130, mouthY: 378, size: 320, lift: 240 },
  green: { cell: 1, mouth: 17, mouthY: 378, size: 310, lift: 285 },
  red: { cell: 2, mouth: 12, mouthY: 378, size: 340, lift: 310 },
};

function Part({ box, x, y, width, height }: { box: string; x: number; y: number; width: number; height: number }) {
  return <svg x={x} y={y} width={width} height={height} viewBox={box} preserveAspectRatio="none" overflow="hidden">
    <image href={parts} width="1280" height="1280" />
  </svg>;
}

function rotate(point: Point, pivot: Point, degrees: number): Point {
  const a = degrees * Math.PI / 180, dx = point.x - pivot.x, dy = point.y - pivot.y;
  return { x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

function Arm({ shoulder, hand, upper, lower, far = false }: { shoulder: Point; hand: Point; upper: number; lower: number; far?: boolean }) {
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y;
  const distance = Math.min(upper + lower - .01, Math.max(Math.abs(upper - lower) + .01, Math.hypot(dx, dy)));
  const bend = Math.atan2(dy, dx) + Math.acos(Math.max(-1, Math.min(1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance))));
  const elbow = { x: shoulder.x + Math.cos(bend) * upper, y: shoulder.y + Math.sin(bend) * upper };
  const foreAngle = Math.atan2(hand.y - elbow.y, hand.x - elbow.x) * 180 / Math.PI - 90;
  const upperScale = upper / 325, lowerScale = lower / 412;
  return <g className={far ? "if-fisher-arm is-far" : "if-fisher-arm is-near"}>
    <g transform={`translate(${shoulder.x} ${shoulder.y}) rotate(${bend * 180 / Math.PI - 90})`}>
      <Part box="215 710 200 470" x={-100 * upperScale} y={-80 * upperScale} width={200 * upperScale} height={470 * upperScale} />
    </g>
    <g className={far ? undefined : "if-fisher-forearm"} transform={`translate(${elbow.x} ${elbow.y}) rotate(${foreAngle})`}>
      <g transform="matrix(1 0 -.07767 1 0 0)">
        <Part box="848 700 194 525" x={-78 * lowerScale} y={-53 * lowerScale} width={194 * lowerScale} height={525 * lowerScale} />
      </g>
    </g>
  </g>;
}

/** The animated hand and crank share a target, while the boots and machine stay planted. */
export default function IceFishingRig({ elapsed, revealMs, settled, color, reducedMotion }: {
  elapsed: number; revealMs: number; settled: boolean; color: Color; reducedMotion: boolean;
}) {
  const sync = useRef({ elapsed, received: 0 });
  const [clock, setClock] = useState(elapsed);
  const [systemReduced, setSystemReduced] = useState(false);
  const paused = reducedMotion || systemReduced || settled;
  useEffect(() => { sync.current = { elapsed, received: performance.now() }; setClock(elapsed); }, [elapsed]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused) return;
    let frame = 0;
    const tick = (time: number) => { setClock(sync.current.elapsed + time - sync.current.received); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused]);
  const { stage, cast, lift } = fishingPresentation(paused ? elapsed : clock, revealMs, settled);
  const active = stage === "reeling" || stage === "catch";
  const t = paused ? 0 : clock;
  const turn = active ? (t / (stage === "catch" ? 1250 : 1450)) * Math.PI * 2 : cast * 1.2;
  const lean = paused ? -1 : (active ? Math.sin(turn) * 3.2 - 1 : -2 + cast * 3);
  const pivot = { x: 342, y: 480 };
  const shoulder = rotate({ x: 354.5, y: 405 }, pivot, lean);
  const farShoulder = rotate({ x: 391, y: 401 }, pivot, lean);
  const crank = { x: 410, y: 468 };
  const hand = { x: crank.x + Math.cos(turn) * 19, y: crank.y + Math.sin(turn) * 19 };
  const rodAngle = 26 * (reducedMotion || systemReduced ? 1 : cast) - 4 * lift + (active && !paused ? Math.sin(turn) * .7 : 0);
  const rodPivot = { x: 474, y: 524 };
  const tip = rotate({ x: 645, y: 66 }, rodPivot, rodAngle);
  const geometry = fishGeometry[color];
  const mouthY = 610 - geometry.lift * lift;
  const fishAngle = 90 + (active && !paused ? Math.sin(t / 170) * 5 * lift : 0);
  const size = geometry.size;
  return <svg className="if-fishing-rig" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true" data-motion={paused ? "paused" : "active"}>
    <defs>
      <linearGradient id="if-rig-body"><stop stopColor="#172734" /><stop offset=".4" stopColor="#6f8089" /><stop offset=".7" stopColor="#3d505b" /><stop offset="1" stopColor="#142431" /></linearGradient>
      <clipPath id="if-waterline"><path d="M0 0H1200V612H0Z" /></clipPath>
    </defs>
    <g className="if-fishing-machine"><Part box="688 105 502 496" x={356} y={432} width={201} height={198} /></g>
    <g className="if-reel-spool" transform={`rotate(${turn * 180 / Math.PI} 410 468)`}>
      <circle cx="410" cy="468" r="29" fill="none" stroke="#68737a" strokeWidth="1.5" />
      {[0, 120, 240].map(a => <path key={a} d="M410 445v7" transform={`rotate(${a} 410 468)`} stroke="#b5babe" strokeWidth="2.5" />)}
    </g>
    <Arm far shoulder={farShoulder} hand={{ x: 414, y: 443 }} upper={35} lower={40} />
    <g className="if-fisher">
      <Part box="180 310 280 320" x={287} y={475} width={140} height={160} />
      <g className="if-fisher-body" transform={`rotate(${lean} 342 480)`}>
        <Part box="180 0 280 322" x={287} y={320} width={140} height={161} />
      </g>
    </g>
    <g transform={`rotate(${rodAngle} 474 524)`}>
      <path d="M474 524L525 226C545 56 630 26 645 66" fill="none" stroke="#526875" strokeWidth="16" />
      <path d="M474 524L525 226C545 56 630 26 645 66" fill="none" stroke="#b6c9d0" strokeWidth="12" />
      <path d="M471 524L522 226C542 56 627 26 642 66" fill="none" stroke="#effaff" strokeWidth="4" />
      <path d="M452 526L466 445L507 452L492 533Z" fill="url(#if-rig-body)" stroke="#687b86" strokeWidth="2" />
      {[[496,458],[503,402],[510,346],[517,290],[524,234],[537,171],[560,118],[595,81],[629,60]].map(([x,y],i) => <g key={i} transform={`translate(${x} ${y}) rotate(${i < 5 ? 7 : 15 + (i-5)*20})`}><path d="M-7 0h15v6H-7z" fill="#425764" stroke="#a4bac4" /><ellipse cx="13" cy="3" rx="3" ry="4" fill="none" stroke="#596f7b" strokeWidth="1.5" /></g>)}
    </g>
    <path d={`M410 468L474 524Q${540 + cast * 120} 226 ${tip.x} ${tip.y}L${tip.x} ${mouthY}`} fill="none" stroke="#314756" strokeWidth="1.3" />
    <g className="if-fisher-crank" transform={`translate(${hand.x} ${hand.y})`}>
      <path d={`M${crank.x - hand.x} ${crank.y - hand.y}L0 0`} stroke="#c58e21" strokeWidth="6" strokeLinecap="round" />
      <circle r="6" fill="#e6bd3d" stroke="#7e5d19" strokeWidth="2" />
    </g>
    <Arm shoulder={shoulder} hand={hand} upper={49} lower={54} />
    {(stage === "catch" || stage === "result") && <g clipPath="url(#if-waterline)">
      <g className="if-caught-fish" data-color={color} data-fish-size={size} transform={`translate(${tip.x} ${mouthY}) rotate(${fishAngle})`} opacity={Math.min(1, lift * 8)}>
        <svg x={-geometry.mouth / 724 * size} y={-geometry.mouthY / 724 * size} width={size} height={size} viewBox={`${geometry.cell * 724} 0 724 724`}>
          <image href={fishArt} width="2172" height="724" />
        </svg>
      </g>
    </g>}
    <path d={`M${tip.x} ${mouthY - 12}v10q0 7 -6 5`} fill="none" stroke="#c4d9e3" strokeWidth="2" />
  </svg>;
}
