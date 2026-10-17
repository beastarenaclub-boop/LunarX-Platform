import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch, getGetWalletBalanceQueryKey } from "@workspace/api-client-react";
import { initialTable } from "./engine";
import type { Action, RummySession } from "@workspace/api-zod/rummy-session";
export { rummySessionReducer } from "@workspace/api-zod/rummy-session";
export type { RummySession } from "@workspace/api-zod/rummy-session";
type Snapshot = RummySession & { version: number; deadline: number; serverNow: number };

export function useRummy(userId: string, name: string) {
  const qc = useQueryClient();
  const key = ["rummy", userId];
  const locked = useRef(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const query = useQuery({ queryKey: key,
    queryFn: ({ signal }) => customFetch<Snapshot>("/api/rummy/table", { signal }),
    refetchInterval: 800, retry: 1, refetchOnWindowFocus: true });
  const mutation = useMutation({
    mutationFn: (input: { version: number; action: Action }) => customFetch<Snapshot>("/api/rummy/action", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }),
    onMutate: async () => { setNotice(""); await qc.cancelQueries({ queryKey: key }); },
    onSuccess: async data => {
      await qc.cancelQueries({ queryKey: key }); qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    },
    onError: error => {
      const detail = error instanceof ApiError ? error.data as { error?: { message?: string }; detail?: string } : undefined;
      setNotice(detail?.error?.message ?? detail?.detail ?? "Reconnecting to check your table. Please try again.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => { locked.current = false; },
  });
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const data = query.data;
  const serverNow = (data?.serverNow ?? now) + Math.max(0, now - query.dataUpdatedAt);
  return {
    table: data?.table ?? initialTable(name), auto: data?.auto ?? null, autoPlay: data?.autoPlay ?? false,
    notice: notice || (query.isError ? "Connection lost. Reconnecting to your table." : data?.notice ?? ""),
    pending: mutation.isPending || !data || query.isError,
    dispatch: (action: Action) => {
      if (!data || query.isError || locked.current) return;
      locked.current = true; mutation.mutate({ version: data.version, action });
    },
    seconds: Math.max(0, Math.ceil(((data?.deadline ?? serverNow) - serverNow) / 1000)),
  };
}
