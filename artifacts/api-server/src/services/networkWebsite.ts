import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function configuredOrigin(value: string | undefined, fallback: string) {
  const host = (value ?? fallback).split(",")[0]!.trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const url = new URL(`${local ? "http" : "https"}://${host}`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid network website host configuration");
  return url.origin;
}

export function networkWebsite(masterId: string, name: string, settings?: { brand_name?: unknown; logo_data?: unknown; custom_domain?: unknown; domain_status?: unknown }) {
  const website = configuredOrigin(process.env.PLAY_HOST ?? process.env.B2B_HOSTS, "localhost:5202");
  const defaultUrl = `${website}/branch/${encodeURIComponent(masterId)}/`;
  const url = settings?.domain_status === "active" && settings.custom_domain ? `https://${settings.custom_domain}/` : defaultUrl;
  return {
    masterId,
    name: String(settings?.brand_name || name),
    logoUrl: settings?.logo_data ? String(settings.logo_data) : null,
    domain: new URL(url).host,
    defaultUrl,
    url,
    loginUrl: `${url}login`,
  };
}

export async function masterWebsite(masterId: string) {
  const result = await db.execute(sql`SELECT n.id,n.name,w.brand_name,w.logo_data,w.custom_domain,w.domain_status
    FROM network_nodes n LEFT JOIN network_websites w ON w.master_id=n.id
    JOIN users u ON u.id=n.user_id WHERE n.id=${masterId} AND n.kind='master' AND n.status='active' AND u.status='active'`);
  const row = result.rows[0];
  return row ? networkWebsite(String(row.id),String(row.name),row) : null;
}

export async function domainMaster(host: string | undefined): Promise<string | null> {
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  const result = await db.execute(sql`SELECT master_id FROM network_websites WHERE custom_domain=${host.toLowerCase()} AND domain_status='active'`);
  return result.rows[0] ? String(result.rows[0].master_id) : null;
}
