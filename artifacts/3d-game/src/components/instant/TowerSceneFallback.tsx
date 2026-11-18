import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { towerAssetUrl } from "./towerAssets";
import { TOWER_BREAK_SECONDS, towerCollapseTiming } from "./towerMotion";

function Building({ floor, suspended = false }: { floor: number; suspended?: boolean }) {
  const facade = ([0, 1, 2, 3, 4, 5, 3, 2, 2, 1] as const)[floor % 10];
  return <g transform="translate(6 0) scale(.912 1.6)">
    {suspended && <g stroke="#394146" fill="none" strokeWidth="1.4"><path d="M4 0 66-40 129 0M66-40V-300"/><rect x="61" y="-53" width="10" height="12" fill="#b89b48" stroke="none"/></g>}
    <path d="M132 0 149-6V91L132 98Z" fill="#77756b" />
    <image href={towerAssetUrl(`facade${facade}`)} width="132" height="98" preserveAspectRatio="none" />
    <path d="M-3 0 14-7H151L134 0ZM-3 98H134L151 91V96L134 104H-3Z" fill="#b3b0a7" />
    <path d="M-3 0H134V5H-3Z" fill="#a19f96" />
    <path d="M137 16 144 13V49L137 52Z" fill="#30404a" stroke="#a9aaa1" strokeWidth="2"/>
  </g>;
}

export type TowerDrop = { key: number; failed: boolean } | null;
export default function TowerSceneFallback({ step, drop, motion, lost }: { step: number; drop: TowerDrop; motion: boolean; lost: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const pattern = useId().replace(/:/g, "");
  const [elapsed, setElapsed] = useState(0);
  const falling = !!drop?.failed || lost;
  const timing = towerCollapseTiming(step);
  useEffect(() => {
    if (!drop?.failed || !motion || lost) return;
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => { const t = (now - start) / 1000; setElapsed(t); if (t < timing.duration) frame = requestAnimationFrame(tick); };
    setElapsed(0); frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drop?.key, drop?.failed, motion, lost, timing.duration]);
  useLayoutEffect(() => {
    const host = svg.current;
    if (!host) return;
    const measure = () => { const rect = host.getBoundingClientRect(); if (rect.height) setWidth(620 * rect.width / rect.height); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const camera = Math.max(0, step - 1) * 166.4;
  const distance = 550 - (step + 1) * 166.4 + camera - 90;
  const time = lost || !motion ? timing.duration : elapsed;
  const flight = Math.max(0, time - TOWER_BREAK_SECONDS);
  const progress = Math.min(1, flight / Math.max(.1, timing.impact - TOWER_BREAK_SECONDS));
  const cameraY = falling ? camera * (1 - progress * progress) : camera;
  const fractured = falling && time >= TOWER_BREAK_SECONDS;
  const approach = Math.min(1, time / .52), tip = Math.min(1, Math.max(0, (time - .52) / .26));
  const facade = ([0, 1, 2, 3, 4, 5, 3, 2, 2, 1] as const)[step % 10];
  return <svg ref={svg} className={`tr-scene ${!motion ? "tr-still" : ""}`} viewBox={`${(800 - width) / 2} 0 ${width} 620`} role="img" aria-label={`Tower with ${step} completed floors${lost ? ". Broken block remains on the street" : ""}`} data-testid="tower-fallback-scene" data-step={step} data-collapse-phase={fractured ? progress === 1 ? "settled" : "falling" : falling ? "tipping" : "none"}>
    <defs><pattern id={pattern} width="150" height="1664" patternUnits="userSpaceOnUse">{Array.from({length:10},(_,i)=><g key={i} transform={`translate(0 ${i*166.4})`}><Building floor={9-i}/></g>)}</pattern></defs>
    <g className="tr-world" style={{ transform: `translateY(${cameraY}px)`, transition: falling ? "none" : undefined }}>
      <image href={towerAssetUrl(width < 650 ? "siteMobile" : "site")} x={(800-width)/2} y="0" width={width} height="620" preserveAspectRatio="xMidYMid slice" />
      <path d="M355 550H445L450 557H350Z" fill="#94938a" />
      {step > 12 && <g transform="translate(334 550)"><rect x="-3" y={-(step-12)*166.4} width="154" height={(step-12)*166.4} fill={`url(#${pattern})`}/></g>}
      {Array.from({ length: Math.min(step, 12) }, (_, index) => {
        const i = Math.max(0, step - 12) + index;
        return <g key={i} transform={`translate(334 ${550 - (i + 1) * 166.4})`} data-testid="tower-fallback-floor"><Building floor={i} /></g>;
      })}
      {falling && !fractured && <g transform={`translate(${334 + 45 * tip} ${90-camera + (distance * approach * approach)}) rotate(${22*tip} 66 98)`}><Building floor={step}/></g>}
      {fractured && Array.from({length:10},(_,n)=>{
        const col=n%3, row=Math.floor(n/3)%2, hit=timing.impact-TOWER_BREAK_SECONDS+(n%3)*.025;
        const t=Math.min(1,flight/hit), after=Math.max(0,flight-hit);
        const startY=550-(step+1)*166.4+row*49, endY=550+(n%4)*12;
        const y=startY+(endY-startY)*t*t-(after<.75?Math.abs(Math.sin(after*13))*Math.exp(-after*6)*14:0);
        const x=350+col*40+(n%5*15-45)*t;
        return <g key={n} data-testid="tower-fallback-debris" transform={`translate(${x} ${y}) rotate(${t*(180+n*39)} 22 16)`}>{n<6?<svg width="40" height="52" viewBox={`${col*44} ${row*49} 44 49`}><image href={towerAssetUrl(`facade${facade}`)} width="132" height="98" preserveAspectRatio="none"/></svg>:<rect width="22" height="9" fill="#9b988e" stroke="#686b6b"/>}</g>;
      })}
    </g>
    {!falling && <g transform="translate(334 90)"><g key={drop?.key ?? `idle-${step}`} className={drop ? "tr-dropping" : "tr-suspended"} style={{ "--tr-drop": `${distance}px` } as CSSProperties}><Building floor={step} suspended /></g></g>}
    {drop && !drop.failed && <g className="tr-dust" transform={`translate(400 ${550 - step * 166.4 + camera})`} fill="#e9ddbb">{[-65, -40, -18, 14, 40, 65].map((x, i) => <ellipse key={x} cx={x} cy={-4 - i % 3 * 4} rx={17 + i % 2 * 8} ry="9" />)}</g>}
  </svg>;
}
