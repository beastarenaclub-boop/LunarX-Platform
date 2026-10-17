import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletBalanceQueryKey, getGetWalletBalancesQueryKey, useRealtimeResync, useRealtimeTopic } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

/** Keep every mounted game and cached header on the same server balance. */
export default function SharedWalletBridge() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const refresh = () => {
    if (!user) return;
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
    void qc.invalidateQueries({ queryKey: ["dragon-tiger", user.id] });
    void qc.invalidateQueries({ queryKey: ["rummy", user.id] });
  };
  useRealtimeTopic<{ type: string; balance: string }>(user ? `wallet:${user.id}` : null, ev => {
    if (ev?.type !== "balance" || !/^-?\d+$/.test(ev.balance)) return;
    qc.setQueriesData({ queryKey: getGetWalletBalanceQueryKey() }, (previous: unknown) =>
      previous && typeof previous === "object" ? { ...previous, balance: ev.balance, scope: "lunar" } : previous);
    refresh();
  });
  useRealtimeResync(refresh);
  return null;
}
