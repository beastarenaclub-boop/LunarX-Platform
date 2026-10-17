import { useEffect, useRef, useState, type RefObject } from "react";
import { DEALER_MASK } from "./dealerMask";
import { idlePlayback, type DealerPlayback } from "./dealerMotion";

export type DealerReactionKind = "greeting" | "win";
export interface DealerReactionCue {
  kind: DealerReactionKind;
  roundId: string;
  endsAt: number;
}
export interface DealerReactionMedia {
  src: string;
  durationMs: number;
  startMs?: number;
  top?: string;
  scale?: number;
}

/** Optional one-shot gestures. Their decoder and audio never drive the dice. */
export default function DealerReaction({ clips, cue, blocked, sound, volume, idleRef, playbackRef, onActiveChange }: {
  clips: Partial<Record<DealerReactionKind, DealerReactionMedia>>;
  cue: DealerReactionCue | null;
  blocked: boolean;
  sound: boolean;
  volume: number;
  idleRef: RefObject<HTMLVideoElement | null>;
  playbackRef: RefObject<DealerPlayback>;
  onActiveChange: (kind: DealerReactionKind | null) => void;
}) {
  const videos = useRef<Partial<Record<DealerReactionKind, HTMLVideoElement>>>({});
  const played = useRef<string[]>([]);
  const [ready, setReady] = useState<Partial<Record<DealerReactionKind, boolean>>>({});
  const [active, setActive] = useState<DealerReactionKind | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const cueRef = useRef(cue);
  // If settlement decoding runs slightly late, finish lowering the clapping
  // hands before greeting the next betting round. A reveal still interrupts.
  if (!(active === "win" && cue?.kind === "greeting" && !blocked)) cueRef.current = cue;
  const currentCue = cueRef.current;
  const cueReady = currentCue ? !!ready[currentCue.kind] : false;
  const cueKey = currentCue ? `${currentCue.roundId}:${currentCue.kind}` : null;

  // Muting must take effect immediately without restarting the gesture.
  useEffect(() => {
    for (const video of Object.values(videos.current)) {
      video.muted = !sound;
      video.volume = Math.max(0, Math.min(1, volume));
    }
  }, [sound, volume]);

  useEffect(() => {
    const cue = cueRef.current;
    if (!cue || blocked || !cueReady) return;
    const clip = clips[cue.kind];
    const video = videos.current[cue.kind];
    if (!clip || !video) return;
    const key = `${cue.roundId}:${cue.kind}`;
    if (played.current.includes(key)) return;
    const remaining = cue.endsAt - Date.now();
    const startMs = clip.startMs ?? 0;
    const playbackMs = clip.durationMs - startMs;
    // A late join must not produce a rushed greeting or truncate a clap.
    if (document.hidden || remaining < (cue.kind === "greeting" ? playbackMs + 500 : playbackMs / 1.5 + 150)) return;
    played.current = [...played.current.slice(-15), key];
    let stopped = false;
    let firstFrame = 0;
    let visible = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timeout);
      if (firstFrame) video.cancelVideoFrameCallback?.(firstFrame);
      video.pause();
      video.muted = true;
      setActive(null);
      onActiveChange(null);
      if (playbackRef.current.mode === cue.kind) playbackRef.current = idlePlayback();
      if (!document.hidden && playbackRef.current.mode === "idle" && idleRef.current) {
        idleRef.current.currentTime = 0;
        void idleRef.current.play().catch(() => {});
      }
    };
    const present = () => {
      if (stopped || visible) return;
      if (video.seeking || video.currentTime * 1000 < startMs - 40) {
        if (video.requestVideoFrameCallback) firstFrame = video.requestVideoFrameCallback(present);
        return;
      }
      visible = true;
      idleRef.current?.pause();
      playbackRef.current = { ...idlePlayback(), mode: cue.kind, roundId: cue.roundId };
      setActive(cue.kind);
      onActiveChange(cue.kind);
    };
    const hidden = () => { if (document.hidden) finish(); };
    // Absorb decoder startup/buffering without seeking across the gesture.
    const catchUp = () => {
      const remaining = cue.endsAt - Date.now() - 80;
      if (!stopped && !video.seeking && remaining > 150) {
        video.playbackRate = Math.max(1, Math.min(2, (clip.durationMs - video.currentTime * 1000) / remaining));
      }
    };
    video.currentTime = startMs / 1000;
    video.playbackRate = Math.max(1, Math.min(1.5, playbackMs / (remaining - 100)));
    video.muted = !soundRef.current;
    video.volume = Math.max(0, Math.min(1, volumeRef.current));
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    video.addEventListener("playing", catchUp);
    video.addEventListener("timeupdate", catchUp);
    document.addEventListener("visibilitychange", hidden);
    if (video.requestVideoFrameCallback) firstFrame = video.requestVideoFrameCallback(present);
    else video.addEventListener("playing", present);
    // The server deadline controls the game, not a hard cut halfway through
    // a decoded clap. Allow a bounded buffering grace; reveal always wins.
    timeout = setTimeout(finish, playbackMs / video.playbackRate + 2500);
    void video.play().catch((error: DOMException) => {
      if (stopped) return;
      // Browsers can block audible autoplay on a fresh visit. Keep the actual
      // gesture running silently; enabling sound does not replay old greetings.
      if (error.name === "NotAllowedError") {
        video.muted = true;
        void video.play().catch(finish);
      } else if (error.name !== "AbortError") finish();
    });
    return () => {
      finish();
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      video.removeEventListener("playing", catchUp);
      video.removeEventListener("timeupdate", catchUp);
      video.removeEventListener("playing", present);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [clips, cueKey, blocked, cueReady, idleRef, playbackRef, onActiveChange]);

  return <>{(["greeting", "win"] as const).map(kind => {
    const clip = clips[kind];
    if (!clip) return null;
    return <video
      key={kind}
      ref={video => { if (video) videos.current[kind] = video; else delete videos.current[kind]; }}
      src={clip.src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      onCanPlay={() => setReady(previous => previous[kind] ? previous : { ...previous, [kind]: true })}
      className="absolute top-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2"
      style={{ opacity: active === kind ? 1 : 0, top: clip.top ?? 0, height: `${(clip.scale ?? 1) * 100}%`, maskImage: DEALER_MASK, maskSize: "100% 100%" }}
      data-testid={`lucky7-dealer-${kind}-video`}
    />;
  })}</>;
}
