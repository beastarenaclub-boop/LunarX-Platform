import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleDot, Pause, Play, Volume2, VolumeX } from "lucide-react";
import idleHd from "@/assets/roulette-dealer/dealer-idle-1080p.mp4";
import idleMobile from "@/assets/roulette-dealer/dealer-idle-720p.mp4";
import actionHd from "@/assets/roulette-dealer/dealer-release-1080p.mp4";
import actionMobile from "@/assets/roulette-dealer/dealer-release-720p.mp4";
import poster from "@/assets/roulette-dealer/dealer-poster.jpg";
import "./roulette-dealer.css";
import { pocketColorHex } from "./wheelData";

// Adjacent sections of one take. Start the gesture before bets close, so the
// existing server-driven landing never waits for a video or decoder.
import { DEALER_ACTION_MS, DEALER_RELEASE_MS, DEALER_FOREGROUND_HEIGHT, DealerVideoContext, type DealerVideoFrame } from "./dealerTiming";
export { DEALER_ACTION_MS, DEALER_RELEASE_MS } from "./dealerTiming";

interface Props {
  roundId: string | null;
  phase: string | null;
  bettingEndsAt: number | null;
  resultActive: boolean;
  winningPocket: number | null;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  children: ReactNode;
}

export default function RouletteDealerTable({
  roundId,
  phase,
  bettingEndsAt,
  resultActive,
  winningPocket,
  soundEnabled,
  onSoundToggle,
  children,
}: Props) {
  const idle = useRef<HTMLVideoElement>(null);
  const action = useRef<HTMLVideoElement>(null);
  const foreground = useRef<HTMLCanvasElement>(null);
  const dealerFrame = useRef<DealerVideoFrame>({ roundId: null, mediaMs: 0, sampledAt: 0, active: false });
  const stage = useRef<HTMLDivElement>(null);
  const playedRound = useRef<string | null>(null);
  const currentRound = useRef(roundId);
  currentRound.current = roundId;
  const [mobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [failed, setFailed] = useState(false);
  const [throwing, setThrowing] = useState(false);
  const [actionVisible, setActionVisible] = useState(false);
  const [inspectWheel, setInspectWheel] = useState<boolean | null>(null);
  const motion = !reduced && !paused && !hidden && !failed;
  const wheelVisible =
    inspectWheel ?? ((phase === "reveal" || phase === "settling") && !throwing);

  useEffect(() => {
    const video = action.current, canvas = foreground.current;
    const ctx = canvas?.getContext("2d");
    if (!video || !canvas || !ctx) return;
    dealerFrame.current = { roundId, mediaMs: 0, sampledAt: 0, active: false };
    ctx.clearRect(0, 0, 1920, DEALER_FOREGROUND_HEIGHT);
    if (!throwing || !motion) return;
    let cancelled = false, callback = 0;
    const videoFrames = typeof video.requestVideoFrameCallback === "function";
    const paint = (mediaTime: number) => {
      if (cancelled || video.seeking || video.readyState < 2) return;
      // Restore the ORIGINAL hand/held ball over the opaque wheel mask. The
      // cropped band ends before the filmed rotor or loose ball can reappear.
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight * DEALER_FOREGROUND_HEIGHT / 1080,
        0, 0, 1920, DEALER_FOREGROUND_HEIGHT);
      // Frame 37 contains the loose filmed ball between the open fingers.
      // Reveal its calibrated game-ball replacement through this small gap;
      // the fingers remain in the foreground and no duplicate ball survives.
      if (mediaTime >= 1.52 && mediaTime < 1.58) ctx.clearRect(806, 541, 40, 29);
      dealerFrame.current = { roundId, mediaMs: mediaTime * 1000, sampledAt: performance.now(), active: true };
      canvas.dataset.mediaMs = String(mediaTime * 1000);
    };
    const schedule = () => {
      if (cancelled) return;
      if (videoFrames) callback = video.requestVideoFrameCallback((_now, metadata) => { paint(metadata.mediaTime); schedule(); });
      else callback = requestAnimationFrame(() => { paint(video.currentTime); schedule(); });
    };
    schedule();
    return () => {
      cancelled = true;
      if (videoFrames) video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
      dealerFrame.current.active = false;
      ctx.clearRect(0, 0, 1920, DEALER_FOREGROUND_HEIGHT);
    };
  }, [roundId, throwing, motion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener("change", changed);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!motion || throwing) idle.current?.pause();
    else void idle.current?.play().catch(() => {});
    if (!motion) {
      action.current?.pause();
      setThrowing(false);
      setActionVisible(false);
    }
  }, [motion, throwing]);

  useEffect(() => {
    setThrowing(false);
    setActionVisible(false);
    setInspectWheel(null);
    action.current?.pause();
    if (stage.current) stage.current.dataset.ballReleased = "false";
  }, [roundId]);

  useEffect(() => {
    if (
      !motion ||
      phase !== "betting" ||
      !roundId ||
      bettingEndsAt == null ||
      playedRound.current === roundId
    )
      return;
    const startAt = bettingEndsAt - DEALER_ACTION_MS;
    // A late join must never replay a complete throw over an existing result.
    if (Date.now() >= bettingEndsAt - 250) return;
    let disposed = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let readyListener: (() => void) | undefined;
    const video = action.current;
    const start = () => {
      if (!video || disposed || currentRound.current !== roundId) return;
      playedRound.current = roundId;
      const elapsed = Math.max(0, (Date.now() - startAt) / 1000);
      if (elapsed >= DEALER_ACTION_MS / 1000) return;
      setThrowing(true);
      const play = () => {
        if (disposed || currentRound.current !== roundId) return;
        const offset = Math.max(0, (Date.now() - startAt) / 1000);
        if (offset >= DEALER_ACTION_MS / 1000) return;
        video.currentTime = offset;
        void video.play().catch(() => {
          if (!disposed) {
            setThrowing(false);
            setActionVisible(false);
          }
        });
      };
      if (video.readyState >= 1) play();
      else {
        readyListener = play;
        video.addEventListener("loadedmetadata", play, { once: true });
      }
      // Decoder failure or a stalled network must not cover the result camera.
      finishTimer = setTimeout(
        () => {
          video.removeEventListener("loadedmetadata", play);
          video.pause();
          if (idle.current) idle.current.currentTime = 0;
          setThrowing(false);
          setActionVisible(false);
        },
        Math.max(0, bettingEndsAt - Date.now()) + 150,
      );
    };
    const timer = setTimeout(start, Math.max(0, startAt - Date.now()));
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(finishTimer);
      if (readyListener)
        video?.removeEventListener("loadedmetadata", readyListener);
    };
  }, [motion, phase, roundId, bettingEndsAt]);

  // Phase changes cancel the scheduled gesture even if metadata/play stalled.
  useEffect(() => {
    if (phase === "betting") return;
    action.current?.pause();
    if (idle.current && !resultActive) idle.current.currentTime = 0;
    setThrowing(false);
    setActionVisible(false);
  }, [phase]);

  const finish = () => {
    setThrowing(false);
    setActionVisible(false);
    if (idle.current) idle.current.currentTime = 0;
  };
  const status = resultActive
    ? "Winning pocket"
    : throwing
      ? "Dealer releasing ball"
      : phase === "reveal" || phase === "settling"
        ? "Ball in motion"
        : "Place your bets";

  return (
    <section
      className="roulette-studio"
      aria-label="Roulette studio with animated female dealer"
      data-testid="roulette-dealer-table"
    >
      <div className="roulette-studio-topline">
        <div>
          <span className="roulette-studio-light" />
          <strong>ROULETTE</strong>
          <span className="roulette-studio-subtitle">THE GRAND TABLE</span>
        </div>
        <span className="roulette-studio-ai">AI DEALER</span>
      </div>
      <div className="roulette-studio-stage-slot">
      <div
        ref={stage}
        className="roulette-studio-frame"
        data-testid="roulette-dealer-stage"
        data-dealer-state={!motion ? "paused" : throwing ? "release" : "idle"}
        data-camera={wheelVisible ? "wheel" : "table"}
        data-round-id={roundId ?? ""}
        data-phase={phase ?? ""}
      >
        {/* One complete scene in both views. The controlled wheel covers the
            filmed wheel at all times, including during the dealer gesture. */}
        <div className="roulette-studio-scene" data-testid="roulette-camera-scene">
          <img
            src={poster}
            alt="Female roulette dealer behind a polished wooden wheel in a gold and emerald casino"
            className="roulette-studio-poster"
          />
          <video
            ref={idle}
            className="roulette-studio-film"
            data-testid="roulette-dealer-idle"
            src={reduced ? undefined : mobile ? idleMobile : idleHd}
            poster={poster}
            muted
            playsInline
            loop
            autoPlay={motion && !throwing}
            preload={reduced ? "none" : "auto"}
            aria-hidden="true"
            onError={() => setFailed(true)}
            onLoadedData={() => {
              if (motion && !throwing) void idle.current?.play().catch(() => {});
            }}
          />
          <video
            ref={action}
            className="roulette-studio-film roulette-studio-action"
            data-testid="roulette-dealer-action"
            data-visible={actionVisible ? "true" : "false"}
            src={reduced ? undefined : mobile ? actionMobile : actionHd}
            muted
            playsInline
            preload={reduced ? "none" : "auto"}
            aria-hidden="true"
            onPlaying={() => {
              if (throwing && motion) setActionVisible(true);
            }}
            onEnded={finish}
            onError={finish}
            onTimeUpdate={() => {
              if (stage.current && action.current && throwing)
                stage.current.dataset.ballReleased = String(
                  action.current.currentTime * 1000 >= DEALER_RELEASE_MS,
                );
            }}
          />
          <DealerVideoContext.Provider value={dealerFrame}>{children}</DealerVideoContext.Provider>
          <canvas ref={foreground} width={1920} height={DEALER_FOREGROUND_HEIGHT}
            className="roulette-dealer-foreground" data-testid="roulette-dealer-hand"
            data-visible={throwing && motion && actionVisible ? "true" : "false"} aria-hidden="true" />
        </div>
        <div className="roulette-studio-vignette" />
        <div className="roulette-studio-caption">
          <span>EUROPEAN ROULETTE</span>
          <strong>Every spin. A new possibility.</strong>
        </div>
        <div
          className="roulette-studio-wheel"
          data-testid="roulette-wheel-popup"
          data-open={wheelVisible ? "true" : "false"}
          aria-label="Roulette wheel close-up"
        >
          <span className="roulette-studio-wheel-label">{resultActive ? "WINNING NUMBER" : "WHEEL CAMERA"}</span>
          <div className="roulette-studio-result">
            {winningPocket !== null ? <strong data-testid="wheel-result" style={{ background: pocketColorHex(winningPocket) }}>{winningPocket}</strong>
              : <span>{phase === "betting" ? "TABLE VIEW" : "BALL IN MOTION"}</span>}
          </div>
        </div>
        <div className="roulette-studio-controls">
          <button type="button" aria-label={soundEnabled ? "Mute roulette sound" : "Enable roulette sound"}
            aria-pressed={soundEnabled} onClick={onSoundToggle} data-testid="roulette-sound-toggle">
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            type="button"
            aria-label={
              wheelVisible ? "Hide wheel close-up" : "Show wheel close-up"
            }
            aria-pressed={wheelVisible}
            onClick={() => setInspectWheel(!wheelVisible)}
          >
            <CircleDot size={15} />
            <span>Wheel view</span>
          </button>
          <button
            type="button"
            disabled={reduced || failed}
            aria-label={paused ? "Play dealer video" : "Pause dealer video"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused || reduced ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      </div>
      </div>
      <div className="roulette-studio-footer">
        <div>
          <span className="roulette-studio-light" />
          <span data-testid="wheel-popup-status">
            {failed ? "Table view · video unavailable" : status}
          </span>
        </div>
        <span className="roulette-studio-ai">SINGLE ZERO · 37 POCKETS</span>
      </div>
    </section>
  );
}
