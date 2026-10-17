import { env } from "cloudflare:workers";
import { createHash, randomBytes } from "node:crypto";
import { loginLocation } from "./location-access";
import { VISITOR_CONSENT_VERSION } from "../src/live/visitor-types";

export const VISITOR_COOKIE = "syndicate_visitor";
const COOKIE = VISITOR_COOKIE;
const MAX_BODY = 700 * 1024;
const sql = (query: string, ...values: unknown[]) =>
  env.DB!.prepare(query).bind(...values);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const date = () => new Date().toISOString();
export class VisitorError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new VisitorError(status, message);
};
const respond = (body: unknown, cookie?: string) =>
  Response.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
const token = (request: Request) =>
  (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1) || "";
export const visitorToken = token;
export async function visitorComplete(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) return false;
  return !!(await sql(
    "SELECT v.id FROM visitor_checkins v JOIN visitor_sessions s ON s.hash=v.session_hash WHERE s.hash=? AND s.expires_at>?",
    digest(value),
    Date.now(),
  ).first());
}
const cookie = (request: Request, value: string, age = 86400) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
const localRequest = (request: Request) =>
  import.meta.env.DEV ||
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
const ip = (request: Request) =>
  localRequest(request)
    ? "127.0.0.1"
    : request.headers.get("cf-connecting-ip") || "Unavailable";
export async function readVisitorBody(request: Request, max = MAX_BODY) {
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "Request body required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > max) {
      // Discard the remainder without buffering it. Cancelling this stream
      // leaves the local Worker's reused connection unusable after the 413.
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk.value);
  }
  if (length > max) return fail(413, "Photo request is too large.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function session(request: Request) {
  const value = token(request);
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return sql(
    "SELECT hash FROM visitor_sessions WHERE hash=? AND expires_at>?",
    digest(value),
    Date.now(),
  ).first<{ hash: string }>();
}
async function limit(request: Request) {
  const now = Date.now();
  const result = await sql(
    "INSERT INTO login_limits(key,count,ends_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ends_at<=? THEN 1 ELSE count+1 END,ends_at=CASE WHEN ends_at<=? THEN excluded.ends_at ELSE ends_at END RETURNING count",
    "visitor:" + digest(ip(request)),
    now + 15 * 60000,
    now,
    now,
  ).first<{ count: number }>();
  if (result!.count > 20)
    fail(429, "Too many visitor check-ins. Retry in 15 minutes.");
}
async function remove(id: string, key: string) {
  await env.BUCKET!.delete(key);
  await sql("DELETE FROM visitor_checkins WHERE id=?", id).run();
}
function validJpeg(bytes: Uint8Array) {
  if (
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    return false;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 192 || marker === 194) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      return width >= 32 && height >= 32 && width <= 1024 && height <= 1024;
    }
    if (marker === 218) return false;
    offset += length;
  }
  return false;
}

