import {
  Send,
  Flame,
  type LucideIcon,
} from "lucide-react";

/**
 * Theme registry for every crash/plane game. All of them run on the shared
 * Lunar crash engine (same provably-fair math, pari-mutuel settlement); each
 * entry only changes branding: name, colors, vehicle art, copy and audio
 * accent. `code` doubles as the server gameCode AND wallet scope.
 */
export interface CrashTheme {
  code: string;
  name: string;
  /** Two-part display name, second part rendered in the accent color. */
  namePrimary: string;
  nameAccent: string;
  provider: string;
  tagline: string;
  route: string;
  /** Lucide icon used as the flying vehicle + branding mark. */
  Icon: LucideIcon;
  /** Vehicle + trail color. */
  vehicleColor: string;
  trailColor: string;
  /** Accent used for glows/logo gradient (CSS color). */
  accent: string;
  accentTo: string;
  /** Tailwind gradient classes for the canvas backdrop. */
  canvasBg: string;
  /** Tailwind gradient for the lobby card art. */
  cardBg: string;
  /** Crash overlay copy. */
  crashText: string;
  crashTextHi: string;
  /** Sky style: starfield for space themes, none for daytime skies. */
  sky: "stars" | "clouds";
  /** Aviator-style black canvas with rotating sunburst rays from the origin. */
  sunburst?: boolean;
  /** Audio accent: playback-rate multiplier applied to engine SFX. */
  sfxRate: number;
}

export const CRASH_THEMES: Record<string, CrashTheme> = {
  jetx: {
    code: "jetx",
    name: "JetX",
    namePrimary: "Jet",
    nameAccent: "X",
    provider: "SmartSoft",
    tagline: "Eject before the jet explodes!",
    route: "/jetx",
    Icon: Send,
    vehicleColor: "#f59e0b",
    trailColor: "#f97316",
    accent: "#f59e0b",
    accentTo: "#fbbf24",
    canvasBg:
      "bg-gradient-to-br from-[hsl(220,45%,10%)] via-[hsl(215,50%,16%)] to-[hsl(30,60%,10%)]",
    cardBg: "bg-gradient-to-br from-yellow-900 to-orange-900",
    crashText: "Exploded!",
    crashTextHi: "धमाका!",
    sky: "clouds",
    sfxRate: 1.1,
  },
  fury: {
    code: "fury",
    name: "Fury Flight",
    namePrimary: "Fury",
    nameAccent: "Flight",
    provider: "Originals",
    tagline: "Ride the firestorm as high as you dare.",
    route: "/fury",
    Icon: Flame,
    vehicleColor: "#f97316",
    trailColor: "#ef4444",
    accent: "#f97316",
    accentTo: "#facc15",
    canvasBg:
      "bg-gradient-to-br from-[hsl(10,50%,9%)] via-[hsl(15,55%,13%)] to-[hsl(30,55%,9%)]",
    cardBg: "bg-gradient-to-br from-orange-950 to-red-900",
    crashText: "Burned Out!",
    crashTextHi: "जलकर राख!",
    sky: "stars",
    sfxRate: 0.9,
  },
};

export const CRASH_GAME_CODES = Object.keys(CRASH_THEMES);

export function getCrashTheme(code: string): CrashTheme {
  return CRASH_THEMES[code] ?? CRASH_THEMES.jetx;
}
