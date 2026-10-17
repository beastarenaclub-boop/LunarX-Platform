import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  getGetWalletBalanceQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  OD_GAME,
  OD_MAX_STAKE,
  type ODTable,
  type ODStage,
} from "@workspace/api-zod/dragon-tiger-one-day";
import {
  BET_SEND_BUFFER_MS,
  useChipDraft,
  useTimedBet,
} from "@/components/table/AutoBet";
import { toast } from "sonner";

export function useOneDayTable(userId?: string) {
  const qc = useQueryClient();
  const [data, setData] = useState<ODTable | null>(null),
    latest = useRef<ODTable | null>(null);
  const [now, setNow] = useState(Date.now()),
    [receivedAt, setReceivedAt] = useState(0),
    [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false),
    sending = useRef(false),
    active = useRef(true);
  // A GET started before a bet must never restore its pre-debit wallet/slips.
  const writeGeneration = useRef(0);
  const accept = useCallback((next: ODTable) => {
    if (
      !active.current ||
      (latest.current && next.serverNow < latest.current.serverNow)
    )
      return;
    latest.current = next;
    setData(next);
    setReceivedAt(Date.now());
    setOffline(false);
  }, []);
  useEffect(() => {
    active.current = true;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const generation = writeGeneration.current;
      try {
        if (!sending.current) {
          const next = await customFetch<ODTable>(`/api/${OD_GAME}/table`);
          if (
            !disposed &&
            generation === writeGeneration.current &&
            !sending.current
          )
            accept(next);
        }
      } catch {
        if (
          !disposed &&
          generation === writeGeneration.current &&
          !sending.current
        )
          setOffline(true);
      }
      if (!disposed) timer = setTimeout(poll, 800);
    };
    if (userId) void poll();
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => {
      disposed = true;
      active.current = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [userId, accept]);
  const offset = data ? data.serverNow - receivedAt : 0;
  const serverNow = now + offset;
  const connected = !!data && !offline && now - receivedAt < 3500;
  const stage: ODStage | null =
    data?.round.phase === "first" || data?.round.phase === "second"
      ? data.round.phase
      : null;
  const roundKey = data ? `${data.round.id}:${data.round.phase}` : null;
  const placed = data?.slips.find((s) => s.stage === stage);
  const firstPlaced = data?.slips.find((s) => s.stage === "first");
  const deadline = data ? data.round.phaseEndsAt - offset : null;
  const remaining = Math.max(0, (deadline ?? now) - now);
  const spent =
    data?.slips.reduce((sum, s) => sum + BigInt(s.stakePaise), 0n) ?? 0n;
  const remainingLimit = BigInt(OD_MAX_STAKE) - spent;
  const betting =
    connected &&
    stage !== null &&
    (stage === "first" || !!firstPlaced) &&
    !placed &&
    remaining > 0 &&
    remainingLimit > 0n;
  const canEdit = betting && !busy && remaining > BET_SEND_BUFFER_MS;
  const draft = useChipDraft<string>(
    roundKey,
    canEdit,
    data?.balancePaise ?? "0",
    String(remainingLimit),
  );
  useEffect(() => {
    if (placed) draft.clear();
  }, [placed?.id]);
  const syncWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
  };
  const settlement = data?.slips
    .map((s) => `${s.id}:${s.payoutPaise}`)
    .join("|");
  useEffect(() => {
    if (settlement) syncWallet();
  }, [settlement]);
  const submit = async () => {
    if (
      !betting ||
      !data ||
      !stage ||
      !draft.bets.length ||
      sending.current ||
      (latest.current?.round.id === data.round.id &&
        latest.current.slips.some((s) => s.stage === stage))
    )
      return;
    sending.current = true;
    writeGeneration.current++;
    setBusy(true);
    const payload = {
      roundId: data.round.id,
      stage,
      quoteId: data.quoteId,
      selections: draft.bets.map((b) => ({
        market: b.type,
        amountPaise: b.amountPaise,
      })),
    };
    try {
      const next = await customFetch<ODTable>(`/api/${OD_GAME}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      accept(next);
      syncWallet();
      if (active.current)
        toast.success(
          `${stage === "first" ? "First" : "Second"} chance confirmed`,
        );
    } catch (error) {
      if (active.current)
        toast.error(
          error instanceof ApiError
            ? ((error.data as { detail?: string })?.detail ??
                "Bet not confirmed. Check your accepted bets before retrying.")
            : "Connection interrupted. Checking accepted bets…",
        );
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  };
  useTimedBet({
    roundKey,
    deadline: deadline === null ? null : deadline - BET_SEND_BUFFER_MS,
    expiresAt: deadline === null ? null : deadline - 100,
    armed: draft.bets.length > 0,
    enabled: betting && !busy,
    submit,
  });
  return {
    data,
    serverNow,
    connected,
    stage,
    placed,
    firstPlaced,
    spent,
    remainingLimit,
    busy,
    canEdit,
    draft,
    submit,
    seconds: Math.max(
      0,
      Math.ceil((remaining - (stage ? BET_SEND_BUFFER_MS : 0)) / 1000),
    ),
    add: (market: string, chip: number) => {
      if (!data?.quotes.find((q) => q.id === market)?.available || !canEdit)
        return false;
      const accepted = draft.stage([
        { type: market, amountPaise: String(chip * 100) },
      ]);
      if (!accepted)
        toast.error(
          "Not enough balance, or the ₹5,000 round limit was reached.",
        );
      return accepted;
    },
  };
}
