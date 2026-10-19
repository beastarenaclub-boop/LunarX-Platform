import mobileFilms from "./mobile-game-media.json";

/** Decide once per mounted player so resizing cannot restart a live take. */
export function preferLightMedia() {
  const device = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return window.matchMedia("(max-width: 760px)").matches
    || !!device.connection?.saveData
    || (device.deviceMemory != null && device.deviceMemory <= 4)
    || /(^|-)2g$/.test(device.connection?.effectiveType ?? "");
}

export function mobileGameMedia(key: keyof typeof mobileFilms) {
  return `${import.meta.env.BASE_URL}media/performance/${mobileFilms[key].src}`;
}
