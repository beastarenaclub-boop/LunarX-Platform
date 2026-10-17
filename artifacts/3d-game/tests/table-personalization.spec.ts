import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { MyBet } from "../src/components/table/useTableRound";

test.beforeEach(async ({ page }) => {
  // Source edits in another local task must not reload a measured round.
  await page.routeWebSocket(url => url.searchParams.has("token"), ws => ws.onMessage(() => {}));
});

type Game = "lucky-7" | "teen-patti-live";
const games: Game[] = ["lucky-7", "teen-patti-live"];
const teenOutcome = {
  handACards: [0, 13, 26],
  handBCards: [9, 24, 38],
  handA: { category: "trail", score: 6 },
  handB: { category: "highCard", score: 1 },
  winner: "playerA",
};
async function table(
  page: Page,
  game: Game,
  userId = "coins-customer",
  reducedMotion = true,
  hidePendingBets = false,
) {
  const lucky = game === "lucky-7";
  let outcome = lucky ? { dice: [3, 4], total: 7 } : teenOutcome;
  const previous = lucky
    ? { dice: [1, 4], total: 5 }
    : {
        ...teenOutcome,
        winner: "playerB",
        handACards: teenOutcome.handBCards,
        handBCards: teenOutcome.handACards,
        handA: teenOutcome.handB,
        handB: teenOutcome.handA,
      };
  const config = {
    enabled: true,
    houseEdge: 0.03,
    maxMultiplier: 1000,
    minStakePaise: "0",
    maxStakePaise: "10000000",
    bettingWindowMs: 60000,
    revealDurationMs: 5000,
    settleDurationMs: 20000,
    maxBetsPerRound: 10,
    decks: 1,
    payouts: lucky
      ? { under: 2, exactly: 12, over: 2 }
      : {
          playerA: 1.95,
          playerB: 1.95,
          tie: 876,
          pairPlus: {
            pair: 2,
            color: 5,
            sequence: 7,
            pureSequence: 31,
            trail: 36,
          },
        },
  };
  const now = Date.now();
  let snapshot = {
    roundId: "personal-round",
    gameCode: game,
    phase: "betting",
    now,
    bettingEndsAt: now + 60000,
    revealEndsAt: now + 65000,
    settleEndsAt: now + 85000,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    outcome: null as unknown,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [] as MyBet[],
    recent: [{ roundId: "old-result", outcome: previous, settledAt: null }],
  };
  let socket: WebSocketRoute;
  const submissions: { bets: { type: string; amountPaise: string }[] }[] = [];
  await page.emulateMedia({
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await page.addInitScript(() =>
    !localStorage.getItem("aviator:v1") &&
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage(() => {});
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/auth/me")
      body = {
        id: userId,
        displayName: "Test customer",
        email: "coins@example.test",
        role: "player",
      };
    else if (url.pathname === `/api/${game}/config`) body = config;
    else if (url.pathname === `/api/${game}/round`)
      body = {
        ...snapshot,
        now: Date.now(),
        myBets: hidePendingBets
          ? snapshot.myBets.filter((b) => b.status !== "pending")
          : snapshot.myBets,
      };
    else if (url.pathname === `/api/${game}/bet`) {
      const request = route.request().postDataJSON();
      submissions.push(request);
      const slipId = `slip-${submissions.length}`,
        totalStake = request.bets
          .reduce(
            (sum: bigint, bet: { amountPaise: string }) =>
              sum + BigInt(bet.amountPaise),
            0n,
          )
          .toString();
      snapshot.myBets.push({
        slipId,
        totalStake,
        bets: request.bets,
        status: "pending",
        payoutAmount: "0",
        auditRoundId: null,
      });
      body = { slipId, totalStake, roundId: snapshot.roundId };
    } else if (url.pathname.includes("/wallet/"))
      body = { balance: "10000000", currency: "INR", scope: game };
    else if (
      url.pathname.includes("/recent") ||
      url.pathname.includes("/registry")
    )
      body = [];
    else if (url.pathname.includes("/config")) body = config;
    await route.fulfill({ json: body });
  });
  await page.goto(`/${game}`);
  await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
    "data-round-id",
    "old-result",
  );
  const emit = (payload: object) =>
    socket.send(
      JSON.stringify({ op: "event", topic: `table-rounds:${game}`, payload }),
    );
  const phase = () =>
    emit({
      type: "phase",
      roundId: snapshot.roundId,
      phase: snapshot.phase,
      endsAt:
        snapshot.phase === "reveal"
          ? snapshot.revealEndsAt
          : snapshot.phase === "settling"
            ? snapshot.settleEndsAt
            : snapshot.bettingEndsAt,
      ts: Date.now(),
      serverSeedHash: "test",
      clientSeed: "test",
      nonce: 1,
    });
  return {
    submissions,
    reveal(duration = 700, result = outcome) {
      outcome = result;
      snapshot = {
        ...snapshot,
        phase: "reveal",
        outcome,
        bettingEndsAt: Date.now(),
        revealEndsAt: Date.now() + duration,
        settleEndsAt: Date.now() + duration + 20000,
      };
      phase();
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome,
        serverSeed: "test",
      });
    },
    settle(
      mode: "partial" | "win" | "push" | "loss" | "refund" | "mixed" = "win",
      notify = true,
    ) {
      snapshot = {
        ...snapshot,
        phase: "settling",
        settleEndsAt: Date.now() + 20000,
        myBets: snapshot.myBets.map((b, i) => ({
          ...b,
          status:
            mode === "refund"
              ? "refunded"
              : mode === "partial" && i > 0
                ? "pending"
                : "settled",
          payoutAmount:
            mode === "loss" ||
            ((mode === "partial" || mode === "mixed") && i > 0)
              ? "0"
              : mode === "push" || mode === "refund"
                ? b.totalStake
                : (
                    (BigInt(b.totalStake) * BigInt(lucky ? 1200 : 195)) /
                    100n
                  ).toString(),
        })),
      };
      phase();
      if (notify) emit({ type: "settled", roundId: snapshot.roundId });
    },
    repeatSettlement() {
      emit({ type: "settled", roundId: snapshot.roundId });
    },
    closeBetting(remainingMs = 100) {
      snapshot = { ...snapshot, bettingEndsAt: Date.now() + remainingMs };
      phase();
    },
    next() {
      snapshot = {
        ...snapshot,
        roundId: "next-round",
        phase: "betting",
        outcome: null,
        myBets: [],
        bettingEndsAt: Date.now() + 60000,
        recent: [
          { roundId: "personal-round", outcome, settledAt: null },
          ...snapshot.recent,
        ],
      };
      phase();
    },
  };
}
const rack = (page: Page) => page.locator('[data-testid^="chip-rack"]:visible');
const settings = (page: Page) =>
  page.locator('[data-testid="coin-settings-button"]:visible');
