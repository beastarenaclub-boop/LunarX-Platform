import { useEffect, useRef, type RefObject } from "react";
import { W20_CUES, type W20Playback } from "./studioTiming";
import { createHostForeground } from "./hostForeground";
import { mobileGameMedia, preferLightMedia } from "@/lib/mediaProfile";

const base = `${import.meta.env.BASE_URL}media/wheel20-live/`;
const FILMS = {
  welcome: "studio-welcome-v3.mp4",
  lastCall: "studio-last-call-v3.mp4",
  spin: "studio-spin-v3.mp4",
  result: "studio-result-v3.mp4",
  idle: "studio-loop-v1.mp4",
} as const;
type Clip = keyof typeof FILMS;
const MOBILE_FILMS = {
  welcome: "wheelWelcome", lastCall: "wheelLastCall", spin: "wheelSpin",
  result: "wheelResult", idle: "wheelIdle",
} as const;
const NEXT_CLIP: Record<Clip, Clip> = {
  welcome: "lastCall", lastCall: "spin", spin: "result", result: "idle", idle: "welcome",
};
export type CommentaryState = "blocked" | "muted" | "loading" | "playing";
export interface StudioAudioControl {
  setEnabled(enabled: boolean): void;
}
interface Props {
  roundId: string;
  clock: number;
  bettingEndsAt: number;
  revealEndsAt: number;
  bettingMs: number;
  hasOutcome: boolean;
  sound: boolean;
  playback: RefObject<W20Playback>;
  audioControl: RefObject<StudioAudioControl | null>;
  onCommentaryState: (state: CommentaryState) => void;
}
interface Take {
  key: string;
  clip: Clip;
  stage: W20Playback["stage"];
  time: number;
}

/** Native dialogue and lips stay in one media stream. The wheel consumes the
 * decoded video frame clock, so buffering pauses both the hand and the disc. */
