import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

async function openTable(page: Page) {
  let socket: WebSocketRoute;
  const requests: string[] = [];
  const config = {
    enabled: true,
    maxMultiplier: 40,
    minStakePaise: "1000",
    maxStakePaise: "10000000",
    maxBetsPerDeal: 10,
    decks: 1,
    bettingWindowMs: 60000,
    revealDurationMs: 9000,
    settleDurationMs: 5000,
    payouts: {
      playerA: 1.98,
      playerB: 1.98,
      tie: 40,
      pairPlus: { pair: 2, color: 4, sequence: 6, pureSequence: 10, trail: 30 },
    },
  };
  const now = Date.now();
  const outcome = {
    handACards: [0, 13, 26],
    handBCards: [9, 24, 38],
    handA: { category: "trail", score: 6 },
    handB: { category: "highCard", score: 1 },
    winner: "playerA",
  };
  let snapshot = {
    roundId: "102261021130740",
    gameCode: "teen-patti",
    phase: "betting",
    now,
    bettingEndsAt: now + 60000,
    revealEndsAt: now + 69000,
    settleEndsAt: now + 74000,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    outcome: null as typeof outcome | null,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [],
    recent: ["A", "B", "A", "A", "A", "B", "A", "B", "A", "A"].map(
      (side, index) => ({
        roundId: String(index),
        outcome: { ...outcome, winner: side === "A" ? "playerA" : "playerB" },
        settledAt: null,
      }),
    ),
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.op === "subscribe")
        ws.send(JSON.stringify({ op: "subscribed", topic: message.topic }));
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (route.request().method() === "POST") {
      requests.push(path);
      return route.fulfill({ status: 400, json: { detail: "Test only" } });
    }
    if (path === "/api/auth/me")
      body = {
        id: "tp2020-ui",
        email: "ui@example.test",
        displayName: "Demo",
        role: "player",
      };
    else if (path === "/api/teen-patti/config" || path.includes("/config/"))
      body = config;
    else if (path === "/api/teen-patti/round")
      body = { ...snapshot, now: Date.now() };
    else if (path.includes("/wallet/"))
      body = { balance: "150000", currency: "INR", scope: "teen-patti" };
    else if (path.endsWith("/recent") || path === "/api/game/registry")
      body = [];
    await route.fulfill({ json: body });
  });
  await page.goto("/teen-patti");
  await expect(page.getByTestId("spot-playerA")).toBeEnabled();
  return {
    requests,
    reveal() {
      snapshot = {
        ...snapshot,
        phase: "reveal",
        outcome,
        bettingEndsAt: Date.now(),
        revealEndsAt: Date.now() + 9000,
      };
      for (const payload of [
        {
          type: "phase",
          roundId: snapshot.roundId,
          phase: "reveal",
          endsAt: snapshot.revealEndsAt,
          ts: Date.now(),
          serverSeedHash: "test",
          clientSeed: "test",
          nonce: 1,
        },
        {
          type: "result",
          roundId: snapshot.roundId,
          outcome,
          serverSeed: "test",
        },
      ])
        socket.send(
          JSON.stringify({
            op: "event",
            topic: "table-rounds:teen-patti",
            payload,
          }),
        );
    },
  };
}

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 1000 },
  { width: 1440, height: 1000 },
]) {
  test(`20/20 card table and markets fit ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const round = await openTable(page);
    await expect(page).toHaveURL(/\/teen-patti$/);
    await expect(page.locator(".tp2020-card-stage video")).toHaveCount(0);
    const markets = page.getByTestId("tp2020-markets");
    await expect(markets.locator("tbody tr")).toHaveCount(6);
    const unavailable = markets.getByRole("button", { name: /Unavailable/ });
    await expect(unavailable).toHaveCount(8);
    for (const button of await unavailable.all())
      await expect(button).toBeDisabled();
    await expect(page.getByTestId("spot-playerA")).toHaveText("1.98");
    await expect(page.getByTestId("spot-pairPlusB")).toHaveText("B");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    for (const spot of [
      "playerA",
      "playerB",
      "pairPlusA",
      "pairPlusB",
      "tie",
    ]) {
      const box = await page.getByTestId("spot-" + spot).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({
      path: info.outputPath("teen-patti-2020-open.png"),
      fullPage: true,
    });
    await page.getByTestId("spot-playerA").click();
    await expect(page.getByTestId("chipstack-playerA")).toBeVisible();
    await page.getByTestId("btn-undo").click();
    await expect(page.getByTestId("chipstack-playerA")).toHaveCount(0);
    expect(round.requests).toHaveLength(0);
    round.reveal();
    await expect(page.getByTestId("spot-playerA")).toBeDisabled();
    await expect(page.getByTestId("spot-playerA").locator("svg")).toBeVisible();
    await expect(
      page.locator(".tp2020-cards > [data-testid^='card-']"),
    ).toHaveCount(6);
    await expect(page.getByTestId("text-result-winner")).toContainText(
      "Player A",
    );
    await page.locator(".tp20-topbar").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Coin and sound settings" }).click();
    await expect(page.getByTestId("coin-settings-dialog")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
