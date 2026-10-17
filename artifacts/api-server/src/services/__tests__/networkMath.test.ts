import { test } from "node:test";
import assert from "node:assert/strict";
import { splitNetworkProfit } from "../networkMath";
const terms = {
  companyFeeBps: 1000,
  masterShareBps: 10000,
  agentShareBps: 5000,
};
test("parent-relative shares mirror profit and loss", () => {
  assert.deepEqual(splitNetworkProfit(10000n, terms), {
    company: 1000n,
    master: 4500n,
    agent: 4500n,
  });
  assert.deepEqual(splitNetworkProfit(-10000n, terms), {
    company: -1000n,
    master: -4500n,
    agent: -4500n,
  });
  assert.deepEqual(
    splitNetworkProfit(10000n, { ...terms, masterShareBps: 5000 }),
    { company: 5500n, master: 2250n, agent: 2250n },
  );
});
test("conserves signed paise at boundaries and fractional percentages", () => {
  for (const amount of [
    -100000000000001n,
    -10001n,
    -11n,
    -1n,
    0n,
    1n,
    11n,
    10001n,
    100000000000001n,
  ]) {
    for (const agentShareBps of [0, 1, 3333, 5000, 9999, 10000]) {
      const result = splitNetworkProfit(amount, { ...terms, agentShareBps });
      assert.equal(result.company + result.master + result.agent, amount);
      const reverse = splitNetworkProfit(-amount, { ...terms, agentShareBps });
      assert.equal(result.company, -reverse.company);
      assert.equal(result.master, -reverse.master);
      assert.equal(result.agent, -reverse.agent);
    }
  }
});
test("invalid rates fail rather than creating an over-allocation", () => {
  for (const value of [-1, 10001, NaN, 1.5])
    assert.throws(() =>
      splitNetworkProfit(100n, { ...terms, agentShareBps: value }),
    );
});
