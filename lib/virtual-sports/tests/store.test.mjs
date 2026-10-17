import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSportsStore, makeMatch } from "../store.mjs";
import { SPORTS, BET_MS, PLAY_MS, ROUND_MS, START_COINS } from "../catalog.mjs";
import { FIXTURES, sportForFixture } from '../fixtures.mjs';
const start = ROUND_MS * 24000000;
function fixture(file = ":memory:") {
  let clock = start;
  const store = createSportsStore(file, { now: () => clock });
  return {
    store,
    set time(n) {
      clock = n;
    },
    get time() {
      return clock;
    },
  };
}
const input = (round, sport = "football", choice = 0, stake = 100) => ({
  requestId: randomUUID(),
  roundId: round.id,
  sport,
  choice,
  stake,
});

test('selectable fixtures keep independent results, receipt names and private future events',()=>{
  const f=fixture();
  try{
    const initial=f.store.state('fixtures');
    assert.equal(initial.rounds.length,5);
    assert.equal(initial.matches.length,FIXTURES.length);
    assert.equal(new Set(initial.matches.map(r=>r.id)).size,FIXTURES.length);
    for(const r of initial.matches){
      assert.equal(r.winner,null);assert.deepEqual(r.events,[]);assert.deepEqual(r.score,[0,0]);
      assert.equal(r.fixture.sport,r.sport);
      // All selections are placed in an isolated in-memory account so the
      // winning receipt and its team label can be verified for every fixture.
      for(let choice=0;choice<r.odds.length;choice++)f.store.place('fixtures',input(r,r.sport,choice,10));
    }
    const midway=start+BET_MS+12000;f.time=midway;
    for(const r of f.store.state('fixtures').matches){assert.equal(r.winner,null);assert.ok(r.events.every(e=>e.at<=12000));}
    f.time=start+BET_MS+PLAY_MS;
    const result=f.store.state('fixtures');
    // Receipts are paginated to 50; inspect the selected football fixtures separately.
    for(const r of result.matches){
      const finish=result.results.find(x=>x.id===r.id);
      assert.equal(finish.winner,r.winner);assert.deepEqual(finish.fixture,r.fixture);
      assert.deepEqual(finish.score,r.score);
    }
    for(const b of result.bets){
      const r=result.matches.find(x=>x.id===b.roundId);
      assert.equal(b.selectionName,sportForFixture(r.fixture).selections[b.choice]);
      assert.equal(b.status,b.choice===r.winner?'won':'lost');
    }
    const balance=result.account.balance;
    f.time=start+ROUND_MS;
    const next=f.store.state('fixtures');
    assert.equal(next.account.balance,balance);
    assert.deepEqual(next.bets,result.bets);
    assert.ok(next.matches.every(r=>!result.matches.some(old=>old.id===r.id)));
    assert.equal(JSON.stringify(next).includes('matchData'),false);
    assert.equal(JSON.stringify(next).includes('weights'),false);
  }finally{f.store.close();}
});

test('fixture switching cannot transfer a bet or retry to a different match',()=>{
  const f=fixture();
  try{
    const matches=f.store.state('a').matches;
    const brazil=matches.find(r=>r.fixture.id==='brazil-argentina');
    const france=matches.find(r=>r.fixture.id==='france-portugal');
    const request=input(brazil);
    assert.equal(f.store.place('a',request).bets[0].selectionName,'Brazil');
    assert.throws(()=>f.store.place('a',{...request,roundId:france.id}),/different bet/);
    assert.throws(()=>f.store.place('a',{...request,requestId:randomUUID(),sport:'cricket'}),/closed/);
    const state=f.store.state('a');assert.equal(state.account.balance,9900);
    assert.equal(state.bets.length,1);assert.equal(state.bets[0].fixture.id,'brazil-argentina');
  }finally{f.store.close();}
});

