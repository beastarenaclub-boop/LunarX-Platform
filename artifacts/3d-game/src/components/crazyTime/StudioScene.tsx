import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import studioPoster from "@/assets/crazy-time/studio-v2-poster.jpg";
import spinFilm from "@/assets/crazy-time/studio-v3-spin.mp4";
import welcomeFilm from "@/assets/crazy-time/studio-v3-welcome.mp4";
import choicesFilm from "@/assets/crazy-time/studio-v3-choices.mp4";
import lastCallFilm from "@/assets/crazy-time/studio-v3-last-call.mp4";
import resultFilm from "@/assets/crazy-time/studio-v3-result.mp4";
import welcomeVoice from "@/assets/crazy-time/studio-v3-welcome.mp3";
import choicesVoice from "@/assets/crazy-time/studio-v3-choices.mp3";
import lastCallVoice from "@/assets/crazy-time/studio-v3-last-call.mp3";
import resultVoice from "@/assets/crazy-time/studio-v3-result.mp3";
import {
  preloadDealerAudio,
  playDealerAudio,
  dealerAudioUnlocked,
  unlockAudio,
  type DealerAudioHandle,
} from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { handOverlay } from "./handOverlay";
import type { RoundPhase } from "@/components/table/useTableRound";
import {
  STUDIO_CUES,
  studioPlaybackRate,
  type StudioPlayback,
} from "./studioTiming";

const FILMS = {
  spin: spinFilm,
  welcome: welcomeFilm,
  choices: choicesFilm,
  lastCall: lastCallFilm,
  result: resultFilm,
};
type Clip = keyof typeof FILMS;
const VOICES: Partial<Record<Clip, string>> = {
  welcome: welcomeVoice,
  choices: choicesVoice,
  lastCall: lastCallVoice,
  result: resultVoice,
};
// Five bounded, complete files are reused on every loop and route visit. Seeking
// a local blob never starts competing HTTP range downloads mid-spin.
const cachedFilms = new Map<Clip, Promise<string>>();
const filmQueue: { clip: Clip; start: () => void }[] = [];
let downloading = 0;
function pumpFilms() {
  while (downloading < 2 && filmQueue.length) {
    downloading++;
    filmQueue.shift()!.start();
  }
}
function loadFilm(clip: Clip, urgent = false) {
  let loading = cachedFilms.get(clip);
  if (!loading) {
    loading = new Promise<string>((resolve, reject) => {
      const task = { clip, start: () => {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 45_000);
        void fetch(FILMS[clip], { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Studio unavailable");
        return response.blob();
      })
      .then((blob) => resolve(URL.createObjectURL(blob)))
      .catch((error) => {
        cachedFilms.delete(clip);
        reject(error);
      }).finally(() => { clearTimeout(timeout); downloading--; pumpFilms(); });
      } };
      if (urgent) filmQueue.unshift(task); else filmQueue.push(task);
    });
    cachedFilms.set(clip, loading);
  } else if (urgent) {
    const index = filmQueue.findIndex(task => task.clip === clip);
    if (index > 0) filmQueue.unshift(...filmQueue.splice(index, 1));
  }
  pumpFilms();
  return loading;
}
interface Props {
  children: ReactNode;
  phase: RoundPhase | null;
  roundId: string | null;
  revealStartsAt: number | null;
  revealMs: number;
  bettingEndsAt: number | null;
  bettingMs: number;
  playback: RefObject<StudioPlayback>;
  sound: boolean;
  volume: number;
}
interface Take {
  key: string;
  clip: Clip;
  stage: StudioPlayback["stage"];
  start: number;
  end: number;
  rate: number;
  audible: boolean;
}

