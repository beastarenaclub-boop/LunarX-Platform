/** Only resume a local page after authentication, never another website. */
export function getLoginDestination(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next?.startsWith("/")) return "/";
  try {
    const target = new URL(next, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    const pathname = target.pathname.replace(/\/+$/, "").toLowerCase();
    if (["/login", "/signup", "/forgot", "/reset", "/launcher"].includes(pathname)) return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}
