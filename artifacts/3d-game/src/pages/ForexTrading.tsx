import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletBalanceQueryKey, getGetWalletBalancesQueryKey, useGetWalletBalance } from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  TrendingUp,
  Coins,
  Info,
  Volume2,
  VolumeX,
  Clock3,
  ShieldCheck,
  History,
  X,
  Check,
  LockKeyhole,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { sfx, unlockAudio } from "@/game/audio";
import { useForex } from "@/components/forex/useForex";
import { TradingChart } from "@/components/forex/TradingChart";
import { GameChart, ChartSourceTabs, BetFeedback } from "@/components/forex/GameChart";
import { marketPrice as quote, marketChange, marketTone, MarketQuoteStatus } from "@/components/forex/MarketQuote";
import {
  TableCoinRack,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import {
  GameInformationDrawer,
  restoreGameInformationFocus,
} from "@/components/game/GameInformation";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import type { Side } from "../../../../lib/forex/store.mjs";
import "@/components/forex/forex.css";
import "@/components/forex/forex-game.css";
import "@/components/forex/forex-quote-layout.css";

const fmt = (amount: number) =>
  amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const directions = { up: "UP", down: "DOWN", flat: "FLAT" };

export default function ForexTrading() {
  const { user } = useAuth();
  return <ForexTable key={user!.id} userId={user!.id} />;
}

function ForexTable({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const wallet = useGetWalletBalance(undefined, { query: { queryKey: getGetWalletBalanceQueryKey(), refetchInterval: 5000 } });
  const game = useForex(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
  });
  const { state, busy, connected, clock } = game;
  const returnMultiplier = state?.round.returnMultiplier ?? 1.7;
  const balance = state?.account?.balance ?? (wallet.data ? Number(wallet.data.balance) / 100 : undefined);
  const coins = useCoinPreferences("forex-trading", userId, 5000);
  const sound = useStore((s) => s.settings.sound);
  const [asset, setAsset] = useState("gold");
  const [category, setCategory] = useState("All");
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [chartSource, setChartSource] = useState<"game" | "market">("game");
  const [candleSeconds, setCandleSeconds] = useState(1);
  const [info, setInfo] = useState(false);
  const [tab, setTab] = useState("History");
  const [count, setCount] = useState(0);
  const market = state?.assets.find((m) => m.id === asset);
  const locked = !state || clock >= state.round.lockAt;
  const remaining = state
    ? Math.max(
        0,
        Math.ceil(
          ((locked ? state.round.endAt : state.round.lockAt) - clock) / 1000,
        ),
      )
    : 0;
  const canBet =
    connected &&
    !busy &&
    !locked &&
    !!state?.account &&
    (balance ?? 0) >= coins.chip &&
    coins.chip % 10 === 0;
  const open = state?.trades.filter((t) => t.status === "open") || [];
  const latestResult = state?.results[0];
  const settled =
    state?.trades.filter(
      (t) => t.roundId === latestResult?.roundId && t.status !== "open",
    ) || [];
  const roundWin = useRoundWin({
    game: "forex-trading",
    userId,
    roundId: latestResult ? String(latestResult.roundId) : null,
    eligible: !!latestResult,
    bets: settled.map((t) => ({
      status: t.status === "refund" ? "refunded" : "settled",
      payoutAmount: String(Math.round(t.payout * 100)),
      totalStake: String(Math.round(t.amount * 100)),
    })),
    unit: "rupees",
  });
  useEffect(() => {
    document.title = "Aurum Forex Trading";
  }, []);
  useEffect(() => {
    if (roundWin.win) setInfo(false);
  }, [roundWin.win]);
  const select = (id: string) => {
    setAsset(id);
    void unlockAudio();
    if (sound) sfx.uiSelect();
  };
  const place = (side: Side) => {
    void unlockAudio();
    if (sound) sfx.uiSelect();
    void game.trade(asset, side, coins.chip);
  };
  const information = (section: string) => {
    setTab(section);
    setInfo(true);
  };

  return (
    <div className="fa-game game-page" data-testid="forex-game">
      <header className="fa-header">
        <Link
          href="/"
          className="fa-icon fa-back"
          aria-label="Back to all games"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="fa-title">
          <span className="fa-emblem">
            <TrendingUp size={22} />
          </span>
          <div>
            <h1>
              FOREX <em>TRADING</em>
            </h1>
            <small>AURUM · GOLD · SILVER · CURRENCIES</small>
          </div>
        </div>
        <Link href="/wallet" className="fa-balance" aria-label="Open Wallet">
          <Coins size={20} />
          <div>
            <small>Wallet balance</small>
            <strong data-testid="balance">
              {balance !== undefined ? `₹${fmt(balance)}` : "…"}
            </strong>
          </div>
        </Link>
        <button
          className="fa-icon fa-sound"
          aria-label={sound ? "Mute sound" : "Enable sound"}
          onClick={() => {
            void unlockAudio();
            updateSettings({ sound: !sound });
          }}
        >
          {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        <button
          className="fa-icon"
          data-testid="btn-game-rules"
          aria-label="Game information"
          onClick={() => information("Rules")}
        >
          <Info size={20} />
        </button>
      </header>

      <div className="fa-market-bar">
        <div
          className="fa-market-filters"
          role="group"
          aria-label="Market category"
        >
          {["All", "Metals", "Forex", "Energy", "Crypto"].map((c) => (
            <button
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
              key={c}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="fa-assets" aria-label="Choose a market">
          {state?.assets
            .filter((m) => category === "All" || m.category === category)
            .map((m) => (
              <button
                key={m.id}
                aria-label={`Select ${m.name}`}
                aria-pressed={asset === m.id}
                className={asset === m.id ? "selected" : ""}
                style={{ "--asset-color": m.color } as CSSProperties}
                onClick={() => select(m.id)}
              >
                <span className="fa-asset-symbol">{m.icon}</span>
                <span>
                  <b>{m.name.includes("/") ? m.symbol : m.name}</b>
                  <small className={marketTone(m)}>
                    {quote(m)}{" "}
                    {m.quote?.status === "stale" ? "· Last" : marketChange(m)}
                  </small>
                </span>
              </button>
            ))}
        </div>
      </div>

      <main className="fa-play-area" data-game-screen="forex">
        <section className="fa-chart-board">
          <div className="fa-chart-heading">
            <div className="fa-instrument">
              <span
                className="fa-large-symbol"
                style={
                  {
                    "--asset-color": market?.color ?? "#e7bd65",
                  } as CSSProperties
                }
              >
                {market?.icon || "Au"}
              </span>
              <div>
                <h2>
                  {market?.name || "Gold"}{" "}
                  <small>{market?.symbol || "XAU/USD"}</small>
                </h2>
                <span>
                  <i className={connected ? "online" : ""} />
                  {connected ? "Market quotes · Pool game" : "Connecting…"}
                </span>
              </div>
            </div>
            <div className="fa-quote">
              <strong data-testid="market-price">
                {market ? quote(market) : "—"}
              </strong>
              <small
                className={
                  marketTone(market)
                }
              >
                {market
                  ? `${marketChange(market)} since previous close`
                  : "Waiting for market"}
              </small>
            </div>
          </div>
          <MarketQuoteStatus market={market} />
          <ChartSourceTabs source={chartSource} onChange={setChartSource} />
          <div className="fa-chart-tools">
            <div role="group" aria-label="Chart range">
              {(chartSource === "game" ? [1, 2, 5] : [0, 15, 30, 60]).map((n) => (
                <button
                  key={n}
                  className={(chartSource === "game" ? candleSeconds : count) === n ? "active" : ""}
                  onClick={() => chartSource === "game" ? setCandleSeconds(n) : setCount(n)}
                >
                  {chartSource === "game" ? `${n}s` : n === 0 ? "Latest" : n === 60 ? "1h" : `${n}m`}
                </button>
              ))}
            </div>
            <span>{chartSource === "game" ? "GAME ANIMATION · 5 TICKS/SEC" : count === 0 ? "AUTO-REFRESH · 30 SEC" : "1 MIN SAMPLES"}</span>
            <div className="fa-chart-view">
              <button
                aria-label="Candlestick chart"
                aria-pressed={mode === "candles"}
                className={mode === "candles" ? "active" : ""}
                onClick={() => setMode("candles")}
              >
                <BarChart3 size={17} />
              </button>
              <button
                aria-label="Line chart"
                aria-pressed={mode === "line"}
                className={mode === "line" ? "active" : ""}
                onClick={() => setMode("line")}
              >
                <TrendingUp size={17} />
              </button>
            </div>
          </div>
          <div className="fa-chart-surface fx-app">
            {market && state ? (
              chartSource === "game" ? <GameChart key={market.id} market={market} state={state} clock={clock} connected={connected} seconds={candleSeconds} mode={mode} /> :
                <TradingChart market={market} mode={mode} count={count} fit />
            ) : (
              <div className="fa-loading">
                <TrendingUp size={36} />
                <p>{game.error || "Opening the trading table…"}</p>
              </div>
            )}
          </div>
          <div className="fa-chart-bottom">
            <span>
              Previous close <b>{market ? quote(market, market.quote?.previousClose ?? null) : "—"}</b>
            </span>
            <span>
              Asset pool <b>{fmt(market?.volume || 0)}</b>
            </span>
            <span>
              Pool signal{" "}
              <b
                data-testid="direction"
                className={`fx-${market?.direction || "flat"}`}
              >
                {directions[market?.direction || "flat"]}
              </b>
            </span>
          </div>
        </section>

        <section className="fa-betting-panel" aria-label="Prediction controls">
          <div
            className={`fa-round-banner ${locked ? "locked" : ""}`}
            data-testid="round-phase-banner"
          >
            <div>
              <span>
                {locked ? <LockKeyhole size={14} /> : <Clock3 size={14} />}{" "}
                {locked ? "ORDERS LOCKED" : "PLACE YOUR PREDICTION"}
              </span>
              <small>Round #{state?.round.id || "—"}</small>
            </div>
            <div className="fa-timer">
              <b data-testid="round-timer-seconds">
                {String(remaining).padStart(2, "0")}
              </b>
              <span>{locked ? "to result" : "to lock"}</span>
            </div>
          </div>
          <div className="fa-round-progress">
            <i
              style={{ width: `${(remaining / (locked ? 15 : 45)) * 100}%` }}
            />
          </div>
          <div className="fa-prediction-title">
            <span>Predict {market?.name || "Gold"}</span>
            <b>{returnMultiplier.toFixed(2)}× RETURN</b>
          </div>
          <div className="fa-bet-buttons">
            <button
              className="fa-buy"
              data-game-bet="buy"
              data-testid="forex-buy"
              disabled={!canBet}
              onClick={() => place("buy")}
            >
              <ArrowUpRight />
              <div>
                <strong>BUY / UP</strong>
                <span>Pool result is UP</span>
              </div>
            </button>
            <button
              className="fa-sell"
              data-game-bet="sell"
              data-testid="forex-sell"
              disabled={!canBet}
              onClick={() => place("sell")}
            >
              <ArrowDownRight />
              <div>
                <strong>SELL / DOWN</strong>
                <span>Pool result is DOWN</span>
              </div>
            </button>
          </div>
          <BetFeedback busy={busy} error={game.error} notice={game.notice} />
          <div className="fa-amount-summary">
            <span>
              Selected{" "}
              <b>
                ₹{fmt(coins.chip)}
              </b>
            </span>
            <span>
              Potential return{" "}
              <b className="fa-gold">
                ₹{fmt(coins.chip * returnMultiplier)}
              </b>
            </span>
          </div>
          <div className="fa-coin-label">
            <Coins size={14} /> SELECT YOUR COIN{" "}
            <small>10–5,000 · multiples of 10</small>
          </div>
          <div className="fa-coins">
            <TableCoinRack
              preferences={coins}
              chip={coins.chip}
              onSelect={(value) => {
                coins.selectChip(value);
                void unlockAudio();
                if (sound) sfx.uiSelect();
              }}
              layout="fit"
              unit="rupees"
              minValue={10}
              maxValue={5000}
              step={10}
              disabled={busy}
            />
          </div>
          <div className="fa-bet-hint" role="status">
            {busy
              ? "Confirming prediction…"
              : !connected
                ? "Connecting to game server…"
                : balance !== undefined && coins.chip > balance
                  ? <Link href="/wallet">Not enough balance. Open Wallet to add funds.</Link>
                  : locked
                    ? "Next round starts after settlement."
                    : "Tap BUY or SELL to place the selected coin."}
          </div>
          <div className="fa-pressure">
            <div>
              <span>
                Pool average <b>₹{fmt(state?.pool.average || 0)}</b>
              </span>
              <strong className={`fx-${market?.direction || "flat"}`}>
                {directions[market?.direction || "flat"]}
              </strong>
            </div>
            <p>Zyada paisa → neeche · Kam paisa → upar</p>
            <small>
              Independent UP/DOWN draw; market prices are for reference. Locks at 45s.
            </small>
          </div>
          <div className="fa-session">
            <span>
              <Users size={13} />
              {state?.pool.participants || 0} players
            </span>
            <button onClick={() => information("Positions")}>
              <History size={14} />
              {open.length} open{" "}
              {open.length === 1 ? "prediction" : "predictions"}
            </button>
          </div>
        </section>
      </main>

      <div className="fa-result-strip">
        <span>LAST ROUNDS</span>
        <div>
          {state?.results.slice(0, 12).map((result) => (
            <button
              key={result.roundId}
              className={`result-${result.assets[asset].direction}`}
              aria-label={`Round ${result.roundId}: ${result.assets[asset].direction}`}
              onClick={() => information("Results")}
            >
              {result.assets[asset].direction === "up" ? (
                <ArrowUpRight size={13} />
              ) : result.assets[asset].direction === "down" ? (
                <ArrowDownRight size={13} />
              ) : (
                "—"
              )}
              {directions[result.assets[asset].direction]}
            </button>
          ))}
          {!state?.results.length && (
            <small>The first result appears at the end of this round.</small>
          )}
        </div>
        <button
          className="fa-history-link"
          aria-label="Prediction history"
          onClick={() => information("History")}
        >
          <History size={16} />
          <span>History</span>
        </button>
      </div>
      <footer className="fa-footer">
        <ShieldCheck size={12} />
        <span>Shared wallet · Google quotes · Pool-based results</span>
        <span className="fa-footer-rule">
          85% RTP target · 60-second rounds
        </span>
      </footer>

      {(game.error || game.notice) && (
        <div
          className={`fa-toast ${game.error ? "error" : ""}`}
          role={game.error ? "alert" : "status"}
        >
          {game.error ? <Info size={17} /> : <Check size={17} />}
          <span>{game.error || game.notice}</span>
          <button aria-label="Dismiss notification" onClick={game.dismiss}>
            <X size={17} />
          </button>
        </div>
      )}
      <Dialog open={info} onOpenChange={setInfo}>
        <GameInformationDrawer
          className="fa-information bg-[#0b1628] text-white"
          onCloseAutoFocus={restoreGameInformationFocus}
        >
          <DialogTitle>Aurum Forex Trading</DialogTitle>
          <DialogDescription>
            Game rules, your predictions and market results.
          </DialogDescription>
          <div
            className="fa-info-tabs"
            role="tablist"
            aria-label="Game information sections"
          >
            {["Rules", "Positions", "History", "Results"].map((name) => (
              <button
                role="tab"
                aria-selected={tab === name}
                key={name}
                onClick={() => setTab(name)}
              >
                {name}
                {name === "Positions" ? ` (${open.length})` : ""}
              </button>
            ))}
          </div>
          <div className="fa-info-content" role="tabpanel" aria-label={tab}>
            {tab === "Rules" && (
              <>
                <h2>Choose a market. Predict its next move.</h2>
                <ol>
                  <li>
                    Select Gold, Silver or one of the other 10 markets, then
                    select a coin.
                  </li>
                  <li>
                    <b>BUY</b> predicts an UP result.{" "}
                    <b>SELL</b> predicts a DOWN result. Both sides add to the
                    asset’s total.
                  </li>
                  <li>
                    New rounds draw UP or DOWN independently with equal probability. Bet totals and player choices cannot change the draw.
                    Market price changes do not add wallet profit.
                  </li>
                  <li>
                    Orders close at 45 seconds. At 60 seconds, correct
                    predictions return <b>{returnMultiplier.toFixed(2)}× including the stake</b>. Wrong
                    predictions lose the stake. Earlier pool rounds retain their accepted rates and refund rules.
                  </li>
                  <li>
                    Game chart is a simulated index with fast candles and your
                    accepted bet markers. Idle animation never credits the wallet.
                  </li>
                  <li>
                    The draw stays hidden until the round ends.
                    Google Finance prices and chart samples are independent of
                    game outcomes. Quotes refresh every 30 seconds with source delays.
                  </li>
                </ol>
                <div className="fa-info-example">
                  ₹100 at 1.70× returns ₹170 on a win. With a 50% chance, the expected return is ₹85 across many plays. This does not guarantee any round or session result.
                </div>
                <p>
                  Stakes are deducted from your lobby wallet. Winnings and flat
                  refunds return to the same wallet, even after you leave this
                  game. One coin represents ₹1. Metals and energy show futures,
                  not spot prices. Google quotes do not decide payouts.
                </p>
                <Link href="/wallet" className="fa-refill">Open Wallet</Link>
              </>
            )}
            {(tab === "Positions" || tab === "History") && (
              <>
                {(tab === "Positions"
                  ? open
                  : state?.trades.filter((t) => t.status !== "open") || []
                ).map((t) => {
                  const m = state!.assets.find((a) => a.id === t.asset)!;
                  return (
                    <article className="fa-trade-row" key={t.id}>
                      <div>
                        <b>
                          {m.name}{" "}
                          <span
                            className={t.side === "buy" ? "fx-up" : "fx-down"}
                          >
                            {t.side.toUpperCase()}
                          </span>
                        </b>
                        <small>
                          #{t.roundId} · Pool-based prediction
                        </small>
                      </div>
                      <div>
                        <b>₹{fmt(t.amount)}</b>
                        <small
                          className={
                            t.status === "won"
                              ? "fx-up"
                              : t.status === "lost"
                                ? "fx-down"
                                : ""
                          }
                        >
                          {t.status === "open"
                            ? "PENDING"
                            : `${t.status.toUpperCase()} · ${t.payout - t.amount >= 0 ? "+" : ""}${fmt(t.payout - t.amount)}`}
                        </small>
                      </div>
                    </article>
                  );
                })}
                {!(
                  tab === "Positions"
                    ? open
                    : state?.trades.filter((t) => t.status !== "open") || []
                ).length && (
                  <p className="fa-info-empty">
                    {tab === "Positions"
                      ? "No open predictions. Select a coin, then BUY or SELL."
                      : "Your completed predictions will appear here."}
                  </p>
                )}
                <div className="fa-info-stats">
                  <span>{state?.account?.settled || 0} completed</span>
                  <span>{state?.account?.wins || 0} wins</span>
                  <b>Net ₹{fmt(state?.account?.profit || 0)}</b>
                </div>
              </>
            )}
            {tab === "Results" && (
              <>
                <h2>{market?.name} round results</h2>
                <p>Pool amounts are fixed at cutoff.</p>
                {state?.results.map((r) => (
                  <article className="fa-trade-row" key={r.roundId}>
                    <div>
                      <b>#{r.roundId}</b>
                      <small>
                        Asset {fmt(r.assets[asset].volume)} · Average{" "}
                        {fmt(r.average)}
                      </small>
                    </div>
                    <div>
                      <b className={`fx-${r.assets[asset].direction}`}>
                        {directions[r.assets[asset].direction]}
                      </b>
                      <small>
                        Pool-based result
                      </small>
                    </div>
                  </article>
                ))}
                {!state?.results.length && (
                  <p className="fa-info-empty">
                    Waiting for the first round to settle.
                  </p>
                )}
              </>
            )}
          </div>
        </GameInformationDrawer>
      </Dialog>
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
    </div>
  );
}
