import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MARKETS,
  ROUND_MS,
  ORDER_MS,
  STARTING_BALANCE,
  MAX_STAKE,
  closingPrice,
  outcomeFor,
  quoteAt,
  quoteTrail,
} from "./market.mjs";

export class ForexFault extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createForexStore(filename, { now = Date.now } = {}) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS forex_accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance >= 0), refill_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS forex_sessions (token TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS forex_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS forex_trades (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, request_id TEXT NOT NULL, round_id INTEGER NOT NULL,
      asset TEXT NOT NULL, side TEXT NOT NULL, amount INTEGER NOT NULL, opened INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', payout INTEGER NOT NULL DEFAULT 0,
      open_price REAL NOT NULL, close_price REAL, settled INTEGER, UNIQUE(account_id, request_id));
    CREATE INDEX IF NOT EXISTS forex_round_trades ON forex_trades(round_id, status);
    CREATE INDEX IF NOT EXISTS forex_account_trades ON forex_trades(account_id, opened DESC);`);

  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const save = (state) =>
    db
      .prepare("INSERT OR REPLACE INTO forex_state(id,data) VALUES(1,?)")
      .run(JSON.stringify(state));
  const read = () =>
    JSON.parse(
      db.prepare("SELECT data FROM forex_state WHERE id=1").get().data,
    );
  const initial = () => {
    const start = Math.floor(now() / ROUND_MS) * ROUND_MS;
    const assets = {};
    for (const [index, market] of MARKETS.entries()) {
      const values = Array.from(
        { length: 49 },
        (_, i) =>
          market.seed *
          (1 +
            (Math.sin(i * 0.52 + index) * 0.8 +
              Math.cos(i * 0.21 + index) * 0.7) *
              market.volatility),
      );
      const offset = market.seed - values[48];
      const candles = values.slice(1).map((v, i) => {
        const open = values[i] + offset,
          close = v + offset;
        return {
          time: start - (48 - i) * ROUND_MS,
          open,
          close,
          high: Math.max(open, close) + market.seed * market.volatility * 0.15,
          low: Math.min(open, close) - market.seed * market.volatility * 0.15,
          volume: 0,
          warmup: true,
        };
      });
      assets[market.id] = { open: market.seed, candles };
    }
    return {
      roundId: Math.floor(start / ROUND_MS),
      start,
      assets,
      results: [],
    };
  };
  transaction(() => {
    if (!db.prepare("SELECT id FROM forex_state WHERE id=1").get())
      save(initial());
  });

  function pools(roundId) {
    const rows = db
      .prepare(
        "SELECT asset, SUM(amount) AS volume, COUNT(*) AS orders FROM forex_trades WHERE round_id=? GROUP BY asset",
      )
      .all(roundId);
    const volumes = Object.fromEntries(MARKETS.map((m) => [m.id, 0]));
    let total = 0,
      orders = 0;
    for (const row of rows) {
      volumes[row.asset] = row.volume;
      total += row.volume;
      orders += row.orders;
    }
    return { volumes, total, orders };
  }

  // Called inside an immediate transaction: round settlement and wallet credits are atomic.
  function advance() {
    const state = read();
    if (now() < state.start + ROUND_MS) return state;
    const pool = pools(state.roundId);
    const result = {
      roundId: state.roundId,
      time: state.start + ROUND_MS,
      total: pool.total,
      average: pool.total / MARKETS.length,
      assets: {},
    };
    for (const market of MARKETS) {
      const asset = state.assets[market.id];
      const volume = pool.volumes[market.id];
      const close = closingPrice(market, asset.open, volume, pool.total);
      const direction = outcomeFor(volume, pool.total);
      const prices = Array.from({ length: 61 }, (_, second) =>
        quoteAt(market, asset.open, close, second * 1000),
      );
      asset.candles.push({
        time: state.start,
        open: asset.open,
        close,
        high: Math.max(...prices),
        low: Math.min(...prices),
        volume,
        warmup: false,
      });
      asset.candles = asset.candles.slice(-100);
      result.assets[market.id] = { volume, direction, open: asset.open, close };
      for (const trade of db
        .prepare(
          "SELECT * FROM forex_trades WHERE round_id=? AND asset=? AND status='open'",
        )
        .all(state.roundId, market.id)) {
        const status =
          direction === "flat"
            ? "refund"
            : (trade.side === "buy") === (direction === "up")
              ? "won"
              : "lost";
        const payout =
          status === "refund"
            ? trade.amount
            : status === "won"
              ? (trade.amount * 19) / 10
              : 0;
        db.prepare(
          "UPDATE forex_trades SET status=?, payout=?, close_price=?, settled=? WHERE id=?",
        ).run(status, payout, close, result.time, trade.id);
        db.prepare(
          "UPDATE forex_accounts SET balance=balance+? WHERE id=?",
        ).run(payout, trade.account_id);
      }
      asset.open = close;
    }
    state.results = [result, ...state.results].slice(0, 30);
    // Skip empty downtime; accepted orders in the old round are always settled first.
    state.start = Math.floor(now() / ROUND_MS) * ROUND_MS;
    state.roundId = Math.floor(state.start / ROUND_MS);
    save(state);
    return state;
  }

  function account(id) {
    if (typeof id !== "string" || !id || id.length > 200)
      throw new ForexFault("Start a practice session first.", 401);
    db.prepare(
      "INSERT OR IGNORE INTO forex_accounts(id,balance) VALUES(?,?)",
    ).run(id, STARTING_BALANCE);
    return db.prepare("SELECT * FROM forex_accounts WHERE id=?").get(id);
  }

  function snapshot(id) {
    const state = advance();
    const user = id ? account(id) : null;
    const pool = pools(state.roundId);
    const elapsed = Math.max(0, now() - state.start);
    const assets = MARKETS.map((market) => {
      const asset = state.assets[market.id];
      const volume = pool.volumes[market.id];
      const target = closingPrice(market, asset.open, volume, pool.total);
      const price = quoteAt(market, asset.open, target, elapsed);
      const trail = Array.from(
        { length: Math.floor(elapsed / 1000) + 1 },
        (_, i) => quoteAt(market, asset.open, target, i * 1000),
      );
      const candle = {
        time: state.start,
        open: asset.open,
        close: price,
        high: Math.max(price, ...trail),
        low: Math.min(price, ...trail),
        volume,
        warmup: false,
      };
      return {
        ...market,
        open: asset.open,
        price,
        volume,
        direction: outcomeFor(volume, pool.total),
        candles: [...asset.candles, candle],
        ticks: quoteTrail(market, asset.candles, asset.open, target, state.start, elapsed),
      };
    });
    const trades = user
      ? db
          .prepare(
            "SELECT id, round_id AS roundId, asset, side, amount, status, payout, opened, open_price AS openPrice, close_price AS closePrice FROM forex_trades WHERE account_id=? ORDER BY opened DESC, rowid DESC LIMIT 100",
          )
          .all(id)
      : [];
    const stats = user
      ? db
          .prepare(
            "SELECT COUNT(*) AS settled, COALESCE(SUM(CASE WHEN status='won' THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(payout-amount),0) AS profit FROM forex_trades WHERE account_id=? AND status!='open'",
          )
          .get(id)
      : { settled: 0, wins: 0, profit: 0 };
    return {
      serverTime: now(),
      round: {
        id: state.roundId,
        start: state.start,
        lockAt: state.start + ORDER_MS,
        endAt: state.start + ROUND_MS,
        phase: elapsed < ORDER_MS ? "open" : "locked",
      },
      assets,
      pool: {
        total: pool.total,
        average: pool.total / MARKETS.length,
        orders: pool.orders,
        participants: db
          .prepare(
            "SELECT COUNT(DISTINCT account_id) AS n FROM forex_trades WHERE round_id=?",
          )
          .get(state.roundId).n,
      },
      account: user ? { balance: user.balance, ...stats } : null,
      trades,
      results: state.results,
    };
  }

  return {
    tick: () => transaction(advance),
    state: (id) => transaction(() => snapshot(id)),
    session(token) {
      if (!token || typeof token !== "string") return null;
      return (
        db
          .prepare(
            "SELECT account_id FROM forex_sessions WHERE token=? AND expires>?",
          )
          .get(token, now())?.account_id ?? null
      );
    },
    createSession() {
      return transaction(() => {
        db.prepare("DELETE FROM forex_sessions WHERE expires<=?").run(now());
        const id = randomUUID(),
          token = randomUUID();
        account(id);
        db.prepare(
          "INSERT INTO forex_sessions(token,account_id,expires) VALUES(?,?,?)",
        ).run(token, id, now() + 30 * 86400_000);
        return { token, id };
      });
    },
    place(id, input) {
      return transaction(() => {
        const state = advance();
        const user = account(id);
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new ForexFault("Expected a trade.");
        const { asset, side, amount, roundId, requestId } = input;
        if (
          typeof requestId !== "string" ||
          !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)
        )
          throw new ForexFault("Invalid request ID.");
        const existing = db
          .prepare(
            "SELECT * FROM forex_trades WHERE account_id=? AND request_id=?",
          )
          .get(id, requestId);
        if (existing) {
          if (
            existing.asset !== asset ||
            existing.side !== side ||
            existing.amount !== amount ||
            existing.round_id !== roundId
          )
            throw new ForexFault(
              "Request ID already used for another trade.",
              409,
            );
          return snapshot(id);
        }
        if (
          !MARKETS.some((m) => m.id === asset) ||
          !["buy", "sell"].includes(side)
        )
          throw new ForexFault("Choose a valid asset and direction.");
        if (
          !Number.isSafeInteger(amount) ||
          amount < 10 ||
          amount > MAX_STAKE ||
          amount % 10 !== 0
        )
          throw new ForexFault("Use 10–5,000 credits, in multiples of 10.");
        if (roundId !== state.roundId || now() >= state.start + ORDER_MS)
          throw new ForexFault(
            "Orders are locked. Wait for the next round.",
            409,
          );
        if (user.balance < amount)
          throw new ForexFault("Not enough practice credits.");
        if (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM forex_trades WHERE account_id=? AND round_id=?",
            )
            .get(id, roundId).n >= 30
        )
          throw new ForexFault("Maximum 30 orders per round.");
        db.prepare(
          "UPDATE forex_accounts SET balance=balance-? WHERE id=?",
        ).run(amount, id);
        db.prepare(
          "INSERT INTO forex_trades(id,account_id,request_id,round_id,asset,side,amount,opened,open_price) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          id,
          requestId,
          roundId,
          asset,
          side,
          amount,
          now(),
          state.assets[asset].open,
        );
        return snapshot(id);
      });
    },
    refill(id) {
      return transaction(() => {
        advance();
        const user = account(id);
        if (
          db
            .prepare(
              "SELECT id FROM forex_trades WHERE account_id=? AND status='open' LIMIT 1",
            )
            .get(id)
        )
          throw new ForexFault("Wait for your open positions to settle.");
        if (user.balance >= STARTING_BALANCE)
          throw new ForexFault(
            "Your practice balance is already 10,000 or more.",
          );
        if (user.refill_at > now() - 60_000)
          throw new ForexFault("You can refill once per minute.");
        db.prepare(
          "UPDATE forex_accounts SET balance=?, refill_at=? WHERE id=?",
        ).run(STARTING_BALANCE, now(), id);
        return snapshot(id);
      });
    },
    close: () => db.close(),
  };
}
