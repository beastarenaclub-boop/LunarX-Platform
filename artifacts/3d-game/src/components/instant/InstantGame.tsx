import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Gem, CircleDot, ShieldCheck, Volume2, VolumeX, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch, useGetWalletBalance, getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey, getListWalletTransactionsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { store, useStore } from "@/game/store";
import { unlockAudio } from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { GameRulesButton } from "@/components/game/GameRules";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "./instant-games.css";

export type InstantGame = "mines" | "plinko";
export function useInstantGame(game: InstantGame) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const sound = useStore(s => s.settings.sound);
  const balance = useGetWalletBalance({ game }, { query: { queryKey: getGetWalletBalanceQueryKey({ game }), enabled: !!user, retry: false } });
  useEffect(() => { if (!isLoading && !user) navigate("/"); }, [isLoading, user, navigate]);
  useEffect(() => { document.title = `${game === "mines" ? "Mines" : "Plinko"} | Lunar Originals`; }, [game]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: [`${game}.recent`] });
  };
  return { user, sound, balance, refresh, qc };
}

export function request<T>(url: string, body?: unknown) {
  return customFetch<T>(url, body === undefined ? { method: "GET" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const data = error.data as { detail?: string; title?: string } | undefined;
    return data?.detail || data?.title || "Request failed. Please try again.";
  }
  return error instanceof Error ? error.message : "Connection lost. Please try again.";
}
export function stakeError(value: number, balance: string | undefined, max: string | undefined) {
  if (!Number.isFinite(value) || value < .01 || !Number.isSafeInteger(Math.round(value * 100))) return "Enter a valid amount of at least ₹0.01.";
  if (max && value * 100 > Number(max)) return `Maximum bet is ₹${formatRupees(max)}.`;
  if (balance !== undefined && Math.round(value * 100) > Number(balance)) return "Insufficient wallet balance.";
  return null;
}
export const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InstantShell({ game, balance, onFairness, children }: {
  game: InstantGame; balance?: string; onFairness: () => void; children: ReactNode;
}) {
  const sound = useStore(s => s.settings.sound);
  return <div className={`game-page instant-page instant-${game}`}>
    <div className="instant-shell">
      <header className="instant-header">
        <div className="instant-brand"><Link href="/" className="instant-icon" aria-label="Back to lobby" data-testid="btn-back"><ArrowLeft size={19} /></Link>
          <span className="instant-brand-mark">{game === "mines" ? <Gem size={25} /> : <CircleDot size={25} />}</span>
          <div><span className="instant-eyebrow">LUNAR ORIGINALS</span><h1>{game === "mines" ? "Mines" : "Plinko"}</h1></div></div>
        <nav className="instant-switch" aria-label="Original games"><Link href="/mines" aria-current={game === "mines" ? "page" : undefined}><Gem size={15} /> Mines</Link><Link href="/plinko" aria-current={game === "plinko" ? "page" : undefined}><CircleDot size={15} /> Plinko</Link></nav>
        <div className="instant-wallet"><Wallet size={17} /><div><small>YOUR BALANCE</small><strong data-testid={`text-${game}-balance`}>{balance === undefined ? "Loading…" : `₹${formatRupees(balance)}`}</strong></div></div>
      </header>
      {children}
      <footer className="instant-footer"><span><i /> Server-settled rounds</span><div>
        <button className="instant-text-button" onClick={onFairness} data-testid="btn-fairness"><ShieldCheck size={15} /> Fairness</button>
        <button className="instant-icon" aria-label={sound ? "Mute sound" : "Enable sound"} aria-pressed={sound} onClick={() => { void unlockAudio(); updateSettings({ sound: !store.getState().settings.sound }); }}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <GameRulesButton gameCode={game} /></div></footer>
    </div>
  </div>;
}

export function StakeControl({ game, userId, value, onChange, disabled, max }: {
  game: InstantGame; userId?: string; value: number; onChange: (n: number) => void; disabled: boolean; max?: string;
}) {
  const coins = useCoinPreferences(game, userId);
  const adjust = (n: number) => onChange(Math.max(.01, Math.min(Number(max ?? Number.MAX_SAFE_INTEGER) / 100, Math.round(n * 100) / 100)));
  return <div className="instant-stake"><label htmlFor={`${game}-stake`}>Bet amount <span>INR</span></label>
    <div className="instant-amount"><span>₹</span><input id={`${game}-stake`} aria-label="Bet amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={value || ""} disabled={disabled}
      onChange={e => onChange(Number(e.target.value))} data-testid={`input-${game}-stake`} />
      <button disabled={disabled} onClick={() => adjust(value / 2)} aria-label="Halve bet">½</button><button disabled={disabled} onClick={() => adjust(value * 2)} aria-label="Double bet">2×</button></div>
    <TableCoinRack preferences={coins} chip={value} onSelect={onChange} disabled={disabled} idSuffix={`-${game}`} layout="fit" className="instant-coins" />
  </div>;
}

export function Notice({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <div className="instant-notice" role="alert">{children}{onRetry && <button onClick={onRetry}>Retry</button>}</div>;
}
export function FairnessDialog({ open, onOpenChange, children, title = "Round fairness" }: {
  open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode; title?: string;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="instant-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Inspect the seed commitment and round details.</DialogDescription></DialogHeader><div className="instant-fairness">{children}</div></DialogContent></Dialog>;
}
export function SeedField({ label, value }: { label: string; value: string | number | null }) {
  return <div><small>{label}</small><code>{value ?? "Revealed when the round is complete"}</code></div>;
}
