import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dealerAudioUnlocked, sfx, unlockAudio } from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import { installAudioAutostart } from "@/game/audioAutostart";
import musicUrl from "@/assets/audio/teenpatti/lounge-jazz.mp3?url";
import ambienceUrl from "@/assets/audio/teenpatti/casino-room.mp3?url";
import type { DealAudio } from "./tableDealAudio";

function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

/** This table owns its jazz/room mix and attempts playback as soon as it opens. */
export function useTeenPattiAudio() {
  const settings = useStore((s) => s.settings);
  const [music, setMusic] = useState(() => saved("teen-patti:music", true));
  const [ambience, setAmbience] = useState(() =>
    saved("teen-patti:ambience", true),
  );
  const [volume, setVolume] = useState(() =>
    Math.max(0, Math.min(1, saved("teen-patti:music-volume", 0.35))),
  );
  const [unlocked, setUnlocked] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const element = useRef<HTMLAudioElement>(null);
  const ambienceElement = useRef<HTMLAudioElement>(null);
  const openingCards = useRef(false);
  const disposed = useRef(false);
  const enabled = useRef(false);
  const latest = useRef({ settings, music, volume, ambience });
  latest.current = { settings, music, volume, ambience };

  const sync = useCallback(() => {
    const state = latest.current;
    const audible = enabled.current && state.settings.sound && !document.hidden;
    const duck = openingCards.current ? 0.55 : 1;
    const layers = [
      {
        audio: element.current,
        active: state.music,
        level: state.settings.masterVolume * state.volume * 0.75 * duck,
      },
      {
        audio: ambienceElement.current,
        active: state.ambience,
        level:
          state.settings.masterVolume * state.settings.sfxVolume * 0.65 * duck,
      },
    ];
    for (const { audio, active, level } of layers) {
      if (!audio) continue;
      audio.volume = Math.max(0, Math.min(1, level));
      if (!audible || !active || !level) audio.pause();
      else
        void audio.play().catch(() => {
          if (audio === element.current && !disposed.current)
            setMusicPlaying(false);
        });
    }
  }, []);

  const enableAudio = useCallback(
    (force = false) => {
      if (force) {
        const { masterVolume, sfxVolume } = latest.current.settings;
        updateSettings({
          sound: true,
          masterVolume: masterVolume || 0.7,
          sfxVolume: sfxVolume || 0.8,
        });
        latest.current.settings = {
          ...latest.current.settings,
          sound: true,
          masterVolume: masterVolume || 0.7,
          sfxVolume: sfxVolume || 0.8,
        };
      }
      if (!latest.current.settings.sound) return;
      enabled.current = true;
      void unlockAudio().then(() => {
        if (!disposed.current) setUnlocked(dealerAudioUnlocked());
      });
      // play() must be invoked in the gesture, not after resume() resolves.
      sync();
    },
    [sync],
  );

  useEffect(() => {
    disposed.current = false;
    const audio = element.current;
    const room = ambienceElement.current;
    const hide = () => sync();
    document.addEventListener("visibilitychange", hide);
    const stopAutostart = installAudioAutostart(() => enableAudio());
    return () => {
      disposed.current = true;
      stopAutostart();
      audio?.pause();
      room?.pause();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [sync, enableAudio]);

  useEffect(() => {
    try {
      localStorage.setItem("teen-patti:music", JSON.stringify(music));
      localStorage.setItem("teen-patti:music-volume", JSON.stringify(volume));
      localStorage.setItem("teen-patti:ambience", JSON.stringify(ambience));
    } catch {
      /* Storage is optional. */
    }
    sync();
  }, [
    settings.sound,
    settings.masterVolume,
    settings.sfxVolume,
    music,
    volume,
    ambience,
    sync,
  ]);

  const toggleSound = () => {
    if (settings.sound && unlocked) updateSettings({ sound: false });
    else enableAudio(true);
  };
  const toggleMusic = () => {
    const next = !music;
    latest.current.music = next;
    setMusic(next);
    if (next) enableAudio(true);
    else sync();
  };
  const toggleAmbience = () => {
    const next = !ambience;
    latest.current.ambience = next;
    setAmbience(next);
    if (next) enableAudio(true);
    else sync();
  };
  const dealAudio = useMemo<DealAudio>(
    () => ({
      onShuffle: () => {
        if (latest.current.settings.sound) sfx.teenPattiShuffle();
      },
      onCardDeal: (index) => {
        if (latest.current.settings.sound) sfx.teenPattiCardPlace(index);
      },
      onDealStart: () => {
        openingCards.current = true;
        sync();
      },
      onCardLand: (index) => {
        if (latest.current.settings.sound) sfx.teenPattiCardPlace(index);
      },
      onCardFlip: (index) => {
        if (latest.current.settings.sound) sfx.teenPattiCardLift(index);
      },
      onReveal: () => {
        openingCards.current = false;
        sync();
      },
    }),
    [sync],
  );

  return {
    element,
    musicUrl,
    ambienceElement,
    ambienceUrl,
    ambience,
    toggleAmbience,
    sound: settings.sound,
    music,
    volume,
    setVolume,
    unlocked,
    musicPlaying,
    setMusicPlaying,
    enableAudio,
    toggleSound,
    toggleMusic,
    dealAudio,
  };
}
