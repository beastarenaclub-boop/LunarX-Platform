import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
import { jetxFlightMotion } from "../src/components/lunar/jetxFlightMotion";

test("JetX rolls, lifts off continuously and resumes at the server flight age", () => {
  const sample = (ms: number) => jetxFlightMotion("flying", ms, Math.exp(ms / 10000));
  expect(sample(1800).lift).toBe(0);
  expect(sample(1800).gear).toBe(1);
  expect(sample(3500).lift).toBeGreaterThan(0);
  expect(sample(3500).lift).toBeLessThan(1);
  expect(sample(6500).gear).toBe(0);
  expect(jetxFlightMotion("flying", 0, Math.exp(1.8)).stage).toBe("cruising");
  for (let ms = 10; ms <= 12000; ms += 10) {
    const before = sample(ms - 10), after = sample(ms);
    expect(after.distance).toBeGreaterThanOrEqual(before.distance);
    expect(Math.abs(after.pitch - before.pitch)).toBeLessThan(.1);
    expect(Math.abs(after.climb - before.climb)).toBeLessThan(.006);
  }
});

test("JetX animates the runway, clouds and pilots with real cashout receipts", async ({ page }, info) => {
  await mockGames(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let phase: "betting" | "flying" | "crashed" = "betting", age = 0, roundId = "crash-motion";
  let receipts: {id: string; panel: number; stakeAmount: string; payoutAmount: string; status: string; multiplier: number | null}[] = [];
  let betPosts = 0, cashoutPosts = 0;
  await page.route("**/api/crash/**", route => {
    const now = Date.now();
    return route.fulfill({ json: { id: roundId, gameCode: "jetx", phase, now, startsAt: phase === "betting" ? now + 15000 : now - age, bettingMs: 20000, multiplier: Math.exp(age / 10000), nextRoundAt: now + 20000, crashPoint: phase === "crashed" ? Math.exp(age / 10000) : null, serverSeed: phase === "crashed" ? "revealed" : null, serverSeedHash: "motion", clientSeed: "motion", nonce: 0, version: 3, bets: receipts } });
  });
  await page.route("**/api/bets/place", route => {
    const body = route.request().postDataJSON(); betPosts++;
    const receipt = { id: "jetx-motion-bet", panel: body.panel, stakeAmount: body.stakeAmount, payoutAmount: "0", status: "placed", multiplier: null };
    receipts = [receipt]; return route.fulfill({ json: receipt });
  });
  await page.route("**/api/bets/*/cashout", route => {
    cashoutPosts++;
    receipts = receipts.map(r => ({ ...r, status: "cashed_out", payoutAmount: "23400", multiplier: 2.34 }));
    return route.fulfill({ json: receipts[0] });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({width:1366,height:768});
  await page.goto("/jetx");
  const canvas = page.getByTestId("jetx-flight-canvas");
  await expect(canvas).toHaveAttribute("data-assets-ready", "true");
  await expect(canvas).toHaveAttribute("data-flight-stage", "runway");
  await page.getByTestId("btn-bet-0").click();
  expect(betPosts).toBe(1);
  await expect(page.locator(".jetx-bet-count")).toHaveText("1 Bets");
  await page.screenshot({path:info.outputPath("01-runway.png")});
  const runwayY = Number(await canvas.getAttribute("data-runway-y"));
  phase = "flying"; age = 600;
  await expect(canvas).toHaveAttribute("data-flight-stage", "rolling");
  await expect(page.getByTestId("btn-cashout-0")).toBeEnabled();
  expect(Number(await canvas.getAttribute("data-pitch"))).toBe(0);
  expect(Number(await canvas.getAttribute("data-runway-y"))).toBeCloseTo(runwayY, 0);
  const initialOffset = Number(await canvas.getAttribute("data-runway-offset"));
  age = 1800;
  await expect.poll(async () => Number(await canvas.getAttribute("data-runway-offset"))).toBeGreaterThan(initialOffset + 70);
  await expect(canvas).toHaveAttribute("data-gear", "1.00");
  await page.screenshot({path:info.outputPath("02-ground-roll.png")});
  age = 3500;
  await expect(canvas).toHaveAttribute("data-flight-stage", "takeoff");
  // The interpolated clock can enter takeoff before the next mocked snapshot
  // arrives. Wait for the actual lift, not just the first takeoff frame.
  await expect.poll(async () => Number(await canvas.getAttribute("data-pitch"))).toBeLessThan(-2);
  await page.screenshot({path:info.outputPath("03-takeoff.png")});
  age = 7000;
  await expect(canvas).toHaveAttribute("data-flight-stage", "climbing");
  await expect(canvas).toHaveAttribute("data-gear", "0.00");
  await expect.poll(async () => Number(await canvas.getAttribute("data-jumpers"))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute("data-cashout-jumpers", "0");
  await page.screenshot({path:info.outputPath("04-climb-pilot.png")});
  await page.getByTestId("btn-cashout-0").click();
  await expect(canvas).toHaveAttribute("data-cashout-ids", "jetx-motion-bet");
  await expect(canvas).toHaveAttribute("data-cashout-jumpers", "1");
  await page.waitForTimeout(1300);
  expect(cashoutPosts).toBe(1);
  await expect(page.locator(".jetx-players-summary")).toContainText("₹ 234.00");
  await expect(canvas).toHaveAttribute("data-cashout-jumpers", "1");
  await page.keyboard.press("Escape");
  await page.screenshot({path:info.outputPath("05-cashout-parachute.png")});
  age = 19000;
  await expect(canvas).toHaveAttribute("data-flight-stage", "cruising");
  expect(Number(await canvas.getAttribute("data-runway-y"))).toBeGreaterThan(768);
  for (const [width,height] of [[1366,768],[390,844],[568,320]]) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(150);
    await page.screenshot({path:info.outputPath(`06-flight-${width}.png`)});
    await expect(page.locator(".jetx-bet-action:visible").first()).toBeInViewport({ratio:.99});
  }
  // Joining a round already in flight must not replay the runway sequence.
  receipts = []; await page.reload();
  await expect(canvas).toHaveAttribute("data-flight-stage", "cruising");
  phase = "crashed";
  await expect(canvas).toHaveAttribute("data-flight-stage", "flew-away");
  await expect(page.getByText("Flew Away!", {exact:true})).toBeVisible();
  await page.emulateMedia({ reducedMotion:"reduce" });
  await expect(canvas).toHaveAttribute("data-reduced-motion", "true");
  phase = "betting"; age = 0; roundId = "crash-motion-next";
  await page.reload();
  await expect(canvas).toHaveAttribute("data-flight-stage", "runway");
  await expect(canvas).toHaveAttribute("data-jumpers", "0");
  expect(errors).toEqual([]);
});
