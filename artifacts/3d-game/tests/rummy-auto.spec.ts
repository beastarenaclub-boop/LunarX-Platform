import { expect, test } from "@playwright/test";
import { initialTable, type TableState } from "../src/game/rummy/engine";
import {
  rummySessionReducer as update,
  type RummySession,
} from "@workspace/api-zod/rummy-session";

const fresh = (): RummySession => ({
  table: ({ ...initialTable(), balance: 10000 }),
  auto: null,
  autoPlay: false,
  notice: "",
});
const start = {
  type: "auto-start",
  stake: 50,
  rounds: 3,
  lossLimit: 100,
  profitTarget: 100,
} as const;
function settle(session: RummySession, net: number): RummySession {
  // Simulate a result arriving from the independently tested card engine.
  const table: TableState = {
    ...session.table,
    phase: "finished",
    balance: session.table.balance + session.table.stake + net,
  };
  return { ...session, table };
}

test("auto-bet deducts each entry once and stops at its round limit", () => {
  let s = update(fresh(), { ...start, rounds: 2 });
  expect(s.table.balance).toBe(9950);
  expect(s.auto?.remaining).toBe(1);
  expect(update(s, start)).toBe(s);
  expect(update(s, { type: "auto-next" })).toBe(s);
  s = update(settle(s, 0), { type: "auto-next" });
  expect(s.table.round).toBe(2);
  expect(s.table.balance).toBe(9950);
  s = update(settle(s, 0), { type: "auto-next" });
  expect(s.auto).toBeNull();
  expect(s.table.balance).toBe(10000);
  expect(s.notice).toContain("Round limit");
});

test("auto-bet stops at profit target and before an entry could exceed the loss limit", () => {
  const won = update(settle(update(fresh(), start), 150), {
    type: "auto-next",
  });
  expect(won.auto).toBeNull();
  expect(won.table.balance).toBe(10150);
  expect(won.notice).toContain("Profit target");
  let lost = update(fresh(), { ...start, lossLimit: 75 });
  lost = update(settle(lost, -50), { type: "auto-next" });
  expect(lost.auto).toBeNull();
  expect(lost.table.balance).toBe(9950);
  expect(lost.notice).toContain("Loss limit");
});

test("stop cancels future entries without refunding an active entry; invalid settings cannot start", () => {
  const initial = fresh();
  expect(update(initial, { ...start, lossLimit: 1 })).toBe(initial);
  expect(update(initial, { ...start, rounds: 51 })).toBe(initial);
  expect(update(initial, { ...start, profitTarget: NaN })).toBe(initial);
  const stopped = update(update(initial, start), { type: "auto-stop" });
  expect(stopped.auto).toBeNull();
  expect(stopped.table.balance).toBe(9950);
  const done = update(settle(stopped, -50), { type: "auto-next" });
  expect(done.table.round).toBe(1);
  expect(done.table.balance).toBe(9950);
});
