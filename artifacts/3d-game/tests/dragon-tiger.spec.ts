import { expect, test, type Page } from "@playwright/test";
import type { TableSnapshot } from "../src/components/dragonTiger/useDragonTiger";

function initial(): TableSnapshot {
  const now = Date.now();
  return {
    serverNow: now,
    mode: "wallet",
    online: 8,
    round: {
      id: 1024,
      phase: "betting",
      closesAt: now + 20000,
      revealsAt: now + 23000,
      endsAt: now + 29000,
    },
    player: { balance: 10000, net: 0, wins: 0, played: 0, rank: null },
    myBet: null,
    lastResult: null,
    leaderboard: [
      { userId: "a", name: "Arjun", net: 2450, wins: 12, played: 19, rank: 1 },
      { userId: "b", name: "Zoya", net: 1800, wins: 9, played: 16, rank: 2 },
      { userId: "c", name: "Kabir", net: 1250, wins: 8, played: 15, rank: 3 },
      { userId: "d", name: "Meera", net: 650, wins: 5, played: 12, rank: 4 },
    ],
    history: Array.from({ length: 24 }, (_, i) => ({
      id: 1023 - i,
      dragon: 0,
      tiger: 1,
      winner: (
        ["dragon", "tiger", "dragon", "dragon", "tie", "tiger"] as const
      )[i % 6],
    })),
  };
}

