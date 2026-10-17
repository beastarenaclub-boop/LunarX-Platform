import { test, expect, type WebSocketRoute } from "@playwright/test";

for (const game of ["lucky-7", "teen-patti-live"]) {
  test(`${game}: settled winnings remain visible across the next round and fullscreen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false } })));
    let socket: WebSocketRoute;
    await page.routeWebSocket("**/*", ws => {
      if (new URL(ws.url()).pathname === "/ws") socket = ws;
      ws.onMessage(() => {});
    });
    const now = Date.now();
    const config = { enabled: true, bettingWindowMs: 60000, revealDurationMs: 1000, settleDurationMs: 20000,
      minStakePaise: "1000", maxStakePaise: "10000000", payouts: { under: 2, exactly: 12, over: 2,
        playerA: 1.95, playerB: 1.95, tie: 876, pairPlus: { pair: 2, color: 5, sequence: 7, pureSequence: 31, trail: 36 } } };
    const outcome = game === "lucky-7" ? { dice: [3, 4], total: 7 } : {
      handACards: [0, 13, 26], handBCards: [9, 24, 38], handA: { category: "trail", score: 6 }, handB: { category: "highCard", score: 1 }, winner: "playerA" };
    let snapshot = { roundId: "winning-round", gameCode: game, phase: "betting", now, bettingEndsAt: now + 60000,
      revealEndsAt: now + 61000, settleEndsAt: now + 81000, config, serverSeedHash: "test", clientSeed: "test", nonce: 1,
      outcome: null as unknown, serverSeed: null, totalStake: "10000", playerCount: 1, liveBets: [], recent: [],
      myBets: [{ slipId: "winning-slip", totalStake: "10000", bets: [{ type: game === "lucky-7" ? "exactly" : "playerA", amountPaise: "10000" }], status: "pending", payoutAmount: "0", auditRoundId: null }] };
    await page.route("**/api/**", async route => {
      const p = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (p === "/api/auth/me") json = { id: "popup-player", email: "popup@example.test", displayName: "Popup", role: "player" };
      else if (p === `/api/${game}/round`) json = { ...snapshot, now: Date.now() };
      else if (p.includes("/config")) json = config;
      else if (/recent|registry/.test(p)) json = [];
      else if (p.includes("/wallet/")) json = { balance: "1000000", currency: "INR", scope: "lunar" };
      await route.fulfill({ json });
    });
    await page.goto(`/${game}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("last-result-banner")).toBeVisible();
    await expect.poll(() => !!socket!).toBe(true);
    const emit = (payload: object) => socket!.send(JSON.stringify({ op: "event", topic: `table-rounds:${game}`, payload }));
    const phase = (name: string, endsAt: number) => emit({ type: "phase", roundId: snapshot.roundId, phase: name, endsAt,
      serverSeedHash: "test", clientSeed: "test", nonce: 1, ts: Date.now() });
    snapshot = { ...snapshot, phase: "reveal", outcome, bettingEndsAt: Date.now(), revealEndsAt: Date.now() + 1000 };
    phase("reveal", snapshot.revealEndsAt);
    emit({ type: "result", roundId: snapshot.roundId, outcome, serverSeed: "test" });
    await expect(page.getByTestId("last-result-banner")).toHaveAttribute("data-round-id", "winning-round", { timeout: 15000 });
    snapshot = { ...snapshot, phase: "settling", settleEndsAt: Date.now() + 20000,
      myBets: snapshot.myBets.map(bet => ({ ...bet, status: "settled", payoutAmount: "120000" })) };
    phase("settling", snapshot.settleEndsAt);
    emit({ type: "settled", roundId: snapshot.roundId });
    const popup = page.getByTestId("round-win-dialog");
    await expect(popup).toBeVisible();
    await expect(page.getByTestId("round-win-profit")).toContainText("1,100.00");
    snapshot = { ...snapshot, roundId: "next-round", phase: "betting", outcome: null, myBets: [], bettingEndsAt: Date.now() + 60000 };
    phase("betting", snapshot.bettingEndsAt);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId("round-win-ok")).toBeInViewport({ ratio: 1 });
    await page.locator("[data-game-viewport]").evaluate(element => element.requestFullscreen());
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement?.querySelector('[data-testid="round-win-dialog"]'))).toBe(true);
    await expect(page.getByTestId("round-win-ok")).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => document.exitFullscreen());
    await page.getByTestId("round-win-ok").click();
    await expect(popup).toHaveCount(0);
    await expect(page.locator('[data-game-coin]:visible').first()).toBeEnabled();
  });
}
