import { useEffect, useRef } from "react";
import { installAudioAutostart } from "@/game/audioAutostart";

/** Keep the table's quiet music bed independent of the round/video clock. */
export function useTableMusic(enabled: boolean) {
  const music = useRef<HTMLAudioElement>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;

  useEffect(() => {
    const element = music.current;
    if (!element) return;
    element.volume = 0.16;
    const sync = () => {
      if (!allowed.current || document.hidden) {
        element.pause();
      } else if (element.paused) {
        // Browsers can require the first tap before audible playback. Retry
        // on that gesture, without interrupting a bet or the dealer's video.
        void element.play().catch(() => {});
      }
    };
    const stopAutostart = installAudioAutostart(sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stopAutostart();
      document.removeEventListener("visibilitychange", sync);
      element.pause();
    };
  }, []);

  useEffect(() => {
    const element = music.current;
    if (!element) return;
    if (enabled && !document.hidden) void element.play().catch(() => {});
    else element.pause();
  }, [enabled]);

  return music;
}
