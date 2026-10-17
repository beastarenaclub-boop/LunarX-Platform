import { env } from "cloudflare:workers";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { PORTALS, portalLabel, type Portal } from "../src/live/portals";
import { loginLocation, clearConnectedLocation } from "./location-access";
import { requireEntry } from "./entry-access";

const COOKIE = "syndicate_session";
const TTL = 8 * 60 * 60;
const sql = (query: string, ...values: unknown[]) =>
  env.DB!.prepare(query).bind(...values);
export class LoginError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const deny = (status: number, message: string): never => {
  throw new LoginError(status, message);
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("hex");
function cookie(request: Request, value: string, age = TTL) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function token(request: Request) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1) || ""
  );
}
function validPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 12 || p.length > 128)
    deny(400, "Use a password of 12–128 characters.");
  return p as string;
}
function passwordHash(
  password: string,
  salt = randomBytes(24).toString("hex"),
) {
  const key = scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$3$${salt}$${key.toString("hex")}`;
}
function matches(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$3")
    return false;
  const result = passwordHash(password, parts[4]).split("$")[5];
  const expected = Buffer.from(parts[5], "hex"),
    actual = Buffer.from(result, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function passwordIdentity(request: Request) {
  const value = token(request);
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const row = await sql(
    "SELECT a.id,a.identity,a.email,a.name,a.signup_portal,s.location FROM login_sessions s JOIN login_accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires_at>? AND s.location IS NOT NULL",
    digest(value),
    Date.now(),
  ).first<any>();
  return row
    ? {
        userId: row.identity,
        email: row.email,
        displayName: row.name,
        accountId: row.id,
        signupPortal: row.signup_portal as Portal,
        loginLocation: row.location as string,
      }
    : null;
}
async function rateLimit(request: Request, email: string) {
  const ip = import.meta.env.DEV
    ? "loopback"
    : request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  for (const [key, maximum] of [
    ["email:" + digest(email), 12],
    ["ip:" + digest(ip), 60],
  ] as const) {
    const result = await sql(
      "INSERT INTO login_limits(key,count,ends_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ends_at<=? THEN 1 ELSE count+1 END,ends_at=CASE WHEN ends_at<=? THEN excluded.ends_at ELSE ends_at END RETURNING count",
      key,
      now + 15 * 60 * 1000,
      now,
      now,
    ).first<any>();
    if (result.count > maximum)
      deny(429, "Too many login attempts. Try again in 15 minutes.");
  }
}
async function session(
  request: Request,
  account: string,
  expectedHash: string,
  location: string,
  extras: object = {},
) {
  const value = random();
  const result = await env.DB!.batch([
    sql("DELETE FROM login_sessions WHERE expires_at<=?", Date.now()),
    sql(
      "INSERT INTO login_sessions(hash,account_id,expires_at,location) SELECT ?,id,?,? FROM login_accounts WHERE id=? AND password_hash=?",
      digest(value),
      Date.now() + TTL * 1000,
      location,
      account,
      expectedHash,
    ),
    sql(
      "INSERT INTO audit(id,actor,action,subject,detail,ip,country,city,location,user_agent,created_at) SELECT ?,m.id,'Login location',m.id,'Location required at sign-in; browser-reported approximate position.',?,NULL,NULL,?,?,? FROM login_accounts a JOIN members m ON m.identity=a.identity WHERE a.id=? AND changes()=1",
      crypto.randomUUID(),
      import.meta.env.DEV
        ? "127.0.0.1"
        : request.headers.get("cf-connecting-ip") || "Unavailable",
      location,
      (request.headers.get("user-agent") || "").slice(0, 300),
      new Date().toISOString(),
      account,
    ),
  ]);
  if (result[1].meta.changes !== 1)
    deny(409, "Login credentials changed. Sign in again.");
  return Response.json(
    { ok: true, ...extras },
    {
      headers: {
        "Set-Cookie": cookie(request, value),
        "Cache-Control": "no-store",
      },
    },
  );
}
export async function passwordAction(
  request: Request,
  path: string,
  b: any,
): Promise<Response | null> {
  if (!path.startsWith("auth/")) return null;
  if (path === "auth/logout") {
    await sql(
      "DELETE FROM login_sessions WHERE hash=?",
      digest(token(request)),
    ).run();
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie(request, "", 0));
    headers.append("Set-Cookie", await clearConnectedLocation(request));
    return Response.json({ ok: true }, { headers });
  }
  if (
    ![
      "auth/signup",
      "auth/login",
      "auth/recover",
      "auth/change-password",
    ].includes(path)
  )
    deny(404, "Unknown login action.");
  if (path !== "auth/change-password") await requireEntry(request);
  const location = loginLocation(b.location);
  const me =
    path === "auth/change-password" ? await passwordIdentity(request) : null;
  if (path === "auth/change-password" && !me)
    deny(401, "Sign in with your email and password first.");
  const portal = b.portal as Portal | undefined;
  if (portal !== undefined && !PORTALS.includes(portal))
    deny(400, "Choose a valid portal.");
  const email = String(me?.email || b.email || "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    deny(400, "Enter a valid email address.");
  await rateLimit(request, email);
  const account = await sql(
    "SELECT * FROM login_accounts WHERE email=?",
    email,
  ).first<any>();
  if (path === "auth/signup") {
    const signupPortal = portal || "member";
    const workspace = await sql(
      "SELECT id FROM settings WHERE id='workspace'",
    ).first();
    if (signupPortal !== "member")
      deny(
        403,
        "Only member signup is available. Agent access is earned through approved onboarding and two approved direct members. Admin access is managed by the existing owner.",
      );
    if (!workspace)
      deny(
        409,
        "The administrator must prepare the workspace before member registration opens.",
      );
    const password = validPassword(b.password);
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 2 || name.length > 80)
      deny(400, "Enter your name (2–80 characters).");
    if (account)
      deny(
        409,
        "An account already uses this email. Sign in or recover access.",
      );
    const existing = await sql(
      "SELECT id FROM members WHERE lower(email)=?",
      email,
    ).first();
    if (existing)
      deny(
        409,
        "This email already belongs to a connected-sign-in profile. Use that sign-in method.",
      );
    const id = crypto.randomUUID(),
      recoveryCode = random(),
      hashed = passwordHash(password);
    await sql(
      "INSERT INTO login_accounts(id,email,name,identity,password_hash,recovery_hash,created_at,signup_portal) VALUES(?,?,?,?,?,?,?,?)",
      id,
      email,
      name,
      "email:" + id,
      hashed,
      digest(recoveryCode),
      new Date().toISOString(),
      "member",
    ).run();
    return session(request, id, hashed, location, { recoveryCode });
  }
  if (path === "auth/login") {
    const password =
      typeof b.password === "string" && b.password.length <= 128
        ? b.password
        : "";
    const valid = matches(
      password,
      account?.password_hash ||
        "scrypt$32768$8$3$000000000000000000000000000000000000000000000000$" +
          "0".repeat(128),
    );
    if (!account || !valid) deny(401, "Email or password is incorrect.");
    if (portal) {
      const profile = await sql(
        "SELECT m.role,m.status,(SELECT count(*) FROM members c WHERE c.parent=m.id AND c.status='Approved') approved_children FROM members m WHERE m.identity=?",
        account.identity,
      ).first<any>();
      const actual = profile
        ? profile.role === "admin"
          ? "admin"
          : profile.status === "Approved" && profile.approved_children === 2
            ? "agent"
            : "member"
        : "member";
      if (portal !== actual && !(portal === "member" && actual === "agent"))
        deny(
          403,
          actual === "member" && portal === "agent"
            ? "Agent access needs your approved profile and two approved direct members. Continue through Member login."
            : `This account uses ${portalLabel(actual)} login. Open /${actual}/login.`,
        );
    }
    return session(request, account.id, account.password_hash, location);
  }
  const password = validPassword(b.password);
  if (path === "auth/change-password") {
    if (
      typeof b.currentPassword !== "string" ||
      b.currentPassword.length > 128 ||
      !account ||
      !matches(b.currentPassword, account.password_hash)
    )
      deny(401, "Current password is incorrect.");
  } else if (
    !account ||
    typeof b.recoveryCode !== "string" ||
    b.recoveryCode.length !== 64 ||
    digest(b.recoveryCode) !== account.recovery_hash
  ) {
    deny(401, "Email or recovery code is incorrect.");
  }
  const recoveryCode = random(),
    hashed = passwordHash(password);
  // The old hash is an optimistic lock: a recovery code cannot be used twice concurrently.
  const changed = await sql(
    "UPDATE login_accounts SET password_hash=?,recovery_hash=? WHERE id=? AND password_hash=? AND recovery_hash=?",
    hashed,
    digest(recoveryCode),
    account.id,
    account.password_hash,
    account.recovery_hash,
  ).run();
  if (changed.meta.changes !== 1) deny(409, "Account changed. Sign in again.");
  await sql("DELETE FROM login_sessions WHERE account_id=?", account.id).run();
  return session(request, account.id, hashed, location, { recoveryCode });
}