async function setup(
  page: Page,
  reducedMotion: "reduce" | "no-preference" = "reduce",
) {
  let snapshot = initial();
  let offline = false;
  let posts = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(
    () =>
      !localStorage.getItem("aviator:v1") &&
      localStorage.setItem(
        "aviator:v1",
        JSON.stringify({ settings: { onboarded: true, sound: false } }),
      ),
  );
  await page.routeWebSocket("**/ws", (ws) => ws.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/dragon-tiger/")) {
      // Keep the mock betting window open while layout checks run, including cold Vite loads.
      if (snapshot.round.phase === "betting") {
        snapshot.round.closesAt = Date.now() + 20000;
        snapshot.round.revealsAt = Date.now() + 23000;
        snapshot.round.endsAt = Date.now() + 29000;
      }
      if (offline) {
        await route.fulfill({
          status: 503,
          json: { detail: "Temporarily unavailable" },
        });
        return;
      }
      if (path.endsWith("/bet")) {
        posts++;
        const { roundId, spots } = route.request().postDataJSON();
        expect(roundId).toBe(snapshot.round.id);
        const stake = spots.dragon + spots.tiger + spots.tie;
        snapshot = {
          ...snapshot,
          player: {
            ...snapshot.player,
            balance: snapshot.player.balance - stake,
          },
          myBet: { spots, stake, payout: null },
        };
      }
      await route.fulfill({ json: { ...snapshot, serverNow: Date.now() } });
      return;
    }
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "dt-test",
        displayName: "You",
        email: "dt@example.test",
        role: "player",
      };
    else if (path.includes("/registry")) body = [];
    else if (path.includes("/config")) body = { enabled: false };
    await route.fulfill({ json: body });
  });
  await page.goto("/dragon-tiger");
  await expect(page.getByTestId("dt-balance")).toContainText("10,000");
  return {
    errors,
    posts: () => posts,
    update: (next: TableSnapshot) => {
      snapshot = next;
    },
    snapshot: () => snapshot,
    offline: () => {
      offline = true;
    },
  };
}

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["tablet", 768, 1024],
  ["phone", 390, 844],
  ["small-phone", 320, 568],
  ["landscape", 844, 390],
] as const) {
  test(`${name}: every control stays in the table, no overflow, bets work`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    await expect(page.getByTestId("dt-card-dragon")).toHaveAttribute(
      "aria-label",
      "Dragon card: face down",
    );
    await expect(
      page.getByRole("img", {
        name: "Zara, the AI dealer in the Dragon Tiger gold and teal studio",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("dt-studio")).toHaveAttribute(
      "data-mode",
      "poster",
    );
    const coinFace = page.getByTestId("chip-dt-100").locator(":scope > span");
    const coinBounds = await coinFace.boundingBox();
    expect(coinBounds!.width).toBeGreaterThanOrEqual(44);
    expect(coinBounds!.height).toBe(coinBounds!.width);
    expect(
      await coinFace.evaluate((el) =>
        parseFloat(getComputedStyle(el).borderRadius),
      ),
    ).toBeGreaterThanOrEqual(coinBounds!.width / 2);
    await page.getByRole("button", { name: "Custom amount" }).click();
    await page.getByTestId("chip-dt-custom-input").fill("50");
    await page.getByTestId("chip-dt-custom-apply").click();
    await page.getByTestId("dt-bet-dragon").click();
    await page.getByTestId("dt-bet-tiger").click();
    await expect(page.getByTestId("dt-total")).toContainText("100");
    await page.getByRole("button", { name: "Undo last chip" }).click();
    await expect(page.getByTestId("dt-total")).toContainText("50");
    await page.getByRole("button", { name: "2×", exact: true }).click();
    await expect(page.getByTestId("dt-total")).toContainText("100");
    const table = page.getByTestId("dt-table");
    const bounds = await table.boundingBox();
    const board = await page.getByTestId("dt-live-leaderboard").boundingBox();
    expect(board!.y).toBeLessThan(height);
    await expect(
      page.getByRole("heading", { name: "Live leaderboard" }),
    ).toBeVisible();
    if (width <= 900) {
      const cards = await page.getByTestId("dt-card-dragon").boundingBox();
      expect(board!.y + board!.height).toBeLessThan(cards!.y);
      await expect(
        page.getByRole("button", { name: "Expand leaderboard" }),
      ).toBeVisible();
    }
    for (const control of [
      "dt-bet-dragon",
      "dt-bet-tiger",
      "dt-bet-tie",
      "dt-confirm",
      "dt-balance",
      "dt-dealer-scene",
      "chip-rack-dt",
    ]) {
      const box = await page.getByTestId(control).boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width + 1,
      );
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        bounds!.y + bounds!.height + 1,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Adjacent chip buttons must not be covered by edit actions on the smallest phone.
    await page.getByRole("button", { name: "1,000 chip", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "1,000 chip", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: `../../tmp/dragon-tiger-${name}.png`,
      fullPage: true,
    });
    await page.getByTestId("dt-confirm").click();
    await expect(page.getByTestId("dt-confirm")).toContainText("Bet confirmed");
    await expect(page.getByTestId("dt-balance")).toContainText("9,900");
    await expect(page.getByTestId("dt-bet-dragon")).toBeDisabled();
    await page.reload();
    await expect(page.getByTestId("dt-confirm")).toContainText("Bet confirmed");
    expect(state.posts()).toBe(1);
    expect(state.errors).toEqual([]);
  });
}

test("settlement reveals cards, updates balance and announces a new live leader", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "100 chip", exact: true }).click();
  await page.getByTestId("dt-bet-tie").click();
  await page.getByTestId("dt-confirm").click();
  await expect(page.getByTestId("dt-balance")).toContainText("9,900");
  const s = state.snapshot();
  state.update({
    ...s,
    round: {
      ...s.round,
      phase: "result",
      dragon: 12,
      tiger: 25,
      winner: "tie",
    },
    myBet: { ...s.myBet!, payout: 1200 },
    player: { balance: 11100, net: 1100, wins: 1, played: 1, rank: 3 },
    lastResult: { roundId: s.round.id, stake: 100, payout: 1200 },
    leaderboard: [
      { userId: "b", name: "Zoya", net: 3000, wins: 10, played: 17, rank: 1 },
      ...s.leaderboard
        .filter((p) => p.userId !== "b")
        .map((p, i) => ({ ...p, rank: i + 2 })),
    ],
  });
  await expect(
    page.getByText("Zoya takes the lead!").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByTestId("dt-card-dragon")).toHaveAttribute(
    "aria-label",
    "Dragon card: K♠",
  );
  await expect(page.getByTestId("dt-card-tiger")).toHaveAttribute(
    "aria-label",
    "Tiger card: K♥",
  );
  await expect(page.getByTestId("dt-card-comparison")).toContainText("K = K");
  await expect(page.locator(".dt-card-won")).toHaveCount(2);
  await expect(page.getByTestId("dt-balance")).toContainText("11,100");
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  await expect(page.getByTestId("round-win-profit")).toHaveText("+\u20b91,100.00");
  await expect(page.getByTestId("round-win-payout")).toHaveText("\u20b91,200.00");
  await page.screenshot({
    path: "../../tmp/dragon-tiger-result.png",
    fullPage: true,
  });
  await page.getByTestId("round-win-ok").click();
  await page.reload();
  await expect(page.getByTestId("dt-balance")).toContainText("11,100");
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
});

