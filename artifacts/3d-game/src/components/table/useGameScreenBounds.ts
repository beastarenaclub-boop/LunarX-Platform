import { useLayoutEffect, useState } from "react";

export type GameScreenBounds = { left: number; top: number; width: number; height: number };

/** Fit dialogs to their game or the visible browser, including zoom/fullscreen. */
export function useGameScreenBounds(game: string, open: boolean, boundary: "game" | "viewport" = "game") {
  const [bounds, setBounds] = useState<GameScreenBounds | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) { setBounds(null); return; }
    const viewportFrame = Array.from(document.querySelectorAll<HTMLElement>("[data-game-viewport]"))
      .find(el => !game || el.dataset.gameViewport === game);
    const surfaces = viewportFrame ? [viewportFrame] : Array.from(document.querySelectorAll<HTMLElement>("[data-game-screen]"))
      .filter(el => el.dataset.gameScreen === game);
    let frame = 0;
    const measure = () => {
      setPortalContainer(document.fullscreenElement as HTMLElement | null);
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth;
      const height = viewport?.height ?? window.innerHeight;
      const fullscreen = document.fullscreenElement as HTMLElement | null;
      const visible = (fullscreen ? [fullscreen] : boundary === "viewport" ? [] : surfaces).map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
        .map(r => ({ left: Math.max(left, r.left), top: Math.max(top, r.top),
          right: Math.min(left + width, r.right), bottom: Math.min(top + height, r.bottom) }))
        .filter(r => r.right > r.left && r.bottom > r.top)
        .sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top));
      const area = visible[0] ?? { left, top, right: left + width, bottom: top + height };
      const next = { left: area.left, top: area.top, width: area.right - area.left, height: area.bottom - area.top };
      setBounds(previous => previous && Object.keys(next).every(key => Math.abs(previous[key as keyof GameScreenBounds] - next[key as keyof GameScreenBounds]) < .5) ? previous : next);
    };
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(update);
    surfaces.forEach(el => observer.observe(el));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("fullscreenchange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("fullscreenchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [game, open, boundary]);
  return { bounds, portalContainer };
}
