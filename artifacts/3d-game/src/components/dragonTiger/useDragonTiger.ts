import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch, getGetWalletBalanceQueryKey } from "@workspace/api-client-react";
import { BET_SEND_BUFFER_MS, useTimedBet } from "../table/AutoBet";

export type Side = "dragon" | "tiger" | "tie";
export type Spots = Record<Side, number>;
export type Leader = {
  userId: string;
  name: string;
  net: number;
  wins: number;
  played: number;
  rank: number;
};
export interface TableSnapshot {
  serverNow: number;
  mode: "wallet";
  online: number;
  round: {
    mainProfitPaisePerRupee?: number;
    tieProfitPaisePerRupee?: number;
    id: number;
    phase: "betting" | "dealing" | "result";
    closesAt: number;
    revealsAt: number;
    endsAt: number;
    dragon?: number;
    tiger?: number;
    winner?: Side;
  };
  player: {
    balance: number;
    net: number;
    wins: number;
    played: number;
    rank: number | null;
  };
  myBet: { spots: Spots; stake: number; payout: number | null } | null;
  lastResult: { roundId: number; stake: number; payout: number } | null;
  leaderboard: Leader[];
  history: { id: number; winner: Side; dragon: number; tiger: number }[];
}
export const emptySpots = (): Spots => ({ dragon: 0, tiger: 0, tie: 0 });
export const totalSpots = (spots: Spots) =>
  spots.dragon + spots.tiger + spots.tie;

export function useDragonTiger(userId: string) {
  const qc = useQueryClient();
  const key = ["dragon-tiger", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      customFetch<TableSnapshot>("/api/dragon-tiger/table", { signal }),
    refetchInterval: 1500,
    refetchOnWindowFocus: true,
    retry: 1,
    staleTime: 500,
  });
  const [tick, setTick] = useState(Date.now());
  const [draft, setDraft] = useState<{ roundId: number; steps: Spots[] }>({
    roundId: 0,
    steps: [],
  });
  const [message, setMessage] = useState("");
  const previous = useRef<Spots | null>(null);
  const receivedAt = useRef({ updated: 0, at: Date.now() });
  if (receivedAt.current.updated !== query.dataUpdatedAt)
    receivedAt.current = { updated: query.dataUpdatedAt, at: Date.now() };
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setMessage("");
  }, [query.data?.round.id]);
  useEffect(() => {
    if (query.data?.myBet) previous.current = query.data.myBet.spots;
  }, [query.data?.myBet]);

  const mutation = useMutation({
    mutationFn: (input: { roundId: number; spots: Spots }) =>
      customFetch<TableSnapshot>("/api/dragon-tiger/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onMutate: () => {
      setMessage("");
    },
    onSuccess: async (data) => {
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
      setDraft({ roundId: data.round.id, steps: [] });
    },
    onError: (error) => {
      const detail =
        error instanceof ApiError
          ? (error.data as {
              detail?: string;
              title?: string;
              error?: { message?: string };
            })
          : undefined;
      setMessage(
        detail?.error?.message ||
          detail?.detail ||
          detail?.title ||
          "Could not confirm your bet. Reconnecting to check its status…",
      );
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const data = query.data;
  const now =
    (data?.serverNow ?? tick) + Math.max(0, tick - receivedAt.current.at);
  const connected =
    !!data && !query.isError && tick - query.dataUpdatedAt < 6000;
  const betting =
    connected && data?.round.phase === "betting" && now < data.round.closesAt;
  const editable = betting && now < data!.round.closesAt - BET_SEND_BUFFER_MS && !data?.myBet && !mutation.isPending;
  const steps = draft.roundId === data?.round.id ? draft.steps : [];
  const spots = data?.myBet?.spots ?? steps.at(-1) ?? emptySpots();
  const total = totalSpots(spots);
  useTimedBet({
    roundKey: data?.round.id ?? null,
    deadline: data ? receivedAt.current.at + data.round.closesAt - data.serverNow - BET_SEND_BUFFER_MS : null,
    expiresAt: data ? receivedAt.current.at + data.round.closesAt - data.serverNow - 300 : null,
    armed: steps.length > 0 && total >= 10,
    enabled: betting && !data?.myBet && !mutation.isPending,
    submit: () => {
      if (data) mutation.mutate({ roundId: data.round.id, spots: { ...spots } });
    },
  });
  const update = (next: Spots) => {
    if (!editable || !data) return;
    if (totalSpots(next) > Math.min(data.player.balance, 5000)) {
      setMessage(
        totalSpots(next) > 5000
          ? "Maximum 5,000 chips per round."
          : "Not enough wallet balance for this bet.",
      );
      return;
    }
    setMessage("");
    setDraft({ roundId: data.round.id, steps: [...steps, next] });
  };
  return {
    data,
    query,
    now,
    connected,
    betting,
    editable,
    spots,
    total,
    message,
    pending: mutation.isPending,
    canUndo: editable && steps.length > 0,
    canRepeat: editable && !!previous.current,
    add: (side: Side, amount: number) =>
      update({ ...spots, [side]: spots[side] + amount }),
    double: () =>
      update({
        dragon: spots.dragon * 2,
        tiger: spots.tiger * 2,
        tie: spots.tie * 2,
      }),
    undo: () => {
      if (editable && data) {
        setDraft({ roundId: data.round.id, steps: steps.slice(0, -1) });
        setMessage("");
      }
    },
    clear: () => {
      if (editable && data) {
        setDraft({ roundId: data.round.id, steps: [] });
        setMessage("");
      }
    },
    repeat: () => {
      if (previous.current) update({ ...previous.current });
    },
    confirm: () => {
      if (editable && data && total >= 10)
        mutation.mutate({ roundId: data.round.id, spots: { ...spots } });
    },
  };
}
