import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

test("unattended race starts on the shared clock, blocks bets, and opens the next round", async ({
  page,
}) => {
  const f = await setup(page),
    id = f.race.id;
  await expect(page.getByTestId("horse-betting-countdown")).toBeVisible();
  await f.start();
  await expect(page.getByTestId("horse-1")).toBeDisabled();
  const canvas = page.getByTestId("horse-race-canvas");
  const before = await canvas.getAttribute("data-positions");
  await page.clock.runFor(1500);
  expect(await canvas.getAttribute("data-positions")).not.toBe(before);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-phase="racing"]')).toBeVisible();
  await expect(canvas).toHaveAttribute("data-race-id", id);
  await f.finish();
  await f.next();
  expect(f.race.id).not.toBe(id);
  await expect(page.getByTestId("horse-1")).toBeEnabled();
  expect(f.posts).toHaveLength(0);
  await expect(page.getByTestId("horse-wallet")).toContainText("10,000.00");
  expect(f.errors).toEqual([]);
});

test("shared coins accept one multi-horse slip without starting or resetting the race", async ({
  page,
}) => {
  test.setTimeout(180000);
  const f = await setup(page, { pauseClock: true, readyTimeout: 90000 }),
    startedAt = f.race.startedAt,
    id = f.race.id;
  async function reloadReady() {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(
        async () => {
          await page.clock.runFor(100);
          return page.getByTestId("horse-betting-dock").count();
        },
        { timeout: 30000 },
      )
      .toBe(1);
  }
  await page.getByTestId("chip-100").click();
  await page.getByTestId("horse-1").click();
  await page.getByTestId("horse-8").click();
  await page.clock.runFor(3300);
  await expect.poll(() => f.posts.length).toBe(1);
  expect(f.posts[0].roundId).toBe(id);
  expect(f.posts[0].bets).toEqual([
    { horseId: 1, amountPaise: "10000" },
    { horseId: 8, amountPaise: "10000" },
  ]);
  expect(f.race.startedAt).toBe(startedAt);
  await expect(page.locator('[data-phase="betting"]')).toBeVisible();
  await expect(page.getByTestId("horse-betting-dock")).toContainText(
    "BET ACCEPTED",
  );
  await expect(page.getByTestId("horse-wallet")).toContainText("9,800.00");
  await reloadReady();
  await expect(page.getByTestId("horse-betting-dock")).toContainText(
    "BET ACCEPTED",
  );
  await f.start();
  await f.finish();
  await expect(
    page.getByTestId(`horse-${f.race.plan.order[0]}`),
  ).toHaveAttribute("data-winner", "true");
  const wallet = await page.getByTestId("horse-wallet").textContent();
  await reloadReady();
  await expect(page.getByTestId("horse-wallet")).toHaveText(wallet!);
  expect(f.posts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("draft expiring at the cutoff is cancelled and never carried to the next round", async ({
  page,
}) => {
  const f = await setup(page);
  await f.advanceTo(f.race.startedAt - 2600);
  await page.getByTestId("horse-4").click();
  await page.clock.runFor(3300);
  await expect(page.getByTestId("horse-4")).toBeDisabled();
  expect(f.posts).toHaveLength(0);
  await f.finish();
  await f.next();
  await page.clock.runFor(4000);
  expect(f.posts).toHaveLength(0);
  await expect(page.getByTestId("horse-4")).toHaveAttribute(
    "data-selected",
    "false",
  );
});

test("cancelled and rejected bets preserve funds while the live race continues", async ({
  page,
}) => {
  const f = await setup(page, { reject: true });
  await page.getByTestId("horse-4").click();
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await page.clock.runFor(4000);
  expect(f.posts).toHaveLength(0);
  await page.getByTestId("horse-4").click();
  await page.clock.runFor(3300);
  await expect(page.getByRole("alert")).toContainText("Insufficient");
  await f.start();
  expect(f.posts).toHaveLength(1);
  await expect(page.getByTestId("horse-wallet")).toContainText("10,000.00");
});

test("lost response recovers the accepted slip without charging twice", async ({
  page,
}) => {
  const f = await setup(page, { lostResponse: true });
  await page.getByTestId("horse-2").click();
  await page.clock.runFor(5000);
  await expect(page.getByTestId("horse-betting-dock")).toContainText(
    "BET ACCEPTED",
  );
  await expect(page.getByRole("alert")).toContainText("recovered");
  await expect(page.getByTestId("horse-wallet")).toContainText("9,990.00");
  expect(f.posts).toHaveLength(1);
});

test("auto bet waits for the next shared window and Stop prevents further debits", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByTestId("horse-3").click();
  await page.getByRole("button", { name: "Start auto", exact: true }).click();
  await page.clock.runFor(3300);
  await expect.poll(() => f.posts.length).toBe(1);
  await f.start();
  await f.finish();
  expect(f.posts).toHaveLength(1);
  await f.next();
  await page.clock.runFor(500);
  await expect(page.getByTestId("auto-bet-status")).toContainText(
    "Auto bet in",
  );
  await page.clock.runFor(3300);
  await expect.poll(() => f.posts.length).toBe(2);
  expect(f.posts[1].roundId).not.toBe(f.posts[0].roundId);
  expect(f.posts[1].bets).toEqual(f.posts[0].bets);
  await expect(page.getByRole("button", { name: /Stop auto/ })).toContainText(
    "3 left",
  );
  await page.getByRole("button", { name: /Stop auto/ }).click();
  await f.start();
  await f.finish();
  await f.next();
  await page.clock.runFor(4000);
  expect(f.posts).toHaveLength(2);
  expect(f.errors).toEqual([]);
});
