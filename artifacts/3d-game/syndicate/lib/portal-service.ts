import { env } from "cloudflare:workers";
import { entryAction, EntryError } from "./entry-access";
import {
  visitorPublic,
  visitorAdmin,
  readVisitorBody,
  VisitorError,
} from "./visitor-service";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { LoginError, passwordAction, passwordIdentity } from "./password-auth";
import {
  LocationError,
  loginLocation,
  connectedLocation,
  grantConnectedLocation,
} from "./location-access";
import { BANKS } from "../src/live/banks";
import { RewardError, rewardAction, rewardSnapshot } from "./rewards-service";
import { performanceReport } from "./performance-service";
import {
  DOCUMENT_KINDS,
  PLAN,
  amountPaise,
  accountProofKind,
  isDate,
  progress,
  type LiveMember,
  type Profile,
  type DocumentRecord,
} from "../src/live/types";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: number, message: string): never => {
  throw new HttpError(code, message);
};
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
function database() {
  if (!env.DB) fail(503, "Database is unavailable.");
  return env.DB!;
}
function bucket() {
  if (!env.BUCKET) fail(503, "Document storage is unavailable.");
  return env.BUCKET!;
}
const stmt = (sql: string, ...args: unknown[]) =>
  database()
    .prepare(sql)
    .bind(...args);
const rows = async <T = any>(sql: string, ...args: unknown[]) =>
  (await stmt(sql, ...args).all<T>()).results;
const one = async <T = any>(sql: string, ...args: unknown[]) =>
  stmt(sql, ...args).first<T>();
