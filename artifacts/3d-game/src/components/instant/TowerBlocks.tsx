import { useId } from "react";

export const TOWER_BLOCK_STYLES = [
  { name: "Timber cabin", wall: "#c89150", shade: "#724b31", edge: "#f0d4a0" },
  { name: "Brick loft", wall: "#ba6b51", shade: "#663e3b", edge: "#e4b49b" },
  { name: "Glass office", wall: "#418aab", shade: "#264758", edge: "#b3d7e3" },
  { name: "Sandstone arcade", wall: "#d7c19a", shade: "#8b765e", edge: "#f4e4c5" },
  { name: "Corner cafe", wall: "#e4b974", shade: "#886349", edge: "#f7dfae" },
  { name: "Clock house", wall: "#77584b", shade: "#443c3b", edge: "#c5ac83" },
  { name: "Art deco suite", wall: "#e3ded0", shade: "#868e8a", edge: "#fff4d7" },
  { name: "Steel cargo", wall: "#cd7648", shade: "#704c3d", edge: "#e6bb86" },
  { name: "Garden conservatory", wall: "#71a89a", shade: "#3c665d", edge: "#d2e5c6" },
  { name: "Royal penthouse", wall: "#776484", shade: "#493c57", edge: "#e3c17d" },
] as const;

function Window({ x, y = 26, w = 25, h = 46, arch = false, glass, trim = "#ead9ae" }: { x: number; y?: number; w?: number; h?: number; arch?: boolean; glass: string; trim?: string }) {
  return <g>
    <rect x={x - 2} y={y + 2} width={w + 4} height={h + 3} rx={arch ? w / 2 : 1} fill="#152e3b" opacity=".45" />
    <path d={arch ? `M${x} ${y + h}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + h}Z` : `M${x} ${y}h${w}v${h}h-${w}Z`} fill={glass} stroke={trim} strokeWidth="2.7" />
    <path d={`M${x + w / 2} ${y + 3}v${h - 4}m-${w / 2 - 1} -${h / 2}h${w - 2}`} stroke={trim} strokeWidth="1.5" />
    <path d={`m${x + 3} ${y + h - 7} ${w - 7}-${h - 15}v10l-${w - 7} ${h - 15}Z`} fill="#effcff" opacity=".2" />
    <path d={`M${x - 3} ${y + h + 2}h${w + 6}`} stroke={trim} strokeWidth="4" />
  </g>;
}