test("round changes clear draft chips, repeat needs confirmation, disconnect pauses betting", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "100 chip", exact: true }).click();
  await page.getByTestId("dt-bet-dragon").click();
  await page.getByTestId("dt-confirm").click();
  await expect(page.getByTestId("dt-confirm")).toContainText("Bet confirmed");
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, id: 1025 },
    myBet: null,
  });
  await expect(page.getByTestId("dt-total")).toContainText("0");
  await page.getByRole("button", { name: "Repeat previous bet" }).click();
  await expect(page.getByTestId("dt-total")).toContainText("100");
  expect(state.posts()).toBe(1);
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, id: 1026 },
  });
  await expect(page.getByTestId("dt-total")).toHaveText("0 chips");
  state.offline();
  await expect(page.getByText(/Connection interrupted/)).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("dt-bet-dragon")).toBeDisabled();
  await expect(page.getByTestId("dt-confirm")).toBeDisabled();
  expect(state.posts()).toBe(1);
});

test("shared coins respect the table cap without erasing larger coins", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("table-coins:v3:dt-test", JSON.stringify({ values: [100, 10000], showCustom: false })));
  await setup(page);
  const rack = page.getByTestId("chip-rack-dt");
  await expect(rack.getByRole("button")).toHaveCount(1);
  await expect(rack.getByRole("button", { name: "100 chip", exact: true })).toBeVisible();
  await page.getByTestId("coin-settings-button").click();
  const dialog = page.getByTestId("coin-settings-dialog");
  await expect(dialog.getByRole("checkbox", { name: "10,000 chip", exact: true })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "500 chip", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "100 chip", exact: true }).click();
  await page.getByTestId("coin-settings-save").click();
  await expect(rack.getByRole("button")).toHaveCount(1);
  await expect(rack.getByRole("button", { name: "500 chip", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("table-coins:v3:dt-test")!))).toEqual({ values: [500, 10000], showCustom: false });
});

for (const payout of [0, 50, 100]) {
  test(`return of ${payout} chips on a 100-chip bet does not show a win popup`, async ({ page }) => {
    const state = await setup(page);
    const snapshot = state.snapshot();
    state.update({ ...snapshot,
      round: { ...snapshot.round, phase: "result", dragon: 0, tiger: 13, winner: "tie" },
      myBet: { spots: { dragon: 100, tiger: 0, tie: 0 }, stake: 100, payout },
      lastResult: { roundId: snapshot.round.id, stake: 100, payout },
    });
    await expect(page.getByTestId("dragon-tiger-page")).toHaveAttribute("data-phase", "result");
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  });
}

test("rules, chip limits and empty leaderboard are usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await setup(page);
  await page.getByRole("button", { name: "Expand leaderboard" }).click();
  await expect(page.getByText("Meera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse leaderboard" }).click();
  state.update({ ...state.snapshot(), leaderboard: [] });
  await expect(page.getByText("No leader yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand leaderboard" }).click();
  await expect(page.getByText("Be the first on the board")).toBeVisible();
  await page.getByRole("button", { name: "Collapse leaderboard" }).click();
  await page.getByTestId("btn-game-rules").click();
  await expect(page.getByRole("region", { name: "How to play" })).toContainText(
    "half of any Dragon or Tiger stake",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "1,000 chip", exact: true }).click();
  for (let i = 0; i < 6; i++) await page.getByTestId("dt-bet-dragon").click();
  await expect(page.getByTestId("dt-total")).toHaveText("5,000 chips");
  await expect(page.getByRole("alert")).toContainText("Maximum 5,000");
  await page.getByRole("button", { name: "Clear chips" }).click();
  await expect(page.getByTestId("dt-confirm")).toBeDisabled();
  expect(state.posts()).toBe(0);
});

