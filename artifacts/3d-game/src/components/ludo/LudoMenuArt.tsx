import { useId } from "react";

export function LudoProfilePlate() {
  const id = useId();
  return <svg className="ld-profile-plate" viewBox="0 0 526 132" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id={id + "blue"} x2="0" y2="1"><stop stopColor="#3689f4"/><stop offset=".55" stopColor="#1964c4"/><stop offset="1" stopColor="#06376b"/></linearGradient>
      <linearGradient id={id + "gold"} x2="0" y2="1"><stop stopColor="#fff4a5"/><stop offset=".45" stopColor="#ffc51c"/><stop offset="1" stopColor="#bd7800"/></linearGradient>
    </defs>
    <path d="M4 4H520V43Q520 57 504 57H167Q116 57 105 93L97 115Q92 128 78 128H4Z" fill={`url(#${id}blue)`} stroke="#5b3c05" strokeWidth="10"/>
    <path d="M4 4H520V43Q520 57 504 57H167Q116 57 105 93L97 115Q92 128 78 128H4Z" fill="none" stroke={`url(#${id}gold)`} strokeWidth="6"/>
    <path d="M11 8H511V42Q511 48 502 48H166Q110 48 98 88" fill="none" stroke="#fff6a0" strokeOpacity=".55" strokeWidth="2"/>
  </svg>;
}

export function LudoPlayerPortrait() {
  const id = useId();
  return <svg viewBox="0 0 80 80" aria-hidden="true">
    <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#fafafa"/><stop offset="1" stopColor="#a8adb3"/></linearGradient></defs>
    <rect x="1" y="1" width="78" height="78" rx="9" fill="#f6f6f4"/>
    <path d="M2 57L78 3M2 77L78 32M2 25L78 68" stroke="#d9dada"/>
    <path d="M7 72V63Q8 53 28 51L31 43H49L52 51Q72 53 73 63V72Z" fill={`url(#${id})`} stroke="#969ca2"/>
    <ellipse cx="40" cy="29" rx="17" ry="21" fill={`url(#${id})`} stroke="#a3a5a7"/>
    <path d="M27 33Q40 55 53 33M29 50Q40 59 51 50" fill="none" stroke="#a7abad" strokeWidth="2"/>
  </svg>;
}

export function LudoMenuIllustration({ computer = false }: { computer?: boolean }) {
  const id = useId();
  const phone = (x: number, y: number, width: number, height: number) => <g transform={`translate(${x} ${y})`}>
    <rect width={width} height={height} rx="5" fill={`url(#${id}gold)`} stroke="#412f00" strokeWidth="2.2"/>
    <rect x="3" y="7" width={width - 6} height={height - 15} rx="1.5" fill="#e8b20b" stroke="#fff28b" strokeWidth="1.5"/>
    <path d={`M${width * .35} 4H${width * .65}`} stroke="#694d00" strokeWidth="1.7" strokeLinecap="round"/>
    <circle cx={width / 2} cy={height - 4.5} r="2.2" fill="#a47400"/>
  </g>;
  return <svg viewBox="0 0 200 90" aria-hidden="true">
    <defs>
      <linearGradient id={id + "gold"} x2="1" y2="1"><stop stopColor="#fff5aa"/><stop offset=".24" stopColor="#ffd839"/><stop offset=".72" stopColor="#d69600"/><stop offset="1" stopColor="#fff080"/></linearGradient>
      <radialGradient id={id + "sea"} cx=".35" cy=".25"><stop stopColor="#157cbe"/><stop offset="1" stopColor="#001830"/></radialGradient>
    </defs>
    {computer ? <>
      {phone(75, 5, 50, 78)}
      <text x="100" y="58" textAnchor="middle" fill="#fff" stroke="#3f3004" strokeWidth="5" paintOrder="stroke" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="34">VS</text>
    </> : <>
      <ellipse cx="100" cy="47" rx="53" ry="30" fill="none" stroke="#684000" strokeWidth="7" strokeDasharray="1 9" strokeLinecap="round"/>
      <ellipse cx="100" cy="45" rx="53" ry="30" fill="none" stroke={`url(#${id}gold)`} strokeWidth="6" strokeDasharray="1 9" strokeLinecap="round"/>
      <circle cx="100" cy="45" r="18" fill={`url(#${id}sea)`} stroke="#a2af24" strokeWidth="1.5"/>
      <path d="M88 33L96 30L99 35L96 39L101 43L97 48L91 46L87 41ZM106 31L113 35L114 41L108 42L106 48L111 51L107 59L101 61L99 54L103 48L100 43L104 39Z" fill="#6dd600"/>
      {phone(20, 16, 36, 59)}{phone(144, 16, 36, 59)}
    </>}
  </svg>;
}

export function LudoCoinStack({ tutorial = false }: { tutorial?: boolean }) {
  const id = useId();
  return <svg viewBox="0 0 84 60" aria-hidden="true">
    <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#ffe782"/><stop offset=".5" stopColor="#fbb900"/><stop offset="1" stopColor="#a85b00"/></linearGradient></defs>
    {[[18, 42], [41, 48], [65, 43], [32, 31], [55, 31]].map(([x, y], i) => <g key={i}><path d={`M${x - 13} ${y}v6a13 6 0 0 0 26 0v-6`} fill={`url(#${id})`} stroke="#8e4d00"/><ellipse cx={x} cy={y} rx="13" ry="6" fill={`url(#${id})`} stroke="#ffe484" strokeWidth="1.5"/></g>)}
    {tutorial && <g><rect x="20" y="8" width="44" height="27" rx="12" fill="#f5210e" stroke="#ffe342" strokeWidth="3"/><path d="M37 13L52 21.5L37 30Z" fill="#fff"/></g>}
  </svg>;
}