/** One presenter frame clock drives both the performance and the prize disc. */
export default function StudioScene(props: Props) {
  const films = useRef<Partial<Record<Clip, HTMLVideoElement>>>({});
  const scene = useRef<HTMLDivElement>(null);
  const hands = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const root = scene.current!;
    const foreground = handOverlay(hands.current!);
    const paintHand = foreground.paint;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const failed = new Set<Clip>();
    const callbacks = new Map<HTMLVideoElement, number>();
    let take: Take | null = null;
    let roundId: string | null = null;
    let seekTarget: number | null = null;
    let presented = false;
    let spinFinishedAt: number | null = null;
    let resync = false;
    let needsPlay = false;
    let playPending = false;
    let voice: DealerAudioHandle | null = null;
    let warmStarted = false;
    const soundButton = root.querySelector<HTMLButtonElement>(
      "[data-studio-sound]",
    )!;
    const loadingLabel = root.querySelector<HTMLElement>(
      "[data-studio-loading]",
    )!;
    const retryButton = root.querySelector<HTMLButtonElement>(
      "[data-studio-retry]",
    )!;
    const stopVoice = () => {
      voice?.stop();
      voice = null;
      root.dataset.voice = "silent";
    };
    for (const url of Object.values(VOICES)) void preloadDealerAudio(url);
    const prepare = async (clip: Clip, urgent = false) => {
      try {
        const url = await loadFilm(clip, urgent);
        if (!disposed && films.current[clip]!.src !== url) {
          const video = films.current[clip]!;
          video.src = url;
          video.preload = "auto";
          video.load();
          root.dataset.loaded = String(
            Object.values(films.current).filter((v) => !!v.getAttribute("src"))
              .length,
          );
        }
      } catch {
        if (!disposed) failed.add(clip);
      }
    };
    const syncVoice = (video: HTMLVideoElement) => {
      const p = latest.current;
      const unlocked = dealerAudioUnlocked();
      soundButton.hidden = p.sound && p.volume > 0 && unlocked;
      if (
        !p.sound ||
        p.volume <= 0 ||
        !unlocked ||
        !presented ||
        video.paused ||
        video.seeking ||
        video.readyState < 3 ||
        !take?.audible ||
        document.hidden
      ) {
        stopVoice();
        return;
      }
      const url = VOICES[take.clip];
      if (!url) {
        stopVoice();
        return;
      }
      voice ??= playDealerAudio(
        url,
        video.currentTime,
        Math.max(0, take.end - video.currentTime),
        take.rate,
        p.volume,
      );
      voice?.setVolume(p.volume);
      root.dataset.voice = voice ? "playing" : "loading";
    };
    let disposed = false;
    let animation = 0;
    let lastTick = 0;

    const publish = (
      stage: StudioPlayback["stage"],
      mediaTime = 0,
      ready = false,
    ) => {
      latest.current.playback.current = {
        roundId: latest.current.roundId,
        stage,
        mediaTime,
        ready,
        presentedAt: performance.now(),
        rate: take?.rate ?? 1,
        advancing: ready && !!take && !films.current[take.clip]!.paused,
      };
    };
    const poster = () => {
      root.dataset.media = "poster";
      foreground.clear();
      stopVoice();
      for (const v of Object.values(films.current)) {
        v.pause();
        v.muted = true;
        v.dataset.active = "false";
      }
    };
    const frameShown = (clip: Clip, video: HTMLVideoElement, time: number) => {
      if (
        disposed ||
        document.hidden ||
        reduced.matches ||
        take?.clip !== clip ||
        video.seeking
      )
        return;
      if (seekTarget != null) {
        // A seek may briefly report the previous decoded frame. Never let that
        // old pull release the new round's wheel.
        if (Math.abs(time - seekTarget) > 0.4) return;
        seekTarget = null;
      }
      presented = true;
      paintHand(video);
      for (const other of Object.values(films.current))
        other.dataset.active = String(other === video);
      video.dataset.active = "true";
      loadingLabel.hidden = true;
      retryButton.hidden = true;
      root.dataset.media = "video";
      root.dataset.clip = clip;
      root.dataset.performance =
        take.stage === "spin" ? "spinning" : take.stage;
      root.dataset.frameTime = time.toFixed(3);
      publish(take.stage, time, true);
    };
    for (const [clip, video] of Object.entries(films.current) as [
      Clip,
      HTMLVideoElement,
    ][]) {
      if (typeof video.requestVideoFrameCallback === "function") {
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
          frameShown(clip, video, metadata.mediaTime);
          if (!disposed)
            callbacks.set(video, video.requestVideoFrameCallback(onFrame));
        };
        callbacks.set(video, video.requestVideoFrameCallback(onFrame));
      }
    }
    const activate = (next: Take) => {
      stopVoice();
      // Hold the last displayed frame until the next video has actually decoded.
      for (const video of Object.values(films.current)) video.pause();
      take = next;
      loadingLabel.hidden = false;
      loadingLabel.textContent = "Loading studio…";
      void prepare(next.clip, true).then(async () => {
        if (warmStarted || disposed || reduced.matches) return;
        warmStarted = true;
        // Active take first, then the spin. Only one background file at a time.
        for (const clip of [
          "spin",
          "welcome",
          "choices",
          "lastCall",
          "result",
        ] as Clip[]) {
          if (disposed) break;
          await prepare(clip);
        }
      });
      presented = false;
      seekTarget = next.start;
      needsPlay = true;
      publish("waiting");
      root.dataset.performance =
        next.stage === "spin" ? "spinning" : next.stage;
      root.dataset.clip = next.clip;
      const video = films.current[next.clip]!;
      if (video.readyState >= 1)
        video.currentTime = Math.min(
          next.start,
          Math.max(0, video.duration - 0.05),
        );
    };
    const play = (video: HTMLVideoElement) => {
      if (!needsPlay || playPending || !video.paused) return;
      needsPlay = false;
      playPending = true;
      void video
        .play()
        .catch(async (error: DOMException) => {
          if (disposed || take?.clip !== video.dataset.clip) return;
          if (error.name === "NotAllowedError") {
            video.muted = true;
            await video.play().catch(() => {});
          }
        })
        .finally(() => {
          playPending = false;
        });
    };
    const tick = () => {
      if (disposed) return;
      animation = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - lastTick < 40) return;
      lastTick = now;
      const p = latest.current;
      if (p.roundId !== roundId) {
        roundId = p.roundId;
        spinFinishedAt = null;
        take = null;
      }
      soundButton.hidden = p.sound && p.volume > 0 && dealerAudioUnlocked();
      if (!p.phase || reduced.matches || document.hidden) {
        loadingLabel.hidden = true;
        poster();
        publish("fallback");
        if (reduced.matches)
          root.dataset.performance =
            p.phase === "betting" ? "betting" : "result";
        resync = true;
        return;
      }
      let next: Take;
      const prefix = p.roundId ?? "waiting";
      if (p.phase === "betting") {
        spinFinishedAt = null;
        const remaining = Math.max(0, ((p.bettingEndsAt ?? now) - now) / 1000);
        const elapsed = Math.max(0, p.bettingMs / 1000 - remaining);
        if (remaining <= 8) {
          next = {
            key: prefix + ":last",
            clip: "lastCall",
            stage: "betting",
            start: Math.max(0, 8 - remaining),
            end: 8,
            rate: 1,
            audible: true,
          };
        } else if (elapsed < 16) {
          const index = Math.floor(elapsed / 8);
          // Alternate the two introductions between rounds, without replaying
          // an entry gesture every time the server refreshes its snapshot.
          const odd = [...prefix].reduce((n, c) => n + c.charCodeAt(0), 0) % 2;
          const clip = (index + odd) % 2 ? "choices" : "welcome";
          next = {
            key: `${prefix}:open:${index}`,
            clip,
            stage: "betting",
            start: elapsed % 8,
            end: 8,
            rate: 1,
            audible: true,
          };
        } else {
          const duration = STUDIO_CUES.idleEnd - STUDIO_CUES.idleStart;
          next = {
            key: `${prefix}:rest:${Math.floor((elapsed - 16) / duration)}`,
            clip: "spin",
            stage: "betting",
            start: STUDIO_CUES.idleStart + ((elapsed - 16) % duration),
            end: STUDIO_CUES.idleEnd,
            rate: 1,
            audible: false,
          };
        }
      } else {
        const elapsed = Math.max(0, (now - (p.revealStartsAt ?? now)) / 1000);
        const rate = studioPlaybackRate(p.revealMs);
        const video = films.current.spin!;
        if (
          take?.stage === "spin" &&
          presented &&
          (video.ended || video.currentTime >= STUDIO_CUES.actionEnd - 0.06)
        )
          spinFinishedAt ??= now;
        // A background-tab join may be beyond the whole take. Skip the pull.
        if (
          (take?.stage !== "spin" || resync) &&
          elapsed * rate >= STUDIO_CUES.actionEnd
        )
          spinFinishedAt ??=
            now - (elapsed - STUDIO_CUES.actionEnd / rate) * 1000;
        if (p.phase === "settling") spinFinishedAt ??= now;
        if (spinFinishedAt == null && elapsed * 1000 < p.revealMs) {
          next = {
            key: prefix + ":spin",
            clip: "spin",
            stage: "spin",
            start: elapsed < 0.75 ? 0 : elapsed * rate,
            end: STUDIO_CUES.actionEnd,
            rate,
            audible: false,
          };
        } else {
          // Network/media errors cannot delay authoritative settlement. Switch
          // to a still/result, never animate a pull that the viewer didn't see.
          spinFinishedAt ??= now;
          const since = Math.max(0, (now - spinFinishedAt) / 1000);
          if (since < 8)
            next = {
              key: prefix + ":result",
              clip: "result",
              stage: "result",
              start: since,
              end: 8,
              rate: 1,
              audible: true,
            };
          else
            next = {
              key: prefix + ":rest-result",
              clip: "spin",
              stage: "result",
              start:
                STUDIO_CUES.idleStart +
                ((since - 8) % (STUDIO_CUES.idleEnd - STUDIO_CUES.idleStart)),
              end: STUDIO_CUES.idleEnd,
              rate: 1,
              audible: false,
            };
        }
      }
      if (take?.key !== next.key || resync) {
        resync = false;
        activate(next);
      }
      const active = take!;
      const video = films.current[active.clip]!;
      if (failed.has(active.clip)) {
        poster();
        loadingLabel.hidden = false;
        loadingLabel.textContent = "Studio video unavailable";
        retryButton.hidden = false;
        publish(
          active.stage === "result" ? "result" : "fallback",
          0,
          active.stage === "result",
        );
        return;
      }
      video.playbackRate = active.rate;
      // Silent video can always autoplay; the unlocked Web Audio clock carries speech.
      video.muted = true;
      syncVoice(video);
      if (video.readyState < 2 || video.seeking) return;
      if (
        seekTarget != null &&
        Math.abs(video.currentTime - seekTarget) > 0.1
      ) {
        video.currentTime = Math.min(seekTarget, video.duration - 0.05);
        return;
      }
      if (
        active.clip === "spin" &&
        active.stage !== "spin" &&
        video.currentTime >= active.end - 0.06
      ) {
        video.currentTime = STUDIO_CUES.idleStart;
        needsPlay = true;
      }
      // Non-rVFC browsers get a conservative decoded-current-frame fallback.
      if (
        typeof video.requestVideoFrameCallback !== "function" &&
        video.readyState >= 3
      )
        frameShown(active.clip, video, video.currentTime);
      play(video);
    };
    const wake = () => {
      if (document.hidden) poster();
      resync = true;
      needsPlay = true;
      lastTick = 0;
    };
    const gesture = () => {
      needsPlay = true;
      lastTick = 0;
    };
    const loaded = (event: Event) => {
      if (!take || event.target !== films.current[take.clip]) return;
      needsPlay = true;
      lastTick = 0;
    };
    const retry = () => {
      failed.clear();
      warmStarted = false;
      resync = true;
      lastTick = 0;
      retryButton.hidden = true;
    };
    retryButton.addEventListener("click", retry);
    const errors: Array<() => void> = [];
    for (const [clip, video] of Object.entries(films.current) as [
      Clip,
      HTMLVideoElement,
    ][]) {
      const halted = () => {
        if (take?.clip !== clip) return;
        latest.current.playback.current.advancing = false;
        stopVoice();
      };
      video.addEventListener("pause", halted);
      video.addEventListener("waiting", halted);
      video.addEventListener("seeking", halted);
      const error = () => {
        failed.add(clip);
      };
      video.addEventListener("error", error);
      video.addEventListener("loadeddata", loaded);
      errors.push(() => {
        video.removeEventListener("pause", halted);
        video.removeEventListener("waiting", halted);
        video.removeEventListener("seeking", halted);
        video.removeEventListener("error", error);
        video.removeEventListener("loadeddata", loaded);
      });
    }
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("pointerdown", gesture);
    reduced.addEventListener("change", wake);
    animation = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      poster();
      foreground.dispose();
      retryButton.removeEventListener("click", retry);
      publish("waiting");
      for (const [video, id] of callbacks) video.cancelVideoFrameCallback(id);
      errors.forEach((remove) => remove());
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("pointerdown", gesture);
      reduced.removeEventListener("change", wake);
    };
  }, []);

  return (
    <div
      ref={scene}
      className="ct-studio-scene"
      data-testid="crazy-studio-scene"
      data-media="poster"
    >
      <img
        className="ct-studio-photograph"
        src={studioPoster}
        width={1920}
        height={1080}
        alt="Red and gold wheel studio with Maya, an AI-generated presenter"
        fetchPriority="high"
        draggable={false}
      />
      {Object.keys(FILMS).map((clip) => (
        <video
          key={clip}
          ref={(v) => {
            if (v) films.current[clip as Clip] = v;
          }}
          className="ct-studio-film"
          muted
          playsInline
          preload="none"
          disablePictureInPicture
          aria-hidden="true"
          data-clip={clip}
          data-active="false"
          data-testid={`crazy-host-${clip}`}
        />
      ))}
      <span className="ct-studio-loading" data-studio-loading role="status">
        Loading studio…
      </span>
      <button className="ct-studio-retry" data-studio-retry hidden>
        Retry video
      </button>
      <button
        className="ct-studio-sound"
        data-studio-sound
        onClick={() => {
          void unlockAudio();
          updateSettings({
            sound: true,
            ...(props.volume <= 0 ? { masterVolume: 0.7, sfxVolume: 0.8 } : {}),
          });
        }}
      >
        Tap for Hindi sound
      </button>
      {props.children}
      <canvas
        ref={hands}
        className="ct-studio-hands"
        width={960}
        height={540}
        aria-hidden="true"
      />
      <img
        className="ct-studio-pointer"
        src={studioPoster}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <div
        className="ct-studio-presenter"
        role="img"
        aria-label="Maya, AI video host"
        data-testid="crazy-host"
      >
        <span>
          MAYA <small>AI VIDEO HOST</small>
        </span>
      </div>
    </div>
  );
}
