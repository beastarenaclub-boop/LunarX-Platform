import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, version: 1 | 2 = 2) {
  const now = Date.now();
  const config = {
    ...(version === 2 ? { vegetableOutcomeVersion: version } : {}),
    outcomeVersion: version,
    enabled: true,
    minStakePaise: "100",
    maxStakePaise: "1000000",
    maxMultiplier: 20,
    houseEdge: 0.0567,
    bettingWindowMs: 20000,
    revealDurationMs: 18000,
    settleDurationMs: 5000,
  };
  const submissions: unknown[] = [];
  let balance = 100000n;
  let snapshot: any = {
    roundId: "vegetable-test-round",
    gameCode: "vegetable-bowl",
    phase: "betting",
    now,
    bettingEndsAt: now + 120000,
    revealEndsAt: now + 127000,
    settleEndsAt: now + 132000,
    serverSeedHash: "hash",
    clientSeed: "shared-harvest",
    nonce: 1,
    outcome: null,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [],
    recent: [
      {
        roundId: "previous",
        outcome: { total: 9, winner: "hard", vegetables: [] },
        settledAt: new Date().toISOString(),
      },
    ],
  };
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/*", (ws) =>
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.op === "subscribe")
        ws.send(JSON.stringify({ op: "subscribed", topic: m.topic }));
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "vegetable-test-player",
        email: "veggie@example.test",
        displayName: "Harvest",
        role: "player",
      };
    else if (path === "/api/vegetable-bowl/config") body = config;
    else if (path === "/api/vegetable-bowl/round")
      body = { ...snapshot, now: await page.evaluate(() => Date.now()) };
    else if (path === "/api/vegetable-bowl/bet") {
      const input = route.request().postDataJSON();
      submissions.push(input);
      const totalStake = input.bets.reduce(
        (sum: bigint, b: { amountPaise: string }) =>
          sum + BigInt(b.amountPaise),
        0n,
      );
      balance -= totalStake;
      snapshot.myBets.push({
        slipId: `slip-${submissions.length}`,
        bets: input.bets,
        status: "pending",
        totalStake: String(totalStake),
        payoutAmount: "0",
        auditRoundId: null,
      });
      body = {
        roundId: snapshot.roundId,
        slipId: `slip-${submissions.length}`,
      };
    } else if (path.includes("/wallet/"))
      body = { balance: balance.toString(), currency: "INR", scope: "lunar" };
    else if (path === "/api/game/registry") body = [];
    else if (path.includes("/config/")) body = { ...config, gameCode: "lunar" };
    await route.fulfill({ json: body });
  });
  await page.goto("/vegetable-bowl");
  await expect(page.locator(".vb-page")).toBeVisible({ timeout: 45000 });
  return {
    now,
    submissions,
    async nextRound(roundId: string) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        roundId,
        phase: "betting",
        outcome: null,
        myBets: [],
        bettingEndsAt: now + 120000,
        revealEndsAt: now + 138000,
        settleEndsAt: now + 143000,
      };
    },
    fillHistory() {
      snapshot.recent = Array.from({ length: 12 }, (_, index) => ({
        roundId: `past-${index}`,
        outcome: {
          total: index,
          winner: index === 0 ? "junk" : index < 7 ? "normal" : index === 7 ? "risk" : "hard",
          vegetables: [],
        },
        settledAt: new Date().toISOString(),
      }));
    },
    reveal(total: number, settled = false, animate = false) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        phase: settled ? "settling" : "reveal",
        bettingEndsAt: animate ? now : now - 18000,
        revealEndsAt: animate ? now + 18000 : now,
        settleEndsAt: now + 120000,
        outcome: {
          total,
          winner: total === 0 ? "junk" : total < 7 ? "normal" : total > 7 ? "hard" : "risk",
          ...(total === 0 ? { junk: ["stone", "boot", "can", "stone"] } : {}),
          vegetables: Array.from(
            { length: total },
            (_, i) =>
              ["carrot", "tomato", "broccoli", "pepper", "aubergine"][i % 5],
          ),
        },
        serverSeed: "test-seed",
      };
      if (settled)
        snapshot.myBets = snapshot.myBets.map((b: any) => ({
          ...b,
          status: "settled",
          payoutAmount: String(total === 0 ? 0n : BigInt(b.totalStake) * 20n),
        }));
    },
  };
}

test("shared coins stage one timed slip and preserve payout and collection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.clock.install();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const game = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "A bowlful of possibilities." }),
  ).toBeVisible();
  expect(game.submissions).toEqual([]);
  await page.getByTestId("chip-custom").click();
  await page.getByTestId("chip-custom-input").fill("1");
  await page.getByTestId("chip-custom-apply").click();
  await expect(page.getByTestId("vegetable-return")).toHaveText("₹1.98");
  await page.locator('[data-mode="hard"]').click();
  await expect(page.getByTestId("vegetable-return")).toHaveText("₹1.98");
  await page.locator('[data-mode="risk"]').click();
  await expect(page.getByTestId("vegetable-return")).toHaveText("₹20.00");
  await expect(page.getByTestId("vegetable-selected-total")).toHaveText("₹2.00");
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await expect(page.getByTestId("vegetable-selected-total")).toHaveText("₹0.00");
  await page.locator('[data-mode="risk"]').click();
  expect(game.submissions).toEqual([]);
  await page.clock.fastForward(Math.max(1, game.now + 118850 - await page.evaluate(() => Date.now())));
  await expect(
    page.getByText("₹1.00 bet placed.", { exact: true }),
  ).toBeVisible();
  expect(game.submissions).toEqual([
    {
      roundId: "vegetable-test-round",
      bets: [{ type: "risk", amountPaise: "100" }],
    },
  ]);
  await page.screenshot({
    path: "../../test-results/vegetable-desktop.png",
    fullPage: true,
  });
  game.reveal(7, true);
  await expect(page.getByTestId("vegetable-count")).toHaveText("07");
  await expect(page.getByText("Risk wins", { exact: true })).toBeVisible();
  await expect(page.locator('[data-mode="risk"]')).toBeDisabled();
  await expect(page.locator(".vb-produce.landed")).toHaveCount(7);
  await expect(page.locator(".vb-your-round")).toContainText("₹20.00");
  await page.screenshot({
    path: "../../test-results/vegetable-result.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("new backgrounds change on live rounds and survive refresh", async ({
  page,
}) => {
  test.setTimeout(150000);
  const game = await fixture(page);
  const background = page.getByTestId("harvest-background");
  await expect(background).toBeAttached();
  // Selection is saved per round so reconnecting does not change its scene.
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("vegetable-world-v1")),
    )
    .not.toBeNull();
  for (let round = 0; round < 3; round++) {
    const previous = await background.getAttribute("data-world");
    await game.nextRound(`fresh-harvest-${round}`);
    await expect(background).not.toHaveAttribute("data-world", previous!);
  }
  const lastWorld = await background.getAttribute("data-world");
  await page.reload();
  await expect(page.locator(".vb-page")).toBeVisible({ timeout: 45000 });
  await expect(background).toHaveAttribute("data-world", lastWorld!);
});

test("night scene and reduced-motion junk preserve the vegetable count", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "vegetable-world-v1",
      JSON.stringify({ roundId: "vegetable-test-round", index: 2 }),
    ),
  );
  const game = await fixture(page);
  await expect(page.getByTestId("harvest-background")).toHaveAttribute(
    "data-world",
    "night",
  );
  await page.screenshot({
    path: "../../test-results/vegetable-world-night-mobile.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  game.reveal(7, false, true);
  await expect(page.locator(".vb-junk.falling").first()).toBeAttached();
  await expect(page.getByTestId("vegetable-count")).toHaveText("07", {
    timeout: 22000,
  });
  await expect(page.locator(".vb-produce.landed")).toHaveCount(7);
  await expect(page.locator(".vb-junk.landed")).toHaveCount(0);
  await expect
    .poll(async () =>
      Number(
        await page.locator(".vb-harvest-svg").getAttribute("data-junk-dodged"),
      ),
    )
    .toBeGreaterThan(2);
});

test("bowl tracks vegetables falling from above over the full harvest", async ({
  page,
}) => {
  const game = await fixture(page);
  const bowl = page.getByTestId("moving-bowl");
  await expect(bowl).toBeVisible();
  const startX = await bowl.getAttribute("data-x");
  await expect.poll(() => bowl.getAttribute("data-x")).not.toBe(startX);
  game.reveal(7, false, true);
  const falling = page.locator('.falling[data-fall-index="1"]');
  await expect(falling).toBeAttached();
  const startY = Number(await falling.getAttribute("data-y"));
  await expect
    .poll(async () => Number(await falling.getAttribute("data-y")))
    .toBeGreaterThan(startY + 15);
  await expect(page.getByTestId("vegetable-count")).toHaveText("02");
  await expect(page.getByText("Risk wins", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../../test-results/vegetable-falling.png" });
  await expect(page.getByTestId("vegetable-count")).toHaveText("07", {
    timeout: 18000,
  });
  await expect(page.getByText("Risk wins", { exact: true })).toBeVisible();
  await expect(page.locator(".vb-produce.landed")).toHaveCount(7);
});

test("vegetable controls remain readable and reachable on small and rotated screens", async ({
  page,
}) => {
  const game = await fixture(page);
  game.fillHistory();
  await page.reload();
  await expect(page.locator(".vb-mode")).toHaveCount(3);
  await page.locator('[data-mode="normal"]').click();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 600],
    [1440, 900],
    [568, 280],
  ]) {
    await page.setViewportSize({ width, height });
    const controls = page.locator(
      ".vb-mode, .vb-coins [data-game-coin], .vb-coins [data-testid=coin-settings-button], .vb-auto-bet, .vb-auto-bet button",
    );
    expect(await controls.count()).toBeGreaterThan(4);
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 0.999 });
    }
    await expect.poll(async () => {
      const status = (await page.locator(".vb-auto-bet").boundingBox())!;
      const receipt = (await page.locator(".vb-your-round").boundingBox())!;
      return status.y + status.height <= receipt.y;
    }).toBe(true);
    await page.getByTestId("moving-bowl").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("moving-bowl")).toBeInViewport({
      ratio: 0.999,
    });
    await page.getByTestId("vegetable-junk-notice").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("vegetable-junk-notice")).toBeInViewport({ ratio: 0.999 });
    await expect
      .poll(async () => {
        const bowl = (await page.getByTestId("moving-bowl").boundingBox())!;
        const timer = (await page.locator(".vb-round-callout").boundingBox())!;
        return bowl.y + bowl.height <= timer.y + 1;
      })
      .toBe(true);
    const overflow = await page
      .locator("[data-game-viewport]")
      .evaluate((el) => ({
        x: el.scrollWidth > el.clientWidth,
        document: document.documentElement.scrollHeight > innerHeight,
      }));
    expect(overflow).toEqual({ x: false, document: false });
    await page.screenshot({
      path: `../../test-results/vegetable-fit-${width}x${height}.png`,
    });
  }
});

test("mobile layout, all three options and readable rules", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const game = await fixture(page);
  await expect(page.locator(".vb-mode")).toHaveCount(3);
  await expect(page.getByTestId("chip-100")).toBeEnabled();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Select coins");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../test-results/vegetable-mobile.png",
    fullPage: true,
  });
  await page.getByTestId("btn-game-rules").click();
  await expect(page.getByRole("dialog")).toContainText("₹1.98");
  await expect(page.getByRole("dialog")).toContainText("₹20");
  await expect(page.getByRole("dialog")).toContainText("4.48%");
  await expect(page.getByRole("dialog")).toContainText("5% chance");
  await expect(page.getByRole("dialog")).toContainText("89.61%");
  await page.getByRole("button", { name: "Got it" }).click();
  game.reveal(12, true);
  await expect(page.getByTestId("vegetable-count")).toHaveText("12");
  await expect(page.getByText("Hard wins", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`junk-only harvest catches objects, keeps count zero and has no winner (${reducedMotion})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const game = await fixture(page);
    await expect(page.getByTestId("vegetable-junk-notice")).toHaveText("5% Junk Bowl · All bets lose");
    game.reveal(0, false, true);
    await expect(page.getByTestId("vegetable-stage")).toHaveAttribute("data-junk-round", "true");
    await expect(page.locator(".vb-junk.landed").first()).toBeAttached();
    await expect(page.locator(".vb-round-callout")).toContainText("Catching junk");
    await expect(page.getByTestId("vegetable-count")).toHaveText("00");
    await expect(page.locator(".vb-produce")).toHaveCount(0);
    await expect(page.locator(".vb-junk.landed")).toHaveCount(4, { timeout: 22000 });
    await expect(page.locator(".vb-round-callout")).toContainText("Junk Bowl · No winners");
    await expect(page.locator(".vb-round-callout")).toContainText("All bets return ₹0");
    await expect(page.locator(".vb-harvest-svg")).toHaveAttribute("data-junk-dodged", "0");
    await expect(page.getByText(/^(Normal|Hard|Risk) wins$/)).toHaveCount(0);
    game.reveal(0, true);
    await page.reload();
    await expect(page.locator(".vb-junk.landed")).toHaveCount(4);
    await expect(page.getByTestId("vegetable-count")).toHaveText("00");
    await page.screenshot({ path: `../../test-results/vegetable-junk-${reducedMotion}.png` });
    await game.nextRound("after-junk");
    await expect(page.locator(".vb-junk.landed")).toHaveCount(0);
    await expect(page.locator(".vb-round-callout")).toContainText("Harvest begins in");
    expect(errors).toEqual([]);
  });
}

test("legacy rounds display their original chances until the next round", async ({ page }) => {
  await fixture(page, 1);
  await expect(page.getByTestId("vegetable-junk-notice")).not.toContainText("All bets lose");
  await page.getByTestId("btn-game-rules").click();
  await expect(page.getByRole("dialog")).toContainText("4.72%");
  await expect(page.getByRole("dialog")).toContainText("94.33%");
  await expect(page.getByRole("dialog")).not.toContainText("5% chance");
});
