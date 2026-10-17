import type { Request } from "express";

function hosts(value: string | undefined, fallback: string) {
  return (value ?? fallback)
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function requestSite(
  req: Pick<Request, "headers">,
): "b2c" | "b2b" | "operator" {
  const host = (req.headers.host ?? "").toLowerCase();
  if (
    hosts(process.env.B2B_HOSTS, "localhost:5202,127.0.0.1:5202").includes(host)
  )
    return "b2b";
  if (
    hosts(process.env.OPERATOR_HOSTS, "localhost:5176,127.0.0.1:5176").includes(
      host,
    )
  )
    return "operator";
  return "b2c";
}

type PanelRequest = Pick<Request, "headers"> & { url?: string };

export function requestOperatorPanel(req: PanelRequest): "master" | "agent" | null {
  if (requestSite(req) !== "operator") return null;
  let panel = req.headers["x-operator-panel"];
  // Browsers cannot add headers to a WebSocket handshake.
  if (!panel && req.url) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/ws" || url.pathname === "/api/ws")
      panel = url.searchParams.get("panel") ?? undefined;
  }
  return panel === "master" || panel === "agent" ? panel : null;
}

export function sessionCookie(req: PanelRequest) {
  const site = requestSite(req);
  const panel = requestOperatorPanel(req);
  if (panel) return `sid_${panel}`;
  // Retain compatibility for older clients; scoped panels never read this cookie.
  return site === "b2c" ? "sid" : `sid_${site}`;
}
