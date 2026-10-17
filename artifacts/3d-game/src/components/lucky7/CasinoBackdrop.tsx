import { useEffect, useRef, useState } from "react";
import poster from "@/assets/lucky7/casino-background.png";
import ambient from "@/assets/lucky7/casino-ambient.webm";

/** Background activity runs independently; only the dealer performs the throw. */
export default function CasinoBackdrop({ reducedMotion }: { reducedMotion: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let disposed = false;
    const sync = () => {
      if (document.visibilityState === "hidden") el.pause();
      else void el.play().catch((error: DOMException) => { if (!disposed && error.name !== "AbortError") setFailed(true); });
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { disposed = true; document.removeEventListener("visibilitychange", sync); el.pause(); };
  }, [reducedMotion, failed]);
  return <div className="absolute inset-x-0 top-0 h-[72%] overflow-hidden" data-testid="lucky7-casino-background">
    <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
    {!reducedMotion && !failed && <video
      ref={video} src={ambient} muted autoPlay loop playsInline preload="auto" disablePictureInPicture
      onPlaying={() => setReady(true)} onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ opacity: ready ? 1 : 0 }}
      data-testid="lucky7-casino-video"
    />}
    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-[#06170f]" />
  </div>;
}
