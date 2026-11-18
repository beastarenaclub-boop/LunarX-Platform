import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { towerAssetUrl } from "./towerAssets";

function Building({ floor, suspended = false }: { floor: number; suspended?: boolean }) {
  const facade = ([0, 1, 2, 3, 4, 5, 3, 2, 2, 1] as const)[floor % 10];
  return <g>
    {suspended && <g stroke="#394146" fill="none" strokeWidth="1.4"><path d="M4 0 66-65 129 0M66-65V-300"/><rect x="61" y="-83" width="10" height="18" fill="#b89b48" stroke="none"/></g>}
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
  useLayoutEffect(() => {
    const host = svg.current;
    if (!host) return;
    const measure = () => { const rect = host.getBoundingClientRect(); if (rect.height) setWidth(620 * rect.width / rect.height); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const camera = Math.max(0, step - 2) * 104;
  const distance = 550 - (step + 1) * 104 + camera - 120;
  return <svg ref={svg} className={`tr-scene ${!motion ? "tr-still" : ""}`} viewBox={`${(800 - width) / 2} 0 ${width} 620`} role="img" aria-label={`Tower with ${step} completed floors${lost ? ". Round ended" : ""}`} data-testid="tower-fallback-scene" data-step={step}>
    <g className="tr-world" style={{ transform: `translateY(${camera}px)` }}>
      <path d="M-800 550H1600V950H-800Z" fill="#62696b" />
      <path d="M-800 550H322L290 950H-800ZM498 550H1600V950H550Z" fill="#a6a69f" />
      {[[100, 5, 2, .9], [580, 6, 3, .9], [205, 3, 1, .8], [505, 4, 3, .8]].map(([x, floors, facade, scale]) => <g key={x}>
        {Array.from({ length: floors }, (_, floor) => <g key={floor} transform={`translate(${x} ${550 - (floor + 1) * 104 * scale}) scale(${scale})`}><Building floor={floor === 0 ? 4 : facade} /></g>)}
        <rect x={x + 15} y={550 - floors * 104 * scale - 18} width="13" height="18" fill="#8c887d" />
      </g>)}
      {step < 6 && <path d="M315 550H496L506 557H309Z" fill="#94938a" />}
      {Array.from({ length: Math.min(step, 12) }, (_, index) => {
        const i = Math.max(0, step - 12) + index;
        return <g key={i} transform={`translate(334 ${550 - (i + 1) * 104})`} data-testid="tower-fallback-floor"><Building floor={i} /></g>;
      })}
    </g>
    {(!lost || drop) && <g transform="translate(334 120)"><g key={drop?.key ?? `idle-${step}`} className={drop ? `tr-dropping ${drop.failed ? "tr-falling" : ""}` : "tr-suspended"} style={{ "--tr-drop": `${distance}px` } as CSSProperties}><Building floor={step} suspended /></g></g>}
    {drop && <g className="tr-dust" transform={`translate(400 ${550 - step * 104 + camera})`} fill="#e9ddbb">{[-65, -40, -18, 14, 40, 65].map((x, i) => <ellipse key={x} cx={x} cy={-4 - i % 3 * 4} rx={17 + i % 2 * 8} ry="9" />)}</g>}
  </svg>;
}
