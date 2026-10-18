import { open, type CityResponse, type Reader } from "maxmind";
import { normalizeIp } from "./accountDevice";

let database: Promise<Reader<CityResponse> | null> | undefined;
export async function approximateLocation(value: string | null) {
  const ip = normalizeIp(value);
  const empty = {
    country: null,
    region: null,
    city: null,
    approximate: true as const,
    source: "DB-IP Lite",
    databaseMonth: "2026-10",
  };
  if (!ip) return { ...empty, status: "unavailable" };
  database ??= open<CityResponse>(
    process.env.GEOIP_CITY_DB ?? "/app/geo/dbip-city-lite.mmdb",
  ).catch(() => null);
  const reader = await database;
  if (!reader) return { ...empty, status: "database_unavailable" };
  try {
    const result = reader.get(ip);
    if (!result) return { ...empty, status: "unavailable" };
    return {
      ...empty,
      country: result.country?.names?.en ?? null,
      region: result.subdivisions?.[0]?.names?.en ?? null,
      city: result.city?.names?.en ?? null,
      status: "approximate",
    };
  } catch {
    return { ...empty, status: "unavailable" };
  }
}
