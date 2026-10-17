import { useEffect, useRef } from "react";
import { playSevenSound, preloadSevenAudio, startDiceShake, stopSevenTableAudio } from "@/game/audio";

type AudioRound = {
  id?: string; phase?: string; countdown: number; total?: number;
  enabled: boolean; fresh: boolean; rolling: boolean;
  slipId?: string; slipStatus?: string; payout: number; bot?: string;
};

/** Compare authoritative transitions; polling, settings and reconnects never replay old results. */
export function useSevenRoundAudio(round: AudioRound) {
  const previous = useRef<AudioRound | null>(null);
  const seen = useRef(new Set<string>());
  const sequence = [round.id, round.phase, round.countdown, round.total, round.slipId, round.slipStatus, round.bot, round.fresh, round.enabled].join(":");
  useEffect(() => { preloadSevenAudio(); return stopSevenTableAudio; }, []);
  useEffect(() => {
    if (!round.fresh || !round.id) return;
    const prev = previous.current;
    if (prev?.id !== round.id) seen.current.clear();
    const once = (key: string, cue: Parameters<typeof playSevenSound>[0], volume = 1) => {
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (round.enabled) playSevenSound(cue, volume);
    };
    if (prev && prev.id !== round.id && round.phase === "betting") once("open", "roundOpen", .75);
    if (round.phase === "betting" && round.countdown > 0 && round.countdown <= 3) once(`tick:${round.countdown}`, round.countdown === 1 ? "lastTick" : "tick", .65);
    if (prev?.id === round.id) {
      if (prev.phase === "betting" && round.phase === "reveal") once("lock", "lock", .7);
      if (prev.total === undefined && round.total !== undefined) {
        once("land", "land", .8);
        once("result", round.total < 7 ? "down" : round.total === 7 ? "seven" : "up", .7);
      }
      if (round.slipStatus === "settled" && prev.slipStatus === "pending" && round.slipId === prev.slipId) {
        once(`paid:${round.slipId}`, round.payout > 0 ? "win" : "lose", round.payout > 0 ? .9 : .55);
      }
      if (round.phase === "betting" && round.countdown > 3 && round.bot && round.bot !== prev.bot) once(`bot:${round.bot}`, "chip", .18);
    }
    previous.current = round;
  }, [sequence]);
  useEffect(() => {
    if (!round.rolling || !round.enabled || !round.fresh) return;
    let stop = () => {};
    const sync = () => { stop(); if (!document.hidden) stop = startDiceShake(); };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { stop(); document.removeEventListener("visibilitychange", sync); };
  }, [round.rolling, round.enabled, round.fresh, round.id]);
}
