import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import type { ODPhase } from "@workspace/api-zod/dragon-tiger-one-day";
import { useStore } from "@/game/store";
import {
  connectDealerMedia,
  dealerAudioUnlocked,
  unlockAudio,
} from "@/game/audio";
import {
  commentaryKey,
  readCommentaryClips,
  type CommentaryClip,
  type CommentaryClips,
} from "./commentary";

const MEDIA = `${import.meta.env.BASE_URL}media/dragon-tiger-one-day/`;

export interface OneDayAudioHandle {
  play: () => void;
}

interface Props {
  voiceEnabled?: boolean;
  phase?: ODPhase;
  roundId?: number;
  dragon?: number;
  winner?: "dragon" | "tiger" | "tie";
  remainingMs: number;
  connected: boolean;
  motionEnabled: boolean;
  onSpeaking: (speaking: boolean) => void;
  audioRef: Ref<OneDayAudioHandle>;
}

/** Speech uses the same audio output as the game, locked to the filmed take. */
export function OneDayCommentary(props: Props) {
  const {
    voiceEnabled = false,
    phase,
    roundId,
    dragon,
    winner,
    remainingMs,
    connected,
    motionEnabled,
    onSpeaking,
    audioRef,
  } = props;
  const sound = useStore((s) => s.settings.sound);
  const music = useStore((s) => s.settings.music);
  const master = useStore((s) => s.settings.masterVolume);
  const voiceVolume = useStore((s) => s.settings.sfxVolume);
  const musicVolume = useStore((s) => s.settings.musicVolume);
  const [visible, setVisible] = useState(!document.hidden);
  const [clips, setClips] = useState<CommentaryClips>({});
  const [speaking, setSpeaking] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);
  const completed = useRef(new Set<string>());
  const speechRetry = useRef<() => void>(() => {});
  const musicRetry = useRef<() => void>(() => {});
  useImperativeHandle(
    audioRef,
    () => ({
      play: () => {
        // Wake the game's audio output before the user's gesture ends.
        speechRetry.current();
        musicRetry.current();
      },
    }),
    [],
  );
  const clock = useRef({ remainingMs, receivedAt: performance.now() });
  clock.current = { remainingMs, receivedAt: performance.now() };
  const remaining = useCallback(
    () =>
      clock.current.remainingMs -
      (performance.now() - clock.current.receivedAt),
    [],
  );

  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    const controller = new AbortController();
    if (voiceEnabled)
      void fetch(`${MEDIA}commentary/manifest.json`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          if (!controller.signal.aborted) setClips(readCommentaryClips(value));
        })
        .catch(() => {});
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [voiceEnabled]);

  const activity = useCallback(
    (value: boolean) => {
      setSpeaking(value);
      onSpeaking(value);
    },
    [onSpeaking],
  );
  const finish = useCallback(
    (key: string) => {
      completed.current.add(key);
      if (completed.current.size > 64)
        completed.current.delete(completed.current.values().next().value!);
      setFinished(key);
      activity(false);
    },
    [activity],
  );
  const line = commentaryKey(phase, dragon, winner);
  const clip = line ? clips[line] : undefined;
  const key = `${roundId}:${phase}:${line}`;
  const audible =
    voiceEnabled &&
    sound &&
    master > 0 &&
    voiceVolume > 0 &&
    connected &&
    visible;
  const eligible =
    roundId !== undefined &&
    audible &&
    clip &&
    !completed.current.has(key) &&
    key !== finished;

  return (
    <>
      <StudioMusic
        enabled={
          sound &&
          music &&
          connected &&
          visible &&
          master > 0 &&
          musicVolume > 0
        }
        volume={master * musicVolume * 0.65}
        speaking={speaking}
        retry={musicRetry}
      />
      {voiceEnabled && (
        <SpokenTake
          eventKey={key}
          clip={eligible ? clip : undefined}
          sourceClip={clip}
          retry={speechRetry}
          motionEnabled={motionEnabled}
          volume={Math.min(1, master * voiceVolume * 2)}
          remaining={remaining}
          onActivity={activity}
          onFinish={finish}
        />
      )}
    </>
  );
}

