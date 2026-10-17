import { useId } from "react";
export default function FlightCraft({ color, size }: { color: string; size: number }) {
  const gradient = useId();
  return <svg width={size * 1.4} height={size} viewBox="0 0 140 100" aria-hidden="true"><defs><linearGradient id={gradient} x2="0" y2="1"><stop stopColor="#fff7ec"/><stop offset=".45" stopColor={color}/><stop offset="1" stopColor="#293a50"/></linearGradient></defs><path d="m40 48-35-9 13 18-13 17 37-12" fill="#ffb75b"/><path d="m37 47-24 8 25 7" fill="#fff3ad"/><path d="m45 40-9-30 16 5 24 28m-23 12-9 36 17-4 28-34" fill={color} stroke="#ffffff75" strokeWidth="1.5"/><path d="M28 49c34-16 74-16 108-3-22 16-65 21-105 15l8-6Z" fill={`url(#${gradient})`} stroke="#ffffff55" strokeWidth="1.5"/><path d="M91 38c16 0 21 4 24 8l-33 2Z" fill="#102c48" stroke="#8cb9d2" strokeWidth="1"/><path d="m40 45-9-18 10 1 21 15" fill={color}/><path d="m65 54 13 2-13 20-10 4Z" fill="#f0f5fe" opacity=".45"/></svg>;
}
