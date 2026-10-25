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
import type { LudoTable } from "@workspace/api-zod/ludo";
type Pending = { url: string; body: object; forfeit?: boolean };
export function useLudo(userId: string) {
  const [data, setData] = useState<LudoTable | null>(null),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(false),
    [time, setTime] = useState(Date.now());
  const latest = useRef<LudoTable | null>(null),
    alive = useRef(true),
    sending = useRef(false),
    syncing = useRef(false),
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
    (next: LudoTable) => {
      if (
        !alive.current ||
        (latest.current && next.serverNow < latest.current.serverNow)
      )
        return;
      offset.current = next.serverNow - Date.now();
      if (latest.current?.balancePaise !== next.balancePaise) {
        void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
        void qc.invalidateQueries({
          queryKey: getListWalletTransactionsQueryKey(),
        });
      }
      latest.current = next;
      setData(next);
      setOffline(false);
    },
    [qc],
  );
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      accept(
        await customFetch<LudoTable>("/api/ludo/state", {
          signal: AbortSignal.timeout(8000),
        }),
      );
    } catch {
      if (alive.current) setOffline(true);
    } finally {
      syncing.current = false;
    }
  }, [accept]);
  const send = useCallback(
    async (request: Pending) => {
      if (sending.current) return;
      sending.current = true;
      setBusy(true);
      setError("");
      remember(request);
      try {
        let current = request;
        for (let attempt = 0; ; attempt++) {
          try {
            const next = await customFetch<LudoTable>(current.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(current.body),
              signal: AbortSignal.timeout(10000),
            });
            remember(null);
            accept(next);
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
            remember(current);
          }
        }
      } catch (e) {
        if (alive.current) {
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
        sending.current = false;
        if (alive.current) {
          setBusy(false);
          void sync();
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
    const poll = setInterval(() => void sync(), 2500),
      clock = setInterval(() => setTime(Date.now() + offset.current), 200);
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("online", online);
    };
  }, [key, remember, send, sync]);
  useRealtimeTopic(`ludo:${userId}`, () => void sync());
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
  const act = (
    type: "roll" | "move" | "leave",
    token?: number,
    forfeit = false,
  ) => {
    const m = latest.current?.match;
    if (!m || pending.current) return;
    if (type === "leave" && !forfeit && m.status !== "waiting") {
      setError(
        "The match has started. Use Leave match to confirm forfeiting your entry.",
      );
      return;
    }
    void send({
      url: `/api/ludo/${m.id}/action`,
      body: { type, token, version: m.version, requestId: crypto.randomUUID() },
      forfeit: type === "leave" && forfeit,
    });
  };
  return {
    data,
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
