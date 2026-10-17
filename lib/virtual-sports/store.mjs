import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { FIXTURES, fixtureById, sportForFixture } from './fixtures.mjs';
import {
  SPORTS,
  sportById,
  oddsFor,
  BET_MS,
  PLAY_MS,
  ROUND_MS,
  START_COINS,
} from "./catalog.mjs";

export class SportsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const choose = (weights) => {
  let n = randomInt(1000000) / 1000000;
  for (let i = 0; i < weights.length; i++) {
    n -= weights[i];
    if (n < 0) return i;
  }
  return weights.length - 1;
};
const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Only the elapsed portion of this server-owned script is sent to the browser.
export function makeMatch(sport) {
  const winner = choose(sport.weights),
    scores = [0, 0];
  let plays = [];
  if (sport.id === "formula") {
    const order = [
      winner,
      ...shuffle([0, 1, 2, 3].filter((i) => i !== winner)),
    ];
    for (let lap = 1; lap <= 3; lap++) {
      const places = lap === 3 ? order : shuffle([0, 1, 2, 3]);
      plays.push({
        team: places[0],
        points: 0,
        order: places,
        text:
          lap === 3
            ? `${sport.teams[winner]} takes the chequered flag`
            : `Lap ${lap} · ${sport.teams[places[0]]} leads`,
        kind: lap === 3 ? "finish" : "lap",
      });
    }
  } else if (sport.id === "tennis") {
    const loser = 1 - winner,
      loserPoints = randomInt(5);
    plays = shuffle([
      ...Array(4).fill(winner),
      ...Array(loserPoints).fill(loser),
    ])
      .concat(winner)
      .map((team) => ({
        team,
        points: 1,
        text: `Point · ${sport.teams[team]}`,
        kind: "point",
      }));
  } else if (sport.id === "cricket") {
    // Rejection sampling produces a legal pair of six-ball innings for the selected 1X2 result.
    let innings;
    do {
      innings = [0, 1].map(() =>
        Array.from({ length: 6 }, () => [0, 1, 2, 3, 4, 6][randomInt(6)]),
      );
    } while (
      (innings[0].reduce((a, b) => a + b, 0) ===
      innings[1].reduce((a, b) => a + b, 0)
        ? 1
        : innings[0].reduce((a, b) => a + b, 0) >
            innings[1].reduce((a, b) => a + b, 0)
          ? 0
          : 2) !== winner
    );
    plays = innings.flatMap((runs, team) =>
      runs.map((points, i) => ({
        team,
        points,
        text: `${sport.tags[team]} · Ball ${i + 1}/6 · ${points === 6 ? "SIX!" : points === 4 ? "FOUR!" : points === 0 ? "Dot ball" : `${points} run${points > 1 ? "s" : ""}`}`,
        kind: points >= 4 ? "boundary" : "delivery",
      })),
    );
  } else {
    const base = sport.id === "football" ? randomInt(3) : randomInt(3, 8);
    const target =
      winner === 1
        ? [base, base]
        : winner === 0
          ? [base + randomInt(1, 3), base]
          : [base, base + randomInt(1, 3)];
    if (sport.id === "football") {
      plays = shuffle(
        target.flatMap((n, team) =>
          Array.from({ length: n }, () => ({
            team,
            points: 1,
            text: `GOAL! ${sport.teams[team]}`,
            kind: "goal",
          })),
        ),
      );
      while (plays.length < 8)
        plays.splice(randomInt(plays.length + 1), 0, {
          team: randomInt(2),
          points: 0,
          text: [
            "A brilliant save",
            "Shot just wide",
            "Possession changes hands",
          ][randomInt(3)],
          kind: "save",
        });
    } else {
      // Scores count legal two-point baskets; the presentation labels this a quick match.
      plays = shuffle(
        target.flatMap((n, team) =>
          Array.from({ length: n }, () => ({
            team,
            points: 2,
            text: `${sport.teams[team]} · Two points`,
            kind: "basket",
          })),
        ),
      );
    }
  }
  const events = plays.map((play, i) => {
    if (sport.id !== "formula") scores[play.team] += play.points;
    return {
      ...play,
      at: Math.round(((i + 1) / plays.length) * (PLAY_MS - 2000)),
      score: [...scores],
    };
  });
  return { winner, events, score: scores };
}

