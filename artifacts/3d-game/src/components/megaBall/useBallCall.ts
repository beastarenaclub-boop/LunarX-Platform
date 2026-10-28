import { useEffect, useRef } from "react";
import { sfx } from "@/game/audio";
import type { ShowStage } from "./showTimeline";

function presenterVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        /zira|hazel|samantha|sonia|female|aria|jenny/i.test(v.name),
    ) ??
    voices.find((v) => v.lang === "en-IN") ??
    voices.find((v) => v.lang.startsWith("en"))
  );
}

export function useShowCalls(
  roundId: string | null,
  stage: ShowStage,
  multiplier: number | null,
  sound: boolean,
) {
  const previous = useRef("");
  useEffect(() => {
    const key = `${roundId}:${stage}`;
    if (previous.current === key) return;
    previous.current = key;
    if (!sound || document.hidden || !("speechSynthesis" in window)) return;
    const phrase =
      stage === "mixing"
        ? "No more bets. Let's draw the balls."
        : stage === "multiplier-opening"
          ? "Let's find the Mega multiplier."
          : stage === "multiplier-selected"
            ? `${multiplier} times.`
            : stage === "mega-draw"
              ? "Here comes the Mega Ball."
              : stage === "result"
                ? "The draw is complete."
                : "";
    if (!phrase) return;
    const speech = window.speechSynthesis;
    speech.cancel();
    const line = new SpeechSynthesisUtterance(phrase),
      voice = presenterVoice();
    if (voice) line.voice = voice;
    line.lang = voice?.lang ?? "en-IN";
    line.rate = 1.08;
    line.volume = 0.85;
    speech.speak(line);
  }, [roundId, stage, multiplier, sound]);
}

export function useBallCall(
  roundId: string | null,
  current: number | null,
  mega: boolean,
  sound: boolean,
) {
  const last = useRef("");
  useEffect(() => {
    const key = current == null ? "" : `${roundId}:${current}`;
    if (!key || last.current === key) return;
    last.current = key;
    // Hydrating or resuming a round never queues old numbers to be read later.
    if (!sound || document.hidden) return;
    sfx.click();
    if (!("speechSynthesis" in window)) return;
    const speech = window.speechSynthesis;
    speech.cancel();
    const call = new SpeechSynthesisUtterance(
      mega ? `Mega ball, ${current}` : String(current),
    );
    const voice = presenterVoice();
    if (voice) call.voice = voice;
    call.lang = voice?.lang ?? "en-IN";
    call.rate = 1.05;
    call.volume = 0.85;
    speech.speak(call);
  }, [roundId, current, mega, sound]);
  useEffect(() => {
    const stop = () => window.speechSynthesis?.cancel();
    if (!sound) stop();
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      stop();
    };
  }, [sound]);
}
