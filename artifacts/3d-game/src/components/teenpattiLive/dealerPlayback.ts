import { DEALER_FILM } from "./dealerFilm";

type Mode = "idle" | "hold" | "reveal" | "rest";
interface PlaybackTarget {
  mode: Mode;
  key: string;
  /** Time in the original nine-second opening take. */
  mediaTime: number;
  enabled: boolean;
  resync: boolean;
}

/** Lucky 7's persistent-player approach: forward motion, a decoded-frame
 * clock and a captured picture across seeks. No crossfaded hands or faces. */
export function createDealerPlayback(
  video: HTMLVideoElement,
  bridge: HTMLCanvasElement | null,
  onError: () => void,
) {
  let disposed = false;
  let callback = 0;
  let playPending = false;
  let suspended = true;
  let presented = false;
  let pending = false;
  let expected = 0;
  let activeMode: Mode | null = null;
  let activeKey = "";
  const decodedFrames = typeof video.requestVideoFrameCallback === "function";
  const state = { mediaTime: 0, frameReady: false, mode: "idle" as Mode };

  const play = () => {
    if (!video.paused || playPending) return;
    playPending = true;
    void video
      .play()
      .catch((error) => {
        if (
          !disposed &&
          error.name !== "AbortError" &&
          error.name !== "NotAllowedError"
        )
          onError();
      })
      .finally(() => {
        playPending = false;
      });
  };
  const hold = () => {
    if (!bridge || !presented || video.readyState < 2 || pending) return;
    const context = bridge.getContext("2d");
    if (!context) return;
    bridge.width = video.videoWidth;
    bridge.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    bridge.style.visibility = "visible";
    bridge.dataset.held = "true";
  };
  const seek = (time: number) => {
    hold();
    expected = time;
    pending = true;
    state.frameReady = false;
    video.currentTime = time;
  };
  const present = (mediaTime: number) => {
    if (
      disposed ||
      suspended ||
      activeMode === "hold" ||
      video.seeking ||
      video.readyState < 2
    )
      return;
    const end =
      activeMode === "idle"
        ? DEALER_FILM.idleEnd
        : DEALER_FILM.sceneOffset + DEALER_FILM.actionEnd + 0.1;
    if (mediaTime < expected - 0.06 || mediaTime >= end) return;
    presented = true;
    pending = false;
    state.frameReady = true;
    state.mediaTime = mediaTime - DEALER_FILM.sceneOffset;
    if (bridge) {
      bridge.style.visibility = "hidden";
      bridge.dataset.held = "false";
    }
  };
  const decoded = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    present(metadata.mediaTime);
    if (!disposed) callback = video.requestVideoFrameCallback(decoded);
  };
  if (decodedFrames) callback = video.requestVideoFrameCallback(decoded);
  const seeked = () => {
    if (!decodedFrames) present(video.currentTime);
  };
  video.addEventListener("seeked", seeked);

  return {
    state,
    update(target: PlaybackTarget) {
      if (disposed) return;
      if (!target.enabled) {
        video.pause();
        suspended = true;
        state.frameReady = false;
        return;
      }
      const changed = activeMode !== target.mode || activeKey !== target.key;
      const resume = suspended;
      suspended = false;
      activeMode = target.mode;
      activeKey = target.key;
      state.mode = target.mode;
      // The hand camera moves into place before leaving the waiting pose.
      if (target.mode === "hold") {
        video.pause();
        state.frameReady = false;
        return;
      }
      const idle = target.mode === "idle";
      if (
        changed ||
        resume ||
        target.resync ||
        (idle && video.currentTime >= DEALER_FILM.idleEnd - 0.055)
      ) {
        video.playbackRate = 1;
        seek(idle ? 0 : DEALER_FILM.sceneOffset + target.mediaTime);
      }
      if (target.mode === "rest") video.pause();
      else play();
      if (!decodedFrames) present(video.currentTime);
    },
    dispose() {
      disposed = true;
      if (decodedFrames) video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeked", seeked);
      video.pause();
      if (bridge) {
        bridge.style.visibility = "hidden";
        bridge.dataset.held = "false";
      }
    },
  };
}