const bet = (page: Page, game: Game) =>
  page.getByTestId(game === "lucky-7" ? "spot-exactly" : "spot-playerA");

test("shared sound controls persist across Lucky 7 and Teen Patti", async ({ page }) => {
  await table(page, "lucky-7");
  await settings(page).click();
  await page.getByRole("checkbox", { name: "Sound, coins & win celebration" }).check();
  const master = page.getByRole("slider", { name: "Master volume", exact: true });
  await master.focus();
  await master.press("Home");
  await master.press("ArrowRight");
  await expect(master).toHaveValue("5");
  await page.getByTestId("coin-settings-save").click();
  await table(page, "teen-patti-live");
  await settings(page).click();
  await expect(page.getByRole("checkbox", { name: "Sound, coins & win celebration" })).toBeChecked();
  await expect(page.getByRole("slider", { name: "Master volume", exact: true })).toHaveValue("5");
  await page.getByRole("checkbox", { name: "Sound, coins & win celebration" }).uncheck();
  await page.getByTestId("coin-settings-save").click();
  await table(page, "lucky-7");
  await settings(page).click();
  await expect(page.getByRole("checkbox", { name: "Sound, coins & win celebration" })).not.toBeChecked();
});

for (const enabled of [true, false]) {
  test(`win coin sound ${enabled ? "plays once" : "respects mute"} after final settlement`, async ({ page }) => {
    const round = await table(page, "lucky-7");
    await settings(page).click();
    await page.getByRole("checkbox", { name: "Sound, coins & win celebration" }).setChecked(enabled);
    await page.getByTestId("coin-settings-save").click();
    await page.evaluate(async () => {
      const path = "/src/game/audio.ts";
      const { sfx } = await import(/* @vite-ignore */ path);
      (window as any).winCues = 0;
      sfx.winCelebration = () => { (window as any).winCues++; };
    });
    await bet(page, "lucky-7").click();
    await expect.poll(() => round.submissions.length).toBe(1);
    await bet(page, "lucky-7").click();
    await expect.poll(() => round.submissions.length).toBe(2);
    round.reveal();
    round.settle("partial");
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).winCues)).toBe(0);
    round.settle("win");
    await expect(page.getByTestId("round-win-dialog")).toBeVisible();
    expect(await page.evaluate(() => (window as any).winCues)).toBe(enabled ? 1 : 0);
    await page.getByTestId("round-win-ok").click();
    round.repeatSettlement();
    round.next();
    await expect(bet(page, "lucky-7")).toBeEnabled();
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).winCues)).toBe(enabled ? 1 : 0);
  });
}

