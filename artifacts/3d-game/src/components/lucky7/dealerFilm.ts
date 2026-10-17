import type { DealerRelease } from "./dicePlan";

export interface FilmSegment { startMs: number; endMs: number }
export interface DealerFilm {
  id: string;
  name: string;
  scene: string;
  idleSegment: FilmSegment;
  poster: string;
  roll: FilmSegment & { releaseMs: number; release: DealerRelease };
  tray: { x: number; y: number };
}

export type DealerFilmMode = "idle" | "roll";

export interface DealerClip {
  scene: string;
  mobileScene: string;
  fallbackScene: string;
  quality?: string;
  mobileQuality?: string;
  fallbackQuality?: string;
}

/** Separate forward-only takes with the same first/last pose. */
export interface DealerLoopFilm extends DealerClip {
  id: string;
  name: string;
  action: DealerClip & { releaseMs: number; landMs?: number };
  poster: string;
  width: number;
  height: number;
}
