import { env } from "cloudflare:workers";
import { createHash, randomBytes, randomInt } from "node:crypto";

export const ENTRY_COOKIE = "syndicate_entry";
const sql = (query: string, ...values: unknown[]) =>
  env.DB!.prepare(query).bind(...values);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class EntryError extends Error {
  status = 403;
}
type Entry = {
  hash: string;
  stage: string;
  key_spot: number;
  walk_after: number;
  expires_at: number;
};
export function entryToken(request: Request) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(ENTRY_COOKIE + "="))
      ?.slice(ENTRY_COOKIE.length + 1) || ""
  );
}
async function entry(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return sql(
    "SELECT * FROM entry_sessions WHERE hash=? AND expires_at>?",
    hash(value),
    Date.now(),
  ).first<Entry>();
}
export async function entryComplete(value: string) {
  return (await entry(value))?.stage === "complete";
}
export async function requireEntry(request: Request) {
  if (!(await entryComplete(entryToken(request))))
    throw new EntryError(
      "Complete the triangle, passage and key-lock game before opening account access.",
    );
}

// A browser-session cookie opens account access, not an authenticated account.
// The server checks each game stage. This is an entrance flow, not an anti-bot test.
export async function entryAction(request: Request, path: string, input: any) {
  if (!path.startsWith("entry/")) return null;
  const action = path.slice(6);
  const response = (body: unknown, cookie?: string) =>
    Response.json(body, {
      headers: {
        "Cache-Control": "private, no-store",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    });
  if (action === "start") {
    const value = randomBytes(32).toString("hex");
    await env.DB!.batch([
      sql(
        "DELETE FROM entry_sessions WHERE expires_at<=? OR hash=?",
        Date.now(),
        hash(entryToken(request)),
      ),
      sql(
        "INSERT INTO entry_sessions(hash,stage,key_spot,walk_after,expires_at) VALUES (?,'puzzle',?,0,?)",
        hash(value),
        randomInt(3),
        Date.now() + 60 * 60 * 1000,
      ),
    ]);
    return response(
      { ok: true },
      `${ENTRY_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    );
  }
  const current = await entry(entryToken(request));
  if (!current)
    throw new EntryError(
      "Entry session expired. Restart the game to continue.",
    );
  const advance = async (
    from: string,
    to: string,
    extra = "",
    values: unknown[] = [],
  ) => {
    const changed = await sql(
      `UPDATE entry_sessions SET stage=?${extra} WHERE hash=? AND stage=? AND expires_at>?`,
      to,
      ...values,
      current.hash,
      from,
      Date.now(),
    ).run();
    if (changed.meta.changes !== 1)
      throw new EntryError("Game state changed. Restart the entry game.");
  };
  if (action === "puzzle" && current.stage === "puzzle") {
    if (
      !Array.isArray(input.angles) ||
      input.angles.length !== 3 ||
      !input.angles.every((value: unknown) => value === 0)
    )
      throw new EntryError("Align all three triangle fragments first.");
    const walkAfter = Date.now() + 1800;
    await advance("puzzle", "passage", ",walk_after=?", [walkAfter]);
    return response({ ok: true, walkAfter });
  }
  if (action === "arrive" && ["passage", "chamber"].includes(current.stage)) {
    if (Date.now() < current.walk_after)
      throw new EntryError("Finish the passage before searching for the key.");
    if (current.stage === "passage") await advance("passage", "chamber");
    return response({ ok: true });
  }
  if (action === "search" && ["chamber", "found"].includes(current.stage)) {
    if (!Number.isInteger(input.spot) || input.spot < 0 || input.spot > 2)
      throw new EntryError("Choose a place inside the key chamber.");
    const found = input.spot === current.key_spot;
    if (found && current.stage === "chamber") await advance("chamber", "found");
    return response({ ok: true, found });
  }
  if (action === "pickup" && ["found", "key"].includes(current.stage)) {
    if (current.stage === "found") await advance("found", "key");
    return response({ ok: true });
  }
  if (action === "unlock" && ["key", "complete"].includes(current.stage)) {
    if (current.stage === "key")
      await advance("key", "complete", ",expires_at=?", [
        Date.now() + 8 * 60 * 60 * 1000,
      ]);
    return response({ ok: true });
  }
  throw new EntryError(
    "Finish the earlier game stages before opening the gate.",
  );
}
