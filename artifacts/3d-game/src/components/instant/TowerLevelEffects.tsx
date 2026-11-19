import type { CSSProperties } from "react";
import { TOWER_LEVEL_FLOORS } from "@workspace/api-zod/instant-collection";
import { Sparkles, Zap } from "lucide-react";

const looks = [
  { name: "SKY START", color: "#81f6e9" },
  { name: "NEON RISE", color: "#6bfff1" },
  { name: "PURPLE POWER", color: "#d4a0ff" },
  { name: "GOLD RUSH", color: "#ffe17b" },
  { name: "SKY FIRE", color: "#ffaf87" },
  { name: "MAX ENERGY", color: "#ff9bdc" },
];

export default function TowerLevelEffects({ floor, burst, motion, totalReturn }: {
  totalReturn?: string; floor: number; burst: { key: number; floor: number } | null; motion: boolean;
}) {
  const level = Math.floor(Math.max(0, floor) / TOWER_LEVEL_FLOORS) + 1;
  const tier = Math.min(looks.length - 1, level - 1);
  const look = looks[tier];
  if (!tier) return null;
  return <div className={`tr-level-effects ${motion ? "" : "tr-level-still"}`}
    style={{ "--tr-level-color": look.color } as CSSProperties} data-testid="tower-level-effects" data-tier={tier} data-level={level}>
    <div className="tr-level-aura" aria-hidden="true" />
    <div className="tr-level-badge"><Zap size={12} fill="currentColor" /><span>{look.name}</span><small>LEVEL {level}</small></div>
    {burst && <div key={burst.key} className="tr-level-up" data-testid="tower-level-up">
      {motion && <div className="tr-level-fireworks" aria-hidden="true">
        <div className="tr-level-ring" />
        {Array.from({ length: 16 }, (_, i) => <i key={i} style={{ "--tr-spark-angle": `${i * 22.5}deg`, "--tr-spark-delay": `${(i % 4) * 35}ms`, "--tr-spark-distance": `${95 + (i % 3) * 22}px` } as CSSProperties} />)}
      </div>}
      <div className="tr-level-card" role="status"><Sparkles size={24} /><small>FLOOR {burst.floor}</small><strong>LEVEL UP!</strong><span>{totalReturn ? `${totalReturn} TOTAL RETURN` : look.name}</span></div>
    </div>}
  </div>;
}