for (const game of games) {
  test(`${game}: every bet remains tappable after selecting preset and custom coins on short phones`, async ({
    page,
  }, info) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 740, height: 360 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const round = await table(page, game);
      const spots =
        game === "lucky-7"
          ? ["under", "exactly", "over"]
          : ["playerA", "tie", "playerB", "pairPlusA", "pairPlusB"];
      if (game === "teen-patti-live") {
        await expect(page.getByTestId("text-tpl-balance")).toBeInViewport({
          ratio: 1,
        });
        await expect(
          page.getByRole("button", { name: "Audio settings", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        expect(
          await page
            .getByRole("heading", { level: 1 })
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      const assertTargets = async () => {
        for (const spot of spots) {
          const target = page.getByTestId(`spot-${spot}`);
          await expect(target).toBeInViewport({ ratio: 1 });
          expect(
            await target.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
          ).toBe(true);
        }
        expect(
          await page
            .locator("[data-live-bet-dock]:visible")
            .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        ).toBe(true);
      };
      await rack(page)
        .getByRole("button", { name: "₹500 coin", exact: true })
        .click();
      await assertTargets();
      await rack(page).getByRole("button", { name: "Custom amount" }).click();
      const amount = page.getByRole("dialog", { name: "Custom coin amount" });
      await amount.locator("input").fill("750");
      await amount.getByRole("button", { name: "Set amount" }).click();
      await expect(amount).toHaveCount(0);
      await assertTargets();
      await page.screenshot({
        path: info.outputPath(`bets-${viewport.width}.png`),
      });
      await bet(page, game).click();
      await expect.poll(() => round.submissions.length).toBe(1);
      expect(round.submissions[0].bets[0].amountPaise).toBe("75000");
      await expect(bet(page, game)).toBeEnabled();
      await assertTargets();
    }
  });

  test(`${game}: customer coin choices persist, cannot be empty, and never place a bet`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const round = await table(page, game);
    await rack(page).getByRole("button", { name: "Custom amount" }).click();
    await page
      .getByRole("dialog", { name: "Custom coin amount" })
      .locator("input")
      .fill("750");
    await page
      .getByRole("dialog", { name: "Custom coin amount" })
      .locator("input")
      .press("Enter");
    await expect(rack(page).getByRole("button", { name: "₹100 coin", exact: true })).toBeVisible();
    const defaultCoinCount = await rack(page).getByRole("button").count();
    await settings(page).click();
    const dialog = page.getByTestId("coin-settings-dialog");
    for (const value of [1000, 2000, 5000, 10000])
      await dialog
        .getByRole("checkbox", {
          name: `₹${value.toLocaleString("en-IN")} coin`,
          exact: true,
        })
        .click();
    await dialog
      .getByRole("checkbox", { name: "Show Any (custom amount)" })
      .uncheck();
    await page.screenshot({ path: info.outputPath("coin-settings-phone.png") });
    await page.getByTestId("coin-settings-save").click();
    await expect(rack(page).getByRole("button")).toHaveCount(2);
    await expect(
      rack(page).getByRole("button", { name: "₹100 coin", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await settings(page).click();
    for (const value of [100, 500])
      await dialog
        .getByRole("checkbox", { name: `₹${value} coin`, exact: true })
        .click();
    await expect(page.getByTestId("coin-settings-save")).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await expect(rack(page).getByRole("button")).toHaveCount(2);
    expect(round.submissions).toHaveLength(0);
    await rack(page)
      .getByRole("button", { name: "₹500 coin", exact: true })
      .click();
    await bet(page, game).click();
    round.closeBetting(3500);
    await expect.poll(() => round.submissions.length).toBe(1);
    expect(round.submissions[0].bets[0].amountPaise).toBe("50000");
    await table(page, game === "lucky-7" ? "teen-patti-live" : "lucky-7");
    await expect(rack(page).getByRole("button")).toHaveCount(2);
    await table(page, game, "different-customer");
    await expect(rack(page).getByRole("button")).toHaveCount(defaultCoinCount);
  });

  test(`${game}: only the last revealed result stays at the top through the next betting window`, async ({
    page,
  }) => {
    // Reduced motion deliberately lands immediately, so use the real visual
    // sequence when checking that a result stays hidden until it has landed.
    const round = await table(page, game, "coins-customer", false);
    if (game === "lucky-7")
      await expect(
        page.getByTestId("lucky7-dice"),
      ).toBeVisible();
    await expect(page.getByTestId("round-phase-banner")).toHaveCount(0);
    const banner = page.getByTestId("last-result-banner");
    const previous = await banner.textContent();
    round.reveal(3500);
    await expect(banner).toHaveText(previous!);
    await expect(banner).toHaveAttribute("data-round-id", "personal-round");
    round.settle(); // Spectator: no user slips and no win popup.
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    round.next();
    await expect(banner).toHaveAttribute("data-round-id", "personal-round");
    await expect(banner).not.toContainText(
      /place your bets|next round|dealing|rolling/i,
    );
  });

  test(`${game}: win popup waits for every settled slip, shows net win and closes once`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const round = await table(page, game);
    await rack(page).getByRole("button", { name: "₹100 coin", exact: true }).click();
    await bet(page, game).click();
    await expect.poll(() => round.submissions.length).toBe(1);
    await expect(bet(page, game)).toBeEnabled();
    await bet(page, game).click();
    await expect.poll(() => round.submissions.length).toBe(2);
    round.reveal();
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
      "data-round-id",
      "personal-round",
    );
    round.settle("partial");
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    round.settle("win");
    await expect(page.getByRole("dialog", { name: "You win!" })).toBeVisible();
    await expect(page.getByTestId("round-win-screen")).toBeVisible();
    await expect(page.getByTestId("round-win-profit")).toHaveText(
      game === "lucky-7" ? "+₹2,200.00" : "+₹190.00",
    );
    const ok = page.getByTestId("round-win-ok"),
      box = (await ok.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
    await page.screenshot({ path: info.outputPath("win-small-phone.png") });
    for (const viewport of [
      { width: 280, height: 480 },
      { width: 568, height: 280 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = (await ok.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      await expect(ok).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("round-win-profit")).toBeInViewport({
        ratio: 1,
      });
      await expect(page.getByTestId("round-win-payout")).toBeInViewport({
        ratio: 1,
      });
      expect(
        await page
          .getByTestId("round-win-dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`win-${viewport.width}.png`),
      });
    }
    // The round clock must not make an unread receipt disappear.
    round.next();
    await expect(page.getByTestId("round-win-dialog")).toBeVisible();
    await ok.click();
    round.repeatSettlement();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
      "data-round-id",
      "personal-round",
    );
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  });

  test(`${game}: a winning slip still gets a popup when another bet makes the round a net loss`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const round = await table(page, game);
    await rack(page).getByRole("button", { name: "₹100 coin", exact: true }).click();
    await bet(page, game).click();
    await expect.poll(() => round.submissions.length).toBe(1);
    await rack(page)
      .getByRole("button", { name: "₹2,000 coin", exact: true })
      .click();
    await page
      .getByTestId(game === "lucky-7" ? "spot-over" : "spot-playerB")
      .click();
    await expect.poll(() => round.submissions.length).toBe(2);
    round.reveal();
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
      "data-round-id",
      "personal-round",
    );
    round.settle("mixed");
    const popup = page.getByRole("dialog", { name: "Winning bet!" });
    await expect(popup).toBeVisible();
    await expect(page.getByTestId("round-win-payout")).toHaveText(
      game === "lucky-7" ? "₹1,200.00" : "₹195.00",
    );
    await expect(page.getByTestId("round-win-profit")).toHaveText(
      game === "lucky-7" ? "−₹900.00" : "−₹1,905.00",
    );
    await expect(popup).toContainText("Round net loss");
    await page.screenshot({ path: info.outputPath("mixed-win.png") });
    await page.setViewportSize({ width: 568, height: 280 });
    await expect(page.getByTestId("round-win-ok")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("round-win-profit")).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByTestId("round-win-payout")).toBeInViewport({
      ratio: 1,
    });
    await page.getByTestId("round-win-ok").click();
    round.repeatSettlement();
    await page.waitForTimeout(900);
    await expect(popup).toHaveCount(0);
  });

  test(`${game}: settlement phase recovers winning slips missing from earlier snapshots`, async ({
    page,
  }) => {
    const round = await table(
      page,
      game,
      "late-snapshot-customer",
      false,
      true,
    );
    await bet(page, game).click();
    await expect.poll(() => round.submissions.length).toBe(1);
    round.reveal(9000);
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
      "data-round-id",
      "personal-round",
      { timeout: 12000 },
    );
    // Real server: settling is broadcast before the final settled event.
    round.settle("win", false);
    await expect(page.getByRole("dialog", { name: "You win!" })).toBeVisible();
  });

  for (const mode of ["push", "loss", "refund"] as const)
    test(`${game}: ${mode} never shows a win popup`, async ({ page }) => {
      const round = await table(page, game);
      await bet(page, game).click();
      await expect.poll(() => round.submissions.length).toBe(1);
      round.reveal();
      await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
        "data-round-id",
        "personal-round",
      );
      round.settle(mode);
      await page.waitForTimeout(1000);
      await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    });
}

