import { useCallback, useEffect, useRef, useState } from "react";
import type { DealerClip } from "./dealerFilm";
import { preferLightMedia } from "@/lib/mediaProfile";

function chooseSource(clip: DealerClip) {
  if (!document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01F"')) return clip.fallbackScene;
  return preferLightMedia() ? clip.mobileScene : clip.scene;
}

/** Native range requests let the first frame play before the whole take arrives. */
export function useDealerClip(clip: DealerClip, disabled: boolean) {
  const [asset, setAsset] = useState(() => chooseSource(clip));
  const [failed, setFailed] = useState(false);
  const metadataReady = useRef<string | undefined>(undefined);
  const onReady = useCallback(() => { metadataReady.current = asset; }, [asset]);
  const fallback = useCallback(() => {
    if (asset === clip.scene) setAsset(clip.mobileScene);
    else if (asset === clip.mobileScene) setAsset(clip.fallbackScene);
    else setFailed(true);
  }, [asset, clip.scene, clip.mobileScene, clip.fallbackScene]);
  useEffect(() => {
    setFailed(false);
    if (disabled) return;
    // Some native decoders retry a failed range request without emitting an
    // error. A bounded first-header wait still reaches the smaller fallback.
    const timeout = window.setTimeout(() => {
      if (metadataReady.current !== asset) fallback();
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [asset, disabled, fallback]);
  const quality = asset === clip.scene ? clip.quality ?? "1080p"
    : asset === clip.mobileScene ? clip.mobileQuality ?? "720p" : clip.fallbackQuality ?? "720p";
  return { source: disabled ? undefined : asset, failed, onReady, onError: fallback, quality };
}
