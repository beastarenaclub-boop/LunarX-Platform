import { useEffect, useRef, type RefObject } from "react";
import { gripAt, type DealerRelease } from "./dicePlan";
import type { DealerPlayback } from "./dealerMotion";

/** Re-use filmed fingers in front of held dice, instead of painting over skin. */
export default function DealerGripComposite({ release, releaseMs, videoRef, playbackRef, active }: {
  release: DealerRelease;
  releaseMs: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  playbackRef: RefObject<DealerPlayback>;
  active: boolean;
}) {
  const fingersRef = useRef<HTMLCanvasElement>(null);
  const shadowRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = fingersRef.current, shadow = shadowRef.current;
    const video = videoRef.current;
    if (!canvas || !shadow || !video) return;
    const ctx = canvas.getContext("2d"), shade = shadow.getContext("2d");
    if (!ctx || !shade) return;
    let raf = 0, lastMs = -1;
    const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); shade.clearRect(0, 0, shadow.width, shadow.height); };
    if (!active) { clear(); return; }
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const frame = playbackRef.current;
      if (document.hidden || frame.mode !== "roll" || !frame.frameReady || frame.mediaMs >= releaseMs) { clear(); return; }
      if (frame.mediaMs === lastMs || video.seeking) return;
      lastMs = frame.mediaMs;
      const width = Math.round(canvas.clientWidth), height = Math.round(canvas.clientHeight);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = shadow.width = width; canvas.height = shadow.height = height; }
      clear();
      const grip = gripAt(release, frame.mediaMs);
      if (!grip) return;
      const vw = height * release.videoAspect, left = (width - vw) * (release.videoPositionX ?? .5);
      const x = left + grip.x * vw, y = grip.y * height;
      const die = grip.size * vw;
      // Soft local contact on the palm; table shadows begin only at release.
      shade.save(); shade.translate(x, y + die * .46); shade.scale(1, .35);
      const gradient = shade.createRadialGradient(0, 0, die * .2, 0, 0, die * 1.2);
      gradient.addColorStop(0, "rgba(35,18,8,.32)"); gradient.addColorStop(1, "rgba(35,18,8,0)");
      shade.fillStyle = gradient; shade.fillRect(-die * 1.2, -die * 1.2, die * 2.4, die * 2.4); shade.restore();
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "white";
      // Distal finger joints are in front of a cupped palm. Copy just those
      // photographed pixels, leaving the centre of the palm and dice exposed.
      for (const joints of [[3, 4], [6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]]) {
        ctx.lineWidth = die * (joints[0] === 3 ? .35 : .28);
        ctx.beginPath();
        joints.forEach((joint, index) => {
          const p = grip.fingers[joint];
          const px = left + p[0] * vw, py = p[1] * height;
          if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(video, left, 0, vw, height); ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); clear(); };
  }, [active, release, releaseMs, videoRef, playbackRef]);
  return <>
    <canvas ref={shadowRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[9] h-full w-full" data-testid="dealer-palm-shadow" />
    <canvas ref={fingersRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[11] h-full w-full" data-testid="dealer-finger-occlusion" />
  </>;
}
