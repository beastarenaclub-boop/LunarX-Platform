import { useCallback, useEffect, useRef, useState } from "react";
import type { LudoMatch } from "@workspace/api-zod/ludo";

export function useLudoAudio(userId: string, match?: LudoMatch | null) {
  const key = `ludo-audio:${userId}`;
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      return { sound: saved?.sound !== false, music: saved?.music === true };
    } catch {
      return { sound: true, music: false };
    }
  });
  const context = useRef<AudioContext | null>(null);
  const ensure = useCallback(() => {
    try {
      if (!context.current) {
        const Audio =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (Audio) context.current = new Audio();
      }
      if (context.current?.state === "suspended")
        void context.current.resume().catch(() => {});
    } catch {
      /* Sound is optional on browsers that block Web Audio. */
    }
  }, []);
  const tone = useCallback(
    (frequency: number, duration: number, volume: number, delay = 0) => {
      const ctx = context.current;
      if (!ctx || ctx.state !== "running" || document.hidden) return;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain(),
        at = ctx.currentTime + delay;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.01);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {}
  }, [key, settings]);
  useEffect(() => {
    if (!settings.music) return;
    const notes = [262, 330, 392, 330, 294, 349, 440, 349];
    let step = 0;
    const timer = window.setInterval(
      () => tone(notes[step++ % notes.length], 0.35, 0.018),
      480,
    );
    return () => window.clearInterval(timer);
  }, [settings.music, tone]);
  useEffect(
    () => () => {
      void context.current?.close().catch(() => {});
      context.current = null;
    },
    [],
  );
  const previous = useRef<{ id: string; version: number; roll: number } | null>(
    null,
  );
  useEffect(() => {
    if (!match) return;
    const last = previous.current;
    previous.current = {
      id: match.id,
      version: match.version,
      roll: match.state.rollNonce,
    };
    if (
      !settings.sound ||
      !last ||
      last.id !== match.id ||
      last.version === match.version
    )
      return;
    if (match.state.winner === match.you)
      [523, 659, 784].forEach((n, i) => tone(n, 0.3, 0.06, i * 0.12));
    else if (match.state.rollNonce > last.roll)
      [170, 230, 310].forEach((n, i) => tone(n, 0.06, 0.045, i * 0.045));
    else if (match.state.last?.token !== undefined)
      tone(match.state.last.captured ? 440 : 660, 0.12, 0.05);
  }, [match?.id, match?.version, settings.sound, tone]);
  return {
    ...settings,
    unlock: () => {
      if (settings.sound || settings.music) ensure();
    },
    toggleSound: () => {
      ensure();
      setSettings((s) => ({ ...s, sound: !s.sound }));
    },
    toggleMusic: () => {
      ensure();
      setSettings((s) => ({ ...s, music: !s.music }));
    },
  };
}
