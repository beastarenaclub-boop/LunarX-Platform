import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectDealerMedia,
  dealerAudioUnlocked,
  playGameSound,
  preloadTableAudio,
  sfx,
  subscribeAudioState,
  unlockAudio,
} from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import { installAudioAutostart } from "@/game/audioAutostart";
import type { TableRoundState } from "@/components/table/useTableRound";
import type { StudioDeal } from "./studioTimeline";

export function useBaccaratAudio(
  round: TableRoundState<StudioDeal>,
  count: number,
  available: boolean,
) {
  const settings = useStore((s) => s.settings);
  const [audioState, setAudioState] = useState<
    AudioContextState | "unsupported"
  >("suspended");
  const [blocked, setBlocked] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const element = useRef<HTMLAudioElement>(null);
  const graph = useRef<ReturnType<typeof connectDealerMedia>>(null);
  const disposed = useRef(false);
  const latest = useRef({ settings, available });
  latest.current = { settings, available };

  const syncMusic = useCallback(() => {
    const audio = element.current;
    const s = latest.current;
    if (!audio || disposed.current) return;
    const volume = s.settings.masterVolume * s.settings.musicVolume;
    const audible =
      dealerAudioUnlocked() &&
      s.settings.sound &&
      s.settings.music &&
      s.available &&
      !document.hidden &&
      volume > 0;
    graph.current?.setVolume(audible ? volume : 0);
    // A Web Audio media gain keeps volume/muting functional on mobile Safari.
    if (!audible || !graph.current) audio.pause();
    else if (audio.paused)
      void audio
        .play()
        .then(() => {
          if (!disposed.current) setBlocked(false);
        })
        .catch((error) => {
          if (!disposed.current && error?.name === "NotAllowedError")
            setBlocked(true);
        });
  }, []);

  const activate = useCallback(
    (force = false) => {
      if (force) {
        const current = latest.current.settings;
        const next = {
          sound: true,
          masterVolume: current.masterVolume || 0.7,
          sfxVolume: current.sfxVolume || 0.8,
        };
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
    },
    [syncMusic],
  );

  useEffect(() => {
    disposed.current = false;
    const audio = element.current;
    graph.current = audio ? connectDealerMedia(audio) : null;
    void preloadTableAudio();
    const unsubscribe = subscribeAudioState((state) => {
      setAudioState(state);
      syncMusic();
    });
    const visibility = () => {
      setVisible(!document.hidden);
      syncMusic();
    };
    const stopAutostart = installAudioAutostart(() => activate());
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed.current = true;
      unsubscribe();
      stopAutostart();
      document.removeEventListener("visibilitychange", visibility);
      audio?.pause();
      graph.current?.disconnect();
      graph.current = null;
    };
  }, [activate, syncMusic]);

  useEffect(() => {
    syncMusic();
  }, [settings, available, syncMusic]);

  const lastCard = useRef({ roundId: round.roundId, count: 0 });
  const lastTick = useRef("");
  useEffect(() => {
    const id = round.roundId;
    const audible =
      available &&
      settings.sound &&
      settings.masterVolume > 0 &&
      audioState === "running" &&
      visible;
    const previous = lastCard.current;
    if (
      audible &&
      round.phase === "reveal" &&
      previous.roundId === id &&
      count === previous.count + 1
    )
      sfx.baccaratCardPlace(count - 1);
    lastCard.current = { roundId: id, count };
    const seconds = Math.ceil(round.remainingMs / 1000);
    const tick = `${id}:${seconds}`;
    if (
      round.phase === "betting" &&
      seconds > 0 &&
      seconds <= 5 &&
      tick !== lastTick.current
    ) {
      lastTick.current = tick;
      if (audible) playGameSound("tick", "baccarat", 0.36);
    }
  }, [
    round.roundId,
    round.phase,
    round.remainingMs,
    count,
    available,
    settings.sound,
    settings.masterVolume,
    audioState,
    visible,
  ]);

  const toggleSound = () => {
    if (
      settings.sound &&
      settings.masterVolume > 0 &&
      audioState === "running" &&
      !blocked
    )
      updateSettings({ sound: false });
    else activate(true);
  };
  return {
    element,
    musicUrl: `${import.meta.env.BASE_URL}media/baccarat/audio/vip-lounge.mp3`,
    musicPlaying,
    setMusicPlaying,
    settings,
    audioState,
    needsTap:
      settings.sound &&
      audioState !== "unsupported" &&
      (audioState !== "running" || blocked),
    activate,
    toggleSound,
  };
}
