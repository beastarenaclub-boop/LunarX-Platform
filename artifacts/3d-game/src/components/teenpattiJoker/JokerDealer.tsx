import { memo, useEffect, useRef, useState } from "react";
import { cinemaPosition, JOKER_FILM, type CinemaClock } from "./jokerCinema";
import type { JokerOutcome } from "@workspace/api-zod/teenpatti-joker";
import JokerTableRanks from "./JokerTableRanks";

const media = `${import.meta.env.BASE_URL}media/teenpatti-joker/`;
const poster = `${media}dealer-playback-v4.webp`;
type Props = CinemaClock & {
  phase?: string;
  fresh: boolean;
  animate: boolean;
  outcome?: JokerOutcome | null;
  cardCount: number;
};

/** One native video player for the full round; no per-frame canvas processing. */
export default memo(function JokerDealer(props: Props) {
  const player = useRef<HTMLVideoElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [enabled, setEnabled] = useState(props.animate);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (props.animate) setEnabled(true);
  }, [props.animate]);

  useEffect(() => {
    const video = player.current;
    if (!video || failed) return;
    let disposed = false,
      playing = false,
      revealed = false,
      previous = "";
    const sync = (force = false) => {
      if (disposed || video.readyState < 2) return;
      // Cached media can load before React's loadeddata handler is attached.
      if (!revealed) {
        revealed = true;
        setReady(true);
      }
      const current = latest.current;
      if (document.hidden || !current.animate || !current.fresh) {
        video.pause();
        return;
      }
      if (!current.revealing && current.elapsed >= 0) {
        // Wait for the server's deal instead of briefly wrapping the idle scene.
        video.pause();
        if (video.currentTime > JOKER_FILM.preparation - 0.05)
          video.currentTime = JOKER_FILM.preparation - 0.05;
        return;
      }
      const scene = cinemaPosition(current);
      const key = `${current.roundKey}:${scene.action}`;
      const start =
        scene.action === "preparing"
          ? 0
          : scene.action === "dealing"
            ? JOKER_FILM.dealStart
            : JOKER_FILM.collectionStart;
      const end =
        scene.action === "preparing"
          ? JOKER_FILM.preparation
          : scene.action === "dealing"
            ? JOKER_FILM.dealEnd
            : JOKER_FILM.collectionEnd;
      const drift = Math.abs(video.currentTime - scene.time);
      const outside =
        video.currentTime < start - 0.5 || video.currentTime >= end;
      video.dataset.action = scene.action;
      if (video.playbackRate !== scene.rate) video.playbackRate = scene.rate;
      if (
        !video.seeking &&
        drift > 1 &&
        (force || key !== previous || outside || drift > 2.5)
      )
        video.currentTime = Math.min(scene.time, video.duration - 0.05);
      previous = key;
      if (video.ended && scene.action === "collecting") return;
      if (video.paused && !playing) {
        playing = true;
        void video
          .play()
          .catch((error: DOMException) => {
            if (!disposed && error.name !== "AbortError") setBlocked(true);
          })
          .finally(() => {
            playing = false;
          });
      }
    };
    const resume = () => sync(true);
    const tick = () => sync();
    video.addEventListener("loadeddata", resume);
    video.addEventListener("canplay", tick);
    video.addEventListener("timeupdate", tick);
    video.addEventListener("ended", tick);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      disposed = true;
      video.pause();
      video.removeEventListener("loadeddata", resume);
      video.removeEventListener("canplay", tick);
      video.removeEventListener("timeupdate", tick);
      video.removeEventListener("ended", tick);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [
    enabled,
    failed,
    props.animate,
    props.fresh,
    props.roundKey,
    props.phase,
    props.revealing,
  ]);

  return (
    <div
      className="j20-dealer"
      data-media-state={
        failed
          ? "fallback"
          : blocked
            ? "blocked"
            : ready
              ? "ready"
              : enabled
                ? "loading"
                : "paused"
      }
    >
      <img
        className="j20-studio-image"
        src={poster}
        alt="AI casino dealer at the Teen Patti Joker table"
        fetchPriority="high"
        decoding="async"
        width={960}
        height={540}
      />
      {enabled && !failed && (
        <video
          ref={player}
          className={`j20-dealer-video${ready ? " is-ready" : ""}`}
          src={`${media}dealer-playback-v4.mp4`}
          poster={poster}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-label="Animated casino dealer"
          onPlaying={() => {
            setReady(true);
            setBlocked(false);
          }}
          onError={() => {
            setFailed(true);
            setReady(false);
          }}
        />
      )}
      <JokerTableRanks
        video={player}
        ready={ready}
        outcome={props.outcome}
        count={props.cardCount}
      />
      {(failed || blocked) && (
        <button
          className="j20-media-retry"
          onClick={() => {
            if (failed) setFailed(false);
            else
              void player.current
                ?.play()
                .then(() => setBlocked(false))
                .catch(() => undefined);
          }}
        >
          {failed ? "Retry dealer" : "Play dealer"}
        </button>
      )}
    </div>
  );
});