export function createSportsStore(filename, { now = Date.now } = {}) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS vs_accounts(id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance >= 0), refill_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vs_sessions(token TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vs_rounds(id TEXT PRIMARY KEY, sport TEXT NOT NULL, starts INTEGER NOT NULL, data TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vs_bets(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, request_id TEXT NOT NULL, round_id TEXT NOT NULL, sport TEXT NOT NULL, choice INTEGER NOT NULL, stake INTEGER NOT NULL, odds REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, UNIQUE(account_id,request_id));
    CREATE INDEX IF NOT EXISTS vs_bets_pending ON vs_bets(round_id,status);
    CREATE INDEX IF NOT EXISTS vs_bets_account ON vs_bets(account_id,created DESC);
    CREATE INDEX IF NOT EXISTS vs_round_starts ON vs_rounds(starts);`);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const ensureAccount = (id) =>
    db
      .prepare("INSERT OR IGNORE INTO vs_accounts(id,balance) VALUES(?,?)")
      .run(id, START_COINS);
  const advance = (timestamp) => {
    const pending = db
      .prepare("SELECT * FROM vs_rounds WHERE settled=0 AND starts+?<=?")
      .all(BET_MS + PLAY_MS, timestamp);
    for (const round of pending) {
      const match = JSON.parse(round.data);
      const bets = db
        .prepare("SELECT * FROM vs_bets WHERE round_id=? AND status='pending'")
        .all(round.id);
      for (const bet of bets) {
        const won = bet.choice === match.winner,
          payout = won
            ? Math.floor((bet.stake * Math.round(bet.odds * 100)) / 100)
            : 0;
        db.prepare("UPDATE vs_bets SET status=?,payout=? WHERE id=?").run(
          won ? "won" : "lost",
          payout,
          bet.id,
        );
        if (payout)
          db.prepare("UPDATE vs_accounts SET balance=balance+? WHERE id=?").run(
            payout,
            bet.account_id,
          );
      }
      db.prepare("UPDATE vs_rounds SET settled=1 WHERE id=?").run(round.id);
    }
    const starts = Math.floor(timestamp / ROUND_MS) * ROUND_MS;
    for (const fixture of FIXTURES) {
      const sport = sportForFixture(fixture);
      const id = fixture.id === 'classic' ? `${sport.id}-${starts}` : `${sport.id}-${fixture.id}-${starts}`;
      if (!db.prepare("SELECT id FROM vs_rounds WHERE id=?").get(id))
        db.prepare(
          "INSERT INTO vs_rounds(id,sport,starts,data) VALUES(?,?,?,?)",
        ).run(id, sport.id, starts, JSON.stringify({...makeMatch(sport),fixture}));
    }
    // Keep recent rounds plus all rounds referenced by an account's receipts.
    db.prepare(
      "DELETE FROM vs_rounds WHERE starts<? AND id NOT IN (SELECT round_id FROM vs_bets)",
    ).run(timestamp - 86400000);
    db.prepare("DELETE FROM vs_sessions WHERE expires<?").run(timestamp);
    return starts;
  };
  const view = (row, timestamp) => {
    const match = JSON.parse(row.data),
      elapsed = timestamp - row.starts;
    const phase =
      elapsed < BET_MS
        ? "betting"
        : elapsed < BET_MS + PLAY_MS
          ? "live"
          : "result";
    const events = match.events.filter((e) => e.at <= elapsed - BET_MS);
    return {
      id: row.id,
      sport: row.sport,
      fixture: match.fixture ?? fixtureById(row.sport),
      starts: row.starts,
      closes: row.starts + BET_MS,
      ends: row.starts + BET_MS + PLAY_MS,
      next: row.starts + ROUND_MS,
      phase,
      odds: oddsFor(sportById(row.sport)),
      events,
      score: events.at(-1)?.score ?? [0, 0],
      winner: phase === "result" ? match.winner : null,
      order: events.at(-1)?.order ?? [0, 1, 2, 3],
    };
  };
  const read = (accountId, timestamp, starts) => ({
    mode: "practice",
    accountId,
    serverTime: timestamp,
    account: db
      .prepare(
        "SELECT balance,refill_at AS refillAt FROM vs_accounts WHERE id=?",
      )
      .get(accountId),
    rounds: db
      .prepare("SELECT * FROM vs_rounds WHERE starts=? ORDER BY sport")
      .all(starts)
      .filter(row => row.id === `${row.sport}-${starts}`)
      .map((row) => view(row, timestamp)),
    matches: db.prepare("SELECT * FROM vs_rounds WHERE starts=? ORDER BY sport,id").all(starts).map(row=>view(row,timestamp)),
    bets: db
      .prepare(
        "SELECT b.id,b.request_id AS requestId,b.round_id AS roundId,b.sport,b.choice,b.stake,b.odds,b.status,b.payout,b.created,r.data AS matchData FROM vs_bets b JOIN vs_rounds r ON r.id=b.round_id WHERE b.account_id=? ORDER BY b.created DESC,b.rowid DESC LIMIT 50",
      )
      .all(accountId).map(({matchData,...bet})=>{
        const fixture=JSON.parse(matchData).fixture ?? fixtureById(bet.sport);
        return {...bet,fixture,selectionName:sportForFixture(fixture).selections[bet.choice]};
      }),
    results: db
      .prepare(
        "SELECT * FROM vs_rounds WHERE settled=1 ORDER BY starts DESC LIMIT 100",
      )
      .all()
      .map((row) => ({
        id: row.id,
        sport: row.sport,
        winner: JSON.parse(row.data).winner,
        score: JSON.parse(row.data).score,
        fixture: JSON.parse(row.data).fixture ?? fixtureById(row.sport),
      })),
  });
  return {
    state(accountId) {
      return tx(() => {
        ensureAccount(accountId);
        const timestamp = now(),
          starts = advance(timestamp);
        return read(accountId, timestamp, starts);
      });
    },
    place(accountId, input) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        typeof input.requestId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(input.requestId) ||
        typeof input.roundId !== "string" ||
        !sportById(input.sport) ||
        !Number.isInteger(input.choice) ||
        input.choice < 0 ||
        input.choice >= sportById(input.sport).selections.length ||
        !Number.isSafeInteger(input.stake) ||
        input.stake < 10 ||
        input.stake > 5000
      )
        throw new SportsError(
          "Choose a valid selection and 10–5,000 whole coins.",
        );
      return tx(() => {
        ensureAccount(accountId);
        const timestamp = now(),
          starts = advance(timestamp);
        const prior = db
          .prepare("SELECT * FROM vs_bets WHERE account_id=? AND request_id=?")
          .get(accountId, input.requestId);
        if (prior) {
          if (
            prior.round_id !== input.roundId ||
            prior.sport !== input.sport ||
            prior.choice !== input.choice ||
            prior.stake !== input.stake
          )
            throw new SportsError(
              "This request ID already belongs to a different bet.",
              409,
            );
          return read(accountId, timestamp, starts);
        }
        const round = db
          .prepare("SELECT * FROM vs_rounds WHERE id=?")
          .get(input.roundId);
        if (
          !round ||
          round.sport !== input.sport ||
          timestamp < round.starts ||
          timestamp >= round.starts + BET_MS
        )
          throw new SportsError(
            "Betting is closed for this match. Wait for the next round.",
            409,
          );
        const account = db
          .prepare("SELECT balance FROM vs_accounts WHERE id=?")
          .get(accountId);
        if (input.stake > account.balance)
          throw new SportsError("Not enough practice coins.");
        const odds = oddsFor(sportById(input.sport))[input.choice];
        db.prepare("UPDATE vs_accounts SET balance=balance-? WHERE id=?").run(
          input.stake,
          accountId,
        );
        db.prepare(
          "INSERT INTO vs_bets(id,account_id,request_id,round_id,sport,choice,stake,odds,created) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          accountId,
          input.requestId,
          input.roundId,
          input.sport,
          input.choice,
          input.stake,
          odds,
          timestamp,
        );
        return read(accountId, timestamp, starts);
      });
    },
    refill(accountId) {
      return tx(() => {
        ensureAccount(accountId);
        const timestamp = now(),
          starts = advance(timestamp);
        const account = db
          .prepare("SELECT * FROM vs_accounts WHERE id=?")
          .get(accountId);
        const pending = db
          .prepare(
            "SELECT id FROM vs_bets WHERE account_id=? AND status='pending' LIMIT 1",
          )
          .get(accountId);
        if (
          account.balance >= 1000 ||
          pending ||
          timestamp - account.refill_at < 60000
        )
          throw new SportsError(
            "Refill is available below 1,000 coins, after all bets settle, once per minute.",
          );
        db.prepare(
          "UPDATE vs_accounts SET balance=balance+?,refill_at=? WHERE id=?",
        ).run(START_COINS, timestamp, accountId);
        return read(accountId, timestamp, starts);
      });
    },
    session(token) {
      return tx(() => {
        const timestamp = now();
        const session =
          token &&
          db
            .prepare("SELECT * FROM vs_sessions WHERE token=? AND expires>?")
            .get(token, timestamp);
        if (session) return { token, accountId: session.account_id };
        const accountId = randomUUID(),
          newToken = randomUUID();
        ensureAccount(accountId);
        db.prepare("INSERT INTO vs_sessions VALUES(?,?,?)").run(
          newToken,
          accountId,
          timestamp + 30 * 86400000,
        );
        return { token: newToken, accountId };
      });
    },
    tick() {
      tx(() => advance(now()));
    },
    close() {
      db.close();
    },
  };
}
