import { useCallback, useEffect, useState, type RefObject } from "react";
import dealerImage from "@/assets/lucky7/dealer.png";
import CasinoBackdrop from "./CasinoBackdrop";
import DealerReaction, { type DealerReactionCue, type DealerReactionKind, type DealerReactionMedia } from "./DealerReaction";
import { DEALER_MASK } from "./dealerMask";
import type { DealerRelease, DiceThrowCue } from "./dicePlan";
import { DEALER_HEIGHT, DEALER_TOP, idlePlayback, type DealerPlayback } from "./dealerMotion";

export interface DealerMedia {
  idle: string;
  roll: string;
  /** Timestamp of the hand release in the roll clip. */
  releaseMs: number;
  startMs: number;
  endMs: number;
  /** Game-clock duration of the gesture (the source may play faster). */
  windupMs: number;
  release: DealerRelease;
  /** Match the subject's framing across separately generated clips. */
  idleScale?: number;
  idleTop?: string;
  reactions?: Partial<Record<DealerReactionKind, DealerReactionMedia>>;
}

interface Props {
  media?: DealerMedia;
  reducedMotion: boolean;
  cue: DiceThrowCue | null;
  onReadyChange: (ready: boolean) => void;
  rollRef: RefObject<HTMLVideoElement | null>;
  idleRef: RefObject<HTMLVideoElement | null>;
  playbackRef: RefObject<DealerPlayback>;
  reactionCue?: DealerReactionCue | null;
  sound?: boolean;
  soundVolume?: number;
}