test("Full HD dealer videos follow bets and replay but keep hands at rest on results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, "no-preference");
  const studio = page.getByTestId("dt-studio");
  const take = page.getByTestId("dt-dealer-video");
  const idle = page.getByTestId("dt-dealer-idle");
  await expect(studio).toHaveAttribute("data-reaction", "invite");
  await expect(take).toHaveAttribute("src", /zara-hd-invite/);
  await expect
    .poll(() => take.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(1920);
  expect(await take.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(
    1080,
  );
  await expect
    .poll(() => take.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await take.evaluate((v: HTMLVideoElement) => v.playsInline && v.muted),
  ).toBe(true);
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await expect(studio.locator("canvas, svg")).toHaveCount(0);
  await page.getByTestId("dt-bet-dragon").click();
  await expect(studio).toHaveAttribute("data-reaction", "dragon");
  await expect(take).toHaveAttribute("src", /zara-hd-dragon/);
  // Read decoded video frames to verify visible hand motion, not just a changing label.
  const difference = await take.evaluate(async (video: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext("2d")!;
    video.pause();
    const frame = async (time: number) => {
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.currentTime = time;
      });
      ctx.drawImage(video, 0, 0, 480, 270);
      return ctx.getImageData(145, 130, 185, 90).data;
    };
    const first = await frame(0.1),
      next = await frame(2);
    let changed = 0;
    for (let i = 0; i < first.length; i += 4)
      if (
        Math.abs(first[i] - next[i]) +
          Math.abs(first[i + 1] - next[i + 1]) +
          Math.abs(first[i + 2] - next[i + 2]) >
        30
      )
        changed++;
    await video.play();
    return changed;
  });
  expect(difference).toBeGreaterThan(150);
  await take.evaluate((v) => v.setAttribute("data-same-take", "yes"));
  await page.getByTestId("dt-bet-dragon").click();
  await expect(take).toHaveAttribute("data-same-take", "yes");
  await page.getByTestId("dt-bet-tiger").click();
  await expect(studio).toHaveAttribute("data-reaction", "tiger");
  await expect(take).toHaveAttribute("src", /zara-hd-tiger/);
  await page.getByTestId("dt-bet-tie").click();
  await expect(studio).toHaveAttribute("data-reaction", "tie");
  await expect(take).toHaveAttribute("src", /zara-hd-both/);
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, phase: "dealing" },
  });
  await expect(studio).toHaveAttribute("data-reaction", "deal");
  await expect(page.getByTestId("dt-card-dragon")).toHaveAttribute(
    "aria-label",
    "Dragon card: face down",
  );
  // Exercise the browser's real end event and handover to a looping idle take.
  await take.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15;
  });
  await expect(studio).toHaveAttribute("data-mode", "idle");
  await expect
    .poll(() =>
      idle.evaluate(
        (v: HTMLVideoElement) => !v.paused && v.loop && v.videoHeight === 1080,
      ),
    )
    .toBe(true);
  await page.getByTestId("dt-dealer-react").click();
  await expect(studio).toHaveAttribute("data-reaction", "deal");
  // A result must cancel the active gesture and never offer a winner replay.
  for (const result of [
    { dragon: 8, tiger: 3, winner: "dragon", comparison: "9 > 4" },
    { dragon: 3, tiger: 8, winner: "tiger", comparison: "4 < 9" },
    { dragon: 8, tiger: 21, winner: "tie", comparison: "9 = 9" },
  ] as const) {
    const { comparison, ...cards } = result;
    state.update({
      ...state.snapshot(),
      round: { ...state.snapshot().round, phase: "result", ...cards },
    });
    await expect(page.getByTestId("dt-card-comparison")).toContainText(comparison);
    await expect(studio).toHaveAttribute("data-mode", "idle");
    await expect(studio).toHaveAttribute("data-reaction", "rest");
    await expect(take).toHaveCount(0);
    await expect(page.getByTestId("dt-dealer-react")).toBeDisabled();
    await expect(page.getByTestId("dt-dealer-react")).not.toContainText("Tap to react");
  }
  state.update({
    ...state.snapshot(),
    round: { ...initial().round, id: 1025 },
  });
  await expect(studio).toHaveAttribute("data-reaction", "invite");
  await idle.dispatchEvent("error");
  await take.dispatchEvent("error");
  await expect(studio).toHaveAttribute("data-mode", "poster");
  await expect(studio.locator("img")).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("dealer replay plays one native take with reduced motion and data saver", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    }),
  );
  await setup(page);
  const studio = page.getByTestId("dt-studio");
  await expect(studio).toHaveAttribute("data-mode", "poster");
  await expect(studio.locator("video")).toHaveCount(0);
  await page.getByTestId("dt-dealer-react").click();
  await expect(studio).toHaveAttribute("data-mode", "animating");
  const take = page.getByTestId("dt-dealer-video");
  await expect
    .poll(() => take.evaluate((v: HTMLVideoElement) => v.videoHeight))
    .toBe(1080);
  await expect(page.getByTestId("dt-dealer-idle")).toHaveCount(0);
  await take.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15;
  });
  await expect(studio).toHaveAttribute("data-mode", "poster");
  await expect(studio.locator("video")).toHaveCount(0);
});

