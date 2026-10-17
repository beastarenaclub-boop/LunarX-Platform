import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_UNLOCK_GRACE_MS, GameSoundBank, type GameAudioId, type GameSoundCue } from "./gameSoundDesign";
import { installAudioAutostart } from "./audioAutostart";

export interface GameAudioBridge {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  play: (cue: GameSoundCue) => void;
}

/** Standalone games own a context; embedded games use the casino's volume/mute bus. */
export function useStandaloneGameAudio(game: GameAudioId, storageKey: string, bridge?: GameAudioBridge) {
  const [localEnabled, setLocalEnabled] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; }
  });
  const enabled = bridge?.enabled ?? localEnabled;
  const latest = useRef({ game, enabled, bridge });
  latest.current = { game, enabled, bridge };
  const engine = useRef<{ context: AudioContext; gain: GainNode; bank: GameSoundBank } | null>(null);
  const generation = useRef(0);
  const soundRequest = useRef(0);
  const music = useRef<AudioBufferSourceNode | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    engine.current?.bank.stop();
    try { music.current?.stop(); } catch { /* Already ended. */ }
    music.current = null;
  }, []);
  const startMusic = useCallback(() => {
    const audio = engine.current, state = latest.current, token = generation.current;
    if (!audio || state.bridge || !state.enabled || document.hidden || music.current || audio.context.state !== "running") return;
    void audio.bank.prepare(state.game, "music").then(ready => {
      if (!ready || engine.current !== audio || token !== generation.current || !latest.current.enabled || document.hidden || music.current) return;
      music.current = audio.bank.play(state.game, "music", audio.gain, .2, true);
    });
  }, []);
  const unlock = useCallback(() => {
    if (latest.current.bridge || !latest.current.enabled || document.hidden) return null;
    try {
      if (!engine.current) {
        const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Audio) return null;
        const context = new Audio(), gain = context.createGain();
        gain.gain.value = .65;
        gain.connect(context.destination);
        engine.current = { context, gain, bank: new GameSoundBank(context) };
        context.addEventListener("statechange", startMusic);
      }
      if (engine.current.context.state === "suspended") void engine.current.context.resume().then(startMusic).catch(() => {});
      startMusic();
      return engine.current;
    } catch { return null; }
  }, [startMusic]);
  const play = useCallback((cue: GameSoundCue) => {
    const state = latest.current;
    if (!state.enabled || document.hidden) return;
    if (state.bridge) { state.bridge.play(cue); return; }
    const audio = unlock();
    if (!audio) return;
    const token = generation.current, request = ++soundRequest.current, requestedAt = Date.now();
    const perform = () => {
      if (engine.current !== audio || token !== generation.current || request !== soundRequest.current || !latest.current.enabled || document.hidden || Date.now() - requestedAt > AUDIO_UNLOCK_GRACE_MS) return;
      audio.bank.play(state.game, cue, audio.gain);
    };
    if (audio.context.state === "running") perform();
    else void audio.context.resume().then(perform).catch(() => {});
  }, [unlock]);
  useEffect(() => {
    stop();
    if (enabled) unlock();
  }, [enabled, game, bridge !== undefined, stop, unlock]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) stop(); };
    const stopAutostart = installAudioAutostart(() => { unlock(); });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      stopAutostart();
      document.removeEventListener("visibilitychange", visibility);
      engine.current?.context.removeEventListener("statechange", startMusic);
      void engine.current?.context.close().catch(() => {});
      engine.current = null;
    };
  }, [unlock, startMusic, stop]);
  const toggle = () => {
    const next = !enabled;
    latest.current = { ...latest.current, enabled: next };
    if (!next) stop();
    if (bridge) bridge.setEnabled(next);
    else {
      setLocalEnabled(next);
      try { localStorage.setItem(storageKey, next ? "on" : "off"); } catch { /* Optional persistence. */ }
      if (next) unlock();
    }
  };
  return { enabled, toggle, play };
}
