import { useEffect, useRef, type RefObject } from "react";
import { playDealerAudio, preloadDealerAudio } from "@/game/audio";
import voice from "@/assets/dragon-tiger/zara-invitation-voice.mp3";

export { voice as dealerVoiceUrl };

/** The original film's voice, played through the audio context unlocked by a tap. */
export default function DealerVoice({
  enabled,
  volume,
  video,
  onDone,
}: {
  enabled: boolean;
  volume: number;
  video?: RefObject<HTMLVideoElement | null>;
  onDone?: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!enabled || volume <= 0) return;
    const film = video?.current;
    let disposed = false;
    let loaded = false;
    let playback: ReturnType<typeof playDealerAudio> = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      playback?.stop();
      playback = null;
      clearTimeout(timer);
    };
    const sync = () => {
      stop();
      if (
        disposed ||
        !loaded ||
        document.hidden ||
        (film &&
          (film.paused || film.seeking || film.ended || film.readyState < 3))
      )
        return;
      const offset = film?.currentTime ?? 0;
      const duration = Math.max(0, 8.05 - offset);
      playback = playDealerAudio(
        voice,
        offset,
        duration,
        film?.playbackRate ?? 1,
        volume,
      );
      if (!film && playback)
        timer = setTimeout(() => done.current?.(), duration * 1000);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    const startEvents = ["playing", "seeked", "ratechange"];
    const stopEvents = ["pause", "waiting", "seeking", "ended", "error"];
    for (const event of startEvents) film?.addEventListener(event, sync);
    for (const event of stopEvents) film?.addEventListener(event, stop);
    document.addEventListener("visibilitychange", visibility);
    void preloadDealerAudio(voice).then(() => {
      loaded = true;
      sync();
    });
    return () => {
      disposed = true;
      stop();
      for (const event of startEvents) film?.removeEventListener(event, sync);
      for (const event of stopEvents) film?.removeEventListener(event, stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, volume, video]);
  return null;
}
