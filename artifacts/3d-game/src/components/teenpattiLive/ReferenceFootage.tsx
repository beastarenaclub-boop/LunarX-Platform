import { useEffect, useRef, useState, type RefObject } from "react";
import { preferLightMedia } from "@/lib/mediaProfile";
import {
  OPENING_START,
  OPENING_LENGTH,
  openingState,
} from "./referenceSequentialMotion";

const media = `${import.meta.env.BASE_URL}media/teen-patti-2020/`;
const plane = "M0,0H1036V586H0Z";
type HandPaths = { startFrame: number; fps: number; paths: string[] };

/** One native decoder. The filmed hand occludes cards using offline silhouettes;
 * there is no synthetic hand, pixel readback, or AI processing in the browser. */
export default function ReferenceFootage({
  animate,
  roundKey,
  revealing,
  revealEndsAt,
  revealDurationMs,
  occlusion,
}: {
  animate: boolean;
  roundKey: string;
  revealing: boolean;
  revealEndsAt?: number | null;
  revealDurationMs: number;
  occlusion: RefObject<SVGPathElement | null>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const paths = useRef<HandPaths | null>(null);
  const [failed, setFailed] = useState(false);
  const [source] = useState(
    () =>
      `${media}reference-sequential${preferLightMedia() ? "-mobile" : ""}-v4.mp4`,
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${media}reference-hands-v2.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Hand silhouettes unavailable");
        return response.json();
      })
      .then((data: HandPaths) => {
        paths.current = data;
      })
      .catch(() => {
        /* Results still work if this optional asset is unavailable. */
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let frame = 0,
      stopped = false,
      previousPath = "";
    const draw = (time: number) => {
      const data = paths.current;
      const index = data ? Math.round(time * data.fps) - data.startFrame : -1;
      const d = plane + (data?.paths[index] ?? "");
      if (d !== previousPath && occlusion.current) {
        occlusion.current.setAttribute("d", d);
        previousPath = d;
      }
    };
    const next: VideoFrameRequestCallback = (_, metadata) => {
      draw(metadata.mediaTime);
      if (!stopped) frame = player.requestVideoFrameCallback(next);
    };
    const fallback = () => draw(player.currentTime);
    if (player.requestVideoFrameCallback)
      frame = player.requestVideoFrameCallback(next);
    else player.addEventListener("timeupdate", fallback);
    player.addEventListener("seeked", fallback);
    return () => {
      stopped = true;
      if (frame) player.cancelVideoFrameCallback(frame);
      player.removeEventListener("seeked", fallback);
      player.removeEventListener("timeupdate", fallback);
      player.pause();
    };
  }, [occlusion]);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let entered = false;
    const sync = () => {
      if (document.hidden) {
        player.pause();
        return;
      }
      if (!player.readyState) return;
      const elapsed =
        revealEndsAt == null
          ? Infinity
          : Date.now() - (revealEndsAt - revealDurationMs);
      const state = openingState(elapsed, revealDurationMs);
      let target = player.currentTime,
        rate = 1,
        play = animate;
      if (revealing) {
        if (!animate || elapsed >= state.openingMs + 1200) {
          target = 30.5;
          play = false;
        } else if (elapsed >= state.openingMs) {
          target =
            OPENING_START + OPENING_LENGTH + (elapsed - state.openingMs) / 1000;
        } else {
          target = OPENING_START + state.seconds;
          rate = Math.max(
            0.25,
            Math.min(4, (OPENING_LENGTH * 1000) / state.openingMs),
          );
        }
      } else if (!entered || player.currentTime >= OPENING_START - 0.15)
        target = 0.02;
      // Healthy playback stays native between phase boundaries and catch-up seeks.
      if (
        !player.seeking &&
        (!entered || Math.abs(player.currentTime - target) > 0.65)
      )
        player.currentTime = target;
      entered = true;
      player.playbackRate = rate;
      player.dataset.motion = revealing
        ? state.settled
          ? "rest"
          : "opening"
        : "betting";
      if (!play) player.pause();
      else if (player.paused)
        void player.play().catch((error) => {
          if (error.name !== "AbortError" && error.name !== "NotAllowedError")
            setFailed(true);
        });
    };
    sync();
    const timer = window.setInterval(sync, 250);
    player.addEventListener("loadeddata", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      player.removeEventListener("loadeddata", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [animate, roundKey, revealing, revealEndsAt, revealDurationMs]);

  return (
    <>
      <img
        className="tp20-recorded-poster"
        src={`${media}reference-natural-poster-v3.webp`}
        alt=""
      />
      <video
        ref={video}
        className="tp20-recorded-dealer"
        data-testid="tp20-dealer-video"
        src={source}
        poster={`${media}reference-natural-poster-v3.webp`}
        muted
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        aria-hidden="true"
        onError={() => setFailed(true)}
        style={{ visibility: failed ? "hidden" : "visible" }}
      />
      {failed && (
        <span className="tp20-media-fallback" role="status">
          Dealer footage unavailable
        </span>
      )}
    </>
  );
}
