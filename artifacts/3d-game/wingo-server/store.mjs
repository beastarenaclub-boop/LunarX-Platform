import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DURATIONS, hash, multiplierFor, commitmentFor } from "./rules.mjs";
export { DURATIONS, hash, colorsFor, multiplierFor, commitmentFor } from "./rules.mjs";
export class Fault extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createStore(
  filename = ":memory:",
  { now = Date.now, draw = () => randomInt(10) } = {},
) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL,
      balance INTEGER NOT NULL CHECK(balance >= 0), created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rounds (period TEXT PRIMARY KEY, duration INTEGER NOT NULL,
      start INTEGER NOT NULL, ends INTEGER NOT NULL, number INTEGER NOT NULL CHECK(number BETWEEN 0 AND 9),
      secret TEXT NOT NULL, commitment TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS round_time ON rounds(duration, ends DESC);
    CREATE TABLE IF NOT EXISTS bets (id TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id),
      period TEXT NOT NULL REFERENCES rounds(period), pick TEXT NOT NULL, stake INTEGER NOT NULL,
      payout INTEGER, created INTEGER NOT NULL, request TEXT NOT NULL, UNIQUE(player, request));
    CREATE INDEX IF NOT EXISTS bet_player ON bets(player, created DESC);
    CREATE INDEX IF NOT EXISTS bet_round ON bets(period);
    CREATE TABLE IF NOT EXISTS accounts (account TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL);
  `);
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const periodFor = (duration, time) =>
    `${duration}-${Math.floor(time / (duration * 1000))}`;
  function tickInner(time) {
    for (const round of db
      .prepare("SELECT * FROM rounds WHERE settled=0 AND ends<=?")
      .all(time)) {
      for (const bet of db
        .prepare("SELECT * FROM bets WHERE period=? AND payout IS NULL")
        .all(round.period)) {
        const payout = Math.round(
          bet.stake * multiplierFor(bet.pick, round.number),
        );
        db.prepare("UPDATE bets SET payout=? WHERE id=?").run(payout, bet.id);
        db.prepare("UPDATE players SET balance=balance+? WHERE id=?").run(
          payout,
          bet.player,
        );
      }
      db.prepare("UPDATE rounds SET settled=1 WHERE period=?").run(
        round.period,
      );
    }
    for (const duration of DURATIONS) {
      const period = periodFor(duration, time);
      if (db.prepare("SELECT 1 FROM rounds WHERE period=?").get(period))
        continue;
      const start = Math.floor(time / (duration * 1000)) * duration * 1000;
      const number = draw();
      if (!Number.isInteger(number) || number < 0 || number > 9)
        throw new Error("Invalid random draw");
      const secret = randomBytes(32).toString("hex");
      db.prepare(
        "INSERT INTO rounds(period,duration,start,ends,number,secret,commitment) VALUES(?,?,?,?,?,?,?)",
      ).run(
        period,
        duration,
        start,
        start + duration * 1000,
        number,
        secret,
        commitmentFor(period, number, secret),
      );
    }
  }
  function playerFor(token) {
    const player =
      typeof token === "string" &&
      db.prepare("SELECT * FROM players WHERE token=?").get(hash(token));
    if (!player)
      throw new Fault(
        "Your practice session has expired. Reload to start again.",
        401,
      );
    return player;
  }
  function checkDuration(value) {
    if (!DURATIONS.includes(value))
      throw new Fault("Choose a supported round duration.");
  }
  function stateInner(player, duration, time) {
    const round = db
      .prepare(
        "SELECT period,duration,start,ends,commitment FROM rounds WHERE period=?",
      )
      .get(periodFor(duration, time));
    const history = db
      .prepare(
        "SELECT period,number,ends,commitment,secret FROM rounds WHERE duration=? AND settled=1 ORDER BY ends DESC LIMIT 100",
      )
      .all(duration);
    const bets = db
      .prepare(
        `SELECT b.id,b.period,b.pick,b.stake,b.payout,b.created,r.duration,
      CASE WHEN r.settled=1 THEN r.number ELSE NULL END AS number
      FROM bets b JOIN rounds r ON r.period=b.period WHERE b.player=? ORDER BY b.created DESC,b.rowid DESC LIMIT 100`,
      )
      .all(player.id);
    const summary = db
      .prepare(
        `SELECT COUNT(*) AS played, COALESCE(SUM(CASE WHEN payout>0 THEN 1 ELSE 0 END),0) AS won,
      COALESCE(SUM(payout-stake),0) AS profit FROM bets WHERE player=? AND payout IS NOT NULL`,
      )
      .get(player.id);
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS count FROM bets WHERE player=? AND payout IS NULL",
      )
      .get(player.id).count;
    return {
      serverTime: time,
      player: { id: player.id.slice(0, 8), balance: player.balance },
      round,
      history,
      bets,
      summary,
      pending,
      lockSeconds: 5,
      minStake: 100,
      maxStake: 1000000,
    };
  }
  function state(token, duration = 30) {
    checkDuration(duration);
    return transaction(() => {
      const time = now();
      tickInner(time);
      return stateInner(playerFor(token), duration, time);
    });
  }
  function session(token) {
    if (token) {
      try {
        playerFor(token);
        return { token, fresh: false };
      } catch (error) {
        if (!(error instanceof Fault)) throw error;
      }
    }
    const next = randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO players(id,token,balance,created) VALUES(?,?,?,?)",
    ).run(randomUUID(), hash(next), 1000000, now());
    return { token: next, fresh: true };
  }
  function placeBet(token, input) {
    const { duration, period, pick, stake, request } = input;
    checkDuration(duration);
    if (
      typeof pick !== "string" ||
      !/^(green|red|violet|big|small|[0-9])$/.test(pick)
    )
      throw new Fault("Select a colour, a number, or Big / Small.");
    if (
      !Number.isSafeInteger(stake) ||
      stake < 100 ||
      stake > 1000000 ||
      stake % 100
    )
      throw new Fault("Use a whole-coin stake from 1 to 10,000.");
    if (typeof request !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(request))
      throw new Fault("Invalid request identifier.");
    return transaction(() => {
      const time = now();
      tickInner(time);
      const player = playerFor(token);
      const existing = db
        .prepare("SELECT * FROM bets WHERE player=? AND request=?")
        .get(player.id, request);
      if (existing) {
        if (
          existing.period !== period ||
          existing.pick !== pick ||
          existing.stake !== stake
        )
          throw new Fault(
            "This request was already used for a different prediction.",
            409,
          );
        return stateInner(player, duration, time);
      }
      if (period !== periodFor(duration, time))
        throw new Fault(
          "A new round has started. Please select your prediction again.",
          409,
        );
      const round = db
        .prepare("SELECT * FROM rounds WHERE period=?")
        .get(period);
      if (time >= round.ends - 5000)
        throw new Fault(
          "Predictions are locked for this round. The next round starts shortly.",
          409,
        );
      if (player.balance < stake)
        throw new Fault(
          "You do not have enough practice coins for this prediction.",
        );
      db.prepare("UPDATE players SET balance=balance-? WHERE id=?").run(
        stake,
        player.id,
      );
      db.prepare(
        "INSERT INTO bets(id,player,period,pick,stake,created,request) VALUES(?,?,?,?,?,?,?)",
      ).run(randomUUID(), player.id, period, pick, stake, time, request);
      return stateInner(playerFor(token), duration, time);
    });
  }
  // Called only with an authenticated platform user ID, never a client-supplied ID.
  function accountSession(accountId) {
    if (typeof accountId !== "string" || !accountId)
      throw new Fault("Invalid account.");
    return transaction(() => {
      const existing = db
        .prepare("SELECT token FROM accounts WHERE account=?")
        .get(accountId);
      if (existing) return existing.token;
      const { token } = session();
      db.prepare("INSERT INTO accounts(account,token) VALUES(?,?)").run(
        accountId,
        token,
      );
      return token;
    });
  }
  function refill(token, duration = 30) {
    checkDuration(duration);
    return transaction(() => {
      const time = now();
      tickInner(time);
      const player = playerFor(token);
      if (
        db
          .prepare("SELECT 1 FROM bets WHERE player=? AND payout IS NULL")
          .get(player.id)
      )
        throw new Fault("Wait for your active predictions to settle first.");
      if (player.balance >= 100000)
        throw new Fault(
          "A free refill is available when your balance is below 1,000 coins.",
        );
      db.prepare("UPDATE players SET balance=1000000 WHERE id=?").run(
        player.id,
      );
      return stateInner(playerFor(token), duration, time);
    });
  }
  return {
    session,
    accountSession,
    state,
    placeBet,
    refill,
    tick: () => transaction(() => tickInner(now())),
    close: () => db.close(),
  };
}
