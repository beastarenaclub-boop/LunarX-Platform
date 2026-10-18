// Storefront presentation is independent of the server's B2C/B2B account channel.
// Both Crypto777 player domains share this design and the existing game routes.
const storefrontHosts = (import.meta.env.VITE_B2C_HOSTS ?? "")
  .split(",")
  .map((host: string) => host.trim().toLowerCase())
  .filter(Boolean);
export const B2C_STANDALONE =
  import.meta.env.VITE_LOBBY_VARIANT === "b2c" ||
  (typeof window !== "undefined" && storefrontHosts.includes(window.location.hostname.toLowerCase()));
export const B2C_BRAND = import.meta.env.VITE_B2C_BRAND?.trim() || "CRYPTO777";
export const B2C_HEADLINE = "Every Game. A New Thrill.";
export const B2C_ICON = `${import.meta.env.BASE_URL}media/b2c/brand-icon.svg`;
export const B2C_LOGO =
  import.meta.env.VITE_B2C_LOGO?.trim() ||
  `${import.meta.env.BASE_URL}media/b2c/brand-logo.png`;
export const B2C_HOME = B2C_STANDALONE ? "/" : "/b2c";
export const CRYPTO777_PLAY_URLS = {
  normal: "https://crypto777.in/",
  agent: "https://play.crypto777.in/",
  panel: "https://panel.lunarx.live/agent/",
} as const;