test("dealer pauses in a hidden tab and resumes idle without replaying the invitation", async ({
  page,
}) => {
  await setup(page, "no-preference");
  await expect(page.getByTestId("dt-studio")).toHaveAttribute(
    "data-reaction",
    "invite",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("dt-dealer-video")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByTestId("dt-dealer-idle")
        .evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("dt-studio")).toHaveAttribute(
    "data-mode",
    "idle",
  );
  await expect
    .poll(() =>
      page
        .getByTestId("dt-dealer-idle")
        .evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
  await expect(page.getByTestId("dt-dealer-video")).toHaveCount(0);
});

test("shared coin settings persist and custom practice amounts respect table limits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await setup(page);
  await page
    .getByRole("button", { name: "Coin settings", exact: true })
    .click();
  const settings = page.getByTestId("coin-settings-dialog");
  await expect(
    settings.getByRole("checkbox", { name: "10,000 chip", exact: true }),
  ).toHaveCount(0);
  await settings
    .getByRole("checkbox", { name: "200 chip", exact: true })
    .click();
  await page.getByTestId("coin-settings-save").click();
  await expect(page.getByTestId("chip-dt-200")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("dt-balance")).toContainText("10,000");
  await expect(page.getByTestId("chip-dt-200")).toHaveCount(0);
  await page.getByRole("button", { name: "Custom amount" }).click();
  const input = page.getByTestId("chip-dt-custom-input");
  const apply = page.getByTestId("chip-dt-custom-apply");
  await expect(
    page.getByText("Amount in chips", { exact: true }),
  ).toBeVisible();
  for (const amount of ["9", "5001", "50.5", "251"]) {
    await input.fill(amount);
    await expect(apply).toBeDisabled();
  }
  await input.fill("250");
  await apply.click();
  await page.getByTestId("dt-bet-tiger").click();
  await expect(page.getByTestId("dt-total")).toHaveText("250 chips");
  expect(state.posts()).toBe(0);
  expect(state.errors).toEqual([]);
});

test("data saver keeps the new dealer poster without downloading the video", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    }),
  );
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "media") mediaRequests.push(request.url());
  });
  await setup(page, "no-preference");
  await expect(page.getByTestId("dt-studio")).toHaveAttribute(
    "data-mode",
    "poster",
  );
  await expect(page.getByTestId("dt-dealer-video")).toHaveCount(0);
  await expect(page.getByTestId("dt-studio").locator("img")).toHaveAttribute(
    "src",
    /zara-studio-poster/,
  );
  expect(mediaRequests).toEqual([]);
});