export function StudioPerformance(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const root = host.current!;
    const light = preferLightMedia();
    const foreground = createHostForeground(root.parentElement!, light);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const films = {} as Record<Clip, HTMLVideoElement>;
    const failed = new Set<Clip>();
    const callbacks = new Map<HTMLVideoElement, number>();
    let disposed = false,
      raf = 0,
      take: Take | null = null;
    let seekTarget: number | null = null,
      needSeek = false,
      resync = false;
    // A site may already have autoplay permission without a gesture in this
    // document. Try native playback and let play() report an actual block.
    let unlocked = true;
    let presented = false;
    const pending = new Set<HTMLVideoElement>();
    let syncedAt = 0,
      syncedClock = 0,
      observedClock = 0;
    let commentaryState: CommentaryState | null = null;
    const reportAudio = (state: CommentaryState) => {
      root.dataset.commentary = state;
      if (state !== commentaryState) {
        commentaryState = state;
        latest.current.onCommentaryState(state);
      }
    };

    const publish = (stage: W20Playback["stage"], time = 0, ready = false) => {
      latest.current.playback.current = {
        roundId: latest.current.roundId,
        stage,
        mediaTime: time,
        ready,
      };
    };
    const silence = () =>
      Object.values(films).forEach((v) => {
        v.muted = true;
        v.pause();
      });
    const showFrame = (clip: Clip, video: HTMLVideoElement, time: number) => {
      if (
        disposed ||
        take?.clip !== clip ||
        video.seeking ||
        needSeek ||
        document.hidden
      )
        return;
      if (seekTarget !== null) {
        // Old callbacks can arrive after seeking a reused video into a new round.
        // A busy device can present the first post-seek frame late. Compare
        // with the actual media position too, instead of rejecting every
        // later frame forever and leaving its commentary muted.
        if (
          time < seekTarget - 0.15 ||
          Math.abs(time - video.currentTime) > 0.5
        )
          return;
        seekTarget = null;
      }
      presented = true;
      if (reduced.matches) {
        foreground.hide();
        root.dataset.media = "poster";
        publish("fallback", time, true);
        return;
      }
      for (const v of Object.values(films))
        v.dataset.active = String(v === video);
      foreground.draw(video, time);
      root.dataset.media = "video";
      root.dataset.clip = clip;
      root.dataset.frameTime = time.toFixed(3);
      publish(take.stage, time, true);
    };
    const play = (v: HTMLVideoElement) => {
      if (!v.paused || pending.has(v)) return;
      pending.add(v);
      void v
        .play()
        .catch(async (e: DOMException) => {
          if (disposed || films[take?.clip ?? "idle"] !== v) return;
          if (e.name === "NotAllowedError") {
            unlocked = false;
            reportAudio("blocked");
            v.muted = true;
            await v.play().catch(() => {});
          }
        })
        .finally(() => pending.delete(v));
    };
    for (const clip of Object.keys(FILMS) as Clip[]) {
      const v = document.createElement("video");
      v.className = "w20-film";
      v.dataset.clip = clip;
      v.dataset.active = "false";
      v.playsInline = true;
      v.muted = true;
      v.preload = "none";
      v.src = light ? mobileGameMedia(MOBILE_FILMS[clip]) : base + FILMS[clip];
      v.addEventListener("error", () => failed.add(clip));
      films[clip] = v;
      root.append(v);
      if (typeof v.requestVideoFrameCallback === "function") {
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
          showFrame(clip, v, metadata.mediaTime);
          if (!disposed) callbacks.set(v, v.requestVideoFrameCallback(onFrame));
        };
        callbacks.set(v, v.requestVideoFrameCallback(onFrame));
      }
    }
    const audioControl: StudioAudioControl = {
      setEnabled(enabled) {
        if (!enabled) {
          Object.values(films).forEach((v) => {
            v.muted = true;
          });
          reportAudio("muted");
          return;
        }
        // Called directly inside the user's click/key gesture. In particular,
        // mobile browsers need the unmute/play here, not in a later effect.
        unlocked = true;
        const v = take ? films[take.clip] : null;
        if (v && !document.hidden) {
          v.muted = take?.clip === "idle";
          v.volume = 1;
          void v
            .play()
            .then(() => {
              if (!disposed) reportAudio(v.muted ? "loading" : "playing");
            })
            .catch((e: DOMException) => {
              if (!disposed && e.name === "NotAllowedError") {
                unlocked = false;
                v.muted = true;
                reportAudio("blocked");
              }
            });
        } else reportAudio("loading");
      },
    };
    latest.current.audioControl.current = audioControl;
    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const p = latest.current,
        now = performance.now();
      if (p.clock !== observedClock) {
        observedClock = syncedClock = p.clock;
        syncedAt = now;
      }
      const clock = syncedClock + now - syncedAt;
      if (
        document.hidden ||
        !p.roundId ||
        (reduced.matches && (!p.sound || !unlocked))
      ) {
        silence();
        root.dataset.media = "poster";
        foreground.hide();
        publish("fallback");
        reportAudio(!p.sound ? "muted" : !unlocked ? "blocked" : "loading");
        resync = true;
        return;
      }
      const elapsed = Math.max(0, (clock - p.bettingEndsAt) / 1000);
      let next: Take;
      if (!p.hasOutcome) {
        const openTime = Math.max(
          0,
          (clock - p.bettingEndsAt + p.bettingMs) / 1000,
        );
        const remaining = Math.max(0, (p.bettingEndsAt - clock) / 1000);
        const closing = remaining <= W20_CUES.duration;
        next = {
          key: `${p.roundId}:${closing ? "last-call" : `welcome-${Math.floor(openTime / 10)}`}`,
          clip: closing ? "lastCall" : "welcome",
          stage: "betting",
          time: closing
            ? Math.max(0, W20_CUES.duration - remaining)
            : openTime % 10,
        };
      } else if (
        clock < p.revealEndsAt &&
        elapsed < W20_CUES.duration &&
        p.revealEndsAt - p.bettingEndsAt >= W20_CUES.duration * 1000
      ) {
        next = {
          key: `${p.roundId}:spin`,
          clip: "spin",
          stage: "spin",
          time: elapsed,
        };
      } else if (
        clock < p.revealEndsAt &&
        p.revealEndsAt - p.bettingEndsAt < W20_CUES.duration * 1000
      ) {
        next = {
          key: `${p.roundId}:short-spin`,
          clip: "idle",
          stage: "fallback",
          time: elapsed % 10,
        };
      } else {
        // The result take follows the completed physical spin. Its ten-second
        // performance spans the remaining reveal and settlement without a
        // silent gap or restarting the same sentence at the phase boundary.
        const resultStart = Math.min(
          p.revealEndsAt,
          p.bettingEndsAt + W20_CUES.duration * 1000,
        );
        const since = Math.max(0, (clock - resultStart) / 1000);
        next = {
          key: `${p.roundId}:result-${Math.floor(since / 10)}`,
          clip: since < 10 ? "result" : "idle",
          stage: "result",
          time: since % 10,
        };
      }
      if (take?.key !== next.key || resync) {
        silence();
        take = next;
        needSeek = true;
        seekTarget = next.time;
        presented = false;
        resync = false;
        publish("waiting");
      }
      const v = films[next.clip];
      if (failed.has(next.clip)) {
        silence();
        foreground.hide();
        root.dataset.media = "poster";
        publish("fallback");
        reportAudio(p.sound ? "loading" : "muted");
        return;
      }
      // Fetch the active take first. Warm only the next take's metadata instead
      // of downloading all five performances on entry to the game.
      if (v.preload !== "auto") {
        v.preload = "auto";
        v.load();
      }
      const upcoming = films[NEXT_CLIP[next.clip]];
      if (v.readyState >= 2 && upcoming.preload === "none") {
        upcoming.preload = "metadata";
        upcoming.load();
      }
      if (v.readyState < 1) return;
      if (needSeek) {
        seekTarget = Math.min(next.time, Math.max(0, v.duration - 0.08));
        v.currentTime = seekTarget;
        needSeek = false;
      }
      // Only resynchronize a genuine stall/late resume. Routine API polling
      // must never restart dialogue, and all performances run at native speed.
      if (
        presented &&
        !v.seeking &&
        Math.abs(v.currentTime - next.time) > 0.8
      ) {
        presented = false;
        seekTarget = Math.min(next.time, Math.max(0, v.duration - 0.08));
        v.currentTime = seekTarget;
      }
      v.muted = !(p.sound && unlocked && next.clip !== "idle" && presented);
      v.volume = 1;
      reportAudio(
        !p.sound
          ? "muted"
          : !unlocked
            ? "blocked"
            : presented && !v.paused && !v.muted && v.readyState >= 3
              ? "playing"
              : "loading",
      );
      if (!v.seeking) play(v);
      if (
        typeof v.requestVideoFrameCallback !== "function" &&
        v.readyState >= 2 &&
        !v.seeking
      )
        showFrame(next.clip, v, v.currentTime);
    };
    const gesture = (event: Event) => {
      if (
        (event.target as Element | null)?.closest?.(
          '.w20-commentary, .w20-audio-start, [aria-label="Mute sound"], [aria-label="Enable sound"]',
        )
      )
        return;
      if (latest.current.sound && !unlocked) audioControl.setEnabled(true);
    };
    const visibility = () => {
      silence();
      resync = true;
    };
    // click also runs after touch activation, unlike pointerdown on a phone.
    window.addEventListener("click", gesture);
    window.addEventListener("keydown", gesture);
    document.addEventListener("visibilitychange", visibility);
    tick();
    return () => {
      disposed = true;
      foreground.dispose();
      latest.current.audioControl.current = null;
      cancelAnimationFrame(raf);
      silence();
      window.removeEventListener("click", gesture);
      window.removeEventListener("keydown", gesture);
      document.removeEventListener("visibilitychange", visibility);
      for (const v of Object.values(films)) {
        const id = callbacks.get(v);
        if (id !== undefined) v.cancelVideoFrameCallback(id);
        v.removeAttribute("src");
        v.load();
        v.remove();
      }
    };
  }, []);
  return <div className="w20-performance" ref={host} data-media="poster" />;
}
