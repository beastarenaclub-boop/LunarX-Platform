import { useEffect, useRef, useState } from "react";
import { Play, Pause, Film, RotateCcw } from "lucide-react";
import { useTurf } from "./store";
import { RUNNERS, type CameraMode } from "./engine";
import {
  cameraAtFilmTime,
  CINEMA_SHOTS,
  horsePhoto,
  venueFilm,
  venuePhoto,
} from "./cinematicMedia";

/** Generated race film is a visual companion. The simulation owns results and payouts. */
export default function CinematicScene({
  onCameraChange,
}: {
  onCameraChange: (camera: CameraMode) => void;
}) {
  const venueId = useTurf((s) => s.venueId),
    quality = useTurf((s) => s.quality),
    phase = useTurf((s) => s.phase);
  const elapsed = useTurf((s) => s.elapsed),
    camera = useTurf((s) => s.camera),
    auto = useTurf((s) => s.autoCamera);
  const muted = useTurf((s) => s.muted),
    result = useTurf((s) => s.result);
  const video = useRef<HTMLVideoElement>(null);
  const shotRef = useRef(CINEMA_SHOTS[camera]);
  const autoRef = useRef(auto);
  const elapsedRef = useRef(elapsed);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [preview, setPreview] = useState(phase === "betting");
  const playing = phase === "racing" || preview;
  const src = venueFilm(venueId, quality);
  shotRef.current = CINEMA_SHOTS[camera];
  autoRef.current = auto;
  elapsedRef.current = elapsed;
  const play = () => {
    const element = video.current;
    if (element)
      void element
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
  };
  useEffect(() => {
    setReady(false);
    setFailed(false);
    setBlocked(false);
    onCameraChange("broadcast");
  }, [src, onCameraChange]);
  useEffect(() => {
    const element = video.current;
    if (!element || !ready) return;
    if (playing) {
      if (phase === "racing" && auto)
        element.currentTime =
          Math.max(0, elapsedRef.current) % element.duration;
      play();
    } else element.pause();
  }, [ready, playing, src, phase, auto]);
  useEffect(() => {
    const element = video.current;
    if (!element || !ready) return;
    if (!auto) {
      element.currentTime = Math.min(
        CINEMA_SHOTS[camera].start,
        Math.max(0, element.duration - 0.1),
      );
      onCameraChange(camera);
      if (phase === "betting") setPreview(true);
      if (playing) play();
    }
  }, [camera, auto, ready, onCameraChange]);
  useEffect(() => {
    setPreview(phase === "betting");
  }, [phase, src]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.volume = 0.45;
    let frame = 0;
    const check = () => {
      if (!autoRef.current && element.readyState >= 2 && !element.paused) {
        const shot = shotRef.current;
        const end = Math.min(shot.end, element.duration - 0.08);
        if (
          element.currentTime >= end ||
          element.currentTime < shot.start - 0.3
        )
          element.currentTime = Math.min(
            shot.start,
            Math.max(0, element.duration - 0.1),
          );
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => {
      cancelAnimationFrame(frame);
      element.pause();
    };
  }, [src]);
  const winner =
    phase === "finished" && result ? RUNNERS[result.winner - 1] : null;
  return (
    <div
      className="tc-cinematic-scene"
      data-testid="cinematic-scene"
      data-shot={auto ? "auto" : camera}
    >
      <img
        className="tc-cinema-poster"
        src={winner ? horsePhoto(winner.id) : venuePhoto(venueId)}
        alt={
          winner
            ? `${winner.name}, simulated race winner`
            : "Photorealistic Higgsfield racecourse artwork"
        }
      />
      <video
        ref={video}
        key={src}
        src={src}
        className={
          ready &&
          (phase === "betting" || phase === "racing") &&
          !failed &&
          !winner
            ? "is-playing"
            : ""
        }
        playsInline
        muted={muted}
        loop={auto}
        preload="auto"
        aria-label="Higgsfield cinematic horse racing footage"
        onLoadedData={() => setReady(true)}
        onTimeUpdate={(event) =>
          onCameraChange(
            auto ? cameraAtFilmTime(event.currentTarget.currentTime) : camera,
          )
        }
        onError={() => {
          setFailed(true);
          setReady(false);
        }}
        onEnded={() => {
          if (playing && video.current) {
            video.current.currentTime = auto ? 0 : shotRef.current.start;
            play();
          }
        }}
      />
      <span className="tc-ai-film-credit">
        <Film size={10} /> HIGGSFIELD · AI CINEMATIC
      </span>
      {failed && (
        <div className="tc-film-notice">
          Film unavailable. Race standings and betting are still running.
          <button
            onClick={() => {
              setFailed(false);
              video.current?.load();
            }}
          >
            <RotateCcw size={12} /> Retry film
          </button>
        </div>
      )}
      {blocked && playing && !failed && (
        <button className="tc-play-film" onClick={play}>
          <Play size={17} fill="currentColor" /> Play footage
        </button>
      )}
      {phase === "betting" && !failed && (
        <button
          className="tc-preview-film"
          onClick={() => {
            setPreview(!preview);
            if (!preview) play();
          }}
        >
          {preview ? (
            <Pause size={13} />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          {preview ? "Pause preview" : "Preview the action"}
        </button>
      )}
      {!ready && playing && !failed && (
        <div className="tc-film-loading">
          <span className="tc-spinner" /> Loading HD race film
        </div>
      )}
      {winner && (
        <div className="tc-film-winner">
          <span>SIMULATED RACE WINNER</span>
          <strong>{winner.name}</strong>
          <small>
            {result?.times[winner.id - 1].toFixed(2)}s · {winner.jockey}
          </small>
        </div>
      )}
    </div>
  );
}
