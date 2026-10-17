import { useEffect, useRef, useState } from "react";
import type { ForexState, Market } from "../../../../../lib/forex/store.mjs";
import { gameCandles, updateGameTape } from "../../../../../lib/forex/game-chart.mjs";
import "./game-chart.css";

export function GameChart({ market, state, clock, connected, seconds, mode }: {
  market: Market; state: ForexState; clock: number; connected: boolean;
  seconds: number; mode: "candles" | "line";
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 720, height: 280 });
  const time = Math.min(clock, state.serverTime + 2000, state.round.endAt);
  const input = { asset: market.id, roundStart: state.round.start, time,
    direction: market.direction, idle: state.pool.total === 0 };
  const [tape, setTape] = useState(() => updateGameTape(undefined, input));
  const paused = !connected || clock - state.serverTime > 2500;
  useEffect(() => {
    if (!paused) setTape(previous => updateGameTape(previous, input));
  }, [market.id, market.direction, state.round.start, state.pool.total, time, paused]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.max(240, entry.contentRect.width), height: Math.max(120, entry.contentRect.height),
    }));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const candles = gameCandles(tape.points, seconds).slice(-80);
  const current = tape.points.at(-1)?.price ?? 100;
  const w = size.width, h = size.height, left = 10, right = w < 450 ? 47 : 60, top = 15, bottom = h - 25;
  const low = Math.min(98, ...candles.map(c => c.low)) - 0.2;
  const high = Math.max(102, ...candles.map(c => c.high)) + 0.2;
  const y = (v: number) => top + (high - v) / (high - low) * (bottom - top);
  const first = candles[0]?.time ?? tape.time;
  const duration = Math.max(80 * seconds * 1000, tape.time - first + seconds * 1000);
  const start = tape.time - duration + seconds * 1000;
  const x = (t: number) => left + (t - start) / duration * (w - left - right);
  const step = (w - left - right) / (duration / (seconds * 1000));
  const color = current >= 100 ? "#45ddb0" : "#ff718b";
  const positions = state.trades.filter(t => t.asset === market.id && t.roundId === state.round.id && t.status === "open");
  const line = candles.map((c, i) => `${i ? "L" : "M"}${x(c.time)},${y(c.close)}`).join(" ");
  return <div className="fg-chart" data-testid="game-chart" data-paused={paused}>
    <div className="fg-chart-heading">
      <span><i /> SIMULATED GAME INDEX</span>
      <b data-testid="game-chart-index" style={{ color }}>{current.toFixed(3)}</b>
      <small>{paused ? "Connection lost · paused" : clock >= state.round.endAt ? "Waiting for result" : state.pool.total === 0 ? "No bets · idle animation" : state.round.economicsVersion === 2 ? "Independent result at round close" : `Pool ${market.direction.toUpperCase()}`}</small>
    </div>
    <div className="fg-plot" ref={host}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${market.name} simulated game ${mode === "candles" ? "candlestick" : "line"} chart`}>
        <rect x={left} y={top} width={w-left-right} height={y(100)-top} fill="#45ddb0" opacity=".035" />
        <rect x={left} y={y(100)} width={w-left-right} height={bottom-y(100)} fill="#ff718b" opacity=".035" />
        {[0, 1, 2, 3, 4].map(i => {
          const value = low + (high-low)*i/4;
          return <g key={i}><line x1={left} x2={w-right} y1={y(value)} y2={y(value)} stroke="#24354a" strokeDasharray="2 5" />
            <text x={w-right+7} y={y(value)+3} fill="#8296ae" fontSize="9">{value.toFixed(2)}</text></g>;
        })}
        <line x1={left} x2={w-right} y1={y(100)} y2={y(100)} stroke="#d8b573" opacity=".5" strokeDasharray="5 5" />
        <text x={left+4} y={y(100)-6} fill="#d8b573" fontSize="8">ROUND BASE 100</text>
        {mode === "line" ? <path data-testid="game-chart-line" d={line} fill="none" stroke={color} strokeWidth="2" /> : candles.map(c => {
          const fill = c.close >= c.open ? "#45ddb0" : "#ff718b";
          return <g key={c.time} data-testid="game-candle" data-time={c.time} data-side={c.close >= c.open ? "up" : "down"}>
            <line x1={x(c.time)} x2={x(c.time)} y1={y(c.high)} y2={y(c.low)} stroke={fill} />
            <rect x={x(c.time)-Math.max(1,step*.3)} y={Math.min(y(c.open),y(c.close))} width={Math.max(1.7,step*.6)} height={Math.max(1.5,Math.abs(y(c.open)-y(c.close)))} fill={fill} rx=".5" />
          </g>;
        })}
        {candles.filter((_,i) => i % (w < 450 ? 25 : 16) === 0).map(c => <text key={c.time} x={x(c.time)} y={h-6} fill="#8296ae" fontSize="8" textAnchor="middle">{new Date(c.time).toLocaleTimeString("en-GB", { minute: "2-digit", second: "2-digit" })}</text>)}
        {positions.slice(0, 5).map((trade,i) => {
          const markerX = Math.max(left+5, Math.min(w-right-70, x(trade.opened)));
          const markerColor = trade.side === "buy" ? "#45ddb0" : "#ff718b";
          return <g key={trade.id} data-testid="game-bet-marker">
            <title>{trade.side.toUpperCase()} {trade.amount} accepted · Pool result decides payout</title>
            <line x1={markerX} x2={markerX} y1={top} y2={bottom} stroke={markerColor} opacity=".5" strokeDasharray="3 4" />
            <rect x={markerX} y={top+4+i*18} width={66} height={16} rx="4" fill="#162c3d" stroke={markerColor} />
            <text x={markerX+5} y={top+15+i*18} fill={markerColor} fontSize="9">{trade.side.toUpperCase()} {trade.amount}</text>
          </g>;
        })}
        <line x1={left} x2={w-right} y1={y(current)} y2={y(current)} stroke={color} opacity=".4" strokeDasharray="3 4" />
        <circle data-testid="game-chart-point" cx={x(tape.time)} cy={y(current)} r="3.5" fill={color} />
      </svg>
    </div>
    <div className="fg-chart-note"><span>{seconds}s candles · Simulated history</span><span>Animation only · Pool decides payout</span></div>
  </div>;
}

export function ChartSourceTabs({ source, onChange }: { source: "game" | "market"; onChange: (source: "game" | "market") => void }) {
  return <div className="fg-source" role="group" aria-label="Chart source">
    <button type="button" aria-pressed={source === "game"} onClick={() => onChange("game")}>Game chart <small>SIMULATED</small></button>
    <button type="button" aria-pressed={source === "market"} onClick={() => onChange("market")}>Google market <small>DELAYED</small></button>
  </div>;
}

export function BetFeedback({ busy, error, notice }: { busy: boolean; error: string; notice: string }) {
  if (!busy && !error && !notice) return null;
  return <div className={`fg-order-feedback ${error ? "fg-order-error" : ""}`} role={error ? "alert" : "status"} data-testid="bet-feedback">
    <b>{busy ? "Submitting bet…" : error ? "Bet not confirmed" : "Bet accepted ✓"}</b>
    <span>{busy ? "Waiting for the server. Please wait." : error || notice}</span>
  </div>;
}