/** The filmed gesture drives the dice clock within the server's reveal window. */
export default function DealerStage({ media, reducedMotion, cue, onReadyChange, rollRef, idleRef, playbackRef, reactionCue = null, sound = false, soundVolume = 0.7 }: Props) {
  const [idleReady, setIdleReady] = useState(false);
  const [rollReady, setRollReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [reaction, setReaction] = useState<DealerReactionKind | null>(null);
  const enabled = !!media && !reducedMotion && !failed;
  const showVideo = enabled && idleReady;

  const fail = useCallback(() => {
    setFailed(true);
    setRolling(false);
  }, []);

  const finishRoll = useCallback(() => {
    playbackRef.current = idlePlayback();
    setRolling(false);
    rollRef.current?.pause();
    if (document.visibilityState === "visible" && idleRef.current) {
      idleRef.current.currentTime = 0;
      void idleRef.current.play().catch((error: DOMException) => {
        if (error.name !== "AbortError") fail();
      });
    }
  }, [playbackRef, rollRef, idleRef, fail]);

  useEffect(() => {
    onReadyChange(enabled && idleReady && rollReady);
  }, [enabled, idleReady, rollReady, onReadyChange]);

  useEffect(() => {
    const idle = idleRef.current;
    const roll = rollRef.current;
    if (!enabled || !idle || !roll || !media) return;
    let disposed = false;
    let clockFrame = 0;
    let decodedFrame = 0;
    let active = false;
    let startPlayback: (() => void) | null = null;
    const play = (video: HTMLVideoElement) => {
      void video.play().catch((error: DOMException) => {
        // Effect cleanup and tab suspension can interrupt a valid play request.
        if (!disposed && error.name !== "AbortError") fail();
      });
    };

    const sync = () => {
      cancelAnimationFrame(clockFrame);
      if (decodedFrame) roll.cancelVideoFrameCallback?.(decodedFrame);
      if (startPlayback) roll.removeEventListener("playing", startPlayback);
      active = false;
      if (document.visibilityState === "hidden") {
        idle.pause();
        roll.pause();
        return;
      }
      active = !!(cue && cue.releaseAt > cue.startedAt && rollReady && idleReady && Date.now() < cue.endsAt);
      if (active && cue) {
        const rate = (media.endMs - media.startMs) / (cue.endsAt - cue.startedAt);
        const desiredMs = () => Math.min(media.endMs, media.startMs + Math.max(0, Date.now() - cue.startedAt) * rate);
        roll.playbackRate = rate;
        roll.currentTime = desiredMs() / 1000;
        playbackRef.current = { roundId: cue.roundId, mediaMs: media.startMs, mode: "roll", frameReady: false, presentedAt: performance.now(), rate };
        // Keep the idle pose on screen until the requested throw frame has
        // actually decoded; seeking must not flash the previous take's frame.
        setRolling(false);
        idle.pause();
        // Account for the initial seek/decode when choosing the starting rate.
        // The frame loop can gently correct it after any later decoder stall.
        let started = false;
        startPlayback = () => {
          if (started || !active) return;
          started = true;
          const remaining = cue.endsAt - Date.now();
          if (remaining > 300) roll.playbackRate = Math.min(2, (media.endMs - roll.currentTime * 1000) / remaining);
        };
        roll.addEventListener("playing", startPlayback);
        play(roll);
        let presentedFirst = false;
        let adjustedAt = 0;

        // Publish the frame actually presented by the decoder. The dice and
        // hand matte use this same timestamp, including during buffering.
        const presented = (_now: number, frame: VideoFrameCallbackMetadata) => {
          if (disposed || !active) return;
          if (!roll.seeking) {
            playbackRef.current = { roundId: cue.roundId, mediaMs: frame.mediaTime * 1000, mode: "roll", frameReady: true, presentedAt: frame.expectedDisplayTime, rate: roll.playbackRate };
            if (!presentedFirst) { presentedFirst = true; setRolling(true); }
          }
          decodedFrame = roll.requestVideoFrameCallback(presented);
        };
        if (roll.requestVideoFrameCallback) decodedFrame = roll.requestVideoFrameCallback(presented);

        const tick = () => {
          if (disposed || !active || document.visibilityState === "hidden") return;
          if (Date.now() >= cue.endsAt) {
            active = false;
            finishRoll();
            return;
          }
          if (!roll.requestVideoFrameCallback && !roll.seeking) {
            playbackRef.current = { roundId: cue.roundId, mediaMs: roll.currentTime * 1000, mode: "roll", frameReady: true, presentedAt: performance.now(), rate: roll.playbackRate };
            if (!presentedFirst) { presentedFirst = true; setRolling(true); }
          }
          // Catch up smoothly after a decoder stall without seeking past
          // the hand release or losing the final slide at the deadline.
          const now = Date.now();
          const remaining = cue.endsAt - now;
          if (presentedFirst && !roll.seeking && remaining > 150 && now - adjustedAt > 180) {
            const rateNeeded = (media.endMs - roll.currentTime * 1000) / remaining;
            roll.playbackRate = Math.max(0.7, Math.min(2, rateNeeded * 1.015));
            adjustedAt = now;
          }
          // Continuous playback is essential on phones: repeatedly seeking
          // to chase wall time can starve the decoder and skip the release.
          clockFrame = requestAnimationFrame(tick);
        };
        clockFrame = requestAnimationFrame(tick);
      } else {
        playbackRef.current = idlePlayback();
        roll.pause();
        setRolling(false);
        play(idle);
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      cancelAnimationFrame(clockFrame);
      if (decodedFrame) roll.cancelVideoFrameCallback?.(decodedFrame);
      if (startPlayback) roll.removeEventListener("playing", startPlayback);
      document.removeEventListener("visibilitychange", sync);
      idle.pause();
      roll.pause();
    };
  }, [enabled, media, cue, rollReady, idleReady, fail, rollRef, idleRef, playbackRef, finishRoll]);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      data-testid="lucky7-dealer-stage"
      data-mode={showVideo ? (rolling ? "roll" : reaction ?? "idle") : "static"}
      data-ready={enabled && idleReady && rollReady}
      data-round-id={rolling ? cue?.roundId : reaction ? playbackRef.current.roundId : undefined}
    >
      <CasinoBackdrop reducedMotion={reducedMotion} />
      <div className="absolute inset-x-0 overflow-hidden" style={{ top: `${DEALER_TOP * 100}%`, height: `${DEALER_HEIGHT * 100}%` }}>
        {enabled && media && (
          <>
            <video
              ref={idleRef}
              src={media.idle}
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              onPlaying={() => setIdleReady(true)}
              onError={fail}
              className="absolute top-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2"
              style={{
                opacity: showVideo && !rolling && !reaction ? 1 : 0,
                height: `${(media.idleScale ?? 1) * 100}%`,
                top: media.idleTop ?? 0,
                maskImage: DEALER_MASK,
                maskSize: "100% 100%",
              }}
              data-testid="lucky7-dealer-idle-video"
            />
            <video
              ref={rollRef}
              src={media.roll}
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              onCanPlay={() => {
                if (!cue && rollRef.current && Math.abs(rollRef.current.currentTime * 1000 - media.startMs) > 50) {
                  rollRef.current.currentTime = media.startMs / 1000;
                }
                setRollReady(true);
              }}
              onEnded={finishRoll}
              onError={fail}
              className="absolute top-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2"
              style={{
                opacity: showVideo && rolling ? 1 : 0,
                maskImage: DEALER_MASK,
                maskSize: "100% 100%",
              }}
              data-testid="lucky7-dealer-roll-video"
            />
            {media.reactions && <DealerReaction
              clips={media.reactions}
              cue={reactionCue}
              blocked={!showVideo || !rollReady || rolling}
              sound={sound}
              volume={soundVolume}
              idleRef={idleRef}
              playbackRef={playbackRef}
              onActiveChange={setReaction}
            />}
          </>
        )}
      </div>

      {!showVideo && (
        <div className="absolute inset-x-0 top-0 z-10 flex h-[64%] justify-center pt-2 sm:pt-3">
          <img
            src={dealerImage}
            alt=""
            width={1145}
            height={1374}
            draggable={false}
            className="h-full w-auto max-w-[65%] select-none object-contain object-bottom drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
            data-testid="lucky7-dealer"
          />
        </div>
      )}
    </div>
  );
}
