import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { POKER_GAMES, type PokerTable } from "@workspace/api-zod/poker";

// This suite uses the running API, demo worker and actual automatic clocks.
// There are no intercepted requests, fabricated cards or accelerated timers.
for (const game of POKER_GAMES)
  test(`${game} accepts bets, reveals cards, settles and reopens for 20 seconds`, async ({
    context,
  }, testInfo) => {
    const login = await context.request.post("/api/auth/demo-login", {
      data: {},
      timeout: 75_000,
    });
    expect(login.status(), await login.text()).toBe(200);
    await context.addInitScript(() =>
      localStorage.setItem(
        "aviator:v1",
        JSON.stringify({ settings: { onboarded: true, sound: false } }),
      ),
    );

    try {
      // Each game gets its own session and active browser page. Concurrent tabs
      // compete for rendering during the short reveal windows on slower clients.
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let latest: PokerTable | undefined;
      const observed = new Map<number, Set<string>>();
      const openingSnapshots = new Map<number, PokerTable>();
      page.on("response", async (response) => {
        if (response.url().includes(`/api/poker/${game}/`) && response.ok()) {
          const state = (await response.json()) as PokerTable;
          if (!latest || state.serverNow >= latest.serverNow) latest = state;
          const phases = observed.get(state.round.id) ?? new Set<string>();
          phases.add(state.round.phase);
          observed.set(state.round.id, phases);
          if (
            state.round.phase === "betting" &&
            !openingSnapshots.has(state.round.id)
          ) {
            openingSnapshots.set(state.round.id, state);
          }
        }
      });
      await page.goto(`/${game}`);
      await expect(page.getByTestId("poker-page")).toBeVisible();
      expect(
        await page
          .locator(".pk-shell")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await expect
        .poll(
          () =>
            latest?.round.phase === "betting" &&
            latest.round.closesAt - latest.serverNow > 12_000,
          { timeout: 50_000 },
        )
        .toBe(true);
      const id = latest!.round.id;
      expect(latest!.round.closesAt - latest!.serverNow).toBeLessThanOrEqual(
        20_000,
      );
      expect(latest!.round.board.every((card) => card === null)).toBe(true);
      expect(latest!.round.nonce).toBeUndefined();
      await page.getByTestId("market-p0-back").click();
      const confirmation = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/poker/${game}/bet`) &&
          r.request().method() === "POST",
      );
      await page.getByTestId("poker-confirm").click();
      const accepted = await confirmation;
      expect(accepted.status(), await accepted.text()).toBe(200);
      const receipt = ((await accepted.json()) as PokerTable).slips[0];
      expect(receipt.stakePaise).toBe("10000");
      expect(receipt.payoutPaise).toBeNull();
      await page.locator(".pk-stage").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`${game}-betting.png`),
      });
      await expect(page.getByTestId("market-p0-back")).toBeDisabled({
        timeout: 25_000,
      });
      await expect(page.getByTestId("poker-result")).toBeVisible({
        timeout: 20_000,
      });
      expect(latest!.round.id).toBe(id);
      expect([...observed.get(id)!]).toEqual(
        expect.arrayContaining([
          "betting",
          "deal",
          "flop",
          "turn",
          "river",
          "result",
        ]),
      );
      expect(latest!.round.board.every((card) => Number.isInteger(card))).toBe(
        true,
      );
      expect(
        latest!.slips.find((s) => s.id === receipt.id)?.payoutPaise,
      ).toMatch(/^\d+$/);
      await expect(page.locator(".pk-seat-winner")).toHaveCount(
        latest!.round.outcome!.winners.length,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${game}-result.png`),
      });
      await page
        .getByRole("button", { name: "Round verification", exact: true })
        .click();
      await page.getByRole("button", { name: "Verify revealed cards" }).click();
      await expect(
        page.getByText("Verified: these cards match", { exact: false }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect
        .poll(
          () => [...openingSnapshots.keys()].some((roundId) => roundId > id),
          { timeout: 40_000 },
        )
        .toBe(true);
      // Read the first observed opening, even if screenshots/verification
      // took long enough for that betting window to finish in another tab.
      const next = [...openingSnapshots.values()].find(
        (state) => state.round.id > id,
      )!;
      const remaining = next.round.closesAt - next.serverNow;
      expect(remaining).toBeGreaterThan(18_000);
      expect(remaining).toBeLessThanOrEqual(20_000);
      await expect(page.getByTestId("market-p0-back")).toBeEnabled({
        timeout: 25_000,
      });
      expect(next.history.some((h) => h.id === id)).toBe(true);
      expect(errors).toEqual([]);
      const proofPath = testInfo.outputPath(`${game}-round.json`);
      await writeFile(
        proofPath,
        JSON.stringify(
          {
            game,
            roundId: id,
            phases: [...observed.get(id)!],
            receipt: next.recent.find((s) => s.id === receipt.id),
            nextBettingMilliseconds: remaining,
          },
          null,
          2,
        ),
      );
      await testInfo.attach(`${game}-round-proof`, {
        path: proofPath,
        contentType: "application/json",
      });
      // A poll response can still be reading its body after this game's
      // checks finish. Drain those listeners before closing its tab so the
      // other games can finish without an unhandled "page closed" error.
      await page.removeAllListeners("response", { behavior: "wait" });
      await page.close();
    } finally {
      await context.request.post("/api/auth/logout", { data: {} });
    }
  });