test("five matches hide all future events and results during betting", () => {
  const f = fixture();
  try {
    const s = f.store.state("alice");
    assert.equal(s.account.balance, START_COINS);
    assert.equal(s.rounds.length, 5);
    for (const r of s.rounds) {
      assert.equal(r.phase, "betting");
      assert.equal(r.winner, null);
      assert.deepEqual(r.events, []);
      assert.deepEqual(r.score, [0, 0]);
    }
    assert.equal(JSON.stringify(s).includes("weights"), false);
  } finally {
    f.store.close();
  }
});
test("atomic debit, idempotent retry and conflicting reuse", () => {
  const f = fixture();
  try {
    const round = f.store.state("a").rounds.find((r) => r.sport === "football"),
      bet = input(round);
    const first = f.store.place("a", bet);
    assert.equal(first.account.balance, 9900);
    assert.equal(f.store.place("a", bet).account.balance, 9900);
    assert.equal(f.store.state("a").bets.length, 1);
    assert.throws(
      () => f.store.place("a", { ...bet, stake: 200 }),
      /different bet/,
    );
    assert.equal(f.store.state("b").account.balance, 10000);
  } finally {
    f.store.close();
  }
});
test("malformed, fractional, negative, oversized, insufficient and unknown bets do not debit", () => {
  const f = fixture();
  try {
    const round = f.store.state("a").rounds[0],
      bet = input(round, round.sport);
    for (const stake of [0, -1, 9, 5001, 1.5, "100", NaN, Infinity])
      assert.throws(() =>
        f.store.place("a", { ...bet, requestId: randomUUID(), stake }),
      );
    assert.throws(() => f.store.place("a", { ...bet, sport: "hockey" }));
    assert.throws(() => f.store.place("a", { ...bet, choice: 99 }));
    f.store.place("a", { ...bet, stake: 5000 });
    f.store.place("a", { ...bet, requestId: randomUUID(), stake: 5000 });
    assert.throws(
      () => f.store.place("a", { ...bet, requestId: randomUUID(), stake: 10 }),
      /Not enough/,
    );
    assert.equal(f.store.state("a").account.balance, 0);
  } finally {
    f.store.close();
  }
});
test("betting deadline is exclusive and stale rounds fail", () => {
  const f = fixture();
  try {
    const round = f.store.state("a").rounds[0],
      bet = input(round, round.sport);
    f.time = start + BET_MS - 1;
    f.store.place("a", bet);
    f.time = start + BET_MS;
    assert.throws(
      () => f.store.place("a", { ...bet, requestId: randomUUID() }),
      /closed/,
    );
    f.time = start + ROUND_MS;
    assert.throws(
      () => f.store.place("a", { ...bet, requestId: randomUUID() }),
      /closed/,
    );
  } finally {
    f.store.close();
  }
});
test("each market settles exactly once, outcomes agree with scores, receipts retain odds", () => {
  const f = fixture();
  try {
    const state = f.store.state("a");
    let spent = 0;
    for (const round of state.rounds) {
      for (let choice = 0; choice < round.odds.length; choice++) {
        f.store.place("a", input(round, round.sport, choice, 101));
        spent += 101;
      }
    }
    f.time = start + BET_MS + PLAY_MS;
    const result = f.store.state("a");
    let returned = 0;
    for (const sport of SPORTS) {
      const round = result.rounds.find((r) => r.sport === sport.id),
        bets = result.bets.filter((b) => b.sport === sport.id);
      assert.equal(bets.filter((b) => b.status === "won").length, 1);
      const winner = bets.find((b) => b.status === "won");
      assert.equal(winner.choice, round.winner);
      assert.equal(
        winner.payout,
        Math.floor((101 * Math.round(winner.odds * 100)) / 100),
      );
      returned += winner.payout;
      if (sport.id === "formula") assert.equal(round.order[0], round.winner);
      else if (sport.id === "tennis")
        assert.equal(round.score[round.winner], 5);
      else
        assert.equal(
          round.winner,
          round.score[0] === round.score[1]
            ? 1
            : round.score[0] > round.score[1]
              ? 0
              : 2,
        );
    }
    assert.equal(result.account.balance, START_COINS - spent + returned);
    f.store.tick();
    assert.equal(f.store.state("a").account.balance, result.account.balance);
    assert.equal(f.store.state("b").bets.length, 0);
  } finally {
    f.store.close();
  }
});
test("live feed exposes only elapsed events", () => {
  const f = fixture();
  try {
    f.store.state("a");
    f.time = start + BET_MS + 12000;
    const s = f.store.state("a");
    for (const r of s.rounds) {
      assert.equal(r.phase, "live");
      assert.equal(r.winner, null);
      assert.ok(r.events.every((e) => e.at <= 12000));
    }
  } finally {
    f.store.close();
  }
});
test("restart settles overdue bets and retry after restart cannot debit again", () => {
  const folder = mkdtempSync(join(tmpdir(), "arena-")),
    file = join(folder, "sports.sqlite");
  const f = fixture(file);
  let second;
  try {
    const round = f.store.state("a").rounds[0],
      bet = input(round, round.sport);
    f.store.place("a", bet);
    f.store.close();
    second = createSportsStore(file, { now: () => start + ROUND_MS * 10 });
    const state = second.state("a");
    assert.notEqual(state.bets[0].status, "pending");
    assert.equal(second.place("a", bet).account.balance, state.account.balance);
    assert.equal(second.state("a").bets.length, 1);
  } finally {
    second?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test("refill requires low balance, no pending bets and has a cooldown", () => {
  const f = fixture();
  try {
    const state = f.store.state("a");
    assert.throws(() => f.store.refill("a"), /below/);
    const r = state.rounds.find((r) => r.sport === "football");
    f.store.place("a", input(r, "football", 0, 5000));
    f.store.place("a", input(r, "football", 0, 5000));
    assert.throws(() => f.store.refill("a"), /settle/);
    f.time = start + BET_MS + PLAY_MS;
    const settled = f.store.state("a");
    if (settled.account.balance < 1000) {
      assert.equal(f.store.refill("a").account.balance, 10000);
      assert.throws(() => f.store.refill("a"), /minute/);
    }
  } finally {
    f.store.close();
  }
});
test("sessions persist and isolate account receipts", () => {
  const f = fixture();
  try {
    const first = f.store.session(),
      same = f.store.session(first.token),
      other = f.store.session("untrusted");
    assert.deepEqual(same, first);
    assert.notEqual(other.accountId, first.accountId);
    f.time = start + 31 * 86400000;
    assert.notEqual(f.store.session(first.token).accountId, first.accountId);
  } finally {
    f.store.close();
  }
});
test("generated sports have legal, coherent final scores across repeated simulations", () => {
  for (const sport of SPORTS)
    for (let i = 0; i < 200; i++) {
      const m = makeMatch(sport);
      assert.ok(m.events.length > 0);
      assert.deepEqual(m.events.at(-1).score, m.score);
      assert.ok(
        m.events.every(
          (e, j) =>
            e.at > 0 &&
            e.at < PLAY_MS &&
            (j === 0 || e.at > m.events[j - 1].at),
        ),
      );
      if (sport.id === "cricket") {
        assert.equal(m.events.length, 12);
        assert.ok(m.events.every((e) => [0, 1, 2, 3, 4, 6].includes(e.points)));
      }
      if (sport.id === "basketball")
        assert.ok(m.events.every((e) => e.points === 2));
      if (sport.id === "tennis") {
        assert.equal(m.score[m.winner], 5);
        assert.ok(m.score[1 - m.winner] < 5);
      } else if (sport.id === "formula") {
        assert.equal(m.events.at(-1).order[0], m.winner);
        assert.equal(new Set(m.events.at(-1).order).size, 4);
      } else
        assert.equal(
          m.winner,
          m.score[0] === m.score[1] ? 1 : m.score[0] > m.score[1] ? 0 : 2,
        );
    }
});
