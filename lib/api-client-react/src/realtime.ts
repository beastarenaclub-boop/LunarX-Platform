import { useEffect, useRef } from "react";
import { getOperatorPanel } from "./operator-session";

/**
 * Browser-side realtime gateway client.
 *
 * Single shared WebSocket connection per tab. Components attach handlers
 * via `useRealtimeTopic(topic, handler)`; the connection auto-subscribes
 * when the first listener attaches and auto-unsubscribes when the last
 * detaches. Reconnection uses exponential backoff with jitter.
 */

type AnyHandler = (event: { topic: string; payload: unknown }) => void;
type ConnState = "idle" | "connecting" | "open" | "closed";

let ws: WebSocket | null = null;
let state: ConnState = "idle";
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let resyncCallbacks = new Set<() => void>();
const handlers = new Map<string, Set<AnyHandler>>();
const pendingSubs = new Set<string>();

function buildWsUrl(): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const panel = getOperatorPanel();
  return `${proto}//${window.location.host}/ws${panel ? `?panel=${panel}` : ""}`;
}

function send(msg: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const base = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts, 6));
  const jitter = Math.floor(Math.random() * 500);
  const delay = base + jitter;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (typeof window === "undefined") return;
  if (state === "connecting" || state === "open") return;
  const url = buildWsUrl();
  if (!url) return;
  state = "connecting";
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    state = "closed";
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    state = "open";
    reconnectAttempts = 0;
    // Re-subscribe everything we care about.
    for (const topic of handlers.keys()) {
      send({ op: "subscribe", topic });
    }
    pendingSubs.clear();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      send({ op: "ping", ts: Date.now() });
    }, 25_000);
    // Notify subscribers so they can REST-resync if they missed events.
    for (const cb of resyncCallbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  };

  socket.onmessage = (ev) => {
    let msg: { op?: string; topic?: string; payload?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    if (!msg || msg.op !== "event" || typeof msg.topic !== "string") return;
    const set = handlers.get(msg.topic);
    if (!set) return;
    for (const h of set) {
      try { h({ topic: msg.topic, payload: msg.payload }); } catch { /* ignore */ }
    }
  };

  const cleanup = () => {
    state = "closed";
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    ws = null;
    if (handlers.size > 0) scheduleReconnect();
  };
  socket.onclose = cleanup;
  socket.onerror = () => {
    try { socket.close(); } catch { /* ignore */ }
  };
}

function attachHandler(topic: string, handler: AnyHandler) {
  let set = handlers.get(topic);
  if (!set) {
    set = new Set();
    handlers.set(topic, set);
    if (state === "open") {
      send({ op: "subscribe", topic });
    } else {
      pendingSubs.add(topic);
      connect();
    }
  }
  set.add(handler);
  return () => {
    const cur = handlers.get(topic);
    if (!cur) return;
    cur.delete(handler);
    if (cur.size === 0) {
      handlers.delete(topic);
      if (state === "open") send({ op: "unsubscribe", topic });
      pendingSubs.delete(topic);
      // If nothing left at all, close socket to release resources.
      if (handlers.size === 0 && ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    }
  };
}

/**
 * Subscribe a React component to realtime events for a single topic.
 * `topic === null` is a no-op (lets callers conditionally subscribe based
 * on auth/state without breaking hook order).
 */
export function useRealtimeTopic<T = unknown>(
  topic: string | null,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!topic) return;
    const detach = attachHandler(topic, ({ payload }) => {
      (handlerRef.current as (p: unknown) => void)(payload as T);
    });
    return detach;
  }, [topic]);
}

/**
 * Register a callback that runs every time the realtime connection
 * (re)opens. Useful for triggering a REST resync after a disconnection
 * so clients never miss events while offline.
 */
export function useRealtimeResync(cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const wrapper = () => ref.current();
    resyncCallbacks.add(wrapper);
    return () => { resyncCallbacks.delete(wrapper); };
  }, []);
}

/** Force-close the active realtime connection (e.g. after sign-out). */
export function disconnectRealtime(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  handlers.clear();
  pendingSubs.clear();
  resyncCallbacks = new Set();
  if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
  state = "idle";
  reconnectAttempts = 0;
}
