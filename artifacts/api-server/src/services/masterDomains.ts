import { resolveTxt, resolveCname, resolve4 } from "node:dns/promises";
import https from "node:https";
import { domainToASCII } from "node:url";
import { badRequest } from "../lib/errors";

export function cleanDomain(value: string) {
  const domain = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  )
    throw badRequest(
      "Enter a domain such as play.yourbrand.com, without https or a path",
    );
  const reserved = (
    process.env.RESERVED_PLAY_DOMAINS ?? "lunarx.live,crypto777.in,onrender.com"
  ).split(",");
  if (reserved.some((v) => domain === v || domain.endsWith(`.${v}`)))
    throw badRequest("Use your own domain; platform domains are reserved");
  return domain;
}
export const domainTarget = () =>
  process.env.PLAY_CNAME_TARGET ?? "lunarx-web.onrender.com";
export async function verifyOwnership(domain: string, token: string) {
  const records: string[][] = await resolveTxt(`_lunarx.${domain}`).catch(
    (): string[][] => [],
  );
  if (!records.some((r) => r.join("") === token))
    throw badRequest(
      "Ownership TXT record not found yet. Add the displayed record, then retry after DNS updates.",
    );
  const cname = await resolveCname(domain).catch(() => []);
  const addresses = await resolve4(domain).catch(() => []);
  // Render's documented apex address is also supported. Never probe arbitrary/private hosts.
  if (
    !cname.some((h) => h.replace(/\.$/, "") === domainTarget()) &&
    !(addresses.length && addresses.every((ip) => ip === "216.24.57.1"))
  )
    throw badRequest(
      "Point this domain to the displayed CNAME target (or apex A record) before verifying.",
    );
}
type ProviderDomain = {
  id: string;
  name: string;
  verificationStatus: string;
  redirectForName?: string;
};
export async function domainProvider(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const key = process.env.RENDER_DOMAINS_API_KEY;
  const service = process.env.RENDER_PLAYER_SERVICE_ID;
  if (!key || !service || !/^srv-[a-z0-9]+$/.test(service))
    throw badRequest(
      "Custom-domain activation is not configured. Contact the platform administrator.",
    );
  const response = await fetch(
    `https://api.render.com/v1/services/${service}/custom-domains${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (method==='DELETE' && response.status===404)return null;
  if (!response.ok)
    throw badRequest(
      `Domain hosting returned ${response.status}. Retry or contact the platform administrator.`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function provisionDomain(
  domain: string,
  existingId: string | null,
) {
  let id = existingId;
  if (!id) {
    // Safe retry after a provider success followed by an interrupted DB transaction.
    const list = await domainProvider(
      `?name=${encodeURIComponent(domain)}&limit=100`,
    );
    const found = list
      .map((v: { customDomain: ProviderDomain }) => v.customDomain)
      .find((v: ProviderDomain) => v.name === domain);
    const added: ProviderDomain[] = found
      ? [found]
      : await domainProvider("", "POST", { name: domain });
    id = added.find((v) => v.name === domain)?.id ?? null;
    if (!id)
      throw badRequest("Domain registration is pending. Retry verification.");
  }
  await domainProvider(`/${encodeURIComponent(id)}/verify`, "POST");
  const result: ProviderDomain = await domainProvider(
    `/${encodeURIComponent(id)}`,
  );
  return { id, verified: result.verificationStatus === "verified" };
}
export async function domainTlsReady(domain: string) {
  const ips = await resolve4(domain).catch(() => []);
  const publicIp = ips.find(
    (ip) =>
      !/^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|192\.0\.0|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|198\.(18|19)|22[4-9]|23\d|24\d|25[0-5])\./.test(
        ip,
      ),
  );
  if (!publicIp) return false;
  return new Promise<boolean>((resolve) => {
    const req = https.request(
      {
        hostname: domain,
        path: "/",
        method: "HEAD",
        servername: domain,
        lookup: ((_hostname: unknown, options: { all?: boolean }, cb: any) =>
          options?.all
            ? cb(null, [{ address: publicIp, family: 4 }])
            : cb(null, publicIp, 4)) as any,
        timeout: 8000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}
