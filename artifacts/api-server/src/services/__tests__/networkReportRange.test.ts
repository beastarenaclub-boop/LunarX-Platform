import { test } from "node:test";
import assert from "node:assert/strict";
import { networkReportRange, reportFilter } from "../networkReportRange";

test("report periods use India midnight, Monday weeks and leap-year calendar months", () => {
  const range = (period: string, time: string) =>
    networkReportRange(reportFilter.parse({ period }), new Date(time));
  assert.equal(range("today", "2026-10-18T18:29:59.999Z").from, "2026-10-18");
  assert.equal(range("today", "2026-10-18T18:30:00Z").from, "2026-10-19");
  assert.equal(range("yesterday", "2026-10-18T18:30:00Z").from, "2026-10-18");
  const sunday = range("weekly", "2026-10-18T18:29:59Z");
  assert.deepEqual([sunday.from, sunday.to], ["2026-10-12", "2026-10-18"]);
  const monday = range("weekly", "2026-10-18T18:30:00Z");
  assert.deepEqual([monday.from, monday.to], ["2026-10-19", "2026-10-25"]);
  const leap = range("monthly", "2024-02-14T12:00:00Z");
  assert.deepEqual([leap.from, leap.to], ["2024-02-01", "2024-02-29"]);
  const year = range("weekly", "2025-12-31T12:00:00Z");
  assert.deepEqual([year.from, year.to], ["2025-12-29", "2026-01-04"]);
});

test("custom reports require valid ordered dates and allow up to 366 inclusive days", () => {
  for (const input of [
    { period: "custom" },
    { period: "custom", from: "2026-02-30", to: "2026-03-01" },
    { period: "custom", from: "2026-10-20", to: "2026-10-19" },
    { period: "custom", from: "2024-01-01", to: "2025-01-01" },
    { period: "unknown" },
  ])
    assert.throws(() => networkReportRange(reportFilter.parse(input)));
  assert.equal(
    networkReportRange(
      reportFilter.parse({
        period: "custom",
        from: "2024-01-01",
        to: "2024-12-31",
      }),
    ).to,
    "2024-12-31",
  );
});
