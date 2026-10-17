import { env } from "cloudflare:workers";
import { createHash, randomBytes } from "node:crypto";

export class LocationError extends Error {
  status = 428;
}
export function loginLocation(value: any): string {
  const current = Date.now();
  if (
    !value ||
    value.consent !== true ||
    !Number.isFinite(value.latitude) ||
    Math.abs(value.latitude) > 90 ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.longitude) > 180 ||
    !Number.isFinite(value.accuracy) ||
    value.accuracy < 0 ||
    !Number.isFinite(value.capturedAt) ||
    current - value.capturedAt > 120000 ||
    value.capturedAt > current + 30000
  )
    throw new LocationError(
      "Allow browser location and obtain a current position before signing in.",
    );
  return JSON.stringify({
    latitude: Number(value.latitude.toFixed(2)),
    longitude: Number(value.longitude.toFixed(2)),
    accuracy: Math.round(value.accuracy),
    capturedAt: new Date(value.capturedAt).toISOString(),
    consentAt: new Date(current).toISOString(),
    source: "Browser-reported location",
  });
}
const COOKIE = "syndicate_location";
const ttl = 8 * 60 * 60;
const sql = (query: string, ...args: unknown[]) =>
  env.DB!.prepare(query).bind(...args);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = (request: Request) =>
  (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1) || "";
const cookie = (request: Request, value: string, age = ttl) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;

export async function connectedLocation(request: Request, identity: string) {
  const value = token(request);
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return (
    (
      await sql(
        "SELECT location FROM location_sessions WHERE hash=? AND identity=? AND expires_at>?",
        digest(value),
        identity,
        Date.now(),
      ).first<{ location: string }>()
    )?.location || null
  );
}
export async function grantConnectedLocation(
  request: Request,
  identity: string,
  location: string,
) {
  const value = randomBytes(32).toString("hex");
  await env.DB!.batch([
    sql(
      "DELETE FROM location_sessions WHERE expires_at<=? OR hash=?",
      Date.now(),
      digest(token(request)),
    ),
    sql(
      "INSERT INTO location_sessions(hash,identity,location,expires_at) VALUES(?,?,?,?)",
      digest(value),
      identity,
      location,
      Date.now() + ttl * 1000,
    ),
  ]);
  return cookie(request, value);
}
export async function clearConnectedLocation(request: Request) {
  await sql(
    "DELETE FROM location_sessions WHERE hash=?",
    digest(token(request)),
  ).run();
  return cookie(request, "", 0);
}
