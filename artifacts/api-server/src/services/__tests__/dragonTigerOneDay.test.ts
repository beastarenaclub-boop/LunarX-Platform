import { test } from "node:test";
import assert from "node:assert/strict";
import { OD_MARKETS } from "@workspace/api-zod/dragon-tiger-one-day";
import {
  commitment,
  draw,
  lockSelections,
  payout,
  phaseAt,
  publicRound,
  quotes,
  wins,
  winner,
} from "../dragonTigerOneDayMath";

test("8-deck draw never repeats a physical card; commitment binds the exact result", () => {
  for (const d of [0, 207, 415])
    for (let second = 0; second < 415; second++) {
      const input = [d, second],
        r = draw(() => input.shift()!);
      assert.notEqual(r.dragon, r.tiger);
      assert.ok(r.tiger >= 0 && r.tiger < 416);
      assert.equal(r.commitment, commitment(r.dragon, r.tiger, r.nonce));
      assert.notEqual(
        r.commitment,
        commitment(r.dragon, (r.tiger + 1) % 416, r.nonce),
      );
    }
});
test("all 56 markets, ties, face cards, colour, and seven exceptions settle consistently", () => {
  assert.equal(OD_MARKETS.length, 56);
  assert.equal(winner(0, 12), "tiger");
  assert.equal(winner(0, 13), "tie");
  assert.equal(wins("suited-tie", 0, 52), true);
  assert.equal(wins("suited-tie", 0, 13), false);
  for (let card = 0; card < 416; card++) {
    assert.notEqual(wins("tiger-red", 0, card), wins("tiger-black", 0, card));
    assert.notEqual(wins("tiger-face", 0, card), wins("tiger-number", 0, card));
    assert.equal(
      ["spades", "hearts", "diamonds", "clubs"].filter((s) =>
        wins(`tiger-${s}`, 0, card),
      ).length,
      1,
    );
    assert.equal(
      OD_MARKETS.filter(
        (m) => m.id.startsWith("tiger-rank-") && wins(m.id, 0, card),
      ).length,
      1,
    );
    if (card % 13 === 6)
      for (const option of ["odd", "even", "low", "high"])
        assert.equal(wins(`tiger-${option}`, 0, card), false);
  }
});
test("initial odds reflect 416×415 pairs, with stake included and 85% maximum return", () => {
  const q = quotes(),
    get = (id: string) => q.find((q) => q.id === id)!;
  assert.equal(get("dragon").probability, 192 / 415);
  assert.equal(get("tie").probability, 31 / 415);
  assert.equal(get("suited-tie").probability, 7 / 415);
  assert.equal(get("dragon").oddsHundredths, 183);
  assert.equal(get("tiger-red").oddsHundredths, 170);
  for (const quote of q)
    assert.ok((quote.probability * quote.oddsHundredths) / 100 <= 0.85 + 1e-12);
});
test("every conditional price matches an independently enumerated 415-card shoe", () => {
  for (let dragon = 0; dragon < 52; dragon++) {
    for (const quote of quotes(dragon)) {
      let count = 0;
      for (let tiger = 0; tiger < 416; tiger++)
        if (tiger !== dragon && wins(quote.id, dragon, tiger)) count++;
      assert.equal(quote.probability, count / 415, `${dragon}: ${quote.id}`);
      if (quote.side === "dragon" || count === 0 || count === 415)
        assert.equal(quote.available, false);
      if (quote.available) {
        assert.equal(quote.oddsHundredths, Math.floor((85 * 415) / count));
        assert.ok(
          (quote.probability * quote.oddsHundredths) / 100 <= 0.85 + 1e-12,
        );
      }
    }
  }
  assert.equal(quotes(0).find((q) => q.id === "dragon")!.available, false);
  assert.equal(quotes(12).find((q) => q.id === "tiger")!.available, false);
});
test("accepted first prices survive second-window repricing; integer paise never drift", () => {
  const first = lockSelections(
    [{ market: "tiger-red", amountPaise: "10000" }],
    quotes(),
  );
  const second = lockSelections(
    [{ market: "tiger-red", amountPaise: "10000" }],
    quotes(0),
    first.stake,
  );
  assert.equal(first.selections[0].oddsHundredths, 170);
  assert.equal(second.selections[0].oddsHundredths, 169); // 208/415, rounded down
  assert.equal(payout(first.selections, 13, 14), 17000n);
  assert.equal(payout(second.selections, 0, 14), 16900n);
  const main = lockSelections(
    [{ market: "dragon", amountPaise: "100" }],
    quotes(),
  );
  assert.equal(payout(main.selections, 12, 0), 183n);
  assert.equal(payout(main.selections, 12, 25), 0n); // One Day: main loses on ties
  assert.equal(first.selections[0].oddsHundredths, 170);
});
test("unknown/duplicate/known markets, invalid amounts and cross-window overspend reject", () => {
  const bet = (market: string, amountPaise = "100") => ({
    market,
    amountPaise,
  });
  assert.throws(() => lockSelections([bet("fake")], quotes()));
  assert.throws(() => lockSelections([bet("tiger"), bet("tiger")], quotes()));
  assert.throws(() => lockSelections([bet("dragon-red")], quotes(12)));
  for (const amount of ["0", "-100", "1.0", "101", "1e4", "99999999999"])
    assert.throws(() => lockSelections([bet("tiger", amount)], quotes()));
  assert.throws(() =>
    lockSelections([bet("tiger", "10000")], quotes(6), 495000n),
  );
  assert.equal(
    lockSelections([bet("tiger", "10000")], quotes(6), 490000n).stake,
    10000n,
  );
});
test("phase boundaries and serialization hide Tiger and nonce until ALL betting closes", () => {
  const round = {
    id: 1,
    ...draw(),
    firstClosesAt: new Date(20000),
    secondOpensAt: new Date(23000),
    secondClosesAt: new Date(38000),
    revealsAt: new Date(41000),
    endsAt: new Date(48000),
  };
  for (const [now, phase] of [
    [19999, "first"],
    [20000, "dragon-reveal"],
    [23000, "second"],
    [38000, "tiger-reveal"],
    [41000, "result"],
  ] as const)
    assert.equal(phaseAt(round, now).phase, phase);
  for (const now of [0, 19999, 20000, 22999, 23000, 37999, 38000, 40999]) {
    const visible = publicRound(round, now);
    assert.ok(!("tiger" in visible));
    assert.ok(!("nonce" in visible));
    assert.ok(!("winner" in visible));
    assert.equal("dragon" in visible, now >= 23000);
  }
  assert.equal(publicRound(round, 41000).tiger, round.tiger);
});
