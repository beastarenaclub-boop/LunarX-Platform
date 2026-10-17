import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectDealerMedia, dealerAudioUnlocked, playGameSound, preloadDealerAudio,
  preloadTableAudio, sfx, subscribeAudioState, unlockAudio,
} from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import { installAudioAutostart } from "@/game/audioAutostart";
import type { TableRoundState } from "@/components/table/useTableRound";
import { orderedCards, type StudioDeal } from "./studioTimeline";
import { BACCARAT_AUDIO_ROOT, BaccaratNarrator, commentaryLines, resultCommentary } from "./commentary";

function preference<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof value === typeof fallback ? value : fallback;
  } catch { return fallback; }
}

export function useBaccaratAudio(round: TableRoundState<StudioDeal>, deal: StudioDeal | null, count: number, available: boolean) {
  const settings = useStore(s => s.settings);
  const [commentary, setCommentary] = useState(() => preference("baccarat:commentary", true));
  const [voiceVolume, setVoiceVolume] = useState(() => Math.max(0, Math.min(1, preference("baccarat:voice-volume", .9))));
  const [audioState, setAudioState] = useState<AudioContextState | "unsupported">("suspended");
  const [blocked, setBlocked] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const element = useRef<HTMLAudioElement>(null);
  const graph = useRef<ReturnType<typeof connectDealerMedia>>(null);
  const narrator = useRef<BaccaratNarrator | null>(null);
  const speaking = useRef(false);
  const disposed = useRef(false);
  const latest = useRef({ settings, commentary, voiceVolume, available });
  latest.current = { settings, commentary, voiceVolume, available };

  const syncMusic = useCallback(() => {
    const audio = element.current;
    const s = latest.current;
    if (!audio || disposed.current) return;
    const volume = s.settings.masterVolume * s.settings.musicVolume * (speaking.current ? .24 : 1);
    const audible = dealerAudioUnlocked() && s.settings.sound && s.settings.music && s.available && !document.hidden && volume > 0;
    graph.current?.setVolume(audible ? volume : 0);
    // A Web Audio media gain keeps volume/muting functional on mobile Safari.
    if (!audible || !graph.current) audio.pause();
    else if (audio.paused) void audio.play().then(() => {
      if (!disposed.current) setBlocked(false);
    }).catch(error => {
      if (!disposed.current && error?.name === "NotAllowedError") setBlocked(true);
    });
  }, []);

  const activate = useCallback((force = false) => {
    if (force) {
      const current = latest.current.settings;
      const next = { sound: true, masterVolume: current.masterVolume || .7, sfxVolume: current.sfxVolume || .8 };
      latest.current.settings = { ...current, ...next };
      updateSettings(next);
    }
    if (!latest.current.settings.sound) return;
    void unlockAudio().then(() => {
      if (disposed.current) return;
      if (dealerAudioUnlocked()) setAudioState("running");
      syncMusic();
    });
    syncMusic();
  }, [syncMusic]);

  useEffect(() => {
    disposed.current = false;
    const audio = element.current;
    graph.current = audio ? connectDealerMedia(audio) : null;
    narrator.current = new BaccaratNarrator(next => {
      speaking.current = next !== null;
      if (!disposed.current) setLine(next);
      syncMusic();
    });
    void preloadTableAudio();
    for (const key of Object.keys(commentaryLines)) void preloadDealerAudio(`${BACCARAT_AUDIO_ROOT}${key}.mp3`);
    const unsubscribe = subscribeAudioState(state => {
      setAudioState(state);
      if (state !== "running") narrator.current?.stop();
      syncMusic();
    });
    const visibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) narrator.current?.stop();
      syncMusic();
    };
    const stopAutostart = installAudioAutostart(() => activate());
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed.current = true;
      unsubscribe();
      stopAutostart();
      document.removeEventListener("visibilitychange", visibility);
      narrator.current?.stop();
      narrator.current = null;
      audio?.pause();
      graph.current?.disconnect();
      graph.current = null;
    };
  }, [activate, syncMusic]);

  useEffect(() => {
    const volume = settings.sound && commentary && available ? settings.masterVolume * voiceVolume : 0;
    narrator.current?.setVolume(volume);
    if (!volume) narrator.current?.stop();
    syncMusic();
    try {
      localStorage.setItem("baccarat:commentary", JSON.stringify(commentary));
      localStorage.setItem("baccarat:voice-volume", JSON.stringify(voiceVolume));
    } catch { /* Preferences are optional when storage is unavailable. */ }
  }, [settings, commentary, voiceVolume, available, syncMusic]);

  const seen = useRef(new Set<string>());
  const scope = useRef("");
  const lastCard = useRef({ roundId: round.roundId, count: 0 });
  const lastTick = useRef("");
  useEffect(() => {
    const id = round.roundId;
    const currentScope = `${id}:${round.phase === "betting" ? "betting" : "deal"}`;
    if (scope.current !== currentScope) {
      scope.current = currentScope;
      narrator.current?.stop();
      seen.current.clear();
    }
    const audible = available && settings.sound && settings.masterVolume > 0 && audioState === "running" && visible;
    const previous = lastCard.current;
    if (audible && round.phase === "reveal" && previous.roundId === id && count === previous.count + 1) sfx.baccaratCardPlace(count - 1);
    lastCard.current = { roundId: id, count };
    const seconds = Math.ceil(round.remainingMs / 1000);
    const tick = `${id}:${seconds}`;
    if (round.phase === "betting" && seconds > 0 && seconds <= 5 && tick !== lastTick.current) {
      lastTick.current = tick;
      if (audible) playGameSound("tick", "baccarat", .36);
    }
    if (!id || !round.phase || !audible || !commentary || voiceVolume <= 0) return;
    let cue = "";
    let clips: string[] = [];
    const complete = deal && count >= orderedCards(deal).length;
    const resultTime = round.remainingMs + (round.phase === "reveal" ? round.config?.settleDurationMs ?? 6000 : 0);
    if (round.phase !== "betting" && complete && resultTime > 1200) {
      cue = "result";
      clips = resultCommentary(deal, resultTime < 6500);
    } else if (round.phase === "betting" && round.remainingMs > 6000) {
      cue = "open";
      clips = [cue];
    } else if (round.phase === "betting" && seconds <= 5 && seconds >= 2) {
      cue = "closing";
      clips = [cue];
    } else if (round.phase === "reveal" && count === 0 && (round.phaseDurationMs ?? 0) - round.remainingMs < 1500) {
      cue = "closed";
      clips = [cue];
    }
    if (!cue || seen.current.has(cue)) return;
    seen.current.add(cue);
    const deadline = Date.now() + (cue === "result" ? resultTime : Math.min(4000, round.remainingMs));
    void narrator.current?.speak(clips, deadline);
  }, [round.roundId, round.phase, round.remainingMs, round.phaseDurationMs, round.config?.settleDurationMs, deal, count, available, settings.sound, settings.masterVolume, audioState, visible, commentary, voiceVolume]);

  const toggleSound = () => {
    if (settings.sound && settings.masterVolume > 0 && audioState === "running" && !blocked) updateSettings({ sound: false });
    else activate(true);
  };
  return {
    element, musicUrl: `${BACCARAT_AUDIO_ROOT}vip-lounge.mp3`, musicPlaying, setMusicPlaying,
    settings, commentary, setCommentary, voiceVolume, setVoiceVolume, line, audioState,
    needsTap: settings.sound && audioState !== "unsupported" && (audioState !== "running" || blocked),
    activate, toggleSound,
  };
}
