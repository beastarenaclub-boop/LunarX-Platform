import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import type { ODPhase } from "@workspace/api-zod/dragon-tiger-one-day";
import { OneDayCommentary, type OneDayAudioHandle } from "./OneDayCommentary";

const MEDIA = `${import.meta.env.BASE_URL}media/dragon-tiger-one-day/`;
type Take = "invite" | "dragon" | "tiger";
const TAKES: Take[] = ["invite", "dragon", "tiger"];

/** One gesture per phase / selection; steady waiting footage between gestures. */
export function OneDayDealer({
  phase,
  roundId,
  winner,
  cue,
  dragon,
  remainingMs,
  connected,
  audioRef,
}: {
  phase?: ODPhase;
  roundId?: number;
  winner?: "dragon" | "tiger" | "tie";
  cue: { id: number; take: Take } | null;
  dragon?: number;
  remainingMs: number;
  connected: boolean;
  audioRef: Ref<OneDayAudioHandle>;
}) {
  const idle = useRef<HTMLVideoElement>(null);
  const videos = useRef<Partial<Record<Take, HTMLVideoElement | null>>>({});
  const [take, setTake] = useState<{ kind: Take; id: string } | null>(null);
  const [painted, setPainted] = useState<Take | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const handleSpeaking = useCallback((value: boolean) => {
    setSpeaking(value);
    if (value) {
      setTake(null);
      setPainted(null);
    }
  }, []);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setEnabled(!document.hidden && !reduced.matches);
    sync();
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, []);
  useEffect(() => {
    setPainted(null);
    if (!phase || !roundId) return;
    const kind: Take | null =
      phase === "dragon-reveal"
        ? "dragon"
        : phase === "tiger-reveal"
          ? "tiger"
          : phase === "first" || phase === "second"
            ? "invite"
            : phase === "result"
              ? winner === "dragon" || winner === "tiger"
                ? winner
                : "invite"
              : null;
    setTake(kind ? { kind, id: `${roundId}:${phase}` } : null);
  }, [phase, roundId, winner]);
  useEffect(() => {
    if (!cue || speaking || (phase !== "first" && phase !== "second")) return;
    setPainted(null);
    setTake({ kind: cue.take, id: `selection:${cue.id}` });
  }, [cue]);
  useEffect(() => {
    for (const [kind, video] of Object.entries(videos.current)) {
      if (!video) continue;
      if (!enabled || speaking || kind !== take?.kind) video.pause();
      else {
        video.currentTime = 0;
        // Presentation reaches the felt inside the server's 3-second reveal.
        video.playbackRate = phase?.includes("reveal") ? 4 / 3 : 1;
        void video.play().catch(() => setTake(null));
      }
    }
    if (enabled && !speaking && !take)
      void idle.current?.play().catch(() => {});
    else idle.current?.pause();
  }, [take, enabled, speaking]);
  return (
    <div
      className="od-dealer"
      data-testid="od-dealer"
      data-take={
        enabled ? (speaking ? "speech" : (take?.kind ?? "idle")) : "paused"
      }
    >
      <img
        src={`${MEDIA}dealer-studio.jpg`}
        alt="One Day studio dealer"
        className="od-dealer-poster"
      />
      {phase && (
        <>
          <video
            ref={idle}
            className="od-dealer-video"
            src={`${MEDIA}dealer-idle.mp4`}
            poster={`${MEDIA}dealer-studio.jpg`}
            muted
            loop
            playsInline
            preload="auto"
            aria-label="AI-generated studio dealer"
          />
          {TAKES.map((kind) => (
            <video
              key={kind}
              ref={(node) => {
                videos.current[kind] = node;
              }}
              className={`od-dealer-take ${enabled && painted === kind ? "od-take-visible" : ""}`}
              src={`${MEDIA}dealer-${kind}.mp4`}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              onPlaying={() => {
                if (take?.kind === kind) setPainted(kind);
              }}
              onEnded={() => {
                if (take?.kind === kind) {
                  setTake(null);
                  setPainted(null);
                }
              }}
              onError={() => {
                if (take?.kind === kind) {
                  setTake(null);
                  setPainted(null);
                }
              }}
            />
          ))}
          <OneDayCommentary
            audioRef={audioRef}
            phase={phase}
            roundId={roundId}
            dragon={dragon}
            winner={winner}
            remainingMs={remainingMs}
            connected={connected}
            motionEnabled={enabled}
            onSpeaking={handleSpeaking}
          />
        </>
      )}
    </div>
  );
}
