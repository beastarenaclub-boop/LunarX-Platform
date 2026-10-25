import { useCallback, useEffect, useRef, useState } from "react";
import type { LudoMatch } from "@workspace/api-zod/ludo";
type Mixer = {
  ctx: AudioContext;
  sound: GainNode;
  music: GainNode;
  noise: AudioBuffer;
  voices: Set<AudioScheduledSourceNode>;
};

/** Original, locally synthesized game audio. No downloads or copyrighted recordings. */
export function useLudoAudio(
  userId: string,
  match?: LudoMatch | null,
  clock = Date.now(),
) {
  const key = `ludo-audio:${userId}`;
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      return { sound: saved?.sound !== false, music: saved?.music === true };
    } catch {
      return { sound: true, music: false };
    }
  });
  const preferences = useRef(settings);
  preferences.current = settings;
  const mixer = useRef<Mixer | null>(null);
  const ensure = useCallback(() => {
    try {
      if (!mixer.current) {
        const Audio =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!Audio) return;
        const ctx = new Audio(),
          sound = ctx.createGain(),
          music = ctx.createGain();
        sound.gain.value = preferences.current.sound ? 0.6 : 0;
        music.gain.value = preferences.current.music ? 0.16 : 0;
        sound.connect(ctx.destination);
        music.connect(ctx.destination);
        const noise = ctx.createBuffer(
            1,
            Math.ceil(ctx.sampleRate * 0.15),
            ctx.sampleRate,
          ),
          samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
        mixer.current = { ctx, sound, music, noise, voices: new Set() };
      }
      if (mixer.current.ctx.state === "suspended")
        void mixer.current.ctx.resume().catch(() => {});
    } catch {
      /* Audio remains optional on unsupported browsers. */
    }
  }, []);
  const tone = useCallback(
    (
      frequency: number,
      duration: number,
      volume: number,
      delay = 0,
      music = false,
      type: OscillatorType = "sine",
    ) => {
      const m = mixer.current;
      if (!m || m.ctx.state !== "running" || document.hidden) return;
      const oscillator = m.ctx.createOscillator(),
        gain = m.ctx.createGain(),
        at = m.ctx.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, at);
      if (!music)
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 0.74,
          at + duration,
        );
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(music ? m.music : m.sound);
      m.voices.add(oscillator);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.015);
      oscillator.onended = () => {
        m.voices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
    },
    [],
  );
  const tap = useCallback((delay: number, pitch = 1000, volume = 0.2) => {
    const m = mixer.current;
    if (!m || m.ctx.state !== "running" || document.hidden) return;
    const source = m.ctx.createBufferSource(),
      filter = m.ctx.createBiquadFilter(),
      gain = m.ctx.createGain(),
      at = m.ctx.currentTime + delay;
    source.buffer = m.noise;
    filter.type = "bandpass";
    filter.frequency.value = pitch;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.065);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(m.sound);
    m.voices.add(source);
    source.start(at);
    source.stop(at + 0.07);
    source.onended = () => {
      m.voices.delete(source);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }, []);
  const roll = useCallback(() => {
    ensure();
    if (!preferences.current.sound) return;
    [0, 0.045, 0.1, 0.16, 0.23, 0.31, 0.4, 0.5, 0.58].forEach((delay, i) => {
      tap(delay, [850, 1500, 1100, 1900][i % 4], 0.34 - i * 0.018);
      tone(220 + (i % 3) * 60, 0.045, 0.09, delay, false, "triangle");
    });
  }, [ensure, tap, tone]);
  const land = useCallback(
    (value: number) => {
      if (!preferences.current.sound) return;
      tap(0, 780, 0.42);
      tone(170, 0.13, 0.22, 0, false, "triangle");
      if (value === 6)
        [660, 880, 1100].forEach((n, i) =>
          tone(n, 0.16, 0.1, 0.08 + i * 0.075),
        );
    },
    [tap, tone],
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {}
    const m = mixer.current;
    if (m) {
      m.sound.gain.setTargetAtTime(
        settings.sound ? 0.6 : 0,
        m.ctx.currentTime,
        0.008,
      );
      m.music.gain.setTargetAtTime(
        settings.music ? 0.16 : 0,
        m.ctx.currentTime,
        0.025,
      );
    }
  }, [key, settings]);
  useEffect(() => {
    if (!settings.music) return;
    const notes = [
      523, 0, 659, 784, 0, 659, 587, 0, 523, 659, 0, 880, 784, 0, 659, 587,
    ];
    let step = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const note = notes[step % notes.length];
      if (note) {
        tone(note, 0.32, 0.22, 0, true);
        tone(note * 2, 0.16, 0.04, 0, true);
      }
      if (step % 4 === 0)
        tone(
          [131, 165, 147, 175][Math.floor(step / 4) % 4],
          0.7,
          0.24,
          0,
          true,
        );
      step++;
    }, 280);
    return () => window.clearInterval(timer);
  }, [settings.music, tone]);
  useEffect(() => {
    const visibility = () => {
      const ctx = mixer.current?.ctx;
      if (document.hidden && ctx?.state === "running") {
        for (const source of mixer.current!.voices) {
          try {
            source.stop();
          } catch {}
        }
        void ctx.suspend().catch(() => {});
      } else if (!document.hidden && ctx?.state === "suspended")
        void ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      void mixer.current?.ctx.close().catch(() => {});
      mixer.current = null;
    };
  }, []);
  const previous = useRef<LudoMatch | null>(null);
  useEffect(() => {
    const old = previous.current;
    previous.current = match ?? null;
    if (
      !match ||
      !old ||
      old.id !== match.id ||
      old.version === match.version ||
      !settings.sound ||
      document.hidden
    )
      return;
    const last = match.state.last;
    if (old.state.winner === null && match.state.winner === match.you) {
      [523, 659, 784, 1047].forEach((n, i) => tone(n, 0.45, 0.22, i * 0.13));
      return;
    }
    if (last?.token !== undefined) {
      const before = old.state.players[last.seat]?.tokens[last.token],
        after = match.state.players[last.seat]?.tokens[last.token];
      if (before !== undefined && after !== undefined && before !== after) {
        const steps = Math.min(6, before < 0 ? 1 : Math.max(1, after - before));
        for (let i = 0; i < steps; i++) {
          tap(i * 0.085, 1200, 0.22);
          tone(420 + i * 35, 0.055, 0.13, i * 0.085, false, "triangle");
        }
        if (last.captured) {
          tone(190, 0.28, 0.22, 0.12, false, "triangle");
          tone(125, 0.3, 0.2, 0.22);
        } else if (after === 56)
          [660, 880, 1320].forEach((n, i) =>
            tone(n, 0.25, 0.16, 0.14 + i * 0.1),
          );
      }
    }
    if (
      match.status === "playing" &&
      match.state.turn === match.you &&
      (old.state.turn !== match.you || old.status === "waiting")
    ) {
      tone(660, 0.13, 0.1, 0.1);
      tone(880, 0.18, 0.12, 0.24);
    }
  }, [match?.id, match?.version, settings.sound, tap, tone]);
  const remaining = match
    ? Math.max(0, Math.ceil((match.deadline - clock) / 1000))
    : 0;
  useEffect(() => {
    if (
      settings.sound &&
      match?.status === "playing" &&
      match.state.turn === match.you &&
      remaining > 0 &&
      remaining <= 5
    )
      tone(1000, 0.035, 0.065);
  }, [remaining, match?.id, match?.state.turn, settings.sound, tone]);
  return {
    ...settings,
    roll,
    land,
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
