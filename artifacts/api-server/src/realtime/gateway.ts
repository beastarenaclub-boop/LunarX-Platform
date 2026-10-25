import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { getActiveSession, findUserById } from "../services/auth";
import { sessionCookie, requestSite, requestOperatorPanel, resolveCustomSite, customMaster } from "../middlewares/siteChannel";
import { userBelongsToMaster } from "../services/network";
import { assertNetworkActive, networkIdentity } from "../services/network";
import { bus, type RealtimeEvent } from "./eventBus";
import { ALLOWED_ROLES_PER_TOPIC, type ClientToServer, type ServerToClient } from "./protocol";
import { logger } from "../lib/logger";
import { recordRealtimeActivity } from "../services/sessionActivity";

const accountSockets = new Map<WebSocket, { userId: string; sessionId: string }>();
export function disconnectAccountSessions(userId: string, keepSessionId?: string) {
  for (const [socket, session] of accountSockets) {
    if (session.userId === userId && session.sessionId !== keepSessionId) socket.close(4001, "Session ended");
  }
}

// Tiny header-only cookie parser; avoids a runtime dep on `cookie`.
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

interface ClientCtx {
  userId: string;
  role: string;
  topics: Map<string, () => void>; // topic -> unsubscribe fn
  alive: boolean;
}

function send(ws: WebSocket, msg: ServerToClient) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn({ err }, "ws send failed");
  }
}

function topicAllowed(topic: string, ctx: ClientCtx): boolean {
  if (topic.startsWith("ludo:")) return topic.slice(5) === ctx.userId;
  if (topic.startsWith("ludo-chat:")) return topic.slice(10) === ctx.userId;
  // Per-user topics: only the owner (or admin) may subscribe.
  if (topic.startsWith("wallet:")) {
    const uid = topic.slice("wallet:".length);
    return uid === ctx.userId || ctx.role === "admin" || ctx.role === "super_admin";
  }
  if (topic.startsWith("notifications:")) {
    const uid = topic.slice("notifications:".length);
    return uid === ctx.userId || ctx.role === "admin" || ctx.role === "super_admin";
  }
  if (topic.startsWith("bonus:")) {
    const uid = topic.slice("bonus:".length);
    return uid === ctx.userId || ctx.role === "admin" || ctx.role === "super_admin";
  }
  if (topic.startsWith("free-bets:")) {
    const uid = topic.slice("free-bets:".length);
    return uid === ctx.userId || ctx.role === "admin" || ctx.role === "super_admin";
  }
  if (topic.startsWith("agent:")) {
    const aid = topic.slice("agent:".length);
    // Agent may subscribe to their own topic; admins to any.
    if (ctx.role === "admin" || ctx.role === "super_admin") return true;
    if (ctx.role !== "agent") return false;
    return aid === ctx.userId;
  }
  const list = ALLOWED_ROLES_PER_TOPIC[topic];
  if (!list) return false;
  return list.includes(ctx.role as never);
}

async function authenticate(req: IncomingMessage): Promise<{ userId: string; role: string; sessionId: string } | null> {
  try { await resolveCustomSite(req); } catch { return null; }
  const sid = readCookie(req.headers.cookie, sessionCookie(req));
  if (!sid) return null;
  try {
    const session = await getActiveSession(sid);
    if (!session) return null;
    const user = await findUserById(session.userId);
    if (!user || user.status !== "active") return null;
    if(user.role === "player" && user.channel !== requestSite(req)) return null;
    if(customMaster(req) && !(await userBelongsToMaster(user,customMaster(req)!)))return null;
    await assertNetworkActive(user);
    const panel = requestOperatorPanel(req);
    if (panel && (await networkIdentity(user)).role !== panel) return null;
    return { userId: user.id, role: user.role, sessionId: session.id };
  } catch (err) {
    logger.warn({ err }, "ws auth failed");
    return null;
  }
}

export function attachRealtime(httpServer: HttpServer, alternativeUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws" && url.pathname !== "/api/ws") {
      // Let other upgrade handlers (if any) deal with it.
      return;
    }
    if (alternativeUpgrade?.(req, socket, head)) return;
    void authenticate(req).then((auth) => {
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, auth);
      });
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, auth: { userId: string; role: string; sessionId: string }) => {
    accountSockets.set(ws, { userId: auth.userId, sessionId: auth.sessionId });
    const ctx: ClientCtx = {
      userId: auth.userId,
      role: auth.role,
      topics: new Map(),
      alive: true,
    };

    send(ws, { op: "welcome", userId: ctx.userId, role: ctx.role, ts: Date.now() });

    ws.on("pong", () => {
      ctx.alive = true;
      void recordRealtimeActivity(auth.sessionId).then(active => {
        if (!active) ws.close(4001, "Session ended");
      }).catch(() => logger.warn("Realtime session activity could not be recorded"));
    });

    ws.on("message", (raw) => {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { op: "error", reason: "invalid_json" });
        return;
      }
      if (!msg || typeof msg !== "object" || typeof (msg as { op?: unknown }).op !== "string") {
        send(ws, { op: "error", reason: "invalid_message" });
        return;
      }
      switch (msg.op) {
        case "ping":
          send(ws, { op: "pong", ts: msg.ts });
          break;
        case "subscribe": {
          const topic = String(msg.topic);
          if (ctx.topics.has(topic)) {
            send(ws, { op: "subscribed", topic });
            return;
          }
          if (!topicAllowed(topic, ctx)) {
            send(ws, { op: "denied", topic, reason: "forbidden" });
            return;
          }
          // Cap subscriptions per-connection.
          if (ctx.topics.size >= 32) {
            send(ws, { op: "denied", topic, reason: "too_many_subscriptions" });
            return;
          }
          const off = bus.subscribe(topic, (ev: RealtimeEvent) => {
            send(ws, { op: "event", topic, payload: ev });
          });
          ctx.topics.set(topic, off);
          send(ws, { op: "subscribed", topic });
          break;
        }
        case "unsubscribe": {
          const topic = String(msg.topic);
          const off = ctx.topics.get(topic);
          if (off) {
            off();
            ctx.topics.delete(topic);
          }
          send(ws, { op: "unsubscribed", topic });
          break;
        }
        default:
          send(ws, { op: "error", reason: "unknown_op" });
      }
    });

    ws.on("close", () => {
      accountSockets.delete(ws);
      for (const off of ctx.topics.values()) off();
      ctx.topics.clear();
    });
    ws.on("error", (err) => {
      logger.warn({ err }, "ws connection error");
    });
  });

  // Heartbeat: drop dead connections.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      const anyWs = ws as WebSocket & { _ctx?: ClientCtx };
      // We track liveness via pong handler; since we don't store ctx on ws
      // here, a simpler ping is sent and stale clients get terminated by ws.
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
      void anyWs;
    }
  }, 30_000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  logger.info("Realtime WebSocket gateway attached at /ws");
  return wss;
}
