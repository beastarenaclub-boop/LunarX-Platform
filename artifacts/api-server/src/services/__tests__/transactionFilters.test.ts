import { test } from "node:test";
import assert from "node:assert/strict";
// Database-dependent integration cases live in network.integration.test.ts.
test("transaction query validation rejects inverted amounts and invalid custom dates", async () => {
  const { parseTransactionQuery } = await import("../transactionFilters");
  for (const query of [
    { minAmount: "100", maxAmount: "99" },
    { minAmount: "-1" },
    { maxAmount: "1.2" },
    { period: "custom", from: "2026-02-30", to: "2026-03-01" },
    { period: "custom", from: "2026-10-19" },
    { limit: 201 },
    { offset: -1 },
  ])
    assert.throws(() => parseTransactionQuery(query));
  const zero = parseTransactionQuery({
    minAmount: "0",
    maxAmount: "0",
    period: "all",
  });
  assert.equal(zero.minAmount, "0");
  assert.equal(zero.maxAmount, "0");
  const preset = parseTransactionQuery({ period: "yesterday" });
  assert.equal(preset.from, preset.to);
});
