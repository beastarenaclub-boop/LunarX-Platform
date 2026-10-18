import { randomBytes, randomUUID } from "node:crypto";

export const DEMO_TTL_MS = 60 * 60 * 1000;
export const DEMO_LIVE_MS = 60 * 1000;
export const DEMO_COINS = 1_000_000_000_000n;
export const isDemoToken = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("demo_");

export interface DemoSession {
  token: string;
  id: string;
  createdAt: number;
  expiresAt: number;
  lastSeen: number;
}

/** Anonymous, process-local presence. No IP, fingerprint, profile or persistence. */
export class DemoSessions {
  private sessions = new Map<string, DemoSession>();
  constructor(private now = Date.now, private capacity = 500) {}

  create() {
    this.prune();
    if (this.sessions.size >= this.capacity) throw new Error("DEMO_CAPACITY");
    const now = this.now();
    const session: DemoSession = {
      token: `demo_${randomBytes(32).toString("hex")}`,
      id: `demo-${randomUUID()}`,
      createdAt: now,
      expiresAt: now + DEMO_TTL_MS,
      lastSeen: now,
    };
    this.sessions.set(session.token, session);
    return session;
  }

  get(token: unknown) {
    if (typeof token !== "string") return undefined;
    const session = this.sessions.get(token);
    if (session && session.expiresAt > this.now()) return session;
    this.sessions.delete(token);
    return undefined;
  }

  touch(token: string) {
    const session = this.get(token);
    if (session) session.lastSeen = this.now();
    return session;
  }

  remove(token: string) { this.sessions.delete(token); }
  get size() { return this.sessions.size; }
  clear() { this.sessions.clear(); }
  prune() {
    const expired: DemoSession[] = [];
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= this.now()) {
        this.sessions.delete(token);
        expired.push(session);
      }
    }
    return expired;
  }
  liveCount() {
    this.prune();
    let count = 0;
    for (const session of this.sessions.values())
      if (this.now() - session.lastSeen < DEMO_LIVE_MS) count++;
    return count;
  }
}

export const demoSessions = new DemoSessions();

export function demoPublicUser(session: DemoSession) {
  return {
    id: session.id,
    email: "",
    displayName: `Demo ${session.id.slice(-6).toUpperCase()}`,
    role: "player" as const,
    status: "active" as const,
    referralCode: null,
    channel: "b2c" as const,
    isDemo: true,
    demoExpiresAt: new Date(session.expiresAt).toISOString(),
    createdAt: new Date(session.createdAt).toISOString(),
  };
}