for (const [width, height] of [
  [280, 653],
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [393, 851],
  [412, 915],
  [430, 932],
  [540, 720],
  [844, 390],
  [932, 430],
] as const) {
  test(`phone ${width}×${height}: dealer and betting stay in view with touch-sized controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    await page.evaluate(() => scrollTo(0, 0));
    const controls = page.locator("[data-live-bet-dock] button");
    for (const button of await controls.all()) {
      const box = await button.boundingBox();
      expect(
        box,
        (await button.getAttribute("aria-label")) ?? "table control",
      ).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(
        box!.y + box!.height,
        (await button.getAttribute("data-testid")) ?? "table control",
      ).toBeLessThanOrEqual(height + 1);
    }
    const scene = (await page.getByTestId("dt-dealer-scene").boundingBox())!;
    expect(scene.height).toBeGreaterThanOrEqual(110);
    expect(scene.y + scene.height).toBeLessThan(height);
    const dealer = page.getByTestId("dt-studio").locator("img");
    await expect(dealer).toHaveAttribute("src", /zara-studio-poster/);
    expect(
      await dealer.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    ).toBe(true);
    for (const side of ["dragon", "tiger"]) {
      const card = (await page.getByTestId(`dt-card-${side}`).boundingBox())!;
      expect(card.x).toBeGreaterThanOrEqual(scene.x);
      expect(card.y).toBeGreaterThanOrEqual(scene.y);
      expect(card.y + card.height).toBeLessThanOrEqual(scene.y + scene.height);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../tmp/dt-responsive-${width}x${height}.png`,
      fullPage: true,
    });
    await page.getByTestId("chip-dt-500").click();
    await page.getByTestId("dt-bet-dragon").click();
    await expect(page.getByTestId("dt-total")).toHaveText("500 chips");
    expect(state.posts()).toBe(0);
    expect(state.errors).toEqual([]);
  });
}

