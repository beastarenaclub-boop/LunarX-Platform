import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  useRealtimeTopic,
  useRealtimeResync,
  getGetWalletBalanceQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { LudoMatch, LudoTable } from "@workspace/api-zod/ludo";
type Pending = {
  url: string;
  body: Record<string, unknown> & { requestId: string };
  forfeit?: boolean;
};
export function useLudo(userId: string) {
  const [data, setData] = useState<LudoTable | null>(null),
    [updates, setUpdates] = useState<LudoMatch[]>([]),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(false),
    [time, setTime] = useState(Date.now());
  const latest = useRef<LudoTable | null>(null),
    alive = useRef(true),
    flight = useRef<{ request: Pending; controller: AbortController } | null>(
      null,
    ),
    syncing = useRef(false),
    syncAgain = useRef(false),
    realtimeAt = useRef(0),
    acceptedAt = useRef(0),
    bestRtt = useRef(Infinity),
    pending = useRef<Pending | null>(null),
    offset = useRef(0),
    qc = useQueryClient();
  const key = `ludo-pending:${userId}`;
  const remember = useCallback(
    (value: Pending | null) => {
      pending.current = value;
      setRetry(!!value);
      try {
        if (value) sessionStorage.setItem(key, JSON.stringify(value));
        else sessionStorage.removeItem(key);
      } catch {}
    },
    [key],
  );
  const accept = useCallback(
    (next: LudoTable, requestStarted?: number) => {
      const old = latest.current;
      if (
        !alive.current ||
        (old?.match &&
          ["waiting", "playing"].includes(old.match.status) &&
          next.match?.id !== old.match.id &&
          (!next.match ||
            ["finished", "cancelled"].includes(next.match.status))) ||
        (old?.match && next.match?.id === old.match.id
          ? next.match.version < old.match.version
          : old && next.serverNow < old.serverNow)
      )
        return;
      if (requestStarted !== undefined) {
        const rtt = Date.now() - requestStarted;
        if (rtt <= bestRtt.current * 1.5) {
          bestRtt.current = Math.min(bestRtt.current, rtt);
          offset.current = next.serverNow - (requestStarted + Date.now()) / 2;
        }
      }
      if (
        old &&
        old.match?.id === next.match?.id &&
        old.match?.version === next.match?.version
      )
        next = { ...next, match: old.match };
      if (latest.current?.balancePaise !== next.balancePaise) {
        void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
        void qc.invalidateQueries({
          queryKey: getListWalletTransactionsQueryKey(),
        });
      }
      latest.current = next;
      if (
        next.match &&
        (old?.match?.id !== next.match.id ||
          old.match.version < next.match.version)
      ) {
        const snapshot = next.match;
        setUpdates((history) =>
          [
            ...(history.at(-1)?.id === snapshot.id ? history : []),
            snapshot,
          ].slice(-64),
        );
      }
      acceptedAt.current = Date.now();
      setData(next);
      setOffline(false);
      if (!pending.current && old?.match?.version !== next.match?.version)
        setError("");
    },
    [qc],
  );
  const sync = useCallback(async () => {
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        syncAgain.current = false;
        const started = Date.now();
        try {
          accept(
            await customFetch<LudoTable>("/api/ludo/state", {
              signal: AbortSignal.timeout(8000),
            }),
            started,
          );
        } catch {
          if (alive.current && acceptedAt.current < started) setOffline(true);
        }
      } while (syncAgain.current && alive.current);
    } finally {
      syncing.current = false;
    }
  }, [accept]);
  const send = useCallback(
    async (request: Pending) => {
      if (flight.current) return;
      const currentFlight = { request, controller: new AbortController() };
      flight.current = currentFlight;
      const timeout = setTimeout(() => currentFlight.controller.abort(), 10000);
      setBusy(true);
      setError("");
      remember(request);
      try {
        let current = request;
        for (let attempt = 0; ; attempt++) {
          try {
            const started = Date.now();
            const next = await customFetch<LudoTable>(current.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(current.body),
              signal: currentFlight.controller.signal,
            });
            if (flight.current !== currentFlight) return;
            remember(null);
            accept(next, started);
            break;
          } catch (e) {
            // A confirmed forfeit still means leave if a bot moved meanwhile.
            // Never retry a move, roll or pre-start cancellation with a new version.
            if (
              !current.forfeit ||
              !(e instanceof ApiError) ||
              e.status !== 409 ||
              attempt >= 2
            )
              throw e;
            const next = await customFetch<LudoTable>("/api/ludo/state", {
              signal: AbortSignal.timeout(8000),
            });
            accept(next);
            const match = next.match;
            if (
              !match ||
              current.url !== `/api/ludo/${match.id}/action` ||
              match.status !== "playing" ||
              match.state.players[match.you]?.forfeited
            ) {
              remember(null);
              break;
            }
            current = {
              ...current,
              body: {
                ...current.body,
                version: match.version,
                requestId: crypto.randomUUID(),
              },
            };
            currentFlight.request = current;
            remember(current);
          }
        }
      } catch (e) {
        if (alive.current && flight.current === currentFlight) {
          setError(
            e instanceof Error ? e.message : "Action could not be confirmed",
          );
          if (
            e instanceof ApiError &&
            e.status >= 400 &&
            e.status < 500 &&
            e.status !== 408 &&
            e.status !== 429
          )
            remember(null);
          else setOffline(true);
        }
      } finally {
        clearTimeout(timeout);
        if (flight.current === currentFlight) {
          flight.current = null;
          if (alive.current) {
            setBusy(false);
            void sync();
          }
        }
      }
    },
    [accept, remember, sync],
  );
  useEffect(() => {
    alive.current = true;
    let restored: Pending | null = null;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.url?.startsWith("/api/ludo/") && p.body?.requestId) {
          restored = p;
          remember(p);
        }
      }
    } catch {}
    // A refresh may interrupt the response after the server committed it.
    // Replay the saved UUID once to confirm it and unblock the saved match.
    if (restored) void send(restored);
    else void sync();
    const poll = setInterval(() => {
        if (!document.hidden && Date.now() - realtimeAt.current > 5000)
          void sync();
      }, 2500),
      clock = setInterval(() => setTime(Date.now() + offset.current), 200);
    const online = () => void sync();
    window.addEventListener("online", online);
    const visible = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, remember, send, sync]);
  useRealtimeTopic<{ match?: LudoMatch; ts: number; requestId?: string }>(
    `ludo:${userId}`,
    (event) => {
      realtimeAt.current = Date.now();
      const joined =
        event.requestId &&
        pending.current?.url === "/api/ludo/join" &&
        pending.current.body.requestId === event.requestId;
      if (
        event.match &&
        latest.current &&
        (latest.current.match?.id === event.match.id || joined)
      ) {
        accept({ ...latest.current, match: event.match, serverNow: event.ts });
      } else void sync();
      // The private event is sent only after commit. A lost/slow HTTP reply must
      // not lock the next turn after the server has acknowledged this exact UUID.
      if (
        event.requestId &&
        pending.current?.body.requestId === event.requestId
      ) {
        const confirmed = flight.current;
        flight.current = null;
        remember(null);
        setBusy(false);
        setError("");
        setOffline(false);
        confirmed?.controller.abort();
      }
      if (joined) void sync(); // Refresh wallet/history without delaying the first turn.
    },
  );
  useRealtimeResync(() => void sync());
  const join = (
    capacity: 2 | 4,
    entryPaise: number,
    mode: "online" | "computer" = "online",
  ) => {
    if (pending.current) return;
    void send({
      url: "/api/ludo/join",
      body: {
        capacity,
        entryPaise,
        ...(mode === "computer" ? { mode } : {}),
        requestId: crypto.randomUUID(),
      },
    });
  };
  const act = useCallback(
    (
      type: "roll" | "move" | "leave",
      token?: number,
      forfeit = false,
      expected?: { id: string; version: number },
    ) => {
      const m = latest.current?.match;
      if (!m || pending.current) return;
      if (expected && (m.id !== expected.id || m.version !== expected.version))
        return;
      if (type === "leave" && !forfeit && m.status !== "waiting") {
        setError(
          "The match has started. Use Leave match to confirm forfeiting your entry.",
        );
        return;
      }
      void send({
        url: `/api/ludo/${m.id}/action`,
        body: {
          type,
          token,
          version: m.version,
          requestId: crypto.randomUUID(),
        },
        forfeit: type === "leave" && forfeit,
      });
    },
    [send],
  );
  return {
    data,
    updates,
    error,
    offline,
    busy,
    retry,
    time,
    join,
    act,
    sync,
    retryAction: () => pending.current && void send(pending.current),
  };
}
