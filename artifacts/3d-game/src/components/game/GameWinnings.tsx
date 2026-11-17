import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { addResponseObserver, customFetch, useRealtimeResync, useRealtimeTopic, type Bet, type BetsPage } from "@workspace/api-client-react";
import { Trophy, ChevronRight, RefreshCw, History, WifiOff } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { LOBBY_GAMES } from "@/components/lobby/catalog";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatWinAmount } from "../table/RoundWinPopup";
import WinningNotice from "./WinningNotice";
import "./game-winnings.css";

const aliases: Record<string, string> = {
  "/wingo": "wingo", "/virtual-sports": "virtual-football", "/horse-riding": "wild-trails",
};
const money = (amount: string | bigint, demo: boolean) => `${demo ? "" : "₹"}${formatWinAmount(BigInt(amount))}${demo ? " coins" : ""}`;
const paid = (bet: Bet) => bet.status === "won" || bet.status === "cashed_out";
const winning = (bet: Bet) => paid(bet) && BigInt(bet.payoutAmount) > BigInt(bet.stakeAmount);
type GameReport = { items: { id: string; at: string; game: string; reference: string | null; stake: string; payout: string | null; status: Bet["status"] }[]; nextCursor?: string | null };

/** Server receipts stay available after the result animation or the next round. */
export default function GameWinnings({ activeGame }: { activeGame?: string }) {
  const [location] = useLocation();
  const game = LOBBY_GAMES.find(item => item.route === location || item.id === aliases[location]);
  const { user } = useAuth();
  const code = game?.registryCode ?? game?.id ?? activeGame;
  if (!code || !user) return null;
  const name = game?.name ?? code.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return <PersonalWinnings key={`${user.id}:${code}`} userId={user.id} demo={!!user.isDemo}
    game={code} name={name} />;
}