test("rotation, text zoom and leaderboard expansion keep betting reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "100 chip", exact: true }).click();
  await page.getByTestId("dt-bet-tiger").click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId("dt-total")).toHaveText("100 chips");
  await page.getByRole("button", { name: "Expand leaderboard" }).click();
  await expect(page.getByText("Meera", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse leaderboard" }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });
  await page
    .getByRole("button", { name: "Coin settings", exact: true })
    .click();
  const dialog = page.getByTestId("coin-settings-dialog");
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.getByTestId("coin-settings-save").click();
  await page.getByTestId("dt-confirm").click();
  await expect(page.getByTestId("dt-confirm")).toContainText("Bet confirmed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const [dragon, tiger, winner, ranks, comparison] of [
  [8, 16, "dragon", ["9", "4"], "9 > 4"],
  [0, 51, "tiger", ["A", "K"], "A < K"],
] as const) {
  test(`higher card determines the visible winner: ${comparison}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const state = await setup(page);
    state.update({
      ...state.snapshot(),
      round: { ...state.snapshot().round, phase: "dealing" },
    });
    await expect(page.getByTestId("dragon-tiger-page")).toHaveAttribute(
      "data-phase",
      "dealing",
    );
    await expect(page.getByTestId("dt-card-dragon")).toHaveAttribute(
      "aria-label",
      "Dragon card: face down",
    );
    await expect(page.getByTestId("dt-card-comparison")).toHaveText("VS");
    state.update({
      ...state.snapshot(),
      round: {
        ...state.snapshot().round,
        phase: "result",
        dragon,
        tiger,
        winner,
      },
    });
    await expect(page.getByTestId("dt-card-comparison")).toContainText(
      comparison,
    );
    await expect(page.getByTestId("dt-card-rank-dragon")).toHaveText(ranks[0]);
    await expect(page.getByTestId("dt-card-rank-tiger")).toHaveText(ranks[1]);
    // Text/ARIA can exist behind a flattened 3D back. Check the painted face.
    for (const side of ["dragon", "tiger"]) {
      await expect
        .poll(() =>
          page.getByTestId(`dt-card-${side}`).evaluate((card) => {
            const box = card.getBoundingClientRect();
            return !!document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.closest(".dt-card-face");
          }),
        )
        .toBe(true);
    }
    await expect(page.locator(".dt-card-won")).toHaveCount(1);
    await expect(
      page.locator(".dt-card-won").getByTestId(`dt-card-${winner}`),
    ).toBeVisible();
    await expect(page.locator(".dt-round-status")).toContainText(
      winner === "dragon" ? "Dragon wins" : "Tiger wins",
    );
    await expect(page.locator(".dt-round-status")).toContainText("A = 1");
    const button = (await page.getByTestId("dt-confirm").boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(568);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../tmp/dt-card-result-${winner}.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  });
}

async function meterGameAudio(page: Page) {
  await page.addInitScript(() => {
    const audit = window as unknown as {
      dtMeters: AnalyserNode[];
      dtPeak: number;
      dtShortStarts: number;
      dtVoices: {
        source: AudioBufferSourceNode;
        offset: number;
        stopped: boolean;
      }[];
    };
    audit.dtMeters = [];
    audit.dtVoices = [];
    audit.dtPeak = 0;
    audit.dtShortStarts = 0;
    const sample = () => {
      for (const meter of audit.dtMeters) {
        const values = new Float32Array(meter.fftSize);
        meter.getFloatTimeDomainData(values);
        const rms = Math.sqrt(
          values.reduce((sum, n) => sum + n * n, 0) / values.length,
        );
        audit.dtPeak = Math.max(audit.dtPeak, rms);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args: unknown[]) {
      const result = (connect as Function).apply(this, args);
      if (args[0] instanceof AudioDestinationNode) {
        const meter = this.context.createAnalyser();
        meter.fftSize = 1024;
        connect.call(this, meter);
        audit.dtMeters.push(meter);
      }
      return result;
    } as typeof connect;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<typeof start>
    ) {
      if (this.buffer && this.buffer.duration > 0 && this.buffer.duration < 2)
        audit.dtShortStarts++;
      if (
        this.buffer &&
        this.buffer.duration > 7.9 &&
        this.buffer.duration < 8.2
      ) {
        audit.dtVoices.push({
          source: this,
          offset: args[1] ?? 0,
          stopped: false,
        });
      }
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (
      ...args: Parameters<typeof stop>
    ) {
      const record = audit.dtVoices.find((record) => record.source === this);
      if (record) record.stopped = true;
      return stop.apply(this, args);
    };
    // Reproduce phones rejecting audible media autoplay.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted)
        return Promise.reject(
          new DOMException("Audible autoplay blocked", "NotAllowedError"),
        );
      return play.call(this);
    };
  });
}
async function outputLevel(page: Page) {
  return page.evaluate(() =>
    Math.max(
      0,
      ...(window as unknown as { dtMeters: AnalyserNode[] }).dtMeters.map(
        (meter) => {
          const samples = new Float32Array(meter.fftSize);
          meter.getFloatTimeDomainData(samples);
          return Math.sqrt(
            samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
          );
        },
      ),
    ),
  );
}
async function activeVoices(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as { dtVoices: { stopped: boolean }[] }
      ).dtVoices.filter((voice) => !voice.stopped).length,
  );
}

test("sound on replays an ended invitation with measurable audio despite blocked media autoplay", async ({
  page,
}) => {
  await meterGameAudio(page);
  const state = await setup(page, "no-preference");
  const studio = page.getByTestId("dt-studio");
  const take = page.getByTestId("dt-dealer-video");
  await expect(studio).toHaveAttribute("data-reaction", "invite");
  await take.evaluate((video: HTMLVideoElement) => {
    video.currentTime = video.duration - 0.1;
  });
  await expect(studio).toHaveAttribute("data-mode", "idle");
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  // No separate dealer replay tap should be necessary to hear her.
  await expect(studio).toHaveAttribute("data-reaction", "invite");
  await expect(
    page.getByRole("button", { name: "Mute game sounds" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => activeVoices(page)).toBe(1);
  await expect.poll(() => outputLevel(page)).toBeGreaterThan(0.01);
  expect(await take.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await take.evaluate((video: HTMLVideoElement) => video.pause());
  await expect.poll(() => activeVoices(page)).toBe(0);
  await take.evaluate(async (video: HTMLVideoElement) => {
    video.currentTime = 2.5;
    await video.play();
  });
  await expect.poll(() => activeVoices(page)).toBe(1);
  const offset = await page.evaluate(
    () =>
      (window as unknown as { dtVoices: { offset: number }[] }).dtVoices.at(-1)!
        .offset,
  );
  expect(offset).toBeGreaterThanOrEqual(2.5);
  expect(offset).toBeLessThan(2.8);
  await page.getByRole("button", { name: "Mute game sounds" }).click();
  await expect.poll(() => activeVoices(page)).toBe(0);
  await expect.poll(() => outputLevel(page)).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  await expect.poll(() => activeVoices(page)).toBe(1);
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, phase: "dealing" },
  });
  await expect(studio).toHaveAttribute("data-reaction", "deal");
  await expect.poll(() => activeVoices(page)).toBe(0);
  await expect.poll(() => outputLevel(page)).toBeLessThan(0.001);
  // Sound preference survives navigation/reload; the first table tap unlocks it.
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("aviator:v1")!).settings.sound,
      ),
    )
    .toBe(true);
  state.update({
    ...state.snapshot(),
    round: { ...initial().round, id: 1025 },
  });
  await page.reload();
  await expect(page.getByTestId("dt-balance")).toBeVisible();
  const unlockSpeaker = page.getByRole("button", {
    name: "Enable game sounds",
  });
  if (await unlockSpeaker.count()) {
    await unlockSpeaker.hover();
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
  } else {
    await page.getByTestId("chip-dt-500").click();
  }
  await expect(
    page.getByRole("button", { name: "Mute game sounds" }),
  ).toBeVisible();
  await expect.poll(() => activeVoices(page)).toBe(1);
  await expect.poll(() => outputLevel(page)).toBeGreaterThan(0.01);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => activeVoices(page)).toBe(0);
  expect(state.errors).toEqual([]);
});

test("mobile reduced motion keeps the poster while dealer voice and chip effects remain audible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await meterGameAudio(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({
        settings: {
          onboarded: true,
          sound: false,
          masterVolume: 0,
          sfxVolume: 0,
        },
      }),
    );
  });
  const state = await setup(page);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  await expect.poll(() => activeVoices(page)).toBe(1);
  await expect.poll(() => outputLevel(page)).toBeGreaterThan(0.01);
  await expect(page.getByTestId("dt-studio")).toHaveAttribute(
    "data-mode",
    "poster",
  );
  await expect(page.getByTestId("dt-studio").locator("video")).toHaveCount(0);
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, phase: "dealing" },
  });
  await expect(page.getByTestId("dragon-tiger-page")).toHaveAttribute(
    "data-phase",
    "dealing",
  );
  await expect.poll(() => activeVoices(page)).toBe(0);
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, phase: "betting" },
  });
  await expect(page.getByTestId("dt-bet-dragon")).toBeEnabled();
  await page.evaluate(() => {
    (window as unknown as { dtPeak: number }).dtPeak = 0;
  });
  const starts = await page.evaluate(
    () => (window as unknown as { dtShortStarts: number }).dtShortStarts,
  );
  await page.getByTestId("dt-bet-dragon").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { dtShortStarts: number }).dtShortStarts,
      ),
    )
    .toBeGreaterThan(starts);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { dtPeak: number }).dtPeak),
    )
    .toBeGreaterThan(0.001);
  const beforeConfirm = await page.evaluate(
    () => (window as unknown as { dtShortStarts: number }).dtShortStarts,
  );
  await page.getByTestId("dt-confirm").click();
  await expect(page.getByTestId("dt-confirm")).toContainText("Bet confirmed");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { dtShortStarts: number }).dtShortStarts,
      ),
    )
    .toBeGreaterThan(beforeConfirm);
  await page.getByRole("button", { name: "Mute game sounds" }).click();
  await expect.poll(() => activeVoices(page)).toBe(0);
  expect(state.errors).toEqual([]);
});

test("a slow dealer audio download cannot speak after betting closes", async ({
  page,
}) => {
  await meterGameAudio(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/zara-invitation-voice*.mp3", async (route) => {
    await gate;
    await route.continue();
  });
  const state = await setup(page, "no-preference");
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  state.update({
    ...state.snapshot(),
    round: { ...state.snapshot().round, phase: "dealing" },
  });
  await expect(page.getByTestId("dt-studio")).toHaveAttribute(
    "data-reaction",
    "deal",
  );
  const response = page.waitForResponse((r) =>
    /\/zara-invitation-voice[^/]*\.mp3$/.test(r.url()),
  );
  release();
  await response;
  // Decode and a late promise completion must not revive the disposed voice.
  await page.waitForTimeout(600);
  await expect.poll(() => activeVoices(page)).toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { dtVoices: unknown[] }).dtVoices.length,
    ),
  ).toBe(0);
  expect(state.errors).toEqual([]);
});