test("teen-patti-live: full dealer, every bet and every coin fit portrait and landscape browsers", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const sizes = [
    [320, 568],
    [360, 640],
    [375, 667],
    [390, 844],
    [412, 915],
    [430, 932],
    [600, 960],
    [768, 1024],
    [568, 320],
    [667, 375],
    [740, 360],
    [844, 390],
    [915, 412],
    [960, 540],
  ];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const round = await table(page, "teen-patti-live");
    await page.evaluate(() => window.scrollTo(0, 0));
    const board = page.getByTestId("teen-patti-table");
    const dock = page.getByTestId("tpl-betting-dock");
    await expect(board).toBeInViewport({ ratio: 1 });
    await expect(dock).toBeInViewport({ ratio: 1 });
    // Both the source picture and complete control rectangles must fit;
    // CSS visibility alone cannot catch a bottom bar hiding the dealer.
    await expect
      .poll(async () => {
        const a = (await board.boundingBox())!,
          b = (await dock.boundingBox())!;
        return a.y + a.height <= b.y + 1 || a.x + a.width <= b.x + 1;
      })
      .toBe(true);
    const video = await page.locator(".tpl-film-stage").boundingBox();
    expect(video!.y).toBeGreaterThanOrEqual(44);
    expect(video!.y + video!.height).toBeLessThanOrEqual(height);
    for (const id of ["playerA", "tie", "playerB", "pairPlusA", "pairPlusB"]) {
      const button = page.getByTestId(`spot-${id}`);
      await expect(button).toBeInViewport({ ratio: 1 });
      const r = (await button.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(
        await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return [0.25, 0.5, 0.75].every((x) =>
            [0.25, 0.5, 0.75].every((y) =>
              el.contains(
                document.elementFromPoint(
                  r.x + r.width * x,
                  r.y + r.height * y,
                ),
              ),
            ),
          );
        }),
      ).toBe(true);
    }
    for (const button of await rack(page).getByRole("button").all())
      await expect(button).toBeInViewport({ ratio: 1 });
    await expect(settings(page)).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if ([320, 390, 740, 844].includes(width))
      await page.screenshot({
        path: info.outputPath(`fit-betting-${width}.png`),
      });
    round.reveal();
    await expect(page.getByTestId("tpl-customer-view")).toBeVisible();
    await expect(board).toBeInViewport({ ratio: 1 });
    for (const card of await page.locator(".tpl-customer-card").all())
      await expect(card).toBeInViewport({ ratio: 1 });
    const film = (await page.locator(".tpl-film-stage").boundingBox())!;
    expect(film.y).toBeGreaterThanOrEqual(44);
    expect(film.y + film.height).toBeLessThanOrEqual(height);
    if ([320, 390, 740, 844].includes(width))
      await page.screenshot({
        path: info.outputPath(`fit-result-${width}.png`),
      });
  }
});

