import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleHelp,
  Clock3,
  Coins,
  Gauge,
  Layers3,
  LockKeyhole,
  Search,
  ShieldCheck,
  Signal,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import type { Market } from "../../../../../lib/forex/store.mjs";
import { useForex } from "./useForex";
import { TradingChart } from "./TradingChart";
import { GameChart, ChartSourceTabs, BetFeedback } from "./GameChart";
import { marketPrice as price, marketChange, marketTone, MarketQuoteStatus } from "./MarketQuote";
import "./forex.css";

const credits = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
function AssetIcon({ market }: { market: Market }) {
  return (
    <span
      className="fx-asset-icon"
      style={{ "--asset-color": market.color } as CSSProperties}
    >
      {market.icon}
    </span>
  );
}
function MiniChart({ market }: { market: Market }) {
  const values = (market.quote?.ticks ?? []).slice(-20).map((c) => c.price);
  if (values.length < 2) return null;
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  return (
    <svg viewBox="0 0 72 24" aria-hidden="true">
      <polyline
        points={values
          .map(
            (v, i) =>
              `${(i * 72) / (values.length - 1)},${22 - ((v - min) / span) * 20}`,
          )
          .join(" ")}
        fill="none"
        stroke={(market.quote?.changePercent ?? 0) >= 0 ? "#47cba7" : "#ee7783"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function TradingTerminal({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const game = useForex();
  const { state, connected, busy, clock } = game;
  const [asset, setAsset] = useState("gold");
  const [category, setCategory] = useState("All assets");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("100");
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [chartSource, setChartSource] = useState<"game" | "market">("game");
  const [candleSeconds, setCandleSeconds] = useState(1);
  const [count, setCount] = useState(0);
  const [tab, setTab] = useState("Open positions");
  const [rules, setRules] = useState(false);
  const rulesDialog = useRef<HTMLDialogElement>(null);
  const portfolio = useRef<HTMLElement>(null);
  useEffect(() => {
    document.title = "Aurum | Practice Trading";
  }, []);
  useEffect(() => {
    if (rules) rulesDialog.current?.showModal();
    else rulesDialog.current?.close();
  }, [rules]);
  const market = state?.assets.find((m) => m.id === asset);
  const locked = !state || clock >= state.round.lockAt;
  const seconds = state
    ? Math.max(
        0,
        Math.ceil(
          ((locked ? state.round.endAt : state.round.lockAt) - clock) / 1000,
        ),
      )
    : 0;
  const stake = Number(amount);
  const valid =
    Number.isSafeInteger(stake) &&
    stake >= 10 &&
    stake <= 5000 &&
    stake % 10 === 0;
  const canTrade =
    connected &&
    !busy &&
    !locked &&
    valid &&
    !!state?.account &&
    stake <= state.account.balance;
  const openTrades = state?.trades.filter((t) => t.status === "open") || [];
  const closedTrades = state?.trades.filter((t) => t.status !== "open") || [];
  const markets =
    state?.assets.filter(
      (m) =>
        (category === "All assets" || category === m.category) &&
        `${m.name} ${m.symbol}`.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const directionLabel =
    market?.direction === "down"
      ? "DOWN"
      : market?.direction === "up"
        ? "UP"
        : "FLAT";
  const rulesContent = (
    <>
      <div className="fx-rules-title">
        <span className="fx-eyebrow">TRANSPARENT BY DESIGN</span>
        <h2>
          Follow the money.
          <br />
          Predict the other way.
        </h2>
      </div>
      <p>
        Aurum is a virtual-credit pool game with Google Finance market quotes.
        Market prices are for reference; pool totals decide payouts.
        Credits cannot be deposited, withdrawn or redeemed.
      </p>
      <ol>
        <li>
          <b>Choose a market.</b> Gold, Silver, forex, energy or crypto. All 12
          assets share the same 60-second round.
        </li>
        <li>
          <b>Place a prediction.</b> BUY predicts an UP pool result.
          SELL predicts a DOWN pool result. Orders close after 45
          seconds.
        </li>
        <li>
          <b>Compare asset totals.</b> Both BUY and SELL stakes count toward the
          asset’s total. Average = all stakes ÷ 12, including assets with zero
          stakes.
        </li>
        <li>
          <b>Pool results.</b> Above average → DOWN. Below
          average → UP. Equal funded pools → FLAT.
          Real market movement does not decide this game's results.
        </li>
        <li>
          <b>Settle at 60 seconds.</b> Correct prediction returns 1.90× stake,
          including the stake. A wrong prediction loses the stake. Flat results
          refund the full stake.
        </li>
      </ol>
      <div className="fx-rule-example">
        Example: 1,200 credits on Gold, zero elsewhere → average 100. Gold's pool
        result is DOWN; the other 11 pool results are UP. Orders can change the result.
      </div>
      <p className="fx-muted">
        Game chart shows a simulated index with 1s/2s/5s candles and accepted bet markers.
        It also moves without bets; animation never credits the wallet.
        The Google market tab uses observed samples, refreshed every 30 seconds.
        Quotes are delayed about 3 minutes for currencies/crypto and 10 minutes for
        futures. Metals and energy show futures, not spot prices. Pool outcomes
        use only players’ accepted stakes before the cutoff.
      </p>
    </>
  );

  return (
    <div className="fx-app">
      <header className="fx-header">
        <a
          className="fx-brand"
          href={standalone ? "/" : "/forex-trading"}
          aria-label="Aurum trading home"
        >
          <span className="fx-logo">
            <i />
            <i />
            <i />
          </span>
          <span>
            AURUM<span className="fx-brand-caption">PREDICTION MARKETS</span>
          </span>
        </a>
        <nav className="fx-nav" aria-label="Trading navigation">
          <button
            className="active"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <BarChart3 size={16} /> Trade
          </button>
          <button
            onClick={() => {
              setTab("History");
              portfolio.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }}
          >
            <Layers3 size={16} /> Portfolio
          </button>
          <button onClick={() => setRules(true)}>
            <CircleHelp size={16} /> How it works
          </button>
        </nav>
        <div className="fx-header-right">
          <span className="fx-demo-badge">
            <span /> PRACTICE
          </span>
          <div className="fx-wallet">
            <Wallet size={17} />
            <div>
              <span>Practice balance</span>
              <b data-testid="balance">
                {credits(state?.account?.balance ?? 10000)} <small>CR</small>
              </b>
            </div>
          </div>
          <button
            className="fx-avatar"
            aria-label="View practice wallet"
            onClick={() => {
              setTab("History");
              portfolio.current?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            P
          </button>
        </div>
      </header>

      <div className="fx-market-strip">
        <span className="fx-strip-label">
          <Signal size={15} /> MARKET WATCH
        </span>
        {(
          state?.assets.filter((m) =>
            ["gold", "silver", "eurusd", "bitcoin", "oil"].includes(m.id),
          ) || []
        ).map((m) => (
          <button
            key={m.id}
            className={asset === m.id ? "selected" : ""}
            onClick={() => setAsset(m.id)}
          >
            <span>{m.symbol}</span>
            <b>{price(m)}</b>
            <span className={marketTone(m)}>
              {marketChange(m)}{m.quote?.status === "stale" ? " · Last" : ""}
            </span>
          </button>
        ))}
        <span className="fx-strip-disclaimer">Google Finance · Delayed</span>
      </div>

      <div className="fx-workspace-heading">
        <div>
          <span className="fx-eyebrow">YOUR MARKET. YOUR MOVE.</span>
          <h1>
            Trading terminal <span>12 markets</span>
          </h1>
        </div>
        <div className="fx-live-status">
          <span className={connected ? "connected" : ""} />
          {connected
            ? "Practice market connected"
            : "Connecting to practice market…"}
          <span className="fx-clock">
            {new Date(clock).toLocaleTimeString("en-GB")}
          </span>
        </div>
      </div>

      <main className="fx-workspace">
        <aside className="fx-panel fx-watchlist">
          <div className="fx-section-heading">
            <h2>Markets</h2>
            <span>12</span>
          </div>
          <label className="fx-search">
            <Search size={15} />
            <input
              aria-label="Search markets"
              placeholder="Search markets"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span>/</span>
          </label>
          <div
            className="fx-market-filters"
            role="group"
            aria-label="Market category"
          >
            {["All assets", "Metals", "Forex", "Energy", "Crypto"].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={category === c ? "active" : ""}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="fx-watchlist-labels">
            <span>Instrument</span>
            <span>Price / day change</span>
          </div>
          <div className="fx-market-list">
            {markets.map((m) => (
              <button
                className={`fx-market-row ${asset === m.id ? "active" : ""}`}
                key={m.id}
                onClick={() => setAsset(m.id)}
                aria-pressed={asset === m.id}
                aria-label={`Select ${m.name}`}
              >
                <AssetIcon market={m} />
                <span className="fx-market-name">
                  <b>
                    {m.name.includes(" / ") ? m.symbol.split("/")[0] : m.name}
                  </b>
                  <small>{m.symbol}</small>
                </span>
                <span className="fx-market-price">
                  <b>{price(m)}</b>
                  <small className={marketTone(m)}>
                    {marketChange(m)}{m.quote?.status === "stale" ? " · Last" : ""}
                  </small>
                </span>
              </button>
            ))}
            {state && !markets.length && (
              <p className="fx-empty-search">No markets found.</p>
            )}
          </div>
          <div className="fx-watchlist-footer">
            <ShieldCheck size={20} />
            <p>
              <b>Practice with confidence</b>
              <span>Virtual credits. Transparent rules.</span>
            </p>
          </div>
        </aside>

        <section className="fx-panel fx-chart-panel" aria-label="Market chart">
          {market ? (
            <>
              <div className="fx-instrument">
                <div className="fx-instrument-name">
                  <AssetIcon market={market} />
                  <div>
                    <h2>
                      {market.name} <span>{market.symbol}</span>
                    </h2>
                    <p>
                      {market.category} <span>•</span> Google Finance
                    </p>
                  </div>
                </div>
                <div className="fx-quote">
                  <strong data-testid="market-price">{price(market)}</strong>
                  <span
                    className={
                      marketTone(market)
                    }
                  >
                    {marketChange(market)} since previous close
                  </span>
                </div>
              </div>
              <MarketQuoteStatus market={market} />
              <div className="fx-instrument-stats">
                <div>
                  <span>Previous close</span>
                  <b>{price(market, market.quote?.previousClose ?? null)}</b>
                </div>
                <div>
                  <span>Asset pool</span>
                  <b>
                    {credits(market.volume)} <small>CR</small>
                  </b>
                </div>
                <div>
                  <span>Pool share</span>
                  <b>
                    {state && state.pool.total
                      ? ((market.volume / state.pool.total) * 100).toFixed(1)
                      : "0.0"}
                    %
                  </b>
                </div>
                <div>
                  <span>Pool signal</span>
                  <b
                    className={`fx-${market.direction}`}
                    data-testid="direction"
                  >
                    {directionLabel}{" "}
                    {market.direction === "up"
                      ? "↗"
                      : market.direction === "down"
                        ? "↘"
                        : "—"}
                  </b>
                </div>
              </div>
              <ChartSourceTabs source={chartSource} onChange={setChartSource} />
              <div className="fx-chart-toolbar">
                <div className="fx-segmented">
                  {(chartSource === "game" ? [[1, "1s"], [2, "2s"], [5, "5s"]] : [
                    [0, "Latest"],
                    [15, "15m"],
                    [30, "30m"],
                    [60, "1h"],
                  ]).map(([value, label]) => (
                    <button
                      className={(chartSource === "game" ? candleSeconds : count) === value ? "active" : ""}
                      key={value}
                      onClick={() => chartSource === "game" ? setCandleSeconds(Number(value)) : setCount(Number(value))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="fx-candle-label">{chartSource === "game" ? "Game animation · 5 ticks/sec" : count === 0 ? "Auto-refresh · 30 sec" : "1-minute samples"}</span>
                <div className="fx-chart-modes">
                  <button
                    aria-label="Candlestick chart"
                    aria-pressed={mode === "candles"}
                    className={mode === "candles" ? "active" : ""}
                    onClick={() => setMode("candles")}
                  >
                    <BarChart3 size={16} />
                  </button>
                  <button
                    aria-label="Line chart"
                    aria-pressed={mode === "line"}
                    className={mode === "line" ? "active" : ""}
                    onClick={() => setMode("line")}
                  >
                    <TrendingUp size={16} />
                  </button>
                </div>
              </div>
              {chartSource === "game" && state ? <GameChart key={market.id} market={market} state={state} clock={clock} connected={connected} seconds={candleSeconds} mode={mode} /> :
                <TradingChart market={market} mode={mode} count={count} />}
              <BetFeedback busy={busy} error={game.error} notice={game.notice} />
            </>
          ) : (
            <div className="fx-loading">
              <span className="fx-logo">
                <i />
                <i />
                <i />
              </span>
              <h2>Opening the market…</h2>
              <p>{game.error || "Connecting to your practice terminal"}</p>
            </div>
          )}
        </section>

        <aside className="fx-panel fx-order-panel">
          <div className="fx-section-heading">
            <h2>Place a prediction</h2>
            <span className="fx-duration">
              <Clock3 size={12} /> 60s
            </span>
          </div>
          <div className={`fx-round ${locked ? "locked" : ""}`}>
            <div>
              <span>{locked ? "ORDERS LOCKED" : "ROUND IN PROGRESS"}</span>
              <b>{locked ? "Settles in" : "Orders close in"}</b>
              <small>#{state?.round.id ?? "—"}</small>
            </div>
            <div
              className="fx-countdown"
              style={
                {
                  "--progress": `${(seconds / (locked ? 15 : 45)) * 100}%`,
                } as CSSProperties
              }
            >
              <strong data-testid="countdown">
                {String(seconds).padStart(2, "0")}
                <small>s</small>
              </strong>
            </div>
          </div>
          <div className="fx-order-asset">
            <span>Trading asset</span>
            <b>
              {market?.name ?? "Gold"}{" "}
              <small>{market?.symbol ?? "XAU/USD"}</small>
            </b>
          </div>
          <label className="fx-stake-label" htmlFor="fx-stake">
            Investment <span>10–5,000 CR</span>
          </label>
          <div className="fx-stake-input">
            <Coins size={18} />
            <input
              id="fx-stake"
              type="number"
              inputMode="numeric"
              min="10"
              max="5000"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="fx-stake-error"
            />
            <span>CR</span>
            <div>
              <button
                aria-label="Decrease investment"
                onClick={() =>
                  setAmount(String(Math.max(10, (Number(amount) || 10) - 10)))
                }
              >
                −
              </button>
              <button
                aria-label="Increase investment"
                onClick={() =>
                  setAmount(String(Math.min(5000, (Number(amount) || 0) + 10)))
                }
              >
                +
              </button>
            </div>
          </div>
          <div className="fx-quick-stakes">
            {[100, 500, 1000, 2500].map((n) => (
              <button
                key={n}
                className={stake === n ? "active" : ""}
                onClick={() => setAmount(String(n))}
              >
                {credits(n)}
              </button>
            ))}
          </div>
          <p id="fx-stake-error" className="fx-input-help">
            {!valid
              ? "Use multiples of 10, from 10 to 5,000."
              : state?.account && stake > state.account.balance
                ? "Insufficient practice credits."
                : "Pool-based outcome · Market quotes are for reference"}
          </p>
          <div className="fx-return">
            <span>
              Potential return <small>Includes your investment</small>
            </span>
            <div>
              <strong>
                {valid ? credits(stake * 1.9) : "—"} <small>CR</small>
              </strong>
              <b>+90% profit</b>
            </div>
          </div>
          <div className="fx-trade-actions">
            <button
              className="fx-buy"
              disabled={!canTrade}
              onClick={() => void game.trade(asset, "buy", stake)}
            >
              <span>
                <ArrowUpRight size={22} /> BUY
              </span>
              <small>Pool result UP</small>
            </button>
            <button
              className="fx-sell"
              disabled={!canTrade}
              onClick={() => void game.trade(asset, "sell", stake)}
            >
              <span>
                <ArrowDownRight size={22} /> SELL
              </span>
              <small>Pool result DOWN</small>
            </button>
          </div>
          <div className="fx-order-note">
            {locked ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}
            <span>
              {busy
                ? "Confirming your request…"
                : locked
                  ? "Next round opens after settlement"
                  : "Practice credits only · No real money"}
            </span>
          </div>
        </aside>

        <section
          className="fx-panel fx-positions"
          ref={portfolio}
          aria-label="Your portfolio"
        >
          <div className="fx-position-tabs">
            {["Open positions", "History", "Round results"].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Open positions" && <span>{openTrades.length}</span>}
              </button>
            ))}
            <span className="fx-portfolio-profit">
              Net P/L{" "}
              <b
                className={
                  (state?.account?.profit || 0) >= 0 ? "fx-up" : "fx-down"
                }
              >
                {(state?.account?.profit || 0) >= 0 ? "+" : ""}
                {credits(state?.account?.profit || 0)} CR
              </b>
            </span>
          </div>
          <div className="fx-table-scroll">
            {tab === "Round results" ? (
              <table>
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Asset</th>
                    <th>Asset pool</th>
                    <th>Average</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {state?.results.map((r) => (
                    <tr key={r.roundId}>
                      <td>#{r.roundId}</td>
                      <td>{market?.name}</td>
                      <td>{credits(r.assets[asset].volume)} CR</td>
                      <td>
                        {r.average.toLocaleString("en-US", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        CR
                      </td>
                      <td className={`fx-${r.assets[asset].direction}`}>
                        {r.assets[asset].direction.toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Direction</th>
                    <th>Investment</th>
                    <th>Outcome basis</th>
                    <th>{tab === "History" ? "Net P/L" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === "History" ? closedTrades : openTrades).map((t) => {
                    const m = state!.assets.find((a) => a.id === t.asset)!;
                    return (
                      <tr key={t.id}>
                        <td>
                          <b>{m.name}</b>
                          <small>#{t.roundId}</small>
                        </td>
                        <td>
                          <span className={`fx-trade-side ${t.side}`}>
                            {t.side === "buy" ? (
                              <ArrowUpRight size={12} />
                            ) : (
                              <ArrowDownRight size={12} />
                            )}{" "}
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td>{credits(t.amount)} CR</td>
                        <td>Game pool</td>
                        <td>
                          {t.status === "open" ? (
                            <span className="fx-pending">
                              <Clock3 size={12} /> Pending
                            </span>
                          ) : (
                            <span
                              className={
                                t.status === "won"
                                  ? "fx-up"
                                  : t.status === "lost"
                                    ? "fx-down"
                                    : "fx-flat"
                              }
                            >
                              {t.payout - t.amount > 0 ? "+" : ""}
                              {credits(t.payout - t.amount)} CR{" "}
                              <small>
                                {t.status === "refund"
                                  ? "REFUND"
                                  : t.status.toUpperCase()}
                              </small>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {(tab === "Open positions"
            ? !openTrades.length
            : tab === "History"
              ? !closedTrades.length
              : !state?.results.length) && (
            <div className="fx-empty">
              <div>
                <Layers3 size={21} />
              </div>
              <b>
                {tab === "Open positions"
                  ? "Your next move starts here"
                  : tab === "History"
                    ? "A fresh start"
                    : "The next result is on its way"}
              </b>
              <p>
                {tab === "Open positions"
                  ? "Choose an asset and place your first prediction."
                  : tab === "History"
                    ? "Settled predictions will appear here automatically."
                    : "Completed rounds show the exact pool calculation."}
              </p>
            </div>
          )}
          <div className="fx-portfolio-footer">
            <span>
              <ShieldCheck size={13} /> Orders & balance saved on the server
            </span>
            <button
              onClick={() => void game.refill()}
              disabled={
                busy ||
                !!openTrades.length ||
                (state?.account?.balance ?? 10000) >= 10000
              }
            >
              <Wallet size={13} /> Refill practice credits
            </button>
          </div>
        </section>

        <aside className="fx-panel fx-pool-panel">
          <div className="fx-section-heading">
            <h2>
              <Gauge size={16} /> Capital pressure
            </h2>
            <button
              className="fx-icon-button"
              aria-label="Explain capital pressure"
              onClick={() => setRules(true)}
            >
              <CircleHelp size={15} />
            </button>
          </div>
          <p>
            More money in an asset.
            <br />
            <b>DOWN pool result above average.</b>
          </p>
          <div className="fx-pool-stat">
            <span>All 12 markets</span>
            <b>{credits(state?.pool.total || 0)} CR</b>
          </div>
          <div className="fx-pool-stat">
            <span>Average per market</span>
            <b>
              {(state?.pool.average || 0).toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}{" "}
              CR
            </b>
          </div>
          <div className="fx-pressure-bar">
            <i
              style={{
                width: `${state?.pool.total ? Math.max(3, ((market?.volume || 0) / state.pool.total) * 100) : 0}%`,
              }}
            />
            <span style={{ left: `${100 / 12}%` }} />
          </div>
          <div className="fx-pressure-key">
            <span>↑ Below average</span>
            <span>Above average ↓</span>
          </div>
          <div className="fx-signal-box">
            <span>{market?.name || "Gold"} pool signal</span>
            <b className={`fx-${market?.direction || "flat"}`}>
              {directionLabel}{" "}
              {market?.direction === "down" ? (
                <ArrowDownRight size={15} />
              ) : market?.direction === "up" ? (
                <ArrowUpRight size={15} />
              ) : (
                "—"
              )}
            </b>
          </div>
          <small className="fx-signal-help">
            {locked
              ? "Pool locked. Result settles at round end."
              : "Indicative until orders close. Your stake can change it."}
          </small>
          <div className="fx-participants">
            <span>{state?.pool.participants || 0} participants</span>
            <span>{state?.pool.orders || 0} orders</span>
          </div>
        </aside>
      </main>

      <section className="fx-flow">
        <div className="fx-flow-heading">
          <div>
            <h2>Where the money is moving</h2>
            <p>
              Total BUY + SELL credits by asset · a higher-than-average pool
              produces a DOWN game result. Market quotes are independent.
            </p>
          </div>
          <span>
            <span className="fx-live-dot" /> THIS ROUND
          </span>
        </div>
        <div className="fx-flow-markets">
          {state?.assets.map((m) => (
            <button
              key={m.id}
              className={asset === m.id ? "active" : ""}
              onClick={() => {
                setAsset(m.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <div>
                <AssetIcon market={m} />
                <b>{m.symbol}</b>
                <span className={`fx-${m.direction}`}>
                  {m.direction === "up" ? (
                    <ArrowUpRight size={16} />
                  ) : m.direction === "down" ? (
                    <ArrowDownRight size={16} />
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <strong>
                {credits(m.volume)} <small>CR</small>
              </strong>
              <MiniChart market={m} />
            </button>
          ))}
        </div>
      </section>
      <footer className="fx-footer">
        <span>
          <ShieldCheck size={14} /> Google market quotes. Pool-based outcomes. Virtual credits.
        </span>
        <button onClick={() => setRules(true)}>
          Zyada pool paisa → DOWN game result. <ArrowRight size={13} />
        </button>
        {!standalone && (
          <a href="/">
            <ArrowLeft size={13} /> Back to lobby
          </a>
        )}
      </footer>

      {(game.error || game.notice) && (
        <div
          role={game.error ? "alert" : "status"}
          className={`fx-toast ${game.error ? "error" : ""}`}
        >
          {game.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{game.error || game.notice}</span>
          <button onClick={game.dismiss} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={rulesDialog}
        className="fx-rules-dialog"
        onCancel={() => setRules(false)}
        onClose={() => setRules(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setRules(false);
        }}
      >
        <div className="fx-rules-content">
          <button
            className="fx-close-rules"
            aria-label="Close rules"
            onClick={() => setRules(false)}
          >
            <X size={20} />
          </button>
          {rulesContent}
          <button className="fx-understood" onClick={() => setRules(false)}>
            Got it. Let’s trade <ArrowRight size={16} />
          </button>
        </div>
      </dialog>
    </div>
  );
}