function SpokenTake({
  eventKey,
  clip,
  sourceClip,
  retry,
  motionEnabled,
  volume,
  remaining,
  onActivity,
  onFinish,
}: {
  eventKey: string;
  clip?: CommentaryClip;
  sourceClip?: CommentaryClip;
  retry: RefObject<() => void>;
  motionEnabled: boolean;
  volume: number;
  remaining: () => number;
  onActivity: (value: boolean) => void;
  onFinish: (key: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [painted, setPainted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [voiceState, setVoiceState] = useState("idle");
  const playback = useRef<ReturnType<typeof connectDealerMedia>>(null);
  const playing = useRef(false);
  const level = useRef(volume);
  level.current = volume;
  useEffect(() => {
    playback.current?.setVolume(playing.current ? volume : 0);
  }, [volume]);
  useEffect(() => {
    const video = ref.current!;
    setPainted(false);
    setBlocked(false);
    setVoiceState("idle");
    if (!clip) return;
    let disposed = false;
    let started = false;
    let done = false;
    let pending = false;
    const output = connectDealerMedia(video);
    playback.current = output;
    const stopVoice = () => {
      playing.current = false;
      output?.setVolume(0);
    };
    const fits = () => {
      const secondsLeft = Math.max(0, clip.duration - video.currentTime);
      return remaining() >= (secondsLeft + 0.15) * 1000;
    };
    const finish = () => {
      if (disposed || done) return;
      done = true;
      stopVoice();
      video.pause();
      onFinish(eventKey);
    };
    const unavailable = () => {
      if (disposed || done) return;
      stopVoice();
      video.pause();
      setBlocked(true);
      setVoiceState("blocked");
    };
    const syncVoice = () => {
      if (
        disposed ||
        done ||
        document.hidden ||
        video.paused ||
        video.seeking ||
        video.ended ||
        video.readyState < 3
      )
        return;
      if (!fits()) {
        finish();
        return;
      }
      if (!dealerAudioUnlocked() || !output) return;
      playing.current = true;
      output.setVolume(level.current);
      started = true;
      setBlocked(false);
      setPainted(true);
      setVoiceState("playing");
      onActivity(true);
    };
    const play = () => {
      if (disposed || done || pending || document.hidden || playing.current)
        return;
      if (!fits()) {
        finish();
        return;
      }
      if (!output) {
        unavailable();
        return;
      }
      pending = true;
      // Invoke both operations inside the tap. The embedded audio and picture
      // then share one decoder clock; there is no MP3 offset or drift restart.
      const unlocked = unlockAudio();
      video.muted = false;
      video.volume = 1;
      video.playbackRate = 1;
      setVoiceState("loading");
      void Promise.all([unlocked, video.play()])
        .then(() => {
          if (disposed || done || document.hidden) return;
          if (!dealerAudioUnlocked()) unavailable();
          else syncVoice();
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            unavailable();
        })
        .finally(() => {
          pending = false;
        });
    };
    retry.current = play;
    const waiting = () => {
      if (disposed || done) return;
      stopVoice();
      setVoiceState("buffering");
      // Keep the last speaking frame and keep music quiet until both resume.
      if (started) onActivity(true);
    };
    const pause = () => {
      stopVoice();
      if (!disposed && !done && !video.ended && !document.hidden) {
        setBlocked(true);
        setVoiceState("blocked");
      }
    };
    const hidden = () => {
      if (document.hidden) {
        stopVoice();
        video.pause();
      }
    };
    const checkOutput = () => {
      // A phone can suspend Web Audio independently of the media element.
      // Freeze the mouth as well and resume both from this frame on a tap.
      if (playing.current && !dealerAudioUnlocked()) unavailable();
      else if (!fits()) finish();
    };
    video.currentTime = 0;
    const deadline = window.setTimeout(finish, Math.max(0, remaining()));
    video.addEventListener("canplay", play);
    video.addEventListener("playing", syncVoice);
    video.addEventListener("seeked", syncVoice);
    video.addEventListener("seeking", stopVoice);
    video.addEventListener("waiting", waiting);
    video.addEventListener("pause", pause);
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    video.addEventListener("timeupdate", checkOutput);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pointerdown", play, true);
    window.addEventListener("keydown", play, true);
    play();
    return () => {
      disposed = true;
      window.clearTimeout(deadline);
      stopVoice();
      output?.disconnect();
      playback.current = null;
      retry.current = () => {};
      video.removeEventListener("canplay", play);
      video.removeEventListener("playing", syncVoice);
      video.removeEventListener("seeked", syncVoice);
      video.removeEventListener("seeking", stopVoice);
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("pause", pause);
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      video.removeEventListener("timeupdate", checkOutput);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pointerdown", play, true);
      window.removeEventListener("keydown", play, true);
      video.pause();
      video.muted = true;
      if (started) onFinish(eventKey);
      else onActivity(false);
    };
  }, [clip, eventKey, onActivity, onFinish, remaining, retry]);
  return (
    <>
      {/* Native soundtrack is routed once through the game's unlocked context. */}
      <video
        ref={ref}
        className={`od-dealer-speech ${clip && painted && motionEnabled ? "od-speech-visible" : ""}`}
        // Preload the current line even while muted, ready for the sound tap.
        src={sourceClip ? `${MEDIA}commentary/${sourceClip.file}` : undefined}
        playsInline
        muted
        preload="auto"
        aria-label={clip?.transcript}
        aria-hidden={!clip || !motionEnabled}
        data-testid={clip ? "od-dealer-speech" : undefined}
        data-event={clip ? eventKey : undefined}
        data-voice-state={voiceState}
        data-audio-path="native-media"
      />
      {clip && blocked && (
        <button
          type="button"
          className="od-enable-voice"
          aria-label="Enable dealer voice"
          onClick={() => retry.current()}
        >
          Tap for dealer voice
        </button>
      )}
    </>
  );
}

function StudioMusic({
  enabled,
  volume,
  speaking,
  retry,
}: {
  enabled: boolean;
  volume: number;
  speaking: boolean;
  retry: RefObject<() => void>;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const attach = useCallback((node: HTMLAudioElement | null) => {
    ref.current = node;
    if (node) node.volume = 0;
  }, []);
  const allowed = useRef(enabled && !speaking);
  allowed.current = enabled && !speaking;
  useEffect(() => {
    const audio = ref.current!;
    let disposed = false;
    const play = () => {
      if (disposed || !allowed.current || document.hidden) return;
      void audio
        .play()
        .then(() => {
          if (disposed || !allowed.current || document.hidden) audio.pause();
        })
        .catch(() => {});
    };
    retry.current = play;
    if (allowed.current) play();
    else {
      audio.volume = 0;
      audio.pause();
    }
    window.addEventListener("pointerdown", play, true);
    window.addEventListener("keydown", play, true);
    return () => {
      disposed = true;
      retry.current = () => {};
      audio.pause();
      window.removeEventListener("pointerdown", play, true);
      window.removeEventListener("keydown", play, true);
    };
  }, [enabled, speaking, retry]);
  useEffect(() => {
    const audio = ref.current!;
    const target = enabled && !speaking ? Math.max(0, Math.min(1, volume)) : 0;
    const from = audio.volume;
    const startedAt = performance.now();
    let frame = 0;
    const fade = () => {
      const progress = Math.min(
        1,
        (performance.now() - startedAt) / (speaking ? 100 : 650),
      );
      audio.volume = from + (target - from) * progress;
      if (progress < 1) frame = requestAnimationFrame(fade);
    };
    if (!enabled) audio.volume = 0;
    else frame = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frame);
  }, [enabled, volume, speaking]);
  return (
    <audio
      ref={attach}
      src={`${MEDIA}studio-lounge.mp3`}
      preload="none"
      loop
      aria-hidden="true"
      data-testid="od-studio-music"
      data-ducked={speaking}
    />
  );
}