test("teen-patti-live: celebration respects reduced motion and OK works with keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const round = await table(
    page,
    "teen-patti-live",
    "celebration-player",
    false,
  );
  await bet(page, "teen-patti-live").click();
  await expect.poll(() => round.submissions.length).toBe(1);
  round.reveal(200);
  round.settle("win");
  const popup = page.getByTestId("round-win-dialog");
  await expect(popup).toBeVisible();
  await expect(page.getByTestId("round-win-ok")).toBeFocused();
  expect(
    await popup
      .locator(".round-win-confetti i")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await popup
      .locator(".round-win-confetti i")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
  expect(round.submissions).toHaveLength(1);
});

test("teen-patti-live: closing bets keeps the landscape dealer in place until cards arrive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  const round = await table(page, "teen-patti-live");
  const board = page.getByTestId("teen-patti-table");
  await expect(board).toBeInViewport({ ratio: 1 });
  const before = (await board.boundingBox())!;
  round.closeBetting();
  await expect(bet(page, "teen-patti-live")).toHaveCount(0);
  await expect(board).toBeInViewport({ ratio: 1 });
  const after = (await board.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  round.reveal();
  await expect(page.getByTestId("tpl-customer-view")).toBeVisible();
  await expect(board).toBeInViewport({ ratio: 1 });
});

