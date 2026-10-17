import { useEffect, useRef } from "react";
import { BikeAudio } from "./audio";
import { store } from "@/game/store";
import { playGameSound } from "@/game/audio";
import { installAudioAutostart } from "@/game/audioAutostart";

export function useBikeSound(enabled: boolean, racing: boolean, finished: boolean, roundId: string) {
  const latest = useRef({ enabled, racing, finished, roundId });
  latest.current = { enabled, racing, finished, roundId };
  useEffect(() => {
    const audio = new BikeAudio();
    let lastFinish = "";
    const unlock = () => { if (latest.current.enabled) void audio.start(); };
    const stopAutostart = installAudioAutostart(unlock);
    const update = () => {
      const s = latest.current;
      const active = s.enabled && !document.hidden;
      const settings = store.getState().settings;
      audio.update(8000 + Math.sin(Date.now() / 900) * 2400, 55, active && settings.sound, s.racing, settings.masterVolume * settings.sfxVolume);
      if (s.finished && lastFinish !== s.roundId) { if (active) playGameSound("settle", "bike-racing"); lastFinish = s.roundId; }
    };
    const timer = window.setInterval(update, 120);
    const unsubscribe = store.subscribe(update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer); audio.dispose();
      unsubscribe();
      document.removeEventListener("visibilitychange", update);
      stopAutostart();
    };
  }, []);
}