function text(v: unknown, max = 160, min = 1): string {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
    fail(400, `Enter a text value of ${min}–${max} characters.`);
  return (v as string).trim();
}
const member = (r: any): LiveMember => ({
  ...r,
  profile: JSON.parse(r.profile || "{}"),
});
async function members() {
  return (await rows("SELECT * FROM members ORDER BY created_at")).map(member);
}
function branch(all: LiveMember[], id: string) {
  const result = new Set([id]);
  for (let n = 0; n < all.length; n++) {
    let changed = false;
    for (const m of all)
      if (m.parent && result.has(m.parent) && !result.has(m.id)) {
        result.add(m.id);
        changed = true;
      }
    if (!changed) break;
  }
  return result;
}
function access(m: LiveMember, all: LiveMember[]) {
  return m.role === "admin"
    ? "admin"
    : m.status === "Approved" &&
        all.filter((c) => c.parent === m.id && c.status === "Approved")
          .length === 2
      ? "agent"
      : "user";
}
async function digest(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function auth(request: Request, allowToken = false) {
  if (
    allowToken &&
    request.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    const hash = await digest(request.headers.get("authorization")!.slice(7));
    const token = await one(
      "SELECT * FROM api_tokens WHERE hash=? AND revoked_at IS NULL",
      hash,
    );
    if (!token) fail(401, "Invalid API token.");
    const r = await one(
      "SELECT * FROM members WHERE id=? AND role=?",
      token.owner,
      "admin",
    );
    if (!r) fail(403, "Token owner is not an administrator.");
    const recent = await one(
      "SELECT COUNT(*) n FROM audit WHERE actor=? AND action=? AND created_at>?",
      r.id,
      "API import",
      new Date(Date.now() - 60000).toISOString(),
    );
    if (recent.n >= 60) fail(429, "Import limit reached. Retry in one minute.");
    return {
      user: { userId: r.identity, email: r.email, displayName: r.name },
      me: member(r),
      api: true,
    };
  }
  const passwordUser = await passwordIdentity(request);
  const connectedUser = passwordUser ? null : await getChatGPTUser();
  // The old portable preview identity is not a real authenticated account.
  const user =
    passwordUser ||
    (connectedUser?.userId === "local_seedy" ? null : connectedUser);
  if (!user) fail(401, "Sign in to continue.");
  const position =
    passwordUser?.loginLocation ||
    (await connectedLocation(request, user!.userId));
  if (!position)
    throw new LocationError(
      "Location access is required before opening your account.",
    );
  const r = await one("SELECT * FROM members WHERE identity=?", user!.userId);
  return {
    user: { ...user!, loginLocation: position },
    me: r ? member(r) : null,
    api: false,
  };
}
function requireMember(m: LiveMember | null): LiveMember {
  if (!m) fail(403, "Complete signup first.");
  return m!;
}
function admin(m: LiveMember) {
  if (m.role !== "admin") fail(403, "Administrator access required.");
}
function checkOrigin(request: Request) {
  const o = request.headers.get("origin");
  if (o && o !== new URL(request.url).origin)
    fail(403, "Cross-origin writes are not allowed.");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    fail(403, "Cross-site writes are not allowed.");
  if (
    !/^(application\/json|multipart\/form-data)/.test(
      request.headers.get("content-type") || "",
    )
  )
    fail(415, "Use JSON or multipart form data.");
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "JSON object required.");
  const decoder = new TextDecoder();
  let raw = "",
    size = 0;
  while (true) {
    const chunk = await reader!.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 100000) {
      await reader!.cancel();
      fail(413, "Request too large.");
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result))
      fail(400, "JSON object required.");
    return result;
  } catch {
    fail(400, "Invalid JSON.");
  }
}
function auditStmt(
  request: Request,
  actor: string,
  action: string,
  subject: string,
  detail: string,
  location: string | null = null,
  onlyAfterChange = false,
) {
  const local = import.meta.env.DEV;
  const cf = (request as Request & { cf?: { country?: string; city?: string } })
    .cf;
  return stmt(
    "INSERT INTO audit(id,actor,action,subject,detail,ip,country,city,location,user_agent,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?" +
      (onlyAfterChange ? " WHERE changes()=1" : ""),
    uid(),
    actor,
    action,
    subject,
    detail,
    local
      ? "127.0.0.1"
      : request.headers.get("cf-connecting-ip") || "Unavailable",
    local ? null : cf?.country || request.headers.get("cf-ipcountry"),
    local ? null : cf?.city || null,
    location,
    (request.headers.get("user-agent") || "").slice(0, 300),
    now(),
  );
}
async function auditLog(
  request: Request,
  actor: string,
  action: string,
  subject: string,
  detail: string,
  location: string | null = null,
) {
  await auditStmt(request, actor, action, subject, detail, location).run();
}
async function saveProfile(
  m: LiveMember,
  p: Profile,
  status: string,
  revision: number,
) {
  const result = await stmt(
    "UPDATE members SET profile=?,status=?,revision=revision+1 WHERE id=? AND revision=?",
    JSON.stringify(p),
    status,
    m.id,
    revision,
  ).run();
  if (result.meta.changes !== 1)
    fail(409, "Profile changed in another session. Refresh and retry.");
}
function validateProfile(p: Profile, draft = false) {
  if (!p || typeof p !== "object") fail(400, "Profile is required.");
  if (!draft || p.firm) text(p.firm, 120);
  if (
    (!draft || p.gst) &&
    (!p.gst || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(p.gst))
  )
    fail(400, "Enter a valid-format 15-character GSTIN.");
  if (
    !Array.isArray(p.contacts) ||
    p.contacts.length > 2 ||
    (!draft && p.contacts.length !== 2)
  )
    fail(400, "Add two registered contact references.");
  p.contacts!.forEach((c) => {
    text(c.label, 50);
    if (!(draft && c.last4 === "") && !/^\d{4}$/.test(c.last4))
      fail(400, "Enter only four contact digits.");
  });
  if (
    !Array.isArray(p.accounts) ||
    p.accounts.length > 7 ||
    p.accounts.filter((a) => a.type === "Current").length > 5 ||
    p.accounts.filter((a) => a.type === "Savings").length > 2 ||
    (!draft &&
      (p.accounts.length !== 7 ||
        p.accounts.filter((a) => a.type === "Current").length !== 5 ||
        p.accounts.filter((a) => a.type === "Savings").length !== 2))
  )
    fail(400, "Add five current and two savings account references.");
  const ids = new Set<string>();
  const pairs = new Set<string>();
  p.accounts!.forEach((a) => {
    if (
      !BANKS.includes(a.bank) ||
      !["Current", "Savings"].includes(a.type) ||
      !/^\d{4}$/.test(a.last4) ||
      a.owned !== true ||
      ![0, 1].includes(a.contact)
    )
      fail(400, "Complete bank, account ownership and contact references.");
    text(a.holder, 120);
    text(a.id, 80);
    if (ids.has(a.id) || pairs.has(a.bank + "-" + a.last4))
      fail(400, "Duplicate account reference.");
    ids.add(a.id);
    pairs.add(a.bank + "-" + a.last4);
    if (a.type === "Current" && ![5000000, 10000000].includes(a.requestedLimit))
      fail(400, "Choose a requested daily limit.");
  });
  if (p.ownership !== true || p.consent !== true)
    fail(400, "Confirm ownership and review consent.");
}
async function snapshot(request: Request) {
  const { user, me } = await auth(request);
  const workspace = await one(
    "SELECT value FROM settings WHERE id=?",
    "workspace",
  );
  const settings = workspace
    ? JSON.parse(workspace.value)
    : {
        company: "SYNDICATE",
        business: "",
        license: "",
      };
  const signupPortal = "signupPortal" in user ? user.signupPortal : "member";
  if (!me)
    return {
      identity: {
        name: user.displayName,
        email: user.email,
        passwordLogin: "accountId" in user,
        signupPortal,
      },
      me: null,
      setupRequired: !workspace,
      settings,
      members: [],
      documents: [],
      tasks: [],
      entries: [],
      audit: [],
      tokens: [],
      serverTime: now(),
    };
  const all = await members();
  me.role = access(me, all);
  const byId = new Map(all.map((m) => [m.id, m]));
  const sponsorFor = (m: LiveMember) => {
    const sponsor = m.parent ? byId.get(m.parent) : undefined;
    return sponsor
      ? { id: sponsor.id, name: sponsor.name, ref: sponsor.ref }
      : null;
  };
  const scope =
    me.role === "admin" ? new Set(all.map((m) => m.id)) : branch(all, me.id);
  const docs = await rows<DocumentRecord>(
    "SELECT id,member_id,kind,name,mime,size,created_at FROM documents",
  );
  const privateRecord = (id: string) => me.role === "admin" || id === me.id;
  return {
    identity: {
      name: user.displayName,
      email: user.email,
      passwordLogin: "accountId" in user,
      signupPortal,
    },
    me: { ...me, sponsor: sponsorFor(me), identity: undefined },
    registrations:
      me.role === "admin"
        ? await rows(
            "SELECT a.id,a.name,a.email,a.created_at FROM login_accounts a LEFT JOIN members m ON m.identity=a.identity WHERE m.id IS NULL ORDER BY a.created_at DESC",
          )
        : [],
    setupRequired: false,
    rewards: await rewardSnapshot(me, all),
    settings,
    members: all
      .filter((m) => scope.has(m.id))
      .map((m) => ({
        ...m,
        sponsor: sponsorFor(m),
        role: access(m, all),
        identity: undefined,
        email: privateRecord(m.id) ? m.email : undefined,
        accountCount: m.profile.accounts?.length || 0,
        onboardingPercent: progress(m, docs).percent,
        documentCount: docs.filter((d) => d.member_id === m.id).length,
        profile: privateRecord(m.id)
          ? m.profile
          : { firm: m.profile.firm, plan: m.profile.plan },
      })),
    documents: docs.filter((d) => privateRecord(d.member_id)),
    tasks: (await rows("SELECT * FROM tasks ORDER BY created_at DESC")).filter(
      (t) =>
        me.role === "admin" ||
        t.assignee === me.id ||
        (me.role === "agent" && scope.has(t.assignee)),
    ),
    entries:
      me.role === "admin"
        ? await rows("SELECT * FROM entries ORDER BY date DESC,created_at DESC")
        : await rows(
            "SELECT * FROM entries WHERE member_id=? ORDER BY date DESC,created_at DESC",
            me.id,
          ),
    audit:
      me.role === "admin"
        ? await rows("SELECT * FROM audit ORDER BY created_at DESC LIMIT 250")
        : await rows(
            "SELECT * FROM audit WHERE actor=? ORDER BY created_at DESC LIMIT 100",
            me.id,
          ),
    tokens:
      me.role === "admin"
        ? await rows(
            "SELECT id,name,created_at,revoked_at FROM api_tokens ORDER BY created_at DESC",
          )
        : [],
    serverTime: now(),
  };
}

