import { useEffect, useRef, useState } from "react";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import { DEALER, dealerCue } from "./dealerTimeline";

export function useDealerVideo({
  snapshot,
  clock,
  fresh,
  motion,
  hasCard,
}: {
  snapshot: TableRoundSnapshot | null | undefined;
  clock: number;
  fresh: boolean;
  motion: boolean;
  hasCard: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const transition = useRef<HTMLCanvasElement>(null);
  const latest = useRef({
    snapshot,
    clock,
    fresh,
    motion,
    hasCard,
    observedAt: performance.now(),
  });
  latest.current = {
    snapshot,
    clock,
    fresh,
    motion,
    hasCard,
    observedAt:
      latest.current.clock === clock
        ? latest.current.observedAt
        : performance.now(),
  };
  const [mediaError, setMediaError] = useState(false);
  const [frameTime, setFrameTime] = useState(0);
  const [cueName, setCueName] = useState("idle");

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let animation = 0,
      frameCallback = 0,
      blendFrame = 0;
    let lastKey = "",
      lastCue = "",
      lastFaceReady = false;
    let playPending = false,
      playBlocked = false,
      disposed = false;
    let hasLoaded = false,
      loadTimedOut = false,
      lastUpdate = -Infinity;
    let lastRateUpdate = -Infinity;
    const loadingStartedAt = performance.now();

    const finishSeek = () => {
      cancelAnimationFrame(blendFrame);
      blendFrame = requestAnimationFrame(() => {
        const canvas = transition.current;
        if (!canvas) return;
        // Only waiting-shot joins dissolve. Card handling stays uninterrupted.
        canvas.style.transition = "opacity 120ms linear";
        canvas.style.opacity = "0";
      });
    };
    const seek = (target: number, blend: boolean) => {
      const canvas = transition.current;
      if (blend && canvas && element.videoWidth && element.readyState >= 2) {
        // Reuse display-sized storage instead of reallocating an HD canvas
        // on every loop, especially on mobile.
        const width = Math.min(
          element.videoWidth,
          Math.ceil(element.clientWidth * Math.min(devicePixelRatio, 1.5)),
        );
        const height = Math.round(
          (width * element.videoHeight) / element.videoWidth,
        );
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas
          .getContext("2d", { alpha: false })
          ?.drawImage(element, 0, 0, width, height);
        canvas.style.transition = "none";
        canvas.style.opacity = "1";
      }
      element.currentTime = target;
    };
    const trackTime = (time: number) => {
      const ready = time >= DEALER.faceAt && time < DEALER.holdEnd;
      if (ready !== lastFaceReady) {
        lastFaceReady = ready;
        setFrameTime(ready ? time : 0);
      }
    };
    const trackFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      trackTime(metadata.mediaTime);
      if (!disposed)
        frameCallback = element.requestVideoFrameCallback(trackFrame);
    };
    if (element.requestVideoFrameCallback)
      frameCallback = element.requestVideoFrameCallback(trackFrame);

    const update = (now: number): void => {
      if (disposed || document.hidden) return;
      animation = requestAnimationFrame(update);
      // The browser decodes video independently; synchronization needs 30 Hz,
      // not 120/144 Hz on high-refresh displays.
      if (now - lastUpdate < 32) return;
      lastUpdate = now;
      const state = latest.current;
      if (!state.snapshot || !state.fresh) {
        element.pause();
        lastKey = "";
        return;
      }
      if (element.readyState < 2) {
        if (!hasLoaded && !loadTimedOut && now - loadingStartedAt > 8000) {
          loadTimedOut = true;
          setMediaError(true);
        }
        return;
      }
      hasLoaded = true;
      const cue = dealerCue(
        state.snapshot,
        state.clock + now - state.observedAt,
      );
      const moving = state.motion && !playBlocked;
      const key = `${state.snapshot.roundId}:${cue.key}:${moving}:${!moving && state.hasCard}`;
      const changed = key !== lastKey;
      const target = moving
        ? cue.time
        : state.hasCard
          ? DEALER.holdStart + 1.8
          : DEALER.idleStart;
      const drift = target - element.currentTime;
      const continuous =
        moving &&
        ((lastKey.startsWith(`${state.snapshot.roundId}:`) &&
          ((lastCue === "prepare" && cue.key === "deal") ||
            (lastCue === "deal" && cue.key === "hold"))) ||
          (lastCue === "hold" && cue.key === "reset" && Math.abs(drift) < 0.4));
      const looped = moving && cue.loop && element.currentTime >= cue.end;
      // Don't seek on ordinary phase changes or small polling jitter. A
      // non-looping shot finishes once even if settlement is delayed.
      if (
        !element.seeking &&
        ((changed && !continuous) || Math.abs(drift) > 1.2 || looped)
      )
        seek(
          target,
          !!lastKey && moving && (cue.key === "idle" || cue.key === "prepare"),
        );
      if (changed) {
        lastKey = key;
        lastCue = cue.key;
        setCueName(cue.key);
      }
      if (changed || now - lastRateUpdate >= 250) {
        const correction =
          Math.abs(drift) > 0.12 && Math.abs(drift) < 1.2
            ? Math.min(1.025, Math.max(0.975, 1 + drift * 0.04))
            : 1;
        const rate = cue.rate * correction;
        if (Math.abs(element.playbackRate - rate) > 0.005)
          element.playbackRate = rate;
        lastRateUpdate = now;
      }
      if (
        !moving ||
        (cue.key === "hold" && element.currentTime >= cue.end - 2 / DEALER.fps)
      ) {
        element.pause();
      } else if (element.paused && !playPending) {
        playPending = true;
        void element
          .play()
          .catch((error: unknown) => {
            if (
              disposed ||
              (error instanceof DOMException && error.name === "AbortError")
            )
              return;
            playBlocked = true;
            setMediaError(true);
          })
          .finally(() => {
            playPending = false;
          });
      }
      if (!element.requestVideoFrameCallback && !element.seeking)
        trackTime(element.currentTime);
    };
    const visibility = () => {
      cancelAnimationFrame(animation);
      element.pause();
      if (!document.hidden) {
        lastKey = "";
        lastUpdate = -Infinity;
        animation = requestAnimationFrame(update);
      }
    };
    element.addEventListener("seeked", finishSeek);
    document.addEventListener("visibilitychange", visibility);
    animation = requestAnimationFrame(update);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      cancelAnimationFrame(blendFrame);
      element.removeEventListener("seeked", finishSeek);
      document.removeEventListener("visibilitychange", visibility);
      if (frameCallback) element.cancelVideoFrameCallback(frameCallback);
      element.pause();
    };
  }, []);

  return {
    video,
    transition,
    frameTime,
    cueName,
    mediaError,
    onMediaError: () => setMediaError(true),
    onMediaLoaded: () => setMediaError(false),
    faceReady:
      mediaError || (frameTime >= DEALER.faceAt && frameTime < DEALER.holdEnd),
  };
}