function PersonalWinnings({ userId, game, name, demo }: { userId: string; game: string; name: string; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState<Element | null>(() => document.fullscreenElement);
  const [notices, setNotices] = useState<Bet[]>([]);
  const previous = useRef<Map<string, string> | null>(null);
  const announced = useRef(new Set<string>());
  const qc = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const key = ["personal-game-winnings", userId, game];
  const receipts = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }): Promise<BetsPage> => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 12000);
      let report: GameReport;
      try {
        report = await customFetch<GameReport>(`/api/reports/gameresults?gameCode=${encodeURIComponent(game)}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal: controller.signal });
      } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
      return { nextCursor: report.nextCursor, entries: report.items.map(row => ({ id: row.id, userId,
        gameCode: row.game, roundId: row.reference, stakeAmount: row.stake, payoutAmount: row.payout ?? "0", status: row.status, placedAt: row.at })) };
    },
    getNextPageParam: page => page.nextCursor || undefined,
    refetchInterval: query => query.state.data?.pages[0]?.entries.some(bet => bet.status === "placed") ? 2000 : 5000,
    staleTime: 2000,
    retry: 1,
  });
  const refresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void qc.invalidateQueries({ queryKey: key });
    }, 150);
  }, [qc, userId, game]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  useEffect(() => {
    // A successful game action is authoritative even when its socket notification
    // was missed. Refresh after both immediate results and accepted table bets.
    const unsubscribe = addResponseObserver(event => {
      const path = new URL(event.url, window.location.href).pathname;
      if (event.method === "POST" && path.startsWith("/api/") && !/^\/api\/(auth|reports|wallet|profile)\//.test(path)) refresh();
    });
    window.addEventListener("table-round-win", refresh);
    return () => { unsubscribe(); window.removeEventListener("table-round-win", refresh); };
  }, [refresh]);
  useEffect(() => {
    const entries = receipts.data?.pages[0]?.entries;
    if (!entries) return;
    const current = entries.filter(bet => bet.userId === userId && bet.gameCode === game);
    if (previous.current) {
      const fresh = current.filter(bet => winning(bet) && !announced.current.has(bet.id) &&
        (previous.current!.get(bet.id) === "placed" || !previous.current!.has(bet.id)));
      if (fresh.length) setNotices(queue => [...queue, ...fresh.slice().reverse()]);
    }
    current.filter(winning).forEach(bet => announced.current.add(bet.id));
    // Only the current page generates alerts. Opening older history never does.
    previous.current = new Map(current.map(bet => [bet.id, bet.status]));
  }, [receipts.data, userId, game]);
  const dismissNotice = useCallback(() => setNotices(queue => queue.slice(1)), []);
  useRealtimeTopic<{ type: string }>(`wallet:${userId}`, event => { if (event.type === "balance") refresh(); });
  useRealtimeTopic<{ type: string; userId: string; gameCode: string }>("bets:global", event => {
    if (event.type === "settled" && event.userId === userId && event.gameCode === game) refresh();
  });
  useRealtimeResync(refresh);
  const rows = [...new Map((receipts.data?.pages.flatMap(page => page.entries ?? []) ?? [])
    .filter(bet => bet.userId === userId && bet.gameCode === game).map(bet => [bet.id, bet])).values()];
  const wins = rows.filter(winning).sort((a, b) => Date.parse(b.settledAt ?? b.placedAt) - Date.parse(a.settledAt ?? a.placedAt));
  const last = wins[0];
  const pending = rows.some(bet => bet.status === "placed");
  const displayed = notices[0] ?? last;
  return <Dialog open={open} onOpenChange={setOpen}>
    <div className="game-winnings-bar" data-testid="game-winnings" data-game={game} data-has-win={!!displayed} data-new-win={!!notices.length}>
      <div className="game-winnings-medal"><Trophy size={22} aria-hidden="true" /></div>
      <div className="game-winnings-summary" role="status" aria-live="polite" aria-atomic="true">
        <span>{notices.length ? "NEW WIN · TOTAL RETURN" : last ? "LAST WIN · TOTAL RETURN" : "YOUR WINNINGS"}{demo ? " · DEMO" : ""}</span>
        <strong data-testid="game-last-win">{displayed ? money(displayed.payoutAmount, demo)
          : receipts.isError ? "Results unavailable" : receipts.isPending ? "Loading…" : pending ? "Bet in progress" : receipts.hasNextPage ? "View older results" : "No wins yet"}</strong>
        <small className="game-winnings-subline">{receipts.isError ? <><WifiOff size={11} /> {displayed ? "Reconnecting · saved result" : "Connection interrupted · tap retry"}</> : displayed ? <>Profit +{money(BigInt(displayed.payoutAmount) - BigInt(displayed.stakeAmount), demo)}{pending ? " · Next bet pending" : ""}</> : pending ? "Your result will update automatically" : "Settled results appear here"}</small>
      </div>
      {receipts.isError && <button className="game-winnings-retry" onClick={() => void receipts.refetch()} aria-label="Retry winnings"><RefreshCw size={18} /></button>}
      <DialogTrigger asChild><button className="game-winnings-open" data-testid="open-game-winnings"><History size={17} aria-hidden="true" /><span>My results</span><ChevronRight size={14} aria-hidden="true" /></button></DialogTrigger>
    </div>
    {fullscreen && fullscreen !== document.documentElement && fullscreen !== document.body && createPortal(
      <DialogTrigger asChild><button className="game-winnings-fullscreen" data-testid="fullscreen-game-winnings" aria-label="My results">
        <Trophy size={18} aria-hidden="true" /><span>My results{displayed && <strong>{money(displayed.payoutAmount, demo)}</strong>}</span><ChevronRight size={15} aria-hidden="true" />
      </button></DialogTrigger>, fullscreen)}
    <DialogContent className="game-winnings-dialog" data-testid="game-winnings-dialog">
      <div className="game-winnings-panel-heading"><span>YOUR GAME RECEIPTS</span><DialogTitle>{name} · My results</DialogTitle></div>
      <DialogDescription>{demo ? "Your demo results. Amounts are practice coins." : "Your bets and settled returns for this game."} Total returned includes the returned stake.</DialogDescription>
      {receipts.isError && <div className="game-winnings-message" role="status">Could not refresh results. <button onClick={() => void receipts.refetch()}>Try again</button></div>}
      {last && <div className="game-winnings-last"><div className="game-winnings-medal"><Trophy size={28} aria-hidden="true" /></div><div><span>LAST WIN · TOTAL RETURN</span><strong>{money(last.payoutAmount, demo)}</strong><small>Profit +{money(BigInt(last.payoutAmount) - BigInt(last.stakeAmount), demo)}</small></div></div>}
      {!rows.length && <p className="game-winnings-empty">{receipts.isPending ? "Loading your results…" : receipts.isError ? "Results will appear when the connection is restored." : "Your bets will appear here when you play."}</p>}
      <ol className="game-winnings-list">
        {rows.map(bet => {
          const settled = bet.status !== "placed" && bet.status !== "voided";
          const net = BigInt(bet.payoutAmount) - BigInt(bet.stakeAmount);
          const voucher = game === "prize-lotto" && bet.status === "won" && bet.payoutAmount === "0";
          const label = bet.status === "placed" ? "In progress" : bet.status === "voided" ? "Voided / refunded"
            : voucher ? "Prize awarded" : winning(bet) ? "Won" : net === 0n ? "Stake returned" : "Lost";
          return <li key={bet.id} data-testid="game-result-row" data-bet={bet.id} data-status={bet.status}>
            <div className="game-result-heading"><b data-win={winning(bet) || voucher}>{label}</b><time dateTime={bet.settledAt ?? bet.placedAt}>{new Date(bet.settledAt ?? bet.placedAt).toLocaleString()}</time></div>
            <dl><div><dt>Bet</dt><dd>{money(bet.stakeAmount, demo)}</dd></div><div><dt>Total returned</dt><dd>{settled && !voucher ? money(bet.payoutAmount, demo) : "—"}</dd></div><div><dt>Net result</dt><dd data-positive={net > 0n}>{settled && !voucher ? `${net > 0n ? "+" : net < 0n ? "−" : ""}${money(net, demo)}` : "—"}</dd></div></dl>
            {voucher && <small>Open Prize Lotto rewards to view your voucher.</small>}
            <small className="game-result-id">Round {bet.roundId ?? bet.id}</small>
          </li>;
        })}
      </ol>
      {receipts.hasNextPage && <button className="game-winnings-more" disabled={receipts.isFetchingNextPage} onClick={() => void receipts.fetchNextPage()}>{receipts.isFetchingNextPage ? "Loading…" : "Older results"}</button>}
    </DialogContent>
    {notices[0] && !open && <WinningNotice key={notices[0].id} bet={notices[0]} name={name} game={game} demo={demo}
      onDismiss={dismissNotice} onView={() => { setOpen(true); setNotices([]); }} />}
  </Dialog>;
}
