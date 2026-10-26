import { useRef } from "react";
import { Link, Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetWalletBalanceQueryKey, getListWalletTransactionsQueryKey } from "@workspace/api-client-react";
import type { CollectionRound, CollectionState } from "@workspace/api-zod/instant-collection";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";

/** The removed game has no play screen; only already-paid rounds can be recovered. */
export default function RemovedInstantGame() {
  const { user } = useAuth(), qc = useQueryClient();
  const key = ["removed-instant-round", user?.id];
  const actionId = useRef(crypto.randomUUID());
  const state = useQuery({
    queryKey: key,
    queryFn: () => customFetch<CollectionState>("/api/instant/chicken-road-2/state"),
    retry: false,
  });
  const cashout = useMutation({
    mutationFn: () => customFetch<CollectionRound>(`/api/instant/chicken-road-2/${state.data!.round!.id}/move`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cashout", expectedStep: state.data!.round!.step, cell: 0, actionId: actionId.current }),
      signal: AbortSignal.timeout(15000),
    }),
    onSuccess: async () => {
      try { localStorage.removeItem(`instant:pending:${user?.id}:chicken-road-2`); } catch {}
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }),
        qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() }),
      ]);
    },
    onError: () => { void state.refetch(); },
  });
  if (state.data && !state.data.round) return <Redirect to="/" />;
  return <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
    <h1 className="text-2xl font-bold">Chicken Road 2.0 has been removed</h1>
    {state.isPending ? <p role="status">Checking your last round…</p> : state.data?.round ? <>
      <p>Your existing round can still be cashed out to your wallet.</p>
      <button className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white disabled:opacity-50" disabled={cashout.isPending} onClick={() => cashout.mutate()}>
        {cashout.isPending ? "Confirming…" : `Cash out ₹${formatRupees(state.data.round.cashoutAmount)}`}
      </button>
    </> : null}
    {(state.error || cashout.error) && <p role="alert">{(cashout.error ?? state.error)?.message}</p>}
    {state.isError && <button onClick={() => void state.refetch()}>Retry</button>}
    <Link href="/" className="underline">Back to games</Link>
  </main>;
}
