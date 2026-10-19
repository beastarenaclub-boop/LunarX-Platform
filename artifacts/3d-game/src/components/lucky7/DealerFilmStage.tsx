import { memo, useEffect, useRef, useState } from "react";
import type { DealerLoopFilm } from "./dealerFilm";
import { useDealerClip } from "./useDealerClip";

export interface DealerRoll { roundId: string; deadline: number }
interface Props {
  film: DealerLoopFilm;
  reducedMotion: boolean;
  roll: DealerRoll | null;
  onRelease: (roundId: string, fromHand: boolean) => void;
  onLand?: (roundId: string) => void;
  onFrame?: (scene: "idle" | "action", ms: number) => void;
}

/** Preload both takes; show the action only after its first frame is decoded. */
function DealerFilmStage({ film, reducedMotion, roll, onRelease, onLand, onFrame }: Props) {
  const idle = useDealerClip(film, reducedMotion);
  const action = useDealerClip(film.action, reducedMotion);
  const idlePlayer = useRef<HTMLVideoElement>(null);
  const actionPlayer = useRef<HTMLVideoElement>(null);
  const [idleReady, setIdleReady] = useState(false);
  const [showAction, setShowAction] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const nearLoopEnd = useRef(false);
  const consumed = useRef<string | null>(null);
  const release = useRef(onRelease);
  release.current = onRelease;
  const callbacks = useRef({ onLand, onFrame });
  callbacks.current = { onLand, onFrame };

  useEffect(() => { setIdleReady(false); }, [idle.source]);
  useEffect(() => {
    const video = idlePlayer.current;
    if (!video || !idle.source || reducedMotion || idle.failed) return;
    let disposed = false;
    const play = () => {
      if (showAction) {
        video.pause();
        // The idle begins on the frame immediately after the action. Rewind
        // behind the visible action, so finishing never jumps to an old pose.
        if (video.currentTime > .001) video.currentTime = 0;
        return;
      }
      if (document.hidden) { video.pause(); return; }
      void video.play().catch(error => {
        if (!disposed && error.name !== "AbortError") setNeedsGesture(true);
      });
    };
    play();
    document.addEventListener("visibilitychange", play);
    return () => { disposed = true; video.pause(); document.removeEventListener("visibilitychange", play); };
  }, [idle.source, idle.failed, reducedMotion, showAction]);

  useEffect(() => {
    if (!roll || consumed.current === roll.roundId) return;
    consumed.current = roll.roundId;
    const video = actionPlayer.current;
    if (reducedMotion || document.hidden || action.failed || !video || video.readyState < 2
      || roll.deadline - Date.now() < (film.action.landMs ?? film.action.releaseMs + 760) + 150) {
      release.current(roll.roundId, false);
      return;
    }
    let disposed = false;
    let stopped = false;
    let visible = false;
    let released = false;
    let landed = false;
    let frame = 0;
    let animationFrame = 0;
    let stallGuard: number | undefined;
    let lastTime = -1;
    let lastProgress = Date.now();
    const show = () => {
      if (disposed || stopped || visible || video.seeking || video.readyState < 2) return;
      visible = true;
      setShowAction(true);
    };
    const observe = (mediaTime = video.currentTime) => {
      if (disposed || stopped) return;
      if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastProgress = Date.now(); }
      if (!video.paused) show();
      if (visible) callbacks.current.onFrame?.("action", mediaTime * 1000);
      if (visible && !released && mediaTime * 1000 >= film.action.releaseMs) {
        released = true;
        release.current(roll.roundId, true);
      }
      if (released && !landed && film.action.landMs != null && mediaTime * 1000 >= film.action.landMs) {
        landed = true;
        callbacks.current.onLand?.(roll.roundId);
      }
    };
    const finished = () => {
      stopped = true;
      window.clearInterval(stallGuard);
      window.cancelAnimationFrame(animationFrame);
      if (frame && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(frame);
      video.pause(); setShowAction(false);
      callbacks.current.onFrame?.("idle", (idlePlayer.current?.currentTime ?? 0) * 1000);
    };
    const unavailable = () => {
      if (disposed || stopped) return;
      if (!released) { released = true; release.current(roll.roundId, false); }
      else if (!landed) { landed = true; callbacks.current.onLand?.(roll.roundId); }
      finished();
    };
    const visibility = () => { if (document.hidden) unavailable(); };
    const decoded = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (disposed || stopped) return;
      observe(metadata.mediaTime);
      if (!video.ended) frame = video.requestVideoFrameCallback(decoded);
    };
    const legacyFrame = () => {
      if (disposed || stopped) return;
      observe();
      if (!video.ended) animationFrame = window.requestAnimationFrame(legacyFrame);
    };
    const play = () => {
      if (disposed || stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") frame = video.requestVideoFrameCallback(decoded);
      else animationFrame = window.requestAnimationFrame(legacyFrame);
      void video.play().catch(unavailable);
    };
    const playing = () => {
      if (typeof video.requestVideoFrameCallback !== "function") observe();
    };
    const timeUpdate = () => {
      // With decoded-frame callbacks, result ink must follow the frame that
      // is actually visible, not a media clock running ahead of the decoder.
      if (typeof video.requestVideoFrameCallback !== "function") observe();
    };
    video.addEventListener("playing", playing);
    video.addEventListener("timeupdate", timeUpdate);
    video.addEventListener("ended", finished);
    video.addEventListener("error", unavailable);
    document.addEventListener("visibilitychange", visibility);
    if (video.currentTime > .02) {
      video.addEventListener("seeked", play, { once: true });
      video.currentTime = 0;
    } else play();
    // Refused autoplay and stalled decoders must never delay the result.
    const startGuard = window.setTimeout(() => { if (!visible) unavailable(); }, 700);
    const deadlineGuard = window.setTimeout(() => {
      if (!released) unavailable();
      else if (!landed && film.action.landMs != null) {
        // The server result may become due while a slow decoder catches up.
        // Never swap away from the landing shot just because a result is due.
        landed = true; callbacks.current.onLand?.(roll.roundId);
      }
    }, Math.max(0, roll.deadline - Date.now() - 150));
    stallGuard = window.setInterval(() => {
      if (!stopped && Date.now() - lastProgress > 1200) unavailable();
    }, 400);
    return () => {
      disposed = true;
      window.clearTimeout(startGuard); window.clearTimeout(deadlineGuard);
      window.clearInterval(stallGuard);
      window.cancelAnimationFrame(animationFrame);
      if (frame && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(frame);
      video.removeEventListener("playing", playing);
      video.removeEventListener("timeupdate", timeUpdate);
      video.removeEventListener("ended", finished);
      video.removeEventListener("error", unavailable);
      video.removeEventListener("seeked", play);
      document.removeEventListener("visibilitychange", visibility);
      video.pause(); setShowAction(false);
      callbacks.current.onFrame?.("idle", (idlePlayer.current?.currentTime ?? 0) * 1000);
    };
    // A round is consumed once. A late asset download must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll, reducedMotion, film.action.releaseMs, film.action.landMs]);

  const resume = () => {
    void idlePlayer.current?.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
  };
  const rememberLoopEnd = () => {
    const video = idlePlayer.current;
    if (video && !showAction) callbacks.current.onFrame?.("idle", video.currentTime * 1000);
    if (video && Number.isFinite(video.duration) && video.currentTime >= video.duration - .5) nearLoopEnd.current = true;
  };
  return <div className="lucky7-dealer-stage" data-testid="lucky7-dealer-stage"
    data-dealer-id={film.id} data-dealer-name={film.name}
    data-mode={reducedMotion || idle.failed ? "static" : showAction ? "roll" : idleReady ? "idle" : "loading"}
    data-ready={idleReady && !reducedMotion && !idle.failed}
    data-cache-mode={idle.source?.startsWith("blob:") ? "blob" : "native"}
    data-quality={idle.quality}>
    <img src={film.poster} width={film.width} height={film.height}
      alt={`${film.name}, the Lucky 7 casino dealer`} fetchPriority="high" decoding="async"
      data-testid="lucky7-dealer" />
    {!reducedMotion && !idle.failed && <video ref={idlePlayer} src={idle.source}
      poster={film.poster} width={film.width} height={film.height}
      muted autoPlay loop playsInline preload="auto" disablePictureInPicture
      onLoadedMetadata={idle.onReady}
      onPlaying={() => {
        if ((idlePlayer.current?.currentTime ?? 0) < 1) nearLoopEnd.current = false;
        setIdleReady(true); setNeedsGesture(false);
      }}
      onTimeUpdate={rememberLoopEnd} onSeeking={rememberLoopEnd}
      onPause={() => {
        const video = idlePlayer.current;
        if (video && nearLoopEnd.current && video.currentTime < .2 && !document.hidden && !showAction) {
          nearLoopEnd.current = false; resume();
        }
      }}
      onError={idle.onError} style={{ opacity: idleReady ? 1 : 0 }} aria-hidden="true"
      data-testid="lucky7-dealer-idle-video" />}
    {!reducedMotion && !action.failed && <video ref={actionPlayer} src={action.source}
      poster={film.poster} width={film.width} height={film.height}
      muted playsInline preload={idleReady ? "auto" : "metadata"} disablePictureInPicture onError={action.onError}
      onLoadedMetadata={action.onReady}
      style={{ opacity: showAction ? 1 : 0 }} aria-hidden="true"
      data-testid="lucky7-dealer-action-video" />}
    {needsGesture && !reducedMotion && !idle.failed && <button type="button"
      className="lucky7-play-dealer" onClick={resume} data-testid="btn-play-dealer">Play dealer video</button>}
    <span className="lucky7-dealer-name">Dealer {film.name}</span>
  </div>;
}

export default memo(DealerFilmStage);
