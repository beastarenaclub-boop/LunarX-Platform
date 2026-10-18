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

export function networkWebsite(masterId: string, name: string) {
  const website = configuredOrigin(process.env.B2B_HOSTS, "localhost:5202");
  const url = `${website}/branch/${encodeURIComponent(masterId)}/`;
  return {
    masterId,
    name,
    domain: new URL(website).host,
    url,
    loginUrl: `${url}login`,
  };
}
