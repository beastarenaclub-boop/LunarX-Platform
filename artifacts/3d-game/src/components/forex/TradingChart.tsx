import { useEffect, useId, useRef, useState } from "react";
import type { Market } from "../../../../../lib/forex/store.mjs";

export function TradingChart({
  market,
  mode,
  count,
  fit = false,
}: {
  market: Market;
  mode: "candles" | "line";
  count: number;
  fit?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [availableHeight, setAvailableHeight] = useState(400);
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
      if (fit) {
        const box = entries[0].target;
        const labels =
          box.querySelector<HTMLElement>(".fx-ohlc")?.offsetHeight ?? 0;
        const note =
          box.querySelector<HTMLElement>(".fx-chart-note")?.offsetHeight ?? 0;
        setAvailableHeight(entries[0].contentRect.height - labels - note);
      }
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [fit, market.quote?.price == null]);
  useEffect(() => setHover(null), [market.id, count]);
  const quote = market.quote;
  const lastTime = quote?.ticks.at(-1)?.time ?? 0;
  const firstTime = lastTime - (count || 60) * 60_000;
  // OHLC is sampled from Google's observations, without invented intraminute movement.
  const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number }>();
  for (const tick of quote?.ticks ?? []) {
    if (tick.time < firstTime) continue;
    const time = Math.floor(tick.time / 60_000) * 60_000;
    const candle = buckets.get(time);
    if (candle) { candle.high = Math.max(candle.high, tick.price); candle.low = Math.min(candle.low, tick.price); candle.close = tick.price; }
    else buckets.set(time, { time, open: tick.price, high: tick.price, low: tick.price, close: tick.price });
  }
  const candles = [...buckets.values()];
  if (!quote || quote.price === null || !candles.length) return <div className="fx-chart fx-chart-empty" ref={host}>
    <p>Market chart unavailable</p><small>Waiting for Google Finance. Prices are never simulated.</small>
  </div>;
  const currentPrice = quote.price;
  const referencePrice = quote.previousClose ?? currentPrice;
  const height = fit ? Math.max(45, availableHeight) : 350,
    left = 16,
    right = width < 450 ? 68 : 85,
    top = height < 110 ? 8 : height < 200 ? 42 : 64,
    bottom = height < 160 ? height - 22 : height - 34;
  const plotWidth = Math.max(80, width - left - right);
  const lo = Math.min(
    currentPrice, referencePrice,
    ...candles.map((c) => c.low),
  );
  const hi = Math.max(
    currentPrice, referencePrice,
    ...candles.map((c) => c.high),
  );
  const pad = Math.max((hi - lo) * 0.08, currentPrice * 0.00015);
  const min = lo - pad,
    max = hi + pad;
  const y = (price: number) =>
    top + ((max - price) / (max - min)) * (bottom - top);
  const step = plotWidth / (count || 60);
  const liveSpan = Math.max(60_000, lastTime - firstTime);
  const x = (i: number) =>
    left + 4 + Math.max(0, (candles[i].time - firstTime) / liveSpan) * (plotWidth - 16);
  const selected =
    candles[Math.min(hover ?? candles.length - 1, candles.length - 1)];
  const color = (quote.changePercent ?? 0) >= 0 ? "#47cba7" : "#ee7783";
  const openY = y(referencePrice);
  const change = quote.changePercent;
  const line = candles
    .map((c, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(c.close)}`)
    .join(" ");
  const fmt = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: market.decimals,
      maximumFractionDigits: market.decimals,
    });
  const time = (t: number) =>
    new Date(t).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="fx-chart" ref={host}>
      <div className="fx-ohlc">
        <span>
          O <b>{fmt(selected.open)}</b>
        </span>
        <span>
          H <b>{fmt(selected.high)}</b>
        </span>
        <span>
          L <b>{fmt(selected.low)}</b>
        </span>
        <span>
          C <b style={{ color }}>{fmt(selected.close)}</b>
        </span>
      </div>
      <svg
        role="img"
        aria-label={`${market.name} ${mode === "candles" ? "candlestick" : "line"} chart. Google Finance delayed price ${fmt(currentPrice)}.`}
        viewBox={`0 0 ${width} ${height}`}
        style={fit ? { height, flex: "none" } : undefined}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const pointerX = ((event.clientX - box.left) / box.width) * width;
            setHover(
              candles.reduce(
                (nearest, _, i) =>
                  Math.abs(x(i) - pointerX) < Math.abs(x(nearest) - pointerX)
                    ? i
                    : nearest,
                0,
              ),
            );
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`${gradient}-zones`}
            x1="0"
            y1={top}
            x2="0"
            y2={bottom}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#47cba7" />
            <stop
              offset={`${((openY - top) / (bottom - top)) * 100}%`}
              stopColor="#47cba7"
            />
            <stop
              offset={`${((openY - top) / (bottom - top)) * 100}%`}
              stopColor="#ee7783"
            />
            <stop offset="100%" stopColor="#ee7783" />
          </linearGradient>
        </defs>
        <g data-testid="chart-price-zones">
          {[0, 1, 2].map((level) => (
            <g key={level}>
              <rect
                x={left}
                y={top + ((openY - top) * level) / 3}
                width={plotWidth}
                height={(openY - top) / 3}
                fill="#47cba7"
                opacity={0.025 + level * 0.025}
              />
              <rect
                x={left}
                y={openY + ((bottom - openY) * level) / 3}
                width={plotWidth}
                height={(bottom - openY) / 3}
                fill="#ee7783"
                opacity={0.075 - level * 0.025}
              />
            </g>
          ))}
          {openY - top > 28 && (
            <text
              x={left + plotWidth - 8}
              y={top + 14}
              textAnchor="end"
              fill="#47cba7"
              fontSize="9"
            >
              ABOVE PREVIOUS CLOSE
            </text>
          )}
          {bottom - openY > 28 && (
            <text
              x={left + plotWidth - 8}
              y={bottom - 8}
              textAnchor="end"
              fill="#ee7783"
              fontSize="9"
            >
              BELOW PREVIOUS CLOSE
            </text>
          )}
        </g>
        {height >= 110 && (
          <g data-testid="chart-market-gain">
            <text
              x={left + 4}
              y={12}
              fill="#92a9bc"
              fontSize="8"
              letterSpacing="1"
            >
              MARKET CHANGE
            </text>
            <text
              x={left + 4}
              y={height < 200 ? 32 : 42}
              fill={color}
              fontSize={height < 200 ? 20 : 28}
              fontWeight="700"
            >
              {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(3)}%`}
            </text>
            {width > 350 && (
              <text
                x={left + 150}
                y={height < 200 ? 30 : 38}
                fill="#7f94aa"
                fontSize="9"
              >
                Since previous close · Google Finance
              </text>
            )}
          </g>
        )}
        {Array.from({ length: height < 160 ? 3 : 6 }, (_, i) => {
          const price = max - ((max - min) * i) / (height < 160 ? 2 : 5);
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width - right + 6}
                y1={y(price)}
                y2={y(price)}
                stroke="#20262f"
                strokeDasharray="3 5"
              />
              <text
                x={width - right + 12}
                y={y(price) + 4}
                fill="#718091"
                fontSize="10"
              >
                {fmt(price)}
              </text>
            </g>
          );
        })}
        {candles.map(
          (c, i) =>
            i % Math.max(1, Math.floor(candles.length / (width < 450 ? 3 : 5))) === 0 && (
              <g key={c.time}>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={top}
                  y2={bottom}
                  stroke="#1b222b"
                />
                <text
                  x={x(i)}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#697586"
                  fontSize="10"
                >
                  {time(c.time)}
                </text>
              </g>
            ),
        )}
        {mode === "line" ? (
          <>
            <path
              d={`${line} L${x(candles.length - 1)},${bottom} L${x(0)},${bottom} Z`}
              fill={`url(#${gradient})`}
            />
            <path
              d={line}
              data-testid="chart-price-line"
              fill="none"
              stroke={`url(#${gradient}-zones)`}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        ) : (
          candles.map((c, i) => {
            const up = c.close >= c.open,
              fill = up ? "#47cba7" : "#e87883";
            return (
              <g key={c.time}>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={y(c.high)}
                  y2={y(c.low)}
                  stroke={fill}
                />
                <rect
                  x={x(i) - Math.max(1, step * 0.29)}
                  y={Math.min(y(c.open), y(c.close))}
                  width={Math.max(2, step * 0.58)}
                  height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))}
                  rx="0.5"
                  fill={fill}
                />
              </g>
            );
          })
        )}
        <line
          x1={left}
          x2={width - right + 5}
          y1={y(referencePrice)}
          y2={y(referencePrice)}
          stroke="#d6b16a"
          strokeDasharray="5 5"
          opacity="0.5"
        />
        <text
          x={left + 5}
          y={Math.max(top + 12, y(referencePrice) - 7)}
          fill="#bda574"
          fontSize="9"
        >
          PREVIOUS CLOSE · {fmt(referencePrice)}
        </text>
        <circle
          cx={x(candles.length - 1)}
          cy={y(currentPrice)}
          r="9"
          fill={color}
          opacity="0.14"
        />
        <circle
          data-testid="chart-live-price"
          cx={x(candles.length - 1)}
          cy={y(currentPrice)}
          r="4"
          fill={color}
          stroke="#dffaf1"
          strokeWidth="1.5"
        />
        <line
          x1={x(candles.length - 1)}
          x2={width - right + 8}
          y1={y(currentPrice)}
          y2={y(currentPrice)}
          stroke={color}
          strokeDasharray="3 3"
        />
        <rect
          x={width - right + 5}
          y={y(currentPrice) - 11}
          width={right - 8}
          height={22}
          rx="4"
          fill={color}
        />
        <text
          x={width - right / 2}
          y={y(currentPrice) + 4}
          textAnchor="middle"
          fontWeight="700"
          fill="#0c1715"
          fontSize="10"
        >
          {fmt(currentPrice)}
        </text>
        {hover !== null && (
          <g>
            <line
              x1={x(Math.min(hover, candles.length - 1))}
              x2={x(Math.min(hover, candles.length - 1))}
              y1={top}
              y2={height - 27}
              stroke="#8997a9"
              strokeDasharray="4 4"
            />
            <circle
              cx={x(Math.min(hover, candles.length - 1))}
              cy={y(selected.close)}
              r="3.5"
              fill="#e8bf62"
            />
            <rect
              x={Math.max(
                left,
                Math.min(
                  width - 200,
                  x(Math.min(hover, candles.length - 1)) - 85,
                ),
              )}
              y={height - 52}
              width={180}
              height={22}
              rx="4"
              fill="#2c3440"
            />
            <text
              x={
                Math.max(
                  left,
                  Math.min(
                    width - 200,
                    x(Math.min(hover, candles.length - 1)) - 85,
                  ),
                ) + 90
              }
              y={height - 37}
              textAnchor="middle"
              fill="#e4e9ef"
              fontSize="10"
            >
              {time(selected.time)} ·{" "}
              Google sample · {fmt(selected.close)}
            </text>
          </g>
        )}
      </svg>
      <div className="fx-chart-note">
        <span>GOOGLE FINANCE · DELAYED</span>
        <span>
          {mode === "candles" ? "1m sampled candles" : "Observed prices"} · Gaps have no samples
        </span>
      </div>
    </div>
  );
}
