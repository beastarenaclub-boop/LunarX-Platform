/**
 * How the 2316 x 1080 canvas is fitted to the window — and, on a phone held
 * upright, TURNED.
 *
 * The cabinet is landscape and nothing about it works any other way, so a
 * portrait viewport gets the whole canvas rotated a quarter turn and stretched
 * to the long side. This is done in CSS rather than with the orientation-lock
 * API because that API only works inside fullscreen on Android and does not
 * exist on iPhone at all; a rotated canvas works on every device the moment
 * the page opens.
 *
 * The bet chart resolves taps by hand (a fraction of the chart rect), so it
 * needs the INVERSE of this transform — `clientToCanvas` — rather than the
 * axis-aligned box `getBoundingClientRect` hands back for a rotated element.
 * Everything else hit-tests through the DOM, which handles the rotation itself.
 */
import { CANVAS_H, CANVAS_W } from "./layout";

export interface Viewport {
  w: number;
  h: number;
  /** True when the canvas is drawn turned a quarter turn (portrait window). */
  rotated: boolean;
  /** Scale from canvas units to screen pixels, along the canvas's own axes. */
  sx: number;
  sy: number;
}

export function fitViewport(w: number, h: number): Viewport {
  const rotated = h > w;
  const sx = (rotated ? h : w) / CANVAS_W;
  const sy = (rotated ? w : h) / CANVAS_H;
  return { w, h, rotated, sx, sy };
}

/** Turned: canvas x runs DOWN the window, canvas y runs LEFT; the game's top sits on the right edge. */
export function canvasTransform(v: Viewport): string {
  if (!v.rotated) return `scale(${v.sx}, ${v.sy})`;
  return `translate(${v.w}px, 0) rotate(90deg) scale(${v.sx}, ${v.sy})`;
}

export function clientToCanvas(v: Viewport, clientX: number, clientY: number): { x: number; y: number } {
  if (!v.rotated) return { x: clientX / v.sx, y: clientY / v.sy };
  return { x: clientY / v.sx, y: (v.w - clientX) / v.sy };
}

/** The window as the canvas experiences it — swapped when turned. */
export function effectiveWindow(v: Viewport): { w: number; h: number } {
  return v.rotated ? { w: v.h, h: v.w } : { w: v.w, h: v.h };
}

let current: Viewport = fitViewport(
  typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : CANVAS_W,
  typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : CANVAS_H,
);

export function currentViewport(): Viewport {
  return current;
}

export function applyViewport(el: HTMLElement): Viewport {
  current = fitViewport(globalThis.innerWidth, globalThis.innerHeight);
  el.style.transform = canvasTransform(current);
  return current;
}
