import { useEffect, useRef, useState } from "react";
import { lucky7Dealer } from "@/components/lucky7/dealerCast";

/**
 * The same casino studio as Lucky 7 (Asha, seated). Only the idle segment is
 * looped; her dice performance is never played at the rummy table. From the
 * Rummy Royale kit (2026-09-29), re-pointed at our dealer cast.
 */
export default function RummyDealer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced || failed) return;
    let disposed = false;
    let frame = 0;
    let fallback = 0;
    // The host cast supplies a dedicated idle film, so loop its full duration.
    const restartAt = Number.POSITIVE_INFINITY;
    const check = () => {
      if (!video.seeking && video.currentTime >= restartAt)
        video.currentTime = 0;
    };
    const play = () => {
      if (document.hidden) video.pause();
      else {
        check();
        void video.play().catch((error) => {
          if (!disposed && error.name !== "AbortError") setFailed(true);
        });
      }
    };
    const watchFrame = () => {
      check();
      if (!disposed) frame = video.requestVideoFrameCallback(watchFrame);
    };
    const watchFallback = () => {
      check();
      if (!disposed) fallback = requestAnimationFrame(watchFallback);
    };
    if (video.requestVideoFrameCallback)
      frame = video.requestVideoFrameCallback(watchFrame);
    else fallback = requestAnimationFrame(watchFallback);
    video.addEventListener("timeupdate", check);
    document.addEventListener("visibilitychange", play);
    play();
    return () => {
      disposed = true;
      video.pause();
      if (frame) video.cancelVideoFrameCallback?.(frame);
      cancelAnimationFrame(fallback);
      video.removeEventListener("timeupdate", check);
      document.removeEventListener("visibilitychange", play);
    };
  }, [reduced, failed]);

  return (
    <div
      className="rm-studio"
      data-testid="rummy-studio"
      data-mode={reduced || failed ? "poster" : ready ? "video" : "loading"}
    >
      <img
        src={lucky7Dealer.poster}
        alt={`${lucky7Dealer.name}, animated computer dealer in the casino studio`}
        fetchPriority="high"
      />
      {!reduced && !failed && (
        <video
          ref={videoRef}
          src={lucky7Dealer.scene}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setReady(true)}
          onError={() => setFailed(true)}
          aria-hidden="true"
          data-testid="rummy-dealer-video"
          style={{ opacity: ready ? 1 : 0 }}
        />
      )}
      <div className="rm-studio-vignette" />
      <div className="rm-table-rail" />
    </div>
  );
}
