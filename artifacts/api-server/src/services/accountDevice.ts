import { isIP } from "node:net";

export function normalizeIp(value: string | null | undefined) {
  const ip = (value ?? "").replace(/^::ffff:/i, "");
  return isIP(ip) ? ip : null;
}

export function deviceDetails(
  raw: string | null,
  hints: Record<string, string> = {},
) {
  const ua = (hints.userAgent || raw || "").slice(0, 1024);
  const unquote = (s: string | undefined) =>
    (s ?? "").replace(/^"|"$/g, "").slice(0, 120);
  const match = (pattern: RegExp) =>
    ua.match(pattern)?.[1]?.replaceAll("_", ".") ?? "";
  let browser = "Unknown",
    version = "";
  for (const [name, pattern] of [
    ["Edge", /Edg(?:A|iOS)?\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ] as const) {
    const found = match(pattern);
    if (found) {
      browser = name;
      version = found;
      break;
    }
  }
  const platform = unquote(hints.platform);
  const os =
    platform ||
    (/Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown");
  const osVersion =
    unquote(hints.platformVersion) ||
    (os === "Android"
      ? match(/Android ([\d.]+)/)
      : os === "iOS"
        ? match(/(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/)
        : "");
  const hintedModel = unquote(hints.model);
  const legacyModel = ua
    .match(
      /Android [^;)]*;\s*(?:[a-z]{2}[-_][A-Z]{2};\s*)?([^;)]+?)(?: Build\/[^;)]*)?\)/,
    )?.[1]
    ?.trim();
  const model =
    hintedModel ||
    (legacyModel && legacyModel !== "K"
      ? legacyModel
      : /iPad/.test(ua)
        ? "iPad (model not provided)"
        : /iPhone/.test(ua)
          ? "iPhone (model not provided)"
          : null);
  const type = /bot|crawler|spider/i.test(ua)
    ? "bot"
    : /iPad|Tablet/i.test(ua)
      ? "tablet"
      : hints.mobile === "?1" || /Mobile|iPhone|Android/i.test(ua)
        ? "mobile"
        : ua
          ? "desktop"
          : "unknown";
  return {
    browser,
    version,
    os,
    osVersion,
    model,
    type,
    userAgent: ua,
    reported: true,
  };
}
