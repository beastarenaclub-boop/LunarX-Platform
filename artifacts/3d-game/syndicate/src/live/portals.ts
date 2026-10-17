export const PORTALS = ["admin", "agent", "member"] as const;
export type Portal = (typeof PORTALS)[number];
export const portalLabel = (portal: Portal) =>
  portal.charAt(0).toUpperCase() + portal.slice(1);
export const rolePortal = (role: string): Portal =>
  role === "admin" ? "admin" : role === "agent" ? "agent" : "member";
export const portalPath = (portal: Portal, screen = "dashboard") =>
  `/${portal}/${screen}`;
