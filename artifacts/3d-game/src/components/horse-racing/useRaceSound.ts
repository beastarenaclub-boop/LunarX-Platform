import { useEffect, useRef } from "react";
import { useStore } from "@/game/store";
export function useRaceSound(
  enabled: boolean,
  running: boolean,
  finished: boolean,
  seed: string,
) {
  const master = useStore(s => s.settings.masterVolume);
  const effects = useStore(s => s.settings.sfxVolume);
  const latest = useRef({ enabled, running, finished, seed, volume: master * effects });
  latest.current = { enabled, running, finished, seed, volume: master * effects };
  const sync = useRef<() => void>(() => {});
  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const crowd = new Audio(`${base}assets/horse-racing/crowd.mp3`);
    const hooves = new Audio(`${base}assets/horse-racing/hooves.mp3`);
    crowd.loop = hooves.loop = true;
    let lastFinish = "", cheeringUntil = 0;
    const update = () => {
      const s = latest.current;
      if (s.finished && lastFinish !== s.seed) {
        lastFinish = s.seed;
        cheeringUntil = s.enabled && !document.hidden ? Date.now() + 2500 : 0;
      }
      if (!s.enabled || document.hidden || s.volume <= 0) {
        crowd.pause(); hooves.pause(); cheeringUntil = 0; return;
      }
      crowd.volume = (s.running ? .17 : .4) * s.volume;
      hooves.volume = .6 * s.volume;
      if (s.running) {
        hooves.playbackRate = .97 + ((s.seed.charCodeAt(0) || 0) % 8) / 100;
        if (hooves.paused) void hooves.play().catch(() => {});
      } else hooves.pause();
      if (s.running || Date.now() < cheeringUntil) {
        if (crowd.paused) void crowd.play().catch(() => {});
      } else crowd.pause();
    };
    sync.current = update;
    const timer = window.setInterval(update, 200);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pointerdown", update);
    window.addEventListener("keydown", update);
    update();
    return () => {
      clearInterval(timer);
      sync.current = () => {};
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pointerdown", update);
      window.removeEventListener("keydown", update);
      for (const audio of [crowd, hooves]) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);
  useEffect(() => { sync.current(); }, [enabled, running, finished, seed, master, effects]);
}