export async function visitorPublic(
  request: Request,
  path: string,
  raw = new Uint8Array(),
): Promise<Response | null> {
  if (path === "visitors/mine" && request.method === "GET") {
    const current = await session(request);
    const saved =
      current &&
      (await sql(
        "SELECT id,created_at FROM visitor_checkins WHERE session_hash=?",
        current.hash,
      ).first());
    return respond({ saved: saved || null });
  }
  if (path === "visitors/start" && request.method === "POST") {
    if (raw.length > 8000) return fail(413, "Consent request is too large.");
    let input: any;
    try {
      input = JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
      if (error instanceof VisitorError) throw error;
      return fail(400, "Invalid consent request.");
    }
    if (input?.consent !== true || input.version !== VISITOR_CONSENT_VERSION)
      return fail(400, "Read and accept visitor photo consent first.");
    await limit(request);
    const existing = await session(request);
    if (existing) return respond({ ok: true });
    const value = randomBytes(32).toString("hex");
    await env.DB!.batch([
      sql("DELETE FROM visitor_sessions WHERE expires_at<=?", Date.now()),
      sql(
        "INSERT INTO visitor_sessions(hash,expires_at) VALUES(?,?)",
        digest(value),
        Date.now() + 86400000,
      ),
    ]);
    return respond({ ok: true }, cookie(request, value));
  }
  if (path === "visitors/withdraw" && request.method === "POST") {
    const current = await session(request);
    if (!current) return fail(403, "This browser's visitor receipt expired.");
    await sql("DELETE FROM visitor_sessions WHERE hash=?", current.hash).run();
    const row = await sql(
      "SELECT id,object_key FROM visitor_checkins WHERE session_hash=?",
      current.hash,
    ).first<any>();
    if (row) await remove(row.id, row.object_key);
    return respond({ ok: true }, cookie(request, "", 0));
  }
  if (path !== "visitors/check-in" || request.method !== "POST") return null;
  const current = await session(request);
  if (!current) return fail(403, "Start a consented visitor check-in first.");
  let form: FormData;
  try {
    form = await new Response(raw, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    return fail(400, "Use a camera photo form.");
  }
  if (
    form.get("consent") !== "true" ||
    form.get("version") !== VISITOR_CONSENT_VERSION
  )
    return fail(400, "Visitor photo consent is required.");
  let location: string;
  try {
    location = loginLocation(JSON.parse(String(form.get("location"))));
  } catch {
    return fail(
      400,
      "A current consented browser location is required. Refresh location and retry.",
    );
  }
  const photo = form.get("photo");
  if (
    !(photo instanceof File) ||
    photo.type !== "image/jpeg" ||
    photo.size < 64 ||
    photo.size > 512 * 1024
  )
    return fail(400, "Use a JPEG camera photo under 512 KB.");
  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (!validJpeg(bytes))
    return fail(400, "Camera photo is invalid or larger than 1024 pixels.");
  const name = String(form.get("name") || "Visitor").trim();
  if (!name || name.length > 80)
    return fail(400, "Visitor name must be 1 to 80 characters.");
  const previous = await sql(
    "SELECT id FROM visitor_checkins WHERE session_hash=?",
    current.hash,
  ).first<any>();
  if (previous) return respond({ ok: true, id: previous.id });
  const id = crypto.randomUUID();
  const key = `visitors/${id}.jpg`;
  const cf = (request as Request & { cf?: { country?: string; city?: string } })
    .cf;
  const timestamp = date();
  await env.BUCKET!.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  try {
    const saved = await sql(
      "INSERT INTO visitor_checkins(id,session_hash,name,object_key,size,ip,country,city,location,user_agent,consent_version,consent_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM visitor_sessions WHERE hash=? AND expires_at>?)",
      id,
      current.hash,
      name,
      key,
      bytes.length,
      ip(request),
      localRequest(request) ? null : cf?.country || null,
      localRequest(request) ? null : cf?.city || null,
      location,
      (request.headers.get("user-agent") || "").slice(0, 300),
      VISITOR_CONSENT_VERSION,
      timestamp,
      timestamp,
      current.hash,
      Date.now(),
    ).run();
    if (saved.meta.changes !== 1)
      fail(403, "Visitor consent session expired or was withdrawn.");
  } catch (error) {
    await env.BUCKET!.delete(key);
    const concurrent = await sql(
      "SELECT id FROM visitor_checkins WHERE session_hash=?",
      current.hash,
    ).first<any>();
    if (concurrent) return respond({ ok: true, id: concurrent.id });
    throw error;
  }
  return respond({ ok: true, id });
}

// Caller authenticates an administrator (including the required login location).
export async function visitorAdmin(
  request: Request,
  path: string,
  log: (action: string, subject: string) => Promise<void>,
) {
  if (path === "visitors" && request.method === "GET") {
    const value = Number(new URL(request.url).searchParams.get("offset") || 0);
    const offset = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const count = await sql(
      "SELECT COUNT(*) total FROM visitor_checkins",
    ).first<{ total: number }>();
    const rows = await sql(
      "SELECT id,name,size,ip,country,city,location,user_agent,consent_version,consent_at,created_at FROM visitor_checkins ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?",
      offset,
    ).all();
    return respond({ records: rows.results, total: count!.total, offset });
  }
  const match = /^visitors\/([a-f0-9-]{36})\/(photo|delete)$/.exec(path);
  if (!match) return fail(404, "Visitor endpoint not found.");
  const row = await sql(
    "SELECT id,object_key FROM visitor_checkins WHERE id=?",
    match[1],
  ).first<any>();
  if (!row) return fail(404, "Visitor record not found.");
  if (match[2] === "delete" && request.method === "POST") {
    await remove(row.id, row.object_key);
    await log("Visitor check-in deleted", row.id);
    return respond({ ok: true });
  }
  if (match[2] !== "photo" || request.method !== "GET")
    return fail(405, "Method not allowed.");
  const file = await env.BUCKET!.get(row.object_key);
  if (!file) return fail(404, "Visitor photo is unavailable.");
  await log("Visitor photo viewed", row.id);
  return new Response(file.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
      "Content-Disposition": `inline; filename="visitor-${row.id}.jpg"`,
    },
  });
}
