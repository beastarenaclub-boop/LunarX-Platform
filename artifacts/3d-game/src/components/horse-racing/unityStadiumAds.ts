import {
  AD_SLOTS,
  activeStadiumCampaign,
  parseStadiumCampaigns,
  type AdSlot,
  type StadiumCampaign,
} from "./stadiumAdvertising";

/** Reuse the existing campaign schedule; Unity only receives decoded PNG pixels. */
export function unityStadiumAds(
  getVenue: () => string,
  send: (slot: AdSlot, image: string) => void,
) {
  let stopped = false,
    campaigns: StadiumCampaign[] = [],
    fetching = false;
  const abort = new AbortController(),
    current = new Map<AdSlot, string>(),
    retries = new Map<AdSlot, number>();
  const pending = new Set<HTMLImageElement>();
  const aspect = { trackside: 8, infield: 3, grandstand: 12, finish: 6 };
  async function refresh() {
    if (fetching) return;
    fetching = true;
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), 15000);
    const stop = () => timeout.abort();
    abort.signal.addEventListener("abort", stop, { once: true });
    try {
      const response = await fetch(
        "/assets/horse-racing/advertising/campaigns.json",
        { cache: "no-cache", signal: timeout.signal },
      );
      if (!response.ok) throw new Error("Campaign configuration unavailable");
      const json = await response.json();
      if (json?.version === 1 && Array.isArray(json.campaigns))
        campaigns = parseStadiumCampaigns(json);
    } catch {
      /* Keep the last valid schedule through temporary outages. */
    } finally {
      fetching = false;
      window.clearTimeout(timer);
      abort.signal.removeEventListener("abort", stop);
    }
    if (!stopped) update();
  }
  function update() {
    const now = Date.now();
    for (const slot of AD_SLOTS) {
      const active = activeStadiumCampaign(campaigns, slot, getVenue(), now),
        key = active ? `${active.id}:${active.imageUrl}` : "";
      if (current.get(slot) === key || (retries.get(slot) ?? 0) > now) continue;
      current.set(slot, key);
      send(slot, "");
      if (!active) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      pending.add(img);
      let finished = false;
      const timer = window.setTimeout(() => finish(false), 15000);
      function finish(ok: boolean) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        pending.delete(img);
        img.onload = img.onerror = null;
        if (stopped || current.get(slot) !== key) return;
        if (!ok) {
          current.delete(slot);
          retries.set(slot, now + 60000);
          return;
        }
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1024;
          canvas.height = Math.round(1024 / aspect[slot]);
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#103c35";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.min(
            canvas.width / img.naturalWidth,
            canvas.height / img.naturalHeight,
          );
          const w = img.naturalWidth * scale,
            h = img.naturalHeight * scale;
          context.drawImage(
            img,
            (canvas.width - w) / 2,
            (canvas.height - h) / 2,
            w,
            h,
          );
          send(slot, canvas.toDataURL("image/png").split(",")[1]);
        } catch {
          current.delete(slot);
          retries.set(slot, now + 60000);
        }
      }
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = active.imageUrl;
    }
  }
  void refresh();
  const refreshTimer = window.setInterval(refresh, 60000),
    scheduleTimer = window.setInterval(update, 1000);
  return () => {
    stopped = true;
    abort.abort();
    window.clearInterval(refreshTimer);
    window.clearInterval(scheduleTimer);
    for (const img of pending) {
      img.onload = img.onerror = null;
      img.src = "";
    }
    pending.clear();
  };
}