export async function handle(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\//, "");
    if (path === "visitors" || path.startsWith("visitors/")) {
      // Bound and consume writes before rejecting them, so a rejected request
      // cannot leave unread bytes on a reused local-worker connection.
      const payload =
        request.method === "POST" ? await readVisitorBody(request) : undefined;
      if (request.method === "POST") checkOrigin(request);
      const publicResponse = await visitorPublic(request, path, payload);
      if (publicResponse) return publicResponse;
      const actor = requireMember((await auth(request)).me);
      admin(actor);
      return await visitorAdmin(request, path, (action, subject) =>
        auditLog(request, actor.id, action, subject, "Visitor check-in"),
      );
    }
    if (request.method === "GET" && path === "state")
      return respond(await snapshot(request));
    if (
      request.method === "GET" &&
      /^members\/[^/]+\/performance$/.test(path)
    ) {
      const actor = requireMember((await auth(request)).me);
      const all = await members();
      const id = path.split("/")[1];
      const selected = all.find((m) => m.id === id);
      if (!selected) fail(404, "Member not found.");
      const role = access(actor, all);
      if (
        role !== "admin" &&
        actor.id !== id &&
        !(role === "agent" && branch(all, actor.id).has(id))
      )
        fail(
          403,
          "You can view only your own or your agent team's performance.",
        );
      const query = new URL(request.url).searchParams;
      const from = query.get("from") ?? "2000-01-01";
      const to =
        query.get("to") ??
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
      if (!isDate(from) || !isDate(to) || from > to)
        fail(400, "Choose a valid performance date range.");
      return respond(
        await performanceReport(selected!, actor, all, { from, to }),
      );
    }
    if (request.method === "GET" && path.startsWith("documents/")) {
      const actor = requireMember((await auth(request)).me);
      const doc = await one(
        "SELECT * FROM documents WHERE id=?",
        path.slice(10),
      );
      if (!doc) fail(404, "Document not found.");
      if (actor.role !== "admin" && doc.member_id !== actor.id)
        fail(403, "This document is private.");
      const file = await bucket().get(doc.object_key);
      if (!file) fail(404, "Stored file unavailable.");
      const inline = new URL(request.url).searchParams.get("view") === "1";
      await auditLog(
        request,
        actor.id,
        inline ? "Document previewed" : "Document downloaded",
        doc.member_id,
        doc.kind,
      );
      return new Response(file!.body, {
        headers: {
          "Content-Type": doc.mime,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.name.replace(/[^\w. -]/g, "_")}"`,
          "Content-Security-Policy": "frame-ancestors 'self'",
          "X-Frame-Options": "SAMEORIGIN",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (request.method !== "POST") fail(405, "Method not allowed.");
    if (Number(request.headers.get("content-length") || 0) > 20 * 1024 * 1024)
      fail(413, "File too large.");
    const input = path === "documents" ? null : await body(request);
    checkOrigin(request);
    const entrance = await entryAction(request, path, input);
    if (entrance) return entrance;
    if (path === "auth/connected-location") {
      const user = await getChatGPTUser();
      if (!user || user.userId === "local_seedy")
        fail(401, "Sign in to continue.");
      const position = loginLocation(input.location);
      const cookie = await grantConnectedLocation(
        request,
        user!.userId,
        position,
      );
      const profile = await one(
        "SELECT id FROM members WHERE identity=?",
        user!.userId,
      );
      if (profile)
        await auditLog(
          request,
          profile.id,
          "Login location",
          profile.id,
          "Location required at sign-in; browser-reported approximate position.",
          position,
        );
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
      );
    }
    const loginResponse = await passwordAction(request, path, input);
    if (loginResponse) return loginResponse;
    const { user, me, api } = await auth(request, path === "entries");
    if (path === "register") {
      if (me) fail(409, "This identity already has a profile.");
      const b = input;
      const name = text(b.name, 80);
      const city = text(b.city, 80);
      const company = await one(
        "SELECT value FROM settings WHERE id=?",
        "workspace",
      );
      const id = uid();
      const ref = "SYN-" + id.slice(0, 8).toUpperCase();
      if (!company)
        fail(
          409,
          "The existing administrator must prepare the workspace before members can join.",
        );
      const sponsor = await one(
        "SELECT * FROM members WHERE ref=?",
        text(b.ref, 40).toUpperCase(),
      );
      if (!sponsor) fail(400, "Referral ID not found.");
      const children = await rows(
        "SELECT position FROM members WHERE parent=?",
        sponsor.id,
      );
      if (children.length >= 2)
        fail(
          409,
          "Both direct positions are filled. Choose a downline sponsor with an open position.",
        );
      const parent = sponsor.id;
      const position = children.some((c) => c.position === "left")
        ? "right"
        : "left";
      const prefs = Array.isArray(b.banks) ? b.banks : [];
      if (
        prefs.length !== 5 ||
        prefs.some((v: unknown) => !BANKS.includes(String(v)))
      )
        fail(400, "Choose five bank preferences.");
      const commands = [
        stmt(
          "INSERT INTO members(id,identity,email,name,city,ref,parent,position,role,status,profile,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          user.userId,
          user.email,
          name,
          city,
          ref,
          parent,
          position,
          "user",
          "Draft",
          JSON.stringify({ plan: PLAN, bankPreferences: prefs }),
          now(),
        ),
        auditStmt(
          request,
          id,
          "Profile created",
          id,
          "Authenticated profile registered.",
          "loginLocation" in user ? user.loginLocation : null,
        ),
      ];
      try {
        await database().batch(commands);
      } catch (e) {
        if (String(e).includes("UNIQUE"))
          fail(409, "Registration changed concurrently. Refresh and retry.");
        throw e;
      }
      return respond({ ok: true });
    }
    const actor = requireMember(me);
    const all = await members();
    const actorRole = access(actor, all);
    if (path === "admin-invitations" || path === "admin-invitations/revoke") {
      admin(actor);
      fail(
        410,
        "Admin signup and invitations are disabled. Only member registration is available.",
      );
    }
    if (path === "workspace") {
      admin(actor);
      const value = {
        company: text(input.company, 100),
        business: text(input.business, 300),
        license: text(input.license, 200),
      };
      await stmt(
        "UPDATE settings SET value=? WHERE id='workspace'",
        JSON.stringify(value),
      ).run();
      await auditLog(
        request,
        actor.id,
        "Workspace updated",
        actor.id,
        "Company declarations updated by administrator.",
      );
      return respond({ ok: true });
    }
    if (path === "session") {
      const recent = await one(
        "SELECT id FROM audit WHERE actor=? AND action=? AND created_at>?",
        actor.id,
        "Session access",
        new Date(Date.now() - 300000).toISOString(),
      );
      if (!recent)
        await auditLog(
          request,
          actor.id,
          "Session access",
          actor.id,
          "Authenticated workspace access. IP is a connection address, not proof of identity.",
        );
      if (actor.role === "admin")
        await stmt(
          "DELETE FROM audit WHERE created_at<?",
          new Date(Date.now() - 90 * 86400000).toISOString(),
        ).run();
      return respond({ ok: true });
    }
    if (path === "documents") return await upload(request, actor);
    const b = input;
    const rewardResponse = await rewardAction(
      path,
      b,
      actor,
      all,
      (action, subject, detail) =>
        auditLog(request, actor.id, action, subject, detail),
    );
    if (rewardResponse) return rewardResponse;
    if (path === "profile") {
      if (["In review", "Approved"].includes(actor.status))
        fail(409, "Request a review reset before editing a submitted profile.");
      const p = b.profile as Profile;
      validateProfile(p, b.draft === true);
      const otherIds = new Set(
        all
          .filter((m) => m.id !== actor.id)
          .flatMap((m) => m.profile.accounts || [])
          .map((a) => a.id),
      );
      if (p.accounts!.some((a) => otherIds.has(a.id)))
        fail(409, "An account identifier is already in use. Reload the form.");
      const clean: Profile = {
        firm: p.firm,
        gst: p.gst,
        plan: PLAN,
        bankPreferences: actor.profile.bankPreferences,
        reviewNote: actor.profile.reviewNote,
        contacts: p.contacts!.map((c) => ({ label: c.label, last4: c.last4 })),
        accounts: p.accounts!.map((a) => ({
          id: a.id,
          bank: a.bank,
          type: a.type,
          last4: a.last4,
          holder: a.holder,
          contact: a.contact,
          requestedLimit: a.type === "Current" ? a.requestedLimit : 0,
          approvedLimit: 0,
          status: "Pending",
          owned: true,
        })),
        ownership: true,
        consent: true,
      };
      await saveProfile(actor, clean, "Draft", Number(b.revision));
      await auditLog(
        request,
        actor.id,
        "Profile updated",
        actor.id,
        "Masked account and business references saved.",
      );
      return respond({ ok: true });
    }
    if (path === "submit-profile") {
      if (!["Draft", "Changes requested"].includes(actor.status))
        fail(409, "Profile already submitted.");
      validateProfile(actor.profile);
      if (
        !progress(
          actor,
          await rows<DocumentRecord>(
            "SELECT * FROM documents WHERE member_id=?",
            actor.id,
          ),
        ).complete
      )
        fail(400, "Complete all documents before submitting.");
      await saveProfile(actor, actor.profile, "In review", Number(b.revision));
      await auditLog(
        request,
        actor.id,
        "Profile submitted",
        actor.id,
        "Awaiting manual review.",
      );
      return respond({ ok: true });
    }
    if (path === "review-profile") {
      admin(actor);
      const target = all.find((m) => m.id === b.member);
      if (!target || target.role === "admin")
        fail(400, "Choose a member profile.");
      const m = target!;
      const p = { ...m.profile, reviewNote: text(b.note, 500) };
      if (b.decision === "reset")
        await saveProfile(m, p, "Changes requested", Number(b.revision));
      else {
        if (m.status !== "In review")
          fail(409, "Profile is not awaiting review.");
        if (!["approve", "changes"].includes(b.decision))
          fail(400, "Unknown decision.");
        if (b.decision === "approve") {
          validateProfile(p);
          if (
            !progress(
              m,
              await rows<DocumentRecord>(
                "SELECT * FROM documents WHERE member_id=?",
                m.id,
              ),
            ).complete
          )
            fail(400, "Checklist incomplete.");
          p.accounts = p.accounts!.map((a) => {
            const limit = a.type === "Current" ? Number(b.limits?.[a.id]) : 0;
            if (
              a.type === "Current" &&
              (!Number.isSafeInteger(limit) ||
                limit < 5000000 ||
                limit > 10000000)
            )
              fail(
                400,
                "Record the evidenced bank-approved limit between 50 lakh and 1 crore for each current account.",
              );
            return { ...a, approvedLimit: limit, status: "Approved" };
          });
        }
        await saveProfile(
          m,
          p,
          b.decision === "approve" ? "Approved" : "Changes requested",
          Number(b.revision),
        );
      }
      await auditLog(
        request,
        actor.id,
        "Profile review",
        m.id,
        `${b.decision}: ${b.note}`,
      );
      return respond({ ok: true });
    }
    if (path === "tasks") {
      if (actorRole === "user")
        fail(403, "Agent eligibility is required for assignment.");
      const target = all.find((m) => m.id === b.assignee);
      if (!target || target.status !== "Approved")
        fail(400, "Choose an approved member.");
      if (
        actorRole !== "admin" &&
        (!branch(all, actor.id).has(target!.id) || target!.id === actor.id)
      )
        fail(403, "Choose your approved downline.");
      if (!isDate(b.due)) fail(400, "Invalid due date.");
      const title = text(b.title, 120);
      await database().batch([
        stmt(
          "INSERT INTO tasks(id,title,description,assignee,assigned_by,due,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
          uid(),
          title,
          text(b.description, 1000),
          target!.id,
          actor.id,
          b.due,
          "To do",
          now(),
        ),
        auditStmt(request, actor.id, "Task assigned", target!.id, title),
      ]);
      return respond({ ok: true });
    }
    if (path === "task-status") {
      const t = await one("SELECT * FROM tasks WHERE id=?", b.id);
      if (!t) fail(404, "Task not found.");
      const transitions: Record<string, string> = {
        "To do": "In progress",
        "In progress": "In review",
        "In review": "Complete",
      };
      if (transitions[t.status] !== b.status)
        fail(409, "Invalid or stale task transition.");
      if (
        b.status === "Complete"
          ? actor.role !== "admin" &&
            (actorRole !== "agent" || t.assigned_by !== actor.id)
          : t.assignee !== actor.id
      )
        fail(403, "You cannot change this task.");
      const changed = await stmt(
        "UPDATE tasks SET status=?,completed_at=? WHERE id=? AND status=?",
        b.status,
        b.status === "Complete" ? now() : null,
        t.id,
        t.status,
      ).run();
      if (changed.meta.changes !== 1)
        fail(409, "Task changed in another session. Refresh and retry.");
      await auditLog(
        request,
        actor.id,
        "Task " + b.status,
        t.assignee,
        t.title,
      );
      return respond({ ok: true });
    }
    if (path === "entries") {
      if (b.allowance === true) {
        admin(actor);
        if (api) fail(400, "Record allowances from the administrator panel.");
        if (b.kind !== "Income")
          fail(400, "Allowances must be income records.");
      }
      if (
        !["Income", "Expense", "Turnover"].includes(b.kind) ||
        !isDate(b.date)
      )
        fail(400, "Invalid transaction kind or date.");
      const target = all.find((m) => m.id === (b.member || actor.id));
      if (!target) fail(400, "Member not found.");
      if (actor.role !== "admin" && target!.id !== actor.id)
        fail(403, "Only submit your own records.");
      if (target!.status !== "Approved")
        fail(400, "Onboarding approval is required.");
      const account = b.account
        ? target!.profile.accounts?.find((a) => a.id === b.account)
        : null;
      if (b.account && !account)
        fail(400, "Account does not belong to this member.");
      if (b.kind === "Turnover" && account?.status !== "Approved")
        fail(400, "Turnover requires an approved account.");
      const ref = text(b.reference, 120);
      const amount = amountPaise(b.amount);
      const existing = await one(
        "SELECT * FROM entries WHERE reference=?",
        ref,
      );
      if (existing) {
        if (
          existing.member_id === target!.id &&
          existing.kind === b.kind &&
          existing.amount_paise === amount &&
          existing.date === b.date &&
          (existing.source === "Allowance") === (b.allowance === true) &&
          existing.account_id === (account?.id || null)
        )
          return respond({ ok: true, duplicate: true, id: existing.id });
        fail(409, "Reference already belongs to a different transaction.");
      }
      const id = uid();
      await database().batch([
        stmt(
          "INSERT INTO entries(id,member_id,account_id,kind,amount_paise,reference,description,date,status,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          target!.id,
          account?.id || null,
          b.kind,
          amount,
          ref,
          text(b.description, 500),
          b.date,
          "Pending",
          api ? "API" : b.allowance === true ? "Allowance" : "Manual",
          actor.id,
          now(),
        ),
        auditStmt(
          request,
          actor.id,
          api ? "API import" : "Transaction recorded",
          target!.id,
          `${b.kind} ${ref} · pending review`,
        ),
      ]);
      return respond({ ok: true, id });
    }
    if (path === "review-entry") {
      admin(actor);
      if (!["Approved", "Rejected"].includes(b.status))
        fail(400, "Invalid review status.");
      const e = await one("SELECT * FROM entries WHERE id=?", b.id);
      if (!e) fail(404, "Entry not found.");
      if (
        b.status === "Approved" &&
        e.kind === "Expense" &&
        !(await one(
          "SELECT id FROM documents WHERE member_id=? AND kind=?",
          e.member_id,
          "Expense receipt:" + e.id,
        ))
      )
        fail(400, "Upload the expense receipt before approval.");
      const r = await stmt(
        "UPDATE entries SET status=?,reviewed_by=? WHERE id=? AND status=?",
        b.status,
        actor.id,
        e.id,
        "Pending",
      ).run();
      if (r.meta.changes !== 1) fail(409, "Entry already reviewed.");
      await auditLog(
        request,
        actor.id,
        "Transaction " + b.status,
        e.member_id,
        e.reference,
      );
      return respond({ ok: true });
    }
    if (path === "location") {
      if (
        b.consent !== true ||
        !Number.isFinite(b.latitude) ||
        !Number.isFinite(b.longitude) ||
        Math.abs(b.latitude) > 90 ||
        Math.abs(b.longitude) > 180
      )
        fail(400, "Location requires consent and valid coordinates.");
      const location = JSON.stringify({
        latitude: Number(b.latitude.toFixed(2)),
        longitude: Number(b.longitude.toFixed(2)),
        accuracy: Number.isFinite(b.accuracy) ? Math.round(b.accuracy) : null,
        consentAt: now(),
      });
      await auditLog(
        request,
        actor.id,
        "Location shared",
        actor.id,
        "User shared an approximate position.",
        location,
      );
      return respond({ ok: true });
    }
    if (path === "tokens") {
      admin(actor);
      const secret =
        "syn_" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      await stmt(
        "INSERT INTO api_tokens(id,name,hash,owner,created_at) VALUES(?,?,?,?,?)",
        uid(),
        text(b.name, 80),
        await digest(secret),
        actor.id,
        now(),
      ).run();
      await auditLog(
        request,
        actor.id,
        "API token created",
        actor.id,
        "Transaction-ingestion token created.",
      );
      return respond({ ok: true, token: secret });
    }
    if (path === "revoke-token") {
      admin(actor);
      await stmt(
        "UPDATE api_tokens SET revoked_at=? WHERE id=?",
        now(),
        b.id,
      ).run();
      await auditLog(
        request,
        actor.id,
        "API token revoked",
        actor.id,
        String(b.id),
      );
      return respond({ ok: true });
    }
    return fail(404, "Endpoint not found.");
  } catch (e) {
    if (
      e instanceof HttpError ||
      e instanceof RewardError ||
      e instanceof LoginError ||
      e instanceof LocationError ||
      e instanceof EntryError ||
      e instanceof VisitorError
    )
      return respond({ error: e.message }, e.status);
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message))
      return respond(
        {
          error:
            "This record was saved concurrently. Refresh and retry with the same reference.",
        },
        409,
      );
    if (e instanceof Error && /amount|decimal/i.test(e.message))
      return respond({ error: e.message }, 400);
    console.error(
      "Portal request failed:",
      e instanceof Error ? e.message : "Unknown error",
    );
    return respond(
      { error: "Request could not be completed. Refresh and try again." },
      500,
    );
  }
}
async function upload(request: Request, actor: LiveMember) {
  const form = await request.formData();
  let kind = String(form.get("kind"));
  let owner = actor.id;
  let guard =
    "EXISTS(SELECT 1 FROM members WHERE id=? AND revision=? AND status NOT IN ('In review','Approved'))";
  let guardArgs: unknown[] = [actor.id, actor.revision];
  if (kind === "Expense receipt") {
    const entry = await one(
      "SELECT * FROM entries WHERE id=? AND kind='Expense'",
      String(form.get("entryId")),
    );
    if (!entry || (entry.member_id !== actor.id && actor.role !== "admin"))
      fail(403, "Choose your own expense record.");
    if (entry.status !== "Pending")
      fail(409, "Receipts cannot change after an expense has been reviewed.");
    owner = entry.member_id;
    kind = "Expense receipt:" + entry.id;
    guard = "EXISTS(SELECT 1 FROM entries WHERE id=? AND status='Pending')";
    guardArgs = [entry.id];
  } else if (["In review", "Approved"].includes(actor.status)) {
    fail(409, "Request a review reset before editing documents.");
  } else if (kind === "Bank account proof") {
    const account = actor.profile.accounts?.find(
      (a) => a.id === form.get("accountId"),
    );
    if (!account)
      fail(400, "Save your account details before uploading its bank proof.");
    kind = accountProofKind(account!);
  } else if (!(DOCUMENT_KINDS as readonly string[]).includes(kind))
    fail(400, "Unknown document kind.");
  const value = form.get("file");
  if (
    !(value instanceof File) ||
    value.size === 0 ||
    value.size > 15 * 1024 * 1024
  )
    fail(400, "Choose a file under 15 MB.");
  const file = value as File;
  const h = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const pdf = String.fromCharCode(...h.slice(0, 5)) === "%PDF-";
  const png = h[0] === 137 && h[1] === 80 && h[2] === 78 && h[3] === 71;
  const jpg = h[0] === 255 && h[1] === 216 && h[2] === 255;
  const mp4 = String.fromCharCode(...h.slice(4, 8)) === "ftyp";
  const webm = h[0] === 26 && h[1] === 69 && h[2] === 223 && h[3] === 163;
  if (kind === "Video KYC" ? !(mp4 || webm) : !(pdf || png || jpg))
    fail(
      400,
      kind === "Video KYC" ? "Upload MP4 or WebM." : "Upload PDF, JPG or PNG.",
    );
  const mime = mp4
    ? "video/mp4"
    : webm
      ? "video/webm"
      : pdf
        ? "application/pdf"
        : png
          ? "image/png"
          : "image/jpeg";
  const id = uid(),
    key = owner + "/" + id;
  const old = await one(
    "SELECT * FROM documents WHERE member_id=? AND kind=?",
    owner,
    kind,
  );
  await bucket().put(key, file.stream(), {
    httpMetadata: { contentType: mime },
  });
  try {
    const saved = await database().batch([
      stmt(
        "INSERT INTO documents(id,member_id,kind,name,mime,size,object_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE " +
          guard +
          " ON CONFLICT(member_id,kind) DO UPDATE SET id=excluded.id,name=excluded.name,mime=excluded.mime,size=excluded.size,object_key=excluded.object_key,created_at=excluded.created_at",
        id,
        owner,
        kind,
        file.name.slice(0, 120),
        mime,
        file.size,
        key,
        now(),
        ...guardArgs,
      ),
      auditStmt(
        request,
        actor.id,
        "Document uploaded",
        owner,
        kind.startsWith("Expense receipt:") ? "Expense receipt attached" : kind,
        null,
        true,
      ),
    ]);
    if (saved[0].meta.changes !== 1)
      fail(409, "Record changed during upload. Refresh before trying again.");
  } catch (e) {
    await bucket().delete(key);
    throw e;
  }
  if (old) await bucket().delete(old.object_key);
  return respond({ ok: true });
}
function respond(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
