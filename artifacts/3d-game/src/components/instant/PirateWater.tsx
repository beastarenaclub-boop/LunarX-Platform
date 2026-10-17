import { useEffect, useRef, type RefObject } from "react";

/** Animate the water texture, leaving the island and horizon anchored in place. */
export default function PirateWater({
  scroller,
  width,
  sceneWidth,
  motion,
  source,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  width: number;
  sceneWidth: number;
  motion: boolean;
  source: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const surface = canvas.current;
    const viewport = scroller.current;
    if (!motion || !surface || !viewport) return;
    const context = surface.getContext("2d", { alpha: true });
    if (!context) return;
    const texture = new Image();
    const tile = document.createElement("canvas");
    const shoreline = document.createElement("canvas");
    const tileContext = tile.getContext("2d")!;
    const maskContext = shoreline.getContext("2d")!;
    const tileWidth = Math.round(sceneWidth * 0.7);
    let frame = 0,
      previous = -Infinity,
      stopped = false;
    let height = 1;
    const prepareTexture = () => {
      if (!texture.naturalWidth) return;
      tile.width = tileWidth * 2;
      tile.height = height;
      const sx = texture.width * 0.32,
        sy = texture.height * 0.565;
      tileContext.drawImage(
        texture,
        sx,
        sy,
        texture.width - sx,
        texture.height - sy,
        0,
        0,
        tileWidth,
        height,
      );
      // Reflect the second half so both joins match, avoiding visible moving
      // vertical seams as the texture repeats across the water.
      tileContext.save();
      tileContext.translate(tile.width, 0);
      tileContext.scale(-1, 1);
      tileContext.drawImage(
        texture,
        sx,
        sy,
        texture.width - sx,
        texture.height - sy,
        0,
        0,
        tileWidth,
        height,
      );
      tileContext.restore();
    };
    const prepareMask = () => {
      const scroll = viewport.scrollLeft;
      maskContext.clearRect(0, 0, width, height);
      maskContext.fillStyle = "#000";
      maskContext.fillRect(0, 0, width, height);
      maskContext.save();
      maskContext.globalCompositeOperation = "destination-out";
      maskContext.filter = "blur(16px)";
      maskContext.beginPath();
      maskContext.moveTo(-sceneWidth - scroll, -100);
      maskContext.lineTo(sceneWidth * 0.33 - scroll, -100);
      maskContext.lineTo(sceneWidth * 0.33 - scroll, height * 0.3);
      maskContext.bezierCurveTo(
        sceneWidth * 0.31 - scroll,
        height * 0.56,
        sceneWidth * 0.22 - scroll,
        height * 0.76,
        -scroll,
        height * 0.76,
      );
      maskContext.lineTo(-sceneWidth - scroll, height * 0.76);
      maskContext.closePath();
      maskContext.fill();
      maskContext.restore();
    };
    const resize = () => {
      // A viewport-sized surface keeps mobile rendering independent of the
      // twelve-platform track's length. The source is already a soft texture.
      height = Math.max(1, Math.round(surface.clientHeight));
      surface.width = Math.round(width);
      surface.height = height;
      shoreline.width = surface.width;
      shoreline.height = height;
      prepareTexture();
      prepareMask();
    };
    const align = () => {
      surface.style.transform = `translateX(${viewport.scrollLeft}px)`;
      prepareMask();
    };
    const draw = (now: number) => {
      if (stopped || document.hidden) return;
      frame = requestAnimationFrame(draw);
      if (now - previous < 1000 / 30) return;
      previous = now;
      const time = now / 1000,
        scroll = viewport.scrollLeft;
      context.clearRect(0, 0, width, height);
      for (let y = 0; y < height; y += 3) {
        const depth = y / height;
        const swell = Math.sin(time * 1.4 - depth * 15) * 2.5 * depth;
        const sy = Math.max(0, Math.min(height - 3, y + swell));
        const drift =
          time * 8 + Math.sin(time * 0.85 + depth * 10) * (4 + depth * 14);
        const offset =
          (((drift - scroll) % tile.width) + tile.width) % tile.width;
        for (let x = offset - tile.width; x < width; x += tile.width) {
          context.drawImage(
            tile,
            0,
            sy,
            tile.width,
            3,
            x,
            y,
            tile.width + 1,
            3,
          );
        }
      }
      // Fade into the still horizon so the water never moves the sky.
      context.globalCompositeOperation = "destination-in";
      context.drawImage(shoreline, 0, 0);
      const fade = context.createLinearGradient(0, 0, 0, height);
      fade.addColorStop(0, "transparent");
      fade.addColorStop(0.14, "#000");
      fade.addColorStop(1, "#000");
      context.fillStyle = fade;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (
        !stopped &&
        !document.hidden &&
        texture.complete &&
        texture.naturalWidth
      ) {
        previous = -Infinity;
        frame = requestAnimationFrame(draw);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    resize();
    align();
    texture.onload = () => {
      prepareTexture();
      resume();
    };
    texture.src = source;
    viewport.addEventListener("scroll", align, { passive: true });
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      texture.onload = null;
      observer.disconnect();
      viewport.removeEventListener("scroll", align);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [motion, sceneWidth, scroller, source, width]);

  return motion ? (
    <canvas
      ref={canvas}
      className="pr-water"
      style={{ width }}
      aria-hidden="true"
    />
  ) : null;
}