for (const winner of ["playerA", "playerB", "tie"] as const) {
  test(`teen-patti-live: ${winner} result appears visibly inside the table without a wager`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const round = await table(page, "teen-patti-live", "spectator", false);
    const board = page.getByTestId("teen-patti-table");
    const popup = board.getByTestId("tpl-table-result");
    await expect(popup).toHaveCount(0);
    const deal =
      winner === "playerA"
        ? teenOutcome
        : winner === "playerB"
          ? {
              ...teenOutcome,
              winner,
              handACards: teenOutcome.handBCards,
              handBCards: teenOutcome.handACards,
              handA: teenOutcome.handB,
              handB: teenOutcome.handA,
            }
          : {
              ...teenOutcome,
              winner,
              handACards: [0, 8, 3],
              handBCards: [13, 21, 16],
              handA: { category: "highCard", score: 1 },
              handB: { category: "highCard", score: 1 },
            };
    round.reveal(winner === "playerA" ? 9000 : 2500, deal);
    await page.waitForTimeout(500);
    await expect(popup).toHaveCount(0);
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute(
      "data-round-id",
      "personal-round",
      { timeout: 12000 },
    );
    await expect(board.getByTestId("badge-deal-winner")).toBeVisible();
    await expect(popup).toBeVisible({ timeout: 12000 });
    await expect(popup.getByRole("heading")).toHaveText(
      winner === "tie"
        ? "Tie"
        : `Player ${winner === "playerA" ? "A" : "B"} wins`,
    );
    await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
    await expect(page.getByTestId("round-win-profit")).toHaveCount(0);
    for (const camera of ["dealer", "cards", "auto"]) {
      await page.getByTestId(`tpl-camera-${camera}`).click();
      await expect(popup).toBeVisible();
    }
    for (let i = 0; i < 6; i++)
      await expect(page.getByTestId(`tpl-customer-card-${i}`)).toHaveAttribute(
        "data-face-up",
        "true",
      );
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [568, 320],
      [844, 390],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(popup).toBeInViewport({ ratio: 1 });
      const a = (await board.boundingBox())!,
        b = (await popup.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(a.x);
      expect(b.y).toBeGreaterThanOrEqual(a.y);
      expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width);
      expect(b.y + b.height).toBeLessThanOrEqual(a.y + a.height);
      await expect(page.getByTestId("tpl-result-ok")).toBeInViewport({
        ratio: 1,
      });
      expect(
        await page.getByTestId("tpl-result-ok").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      ).toBe(true);
      if (winner === "playerA")
        await page.screenshot({
          path: info.outputPath(`table-winner-${width}.png`),
        });
    }
    await page.getByTestId("tpl-result-ok").click();
    round.repeatSettlement();
    await page.waitForTimeout(300);
    await expect(popup).toHaveCount(0);
    round.next();
    await expect(bet(page, "teen-patti-live")).toBeEnabled();
    await expect(board.getByRole("dialog")).toHaveCount(0);
    expect(round.submissions).toHaveLength(0);
  });
}

test("teen-patti-live: payout opens a game popup and stays readable through the next bet", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const round = await table(page, "teen-patti-live", "table-winner", false);
  const board = page.getByTestId("teen-patti-table");
  await rack(page).getByRole("button", { name: "₹100 coin", exact: true }).click();
  await bet(page, "teen-patti-live").click();
  await expect.poll(() => round.submissions.length).toBe(1);
  round.reveal(9000);
  await expect(board.getByTestId("tpl-table-result")).toBeVisible();
  round.settle("win");
  const popup = page.getByRole("dialog", { name: "You win!" });
  await expect(popup).toBeVisible();
  await expect(board.getByTestId("tpl-table-result")).toHaveCount(0);
  await expect(popup.getByTestId("round-win-profit")).toHaveText("+₹95.00");
  await page.screenshot({ path: info.outputPath("table-you-win-phone.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(popup).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("table-you-win-desktop.png") });
  round.next();
  await expect(popup).toBeVisible();
  await popup.getByTestId("round-win-ok").click();
  await expect(popup).toHaveCount(0);
  await expect(bet(page, "teen-patti-live")).toBeEnabled();
});
