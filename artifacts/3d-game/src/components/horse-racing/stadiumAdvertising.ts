export const AD_SLOTS = [
  "trackside",
  "infield",
  "grandstand",
  "finish",
] as const;
export type AdSlot = (typeof AD_SLOTS)[number];
export interface StadiumCampaign {
  id: string;
  slot: AdSlot;
  imageUrl: string;
  enabled: boolean;
  venues?: string[];
  startsAt?: number;
  endsAt?: number;
}
const VENUES = ["royal", "dubai", "alpine", "coast", "night", "marathon"];

/** Public artwork only; never execute markup or use advertising URLs as links. */
export function parseStadiumCampaigns(input: unknown): StadiumCampaign[] {
  if (!input || typeof input !== "object") return [];
  const data = input as Record<string, unknown>;
  if (data.version !== 1 || !Array.isArray(data.campaigns)) return [];
  const result: StadiumCampaign[] = [];
  const ids = new Set<string>();
  for (const item of data.campaigns.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      !/^[\w-]{1,64}$/.test(c.id) ||
      ids.has(c.id)
    )
      continue;
    if (
      !AD_SLOTS.includes(c.slot as AdSlot) ||
      typeof c.imageUrl !== "string" ||
      c.imageUrl.length > 2048
    )
      continue;
    // Same-origin files or CORS-enabled HTTPS artwork. Reject data/script URLs.
    if (
      !/^\/(?!\/)[^\\\s]*$/.test(c.imageUrl) &&
      !/^https:\/\/[^\s\\]+$/.test(c.imageUrl)
    )
      continue;
    if (c.enabled !== undefined && typeof c.enabled !== "boolean") continue;
    const date = (v: unknown) =>
      v === undefined || v === null
        ? undefined
        : typeof v === "string"
          ? Date.parse(v)
          : NaN;
    const startsAt = date(c.startsAt),
      endsAt = date(c.endsAt);
    if (
      (startsAt !== undefined && !Number.isFinite(startsAt)) ||
      (endsAt !== undefined && !Number.isFinite(endsAt))
    )
      continue;
    if (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt)
      continue;
    if (
      c.venues !== undefined &&
      (!Array.isArray(c.venues) ||
        !c.venues.length ||
        !c.venues.every((v) => typeof v === "string" && VENUES.includes(v)))
    )
      continue;
    ids.add(c.id);
    result.push({
      id: c.id,
      slot: c.slot as AdSlot,
      imageUrl: c.imageUrl,
      enabled: c.enabled !== false,
      venues: c.venues as string[] | undefined,
      startsAt,
      endsAt,
    });
  }
  return result;
}

export function activeStadiumCampaign(
  campaigns: StadiumCampaign[],
  slot: AdSlot,
  venue: string,
  now: number,
) {
  return campaigns.find(
    (c) =>
      c.slot === slot &&
      c.enabled &&
      (!c.venues || c.venues.includes(venue)) &&
      (c.startsAt === undefined || now >= c.startsAt) &&
      (c.endsAt === undefined || now < c.endsAt),
  );
}
