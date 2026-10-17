import { test, expect } from "@playwright/test";
import { SPORTS } from "../../../lib/virtual-sports/catalog.mjs";
import { mkdirSync } from "node:fs";
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('arena:fixtures:v1',JSON.stringify({football:'classic',cricket:'classic',basketball:'classic',tennis:'classic',formula:'classic'})));
});
test("all five 3D arenas render, controls work, responsive layout and rules", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("sports-balance")).not.toHaveText("—");
  await expect(page.getByTestId("sports-scene")).toHaveAttribute(
    "data-ready",
    "true",
  );
  mkdirSync("tmp/virtual-sports", { recursive: true });
  for (const sport of SPORTS) {
    await page.getByRole("tab", { name: new RegExp(sport.short) }).click();
    await expect(
      page.getByRole("heading", { name: sport.name + " 3D" }),
    ).toBeVisible();
    await expect(page.getByTestId("sports-scene")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("sports-scene")).toHaveAttribute(
      "data-athletes",
      String(
        { football: 22, cricket: 13, basketball: 10, tennis: 2, formula: 0 }[
          sport.id
        ],
      ),
    );
    await expect(page.getByTestId("sports-scene")).toHaveAttribute(
      "data-vehicles",
      sport.id === "formula" ? "4" : "0",
    );
    await page.screenshot({
      path: `tmp/virtual-sports/${sport.id}-desktop.png`,
      fullPage: true,
    });
  }
  await page
    .getByRole("combobox", { name: "Camera view" })
    .selectOption("overhead");
  await page
    .getByRole("combobox", { name: "Graphics quality" })
    .selectOption("balanced");
  await expect(page.getByTestId("sports-scene")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "separate from your main wallet",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mute sound", exact: true }),
  ).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByTestId("sports-place").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("sports-place")).toBeVisible();
    await page.screenshot({
      path: `tmp/virtual-sports/mobile-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
test("real server accepts all five markets, persists through reload, closes bets and settles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Graphics quality" })
    .selectOption("balanced");
  // A real scheduled round, not a mocked settlement response.
  let state = await (
    await page.request.get("/api/virtual-sports/state")
  ).json();
  if (
    state.rounds[0].phase !== "betting" ||
    state.rounds[0].closes - state.serverTime < 14000
  ) {
    await page.waitForTimeout(state.rounds[0].next - state.serverTime + 300);
  }
  state = await (await page.request.get("/api/virtual-sports/state")).json();
  const roundId = state.rounds.find((r: any) => r.sport === "football").id;
  await expect(
    page.getByRole("button", { name: "Select Emerald FC", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Select Emerald FC", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Stake amount" }).fill("100");
  await page.getByTestId("sports-place").click();
  await expect(page.getByRole("status")).toContainText("Bet accepted");
  let after = await (
    await page.request.get("/api/virtual-sports/state")
  ).json();
  expect(after.account.balance).toBe(9900);
  for (const sport of SPORTS) {
    const round = after.rounds.find((r: any) => r.sport === sport.id);
    for (let choice = 0; choice < sport.selections.length; choice++) {
      if (sport.id === "football" && choice === 0) continue;
      const response = await page.request.post("/api/virtual-sports/bets", {
        headers: { "X-Sports-Client": "1" },
        data: {
          requestId: crypto.randomUUID(),
          roundId: round.id,
          sport: sport.id,
          choice,
          stake: 100,
        },
      });
      expect(response.ok()).toBe(true);
    }
  }
  await page.reload();
  await expect(page.getByTestId("sports-balance")).toHaveText("8,500 coins");
  await expect(page.getByTestId("sports-bet")).toHaveCount(3);
  after = await (await page.request.get("/api/virtual-sports/state")).json();
  await page.waitForTimeout(
    Math.max(0, after.rounds[0].closes - after.serverTime + 250),
  );
  await expect(page.getByTestId("sports-place")).toBeDisabled();
  const rejected = await page.request.post("/api/virtual-sports/bets", {
    headers: { "X-Sports-Client": "1" },
    data: {
      requestId: crypto.randomUUID(),
      roundId,
      sport: "football",
      choice: 0,
      stake: 100,
    },
  });
  expect(rejected.status()).toBe(409);
  after = await (await page.request.get("/api/virtual-sports/state")).json();
  await page.waitForTimeout(
    Math.max(0, after.rounds[0].ends - after.serverTime + 400),
  );
  const settled = await (
    await page.request.get("/api/virtual-sports/state")
  ).json();
  expect(settled.bets).toHaveLength(15);
  expect(settled.bets.filter((b: any) => b.status === "won")).toHaveLength(5);
  expect(settled.bets.every((b: any) => b.status !== "pending")).toBe(true);
  expect(settled.account.balance).toBe(
    8500 + settled.bets.reduce((n: number, b: any) => n + b.payout, 0),
  );
  await expect(page.getByTestId("sports-result")).toBeVisible();
  await page.getByRole("button", { name: "Bet history", exact: true }).click();
  await expect(page.getByTestId("sports-bet")).toHaveCount(3);
  await page.screenshot({
    path: "tmp/virtual-sports/settlement.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("a lost bet response is reconciled without a second deduction and offline betting is disabled", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Graphics quality" })
    .selectOption("balanced");
  let state = await (
    await page.request.get("/api/virtual-sports/state")
  ).json();
  if (
    state.rounds[0].phase !== "betting" ||
    state.rounds[0].closes - state.serverTime < 10000
  )
    await page.waitForTimeout(state.rounds[0].next - state.serverTime + 300);
  let posts = 0;
  await page.route("**/api/virtual-sports/bets", async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("connectionreset");
  });
  await expect(
    page.getByRole("button", { name: "Select Emerald FC", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Select Emerald FC", exact: true })
    .click();
  await page.getByTestId("sports-place").click();
  await expect(page.getByTestId("sports-balance")).toHaveText("9,900 coins");
  await expect(page.getByTestId("sports-bet")).toHaveCount(1);
  expect(posts).toBe(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("arena:pending-bet:v1")),
  ).toBeNull();
  await page.route("**/api/virtual-sports/state", (route) =>
    route.abort("internetdisconnected"),
  );
  await expect(page.getByTestId("sports-place")).toHaveText("Connecting…");
  await expect(page.getByTestId("sports-place")).toBeDisabled();
  await page.unroute("**/api/virtual-sports/state");
  await expect(page.getByTestId("sports-balance")).toHaveText("9,900 coins");
});
