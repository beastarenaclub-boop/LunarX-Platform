import { useCallback, useEffect, useState } from "react";
import type { DealerClip } from "./dealerFilm";

function chooseSource(clip: DealerClip) {
  if (!document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01F"')) return clip.fallbackScene;
  const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  const light = window.matchMedia("(max-width: 760px)").matches
    || device.connection?.saveData || (device.deviceMemory != null && device.deviceMemory <= 4)
    || /(^|-)2g$/.test(device.connection?.effectiveType ?? "");
  return light ? clip.mobileScene : clip.scene;
}

/** Download each take once, before a round needs it. */
export function useDealerClip(clip: DealerClip, disabled: boolean) {
  const [asset, setAsset] = useState(() => chooseSource(clip));
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  const fallback = useCallback(() => {
    if (asset === clip.scene) setAsset(clip.mobileScene);
    else if (asset === clip.mobileScene) setAsset(clip.fallbackScene);
    else setFailed(true);
  }, [asset, clip.scene, clip.mobileScene, clip.fallbackScene]);
  useEffect(() => {
    if (disabled) { setSource(undefined); return; }
    const controller = new AbortController();
    let url: string | undefined;
    setSource(undefined);
    setFailed(false);
    void fetch(asset, { signal: controller.signal, cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error("Dealer video unavailable");
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSource(url);
      })
      .catch(() => { if (!controller.signal.aborted) fallback(); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [asset, disabled, fallback]);
  const onError = useCallback(() => {
    // Some WebKit backends decode HTTP MP4 but reject the identical blob.
    if (source?.startsWith("blob:")) setSource(asset);
    else fallback();
  }, [source, asset, fallback]);
  const quality = asset === clip.scene ? clip.quality ?? "1080p"
    : asset === clip.mobileScene ? clip.mobileQuality ?? "720p" : clip.fallbackQuality ?? "720p";
  return { source, failed, onError, quality };
}
