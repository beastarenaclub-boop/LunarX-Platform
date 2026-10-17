/** Try on entry, then retry in a trusted gesture if the browser blocked audio.
 * Callers keep their own mute, visibility and current-round checks. */
export function installAudioAutostart(start: () => void | Promise<void>) {
  let disposed = false;
  const attempt = () => {
    if (disposed || document.hidden) return;
    try { void Promise.resolve(start()).catch(() => {}); } catch { /* Optional audio. */ }
  };
  const gestures = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
  for (const event of gestures) window.addEventListener(event, attempt, true);
  window.addEventListener("pageshow", attempt);
  document.addEventListener("visibilitychange", attempt);
  attempt();
  return () => {
    disposed = true;
    for (const event of gestures) window.removeEventListener(event, attempt, true);
    window.removeEventListener("pageshow", attempt);
    document.removeEventListener("visibilitychange", attempt);
  };
}