function Facade({ kind, id }: { kind: number; id: string }) {
  const glass = `url(#${id}-glass)`, warm = `url(#${id}-warm)`;
  switch (kind) {
    case 0: return <g>
      {[24, 35, 46, 57, 68, 79, 90].map(y => <path key={y} d={`M12 ${y}h108m-103 2h98`} stroke="#68472f" strokeWidth="1" opacity=".5" />)}
      <path d="M16 19v75m98-75v75M16 20l22 18m76-18L93 38" stroke="#70482e" strokeWidth="5" />
      <Window x={28} y={28} w={30} h={43} glass={warm} /><Window x={78} y={28} w={26} h={43} glass={glass} />
      <path d="M25 77h36l-4 13H29Z" fill="#6e4d38" /><path d="M28 78q2-16 11-5 5-20 14-4l7 10" fill="#487652" /><circle cx="36" cy="73" r="3" fill="#f3a676" />
    </g>;
    case 1: return <g>
      <rect x="12" y="19" width="109" height="77" fill={`url(#${id}-bricks)`} />
      {[26, 76].map(x => <g key={x}><Window x={x} y={29} w={31} h={49} arch glass={glass} trim="#e5ba91" /><path d={`M${x - 4} 44a20 20 0 0 1 39 0`} stroke="#f2cba2" strokeWidth="5" fill="none" /><path d={`M${x + 14} 25v8`} stroke="#815244" strokeWidth="3" /></g>)}
      <path d="M21 88h91m-88-8v15m17-15v15m17-15v15m17-15v15m17-15v15m17-15v15" stroke="#373b3e" strokeWidth="2" />
    </g>;
    case 2: return <g>
      <rect x="12" y="18" width="109" height="77" fill={glass} />
      <path d="m15 20 48 0-48 63Zm45 0h17L18 94H13Z" fill="#d7f6ff" opacity=".28" />
      <path d="M12 19h109M12 55h109M12 94h109M13 20v74m27-74v74m27-74v74m27-74v74m27-74v74" stroke="#b0c8cc" strokeWidth="3" />
      <path d="M17 58h100" stroke="#214959" strokeWidth="3" opacity=".5" />
      <rect x="51" y="82" width="31" height="10" rx="2" fill="#233f4d" /><path d="M57 86h19" stroke="#a5dce4" strokeWidth="2" />
    </g>;
    case 3: return <g>
      {[26, 49, 73].map(y => <path key={y} d={`M12 ${y}h110M43 ${y}v20m43-20v20`} stroke="#99876b" opacity=".5" />)}
      {[23, 57, 91].map(x => <Window key={x} x={x} y={28} w={20} h={57} arch glass={warm} trim="#f3e3bc" />)}
      {[16, 49, 83, 116].map(x => <g key={x}><path d={`M${x} 42v47`} stroke="#bca581" strokeWidth="5" /><path d={`M${x - 4} 41h8m-8 49h8`} stroke="#f3e2bc" strokeWidth="3" /></g>)}
    </g>;
    case 4: return <g>
      <rect x="21" y="22" width="90" height="14" rx="2" fill="#355c56" stroke="#d9cf9c" />
      <path d="M37 29h57" stroke="#ddc990" strokeWidth="2" /><circle cx="29" cy="29" r="2" fill="#d9c68c" /><circle cx="103" cy="29" r="2" fill="#d9c68c" />
      <Window x={25} y={49} w={40} h={38} glass={warm} trim="#584f3e" /><Window x={79} y={48} w={26} h={47} glass={glass} trim="#584f3e" />
      <path d="m17 51 8-14h84l9 14v6H17Z" fill="#f2dfb6" stroke="#a36b49" />
      {[26, 50, 74, 98].map(x => <path key={x} d={`m${x} 38 11 0 3 13v6h-18v-6Z`} fill="#a75347" />)}
      <circle cx="98" cy="77" r="1.8" fill="#f7d28b" /><path d="M20 93h49" stroke="#8f6045" strokeWidth="4" />
    </g>;
    case 5: return <g>
      <path d="M13 19h108v76H13Z" fill="#c3b394" /><path d="M16 20v75m102-75v75M16 21l50 38 52-38M16 95l50-37 52 37M66 19v76" stroke="#654f43" strokeWidth="5" />
      <circle cx="66" cy="54" r="29" fill="#443e38" stroke="#c99d5b" strokeWidth="3" /><circle cx="66" cy="54" r="24" fill="#f5e3b3" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(angle => <path key={angle} d="M66 33v4" transform={`rotate(${angle} 66 54)`} stroke="#695541" strokeWidth="1.7" />)}
      <path d="M66 39v15l13 8" fill="none" stroke="#453f37" strokeWidth="3" strokeLinecap="round" /><circle cx="66" cy="54" r="3" fill="#b3834b" />
    </g>;
    case 6: return <g>
      <path d="M19 23h94v65H19Z" fill="#bbbfb0" /><path d="M24 19h83v73H24Z" fill="#f6ecce" />
      {[32, 56, 80].map(x => <Window key={x} x={x} y={26} w={19} h={56} glass={glass} trim="#697f7e" />)}
      <path d="M14 28h9m-9 8h9m-9 8h9m86-16h10m-10 8h10m-10 8h10M19 90h95" stroke="#bb9d66" strokeWidth="3" />
      <path d="M20 89h94v7H20Z" fill="#d3c3a0" /><path d="M65 14v9m-6-8v7m12-7v7" stroke="#aa8f59" strokeWidth="2" />
    </g>;
    case 7: return <g>
      <rect x="14" y="20" width="105" height="73" fill="#b8603f" />
      {[23, 35, 47, 59, 71, 83, 95, 107].map(x => <path key={x} d={`M${x} 23v66`} stroke="#edaf73" strokeWidth="4" opacity=".6" />)}
      <path d="M15 22h103v70H15ZM17 23l99 67M116 23 17 90" fill="none" stroke="#5a6667" strokeWidth="6" /><path d="M17 23l99 67M116 23 17 90" stroke="#bfc2af" strokeWidth="1.3" />
      {[20, 113].map(x => [25, 88].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" fill="#e5d5ac" stroke="#4c5656" />))}
      <rect x="48" y="43" width="37" height="25" rx="2" fill="#283c45" stroke="#ded2b0" strokeWidth="2" /><path d="m54 48 8 7-8 7m24-14-8 7 8 7" fill="none" stroke="#f4c46e" strokeWidth="3" />
    </g>;
    case 8: return <g>
      <rect x="17" y="22" width="99" height="71" fill={glass} />
      <path d="M19 80q12-45 25-10 8-45 21-12 14-48 28-3 15-27 21 25v13H19Z" fill="#477a58" /><path d="M28 89q3-24 12-8 3-37 15-13 7-28 16-4 6-39 18-13 12-17 16 19v19Z" fill="#79a86b" />
      <path d="M17 23h99v70H17ZM18 23l49 30 49-30M67 23v70M41 24v68m51-68v68M18 56h97" stroke="#d5dfbb" strokeWidth="3" fill="none" />
      <path d="M14 87h104v8H14Z" fill="#6b8c75" />
      {[24, 44, 65, 85, 105].map((x, i) => <g key={x}><path d={`M${x} 87q-5-15 1-20 7 3 1 12`} fill="#b1c787" /><circle cx={x} cy={79 - i % 2 * 5} r="3" fill={i % 2 ? "#efd189" : "#d29493"} /></g>)}
    </g>;
    default: return <g>
      <path d="M17 22h99v72H17Z" fill="#65506f" /><path d="M23 20v74m87-74v74" stroke="#d4b36c" strokeWidth="3" />
      {[35, 79].map(x => <Window key={x} x={x} y={31} w={23} h={48} arch glass={warm} trim="#dfc384" />)}
      <path d="m52 22 5-9 9 8 9-8 5 9ZM28 88h78m-72-5v13m16-13v13m16-13v13m16-13v13m16-13v13" fill="#d0ac64" stroke="#dfc384" strokeWidth="1.6" />
      <path d="m66 35 5 7-5 7-5-7Z" fill="#d1ac69" />
    </g>;
  }
}

export default function TowerBlock({ floor, suspended = false }: { floor: number; suspended?: boolean }) {
  const id = useId().replaceAll(":", "");
  const kind = floor % TOWER_BLOCK_STYLES.length;
  const { name, wall, shade, edge } = TOWER_BLOCK_STYLES[kind];
  return <g className="tr-building" data-style={name}>
    <title>{name}</title>
    <defs>
      <linearGradient id={`${id}-wall`} x2="1" y2="1"><stop stopColor={wall} /><stop offset=".5" stopColor={wall} /><stop offset="1" stopColor={shade} /></linearGradient>
      <linearGradient id={`${id}-side`} x2="1" y2="0"><stop stopColor={shade} /><stop offset="1" stopColor="#25313c" /></linearGradient>
      <linearGradient id={`${id}-glass`} x2=".65" y2="1"><stop stopColor="#92c9da" /><stop offset=".4" stopColor="#436b81" /><stop offset="1" stopColor="#213c51" /></linearGradient>
      <linearGradient id={`${id}-warm`} x2="1" y2="1"><stop stopColor="#fff2c1" /><stop offset=".5" stopColor="#d9b772" /><stop offset="1" stopColor="#786e58" /></linearGradient>
      <pattern id={`${id}-bricks`} width="28" height="16" patternUnits="userSpaceOnUse"><path d="M0 0h28M0 8h28M14 0v8M0 8v8" stroke="#f4c3a0" strokeOpacity=".4" strokeWidth="1.2" /><path d="M2 3h9m5 8h10" stroke="#723d36" opacity=".3" /></pattern>
    </defs>
    {suspended && <g className="tr-rig" fill="none" stroke="#52626a" strokeWidth="2"><path d="M66-145V-42M66-42 2 0M66-42 132 0" /><path d="M59-57v10q0 12 10 9" stroke="#f8c548" strokeWidth="5" /><rect x="55" y="-85" width="22" height="25" rx="3" fill="#eeb947" /><path d="m57-80 16 13m-17-3 11 9" stroke="#383f40" strokeWidth="5" /></g>}
    <path d="m5 7 12-8h123l-12 10Z" fill={edge} stroke="#4f4b48" strokeWidth="1.4" />
    <path d="M126 9 140-1v94l-14 11Z" fill={`url(#${id}-side)`} stroke="#4c4946" strokeWidth="1.4" />
    <path d="M5 7h122v96H5Z" fill={`url(#${id}-wall)`} stroke="#595047" strokeWidth="1.5" />
    <path d="M8 10h116v7H8Z" fill={edge} /><path d="M8 18h116" stroke="#3d3939" opacity=".3" strokeWidth="3" />
    <Facade kind={kind} id={id} />
    <path d="M1 97h131v7H1Z" fill={edge} stroke="#75654f" strokeWidth="1.3" /><path d="M3 99h126" stroke="#fff4d7" opacity=".7" />
    <path d="M129 14v78M8 19v74" stroke="#fff5d2" opacity=".16" strokeWidth="2" />
  </g>;
}
