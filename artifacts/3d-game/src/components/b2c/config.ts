// A shared deployment can serve the B2C storefront on its own domain while
// retaining the existing lobby on all other hosts. Separate B2C builds also work.
const storefrontHosts = (import.meta.env.VITE_B2C_HOSTS ?? "")
  .split(",")
  .map((host: string) => host.trim().toLowerCase())
  .filter(Boolean);
export const B2C_STANDALONE =
  import.meta.env.VITE_LOBBY_VARIANT === "b2c" ||
  (typeof window !== "undefined" && storefrontHosts.includes(window.location.hostname.toLowerCase()));
export const B2C_BRAND = import.meta.env.VITE_B2C_BRAND?.trim() || "CRYPTO777";
export const B2C_LOGO =
  import.meta.env.VITE_B2C_LOGO?.trim() ||
  `${import.meta.env.BASE_URL}media/b2c/brand-logo.png`;
export const B2C_HOME = B2C_STANDALONE ? "/" : "/b2c";
