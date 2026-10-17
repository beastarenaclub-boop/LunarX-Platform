import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetWalletBalanceQueryKey, getGetWalletBalancesQueryKey, getGetMeQueryKey, useRealtimeTopic } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { playGameSound, unlockAudio } from "@/game/audio";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import { PlayerGame, type LotteryCoinProps } from "../../lottery/src/PlayerGame";
import { PlayerShell } from "../../lottery/src/PlayerShell";
import { Tickets, Results, Reports } from "../../lottery/src/Views";
import type { Data } from "../../lottery/src/types";
import type { ViewProps } from "../../lottery/src/App";
import baseCss from "../../lottery/src/styles.css?inline";
import playerCss from "../../lottery/src/player.css?inline";
import themeCss from "../../lottery/src/theme.css?inline";
import desktopCss from "../../lottery/src/desktop.css?inline";
import paper from "../../lottery/public/ticket-paper.svg";

// Scope the existing paper-ticket layout to this page; lobby/table CSS stays intact.
const css = `@scope (.lottery-connected) { ${[baseCss, playerCss, themeCss, desktopCss].join("\n").replaceAll(":root", ":scope").replace(/url\((["']?)\/ticket-paper\.svg\1\)/g, () => `url(${JSON.stringify(paper)})`)}
  .lottery-coins { margin: 10px 0; padding: 10px; border-radius: 10px; background: #123b2e; color: white; }
  .lottery-coins p { font-size: 11px; margin: 8px 0 0; color: #d7e9df; }
  .lottery-coins .table-coin-controls { align-items: flex-start; }
  .player-main-game .player-game { min-height: 548px; }
}`;

function LotteryCoins({ price, quantity, max, disabled, onQuantity }: LotteryCoinProps) {
  const { user } = useAuth();
  const preferences = useCoinPreferences("lottery", user?.id, max);
  const usable = preferences.values.filter(value => price > 0 && value >= price && value % price === 0 && value / price <= 500);
  return <div className="lottery-coins">
    <TableCoinRack preferences={preferences} selectableValues={usable} chip={quantity * price} layout="row"
      onSelect={value => { if (price > 0 && value % price === 0 && value / price <= 500) { preferences.selectChip(value); onQuantity(value / price); } }}
      minValue={price || 100} step={price || 100} maxValue={Math.min(max, price * 500)} disabled={disabled || price === 0} />
    <p>Har number ki rakam. Selected tickets ke total price ke multiples chunein.</p>
  </div>;
}

export default function Lottery() {
  const { user } = useAuth();
  return <ConnectedLottery key={user!.id} userId={user!.id} />;
}
function ConnectedLottery({ userId }: { userId: string }) {
  const qc = useQueryClient(), [, go] = useLocation();
  const [page, setPage] = useState("terminal"), [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const operation = useRef(false);
  const sound = useStore(s => s.settings.sound);
  const key = ["lottery", userId];
  const state = useQuery({ queryKey: key, queryFn: ({ signal }) => customFetch<Data>("/api/lottery/bootstrap", { signal }),
    refetchInterval: busy ? false : 5000, retry: 1 });
  useRealtimeTopic(`wallet:${userId}`, () => { if (!operation.current) void qc.invalidateQueries({ queryKey: key }); });
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5500); return () => clearTimeout(timer); }, [toast]);
  const navigate = (next: string) => {
    if (next === "wallet") go("/wallet");
    else if (next === "settings") go("/profile");
    else if (next === "support") go("/help");
    else setPage(next);
  };
  const run: ViewProps["run"] = async <T,>(path: string, body: unknown, message?: string, request?: string) => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    await qc.cancelQueries({ queryKey: key });
    try {
      const result = await customFetch<T>(`/api/lottery${path}`, { method: "POST", headers: {
        "Content-Type": "application/json", ...(request ? { "Idempotency-Key": request } : {}),
      }, body: JSON.stringify(body) });
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() }), qc.invalidateQueries({ queryKey: ["/api/bets"] })]);
      if (message) setToast({ message, error: false });
      return result;
    } catch (error) { setToast({ message: error instanceof Error ? error.message : "Unable to complete this action.", error: true }); return undefined; }
    finally { operation.current = false; setBusy(false); }
  };
  const logout = async () => {
    try {
      await customFetch("/api/auth/logout", { method: "POST" });
      qc.removeQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); go("/login");
    } catch { setToast({ message: "Sign out failed. Please retry.", error: true }); }
  };
  if (!state.data) return <div className="min-h-screen grid place-items-center bg-white text-slate-800"><div role="status">
    <p>{state.isError ? "Lottery connection unavailable." : "Loading Irland Lotto…"}</p>
    {state.isError && <button onClick={() => void state.refetch()}>Retry</button>}
    <button className="ml-4" onClick={() => go("/")}>Back to lobby</button>
  </div></div>;
  const now = clock + state.data.serverTime - state.dataUpdatedAt;
  const props: ViewProps = { data: state.data, now, navigate, run, busy: busy || state.isError, printTicket: async () => {} };
  return <div className="lottery-connected" data-testid="lottery-connected"><style>{css}</style>
    <PlayerShell data={state.data} active={page} navigate={navigate} offline={state.isError} onRetry={() => void state.refetch()}
      onLogout={() => void logout()} onBackToLobby={() => go("/")} toast={toast} dismissToast={() => setToast(null)}>
      {page === "tickets" ? <Tickets {...props} /> : page === "results" ? <Results {...props} /> : page === "reports" ? <Reports {...props} /> :
        <PlayerGame {...props} CoinControls={LotteryCoins} audioBridge={{ enabled: sound,
          setEnabled: enabled => { void unlockAudio(); updateSettings({ sound: enabled }); }, play: cue => playGameSound(cue, "lottery-2d") }} />}
    </PlayerShell>
  </div>;
}
