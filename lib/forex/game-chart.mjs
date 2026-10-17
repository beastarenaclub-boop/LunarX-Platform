// Illustrative game-index animation only. Never a market quote or payout input.
export const GAME_TICK_MS = 200;
export const GAME_HISTORY_MS = 90_000;

export function gameIndexAt({ asset, roundStart, time, direction, idle }) {
  const elapsed = Math.max(0, Math.min(60_000, time - roundStart));
  const progress = elapsed / 60_000;
  const phase = [...asset].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 0.017;
  const seconds = elapsed / 1000;
  const target = direction === "up" ? 1.3 : direction === "down" ? -1.3 : 0;
  if (progress === 0) return 100;
  if (progress === 1) return 100 + target;
  const wave = Math.sin(seconds * 2.3 + phase) * 0.65 +
    Math.sin(seconds * 5.7 + phase * 2) * 0.22 + Math.sin(seconds * 0.61 + phase) * 0.8;
  // Both directions stay active when idle. Movement tapers to the pool signal
  // at the end of a funded round; it never decides that signal.
  const envelope = Math.sin(Math.PI * progress) ** 0.4;
  return 100 + target * progress + wave * envelope * (idle ? 1.35 : 0.65);
}

export function updateGameTape(previous, input) {
  const { asset, roundStart, time, direction, idle } = input;
  const now = Math.min(roundStart + 60_000, Math.max(roundStart, time));
  const requested = Math.floor(now / GAME_TICK_MS) * GAME_TICK_MS;
  const reset = !previous || previous.asset !== asset || requested < previous.time - 2000 || requested - previous.time > GAME_HISTORY_MS;
  const bucket = reset ? requested : Math.max(requested, previous.time);
  const points = reset ? [] : previous.points.slice();
  const first = reset ? bucket - GAME_HISTORY_MS : previous.time + GAME_TICK_MS;
  for (let t = first; t <= bucket; t += GAME_TICK_MS) {
    const historic = t < roundStart;
    const value = gameIndexAt({ asset, time: t, roundStart: historic ? Math.floor(t / 60_000) * 60_000 : roundStart,
      direction: historic ? "flat" : direction, idle: historic || idle });
    const last = points.at(-1);
    const end = t >= roundStart + 60_000;
    // A new bet changes the following samples, never the already drawn tape.
    const price = last && !reset && !end ? last.price + (value - last.price) * 0.55 : value;
    points.push({ time: t, price });
  }
  return { asset, time: bucket, points: points.filter(point => point.time >= bucket - GAME_HISTORY_MS) };
}

export function gameCandles(points, seconds = 1) {
  const interval = [1, 2, 5].includes(seconds) ? seconds * 1000 : 1000;
  const buckets = new Map();
  for (const point of points) {
    const time = Math.floor(point.time / interval) * interval;
    const candle = buckets.get(time);
    if (candle) { candle.high = Math.max(candle.high, point.price); candle.low = Math.min(candle.low, point.price); candle.close = point.price; }
    else buckets.set(time, { time, open: point.price, high: point.price, low: point.price, close: point.price });
  }
  return [...buckets.values()];
}
