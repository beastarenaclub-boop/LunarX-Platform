import { B2C_BRAND, B2C_HEADLINE, B2C_ICON } from "./config";

export function applyB2CBranding() {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const previousIcon = icon?.getAttribute("href");
  document.title = `${B2C_BRAND} | ${B2C_HEADLINE}`;
  icon?.setAttribute("href", B2C_ICON);
  return () => {
    if (previousIcon) icon?.setAttribute("href", previousIcon);
  };
}
