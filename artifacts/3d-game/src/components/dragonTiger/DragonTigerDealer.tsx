import { useEffect, useRef, useState } from "react";
import { dragonTigerDealer, type HandReaction } from "./dealerCast";
import DealerVoice from "./DealerVoice";

export type DealerCue = {
  id: number;
  kind: HandReaction;
  manual?: boolean;
  restart?: boolean;
  roundId?: number;
};
type DataSaverNavigator = Navigator & { connection?: { saveData?: boolean } };

/** Native video preserves the photographed eyes, fingers and wrist articulation. */
function DealerTake({
  src,
  active,
  voice = false,
  volume = 0,
  loop = false,
  shown = true,
  onReady,
  onDone,
  onError,
  testId,
}: {
  src: string;
  active: boolean;
  voice?: boolean;
  volume?: number;
  loop?: boolean;
  shown?: boolean;
  onReady: () => void;
  onDone?: () => void;
  onError: () => void;
  testId: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [painted, setPainted] = useState(false);
  const failure = useRef(onError);
  failure.current = onError;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let disposed = false;
    video.muted = true;
    if (!active) {
      video.pause();
      // Every take starts and ends at the same resting pose.
      if (loop && video.readyState > 0) video.currentTime = 0;
    } else {
      void video.play().catch(() => {
        if (!disposed) failure.current();
      });
    }
    return () => {
      disposed = true;
      video.pause();
    };
  }, [active, loop]);
  return (
    <>
      <video
        ref={ref}
        src={src}
        muted
        loop={loop}
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
        style={{ opacity: painted && shown ? 1 : 0 }}
        data-testid={testId}
        onPlaying={() => {
          setPainted(true);
          onReady();
        }}
        onEnded={onDone}
        onError={onError}
      />
      <DealerVoice enabled={active && voice} volume={volume} video={ref} />
    </>
  );
}

export default function DragonTigerDealer({
  canInvite,
  sound,
  audioReady,
  volume,
  phase,
  cue,
}: {
  canInvite: boolean;
  sound: boolean;
  audioReady: boolean;
  volume: number;
  phase?: "betting" | "dealing" | "result";
  cue: DealerCue | null;
}) {
  const [motion, setMotion] = useState<DealerCue | null>(null);
  const [readyId, setReadyId] = useState<number | null>(null);
  const [idleReady, setIdleReady] = useState(false);
  const [idleFailed, setIdleFailed] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const invited = useRef(false);
  const seenPhase = useRef<string | undefined>(undefined);
  const lastCue = useRef<number | undefined>(undefined);
  const sequence = useRef(-1);
  const saveData =
    (navigator as DataSaverNavigator).connection?.saveData === true;
  const automatic = !reduced && !saveData;
  const enabled = visible && (automatic || motion?.manual === true);
  const reacting = enabled && phase !== "result" && motion !== null;
  const takeReady = reacting && readyId === motion.id;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReduced(query.matches);
      setMotion(null);
    };
    const visibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) setMotion(null);
    };
    query.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      query.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (phase !== seenPhase.current) {
      // Stop invitations when betting closes and keep hands at rest on results.
      setMotion(
        automatic && visible && phase === "dealing"
          ? {
              id: sequence.current--,
              kind: "deal",
            }
          : null,
      );
      seenPhase.current = phase;
    }
    if (
      phase === "betting" &&
      canInvite &&
      !invited.current &&
      (automatic || sound) &&
      visible
    ) {
      invited.current = true;
      setMotion({ id: sequence.current--, kind: "invite" });
    }
  }, [automatic, canInvite, phase, sound, visible]);

  useEffect(() => {
    if (!cue || lastCue.current === cue.id) return;
    lastCue.current = cue.id;
    if (
      phase === "result" ||
      !visible ||
      (!automatic && !cue.manual && !(sound && cue.kind === "invite"))
    )
      return;
    // Repeated chips on the same side must not restart the same hand every tap.
    setMotion((current) =>
      current?.kind === cue.kind && !cue.manual && !cue.restart ? current : cue,
    );
  }, [automatic, cue, phase, sound, visible]);

  return (
    <div
      className="dt-studio"
      data-testid="dt-studio"
      data-mode={
        takeReady
          ? "animating"
          : automatic && visible && idleReady && !idleFailed
            ? "idle"
            : "poster"
      }
      data-reaction={takeReady ? motion.kind : "rest"}
      data-take-ready={takeReady}
    >
      <img
        src={dragonTigerDealer.poster}
        alt="Zara, the AI dealer in the Dragon Tiger gold and teal studio"
        fetchPriority="high"
        decoding="async"
        width={1672}
        height={941}
      />
      {automatic && !idleFailed && (
        <DealerTake
          src={dragonTigerDealer.idle}
          active={visible && !takeReady}
          loop
          testId="dt-dealer-idle"
          onReady={() => setIdleReady(true)}
          onError={() => setIdleFailed(true)}
        />
      )}
      {reacting && (
        <DealerTake
          key={motion.id}
          src={dragonTigerDealer.takes[motion.kind]}
          active={visible}
          shown={takeReady}
          voice={
            sound &&
            audioReady &&
            motion.kind === "invite" &&
            phase === "betting"
          }
          volume={volume}
          testId="dt-dealer-video"
          onReady={() => setReadyId(motion.id)}
          onDone={() => setMotion(null)}
          onError={() => setMotion(null)}
        />
      )}
      {!reacting &&
        motion?.kind === "invite" &&
        phase === "betting" &&
        visible && (
          <DealerVoice
            key={motion.id}
            enabled={sound && audioReady}
            volume={volume}
            onDone={() => setMotion(null)}
          />
        )}
      <div className="dt-studio-vignette" />
      <div className="dt-studio-rail" />
    </div>
  );
}
