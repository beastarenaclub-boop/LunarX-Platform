import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

const outcome = {
  handACards: [0, 13, 26],
  handBCards: [9, 24, 38],
  handA: { category: "trail", score: 6 },
  handB: { category: "highCard", score: 1 },
  winner: "playerA",
};
async function table(
  page: Page,
  options: { late?: boolean; remaining?: number } = {},
) {
  let socket: WebSocketRoute;
  const now = Date.now();
  const config = {
    enabled: true,
    houseEdge: 0.03,
    maxMultiplier: 50,
    minStakePaise: "1000",
    maxStakePaise: "10000000",
    bettingWindowMs: 20000,
    revealDurationMs: 9000,
    settleDurationMs: 5000,
    decks: 1,
    maxBetsPerRound: 10,
    payouts: {
      playerA: 1.97,
      playerB: 1.97,
      tie: 40,
      pairPlus: { pair: 2, color: 4, sequence: 6, pureSequence: 10, trail: 30 },
    },
  };
  let snapshot = {
    roundId: "reference-round-1",
    gameCode: "teen-patti-live",
    phase: options.late ? "reveal" : "betting",
    now,
    bettingEndsAt: now + (options.remaining ?? 20000),
    revealEndsAt: options.late ? now + 150 : now + 29000,
    settleEndsAt: now + 34000,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    outcome: options.late ? outcome : null,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [],
    recent: [
      {
        roundId: "previous-round",
        outcome: { ...outcome, winner: "playerB" },
        settledAt: new Date(now - 34000).toISOString(),
      },
    ],
  };
  let snapshotDelivered = false;
  const requests: {
    roundId: string;
    bets: { type: string; amountPaise: string }[];
  }[] = [];
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.op === "subscribe")
        ws.send(JSON.stringify({ op: "subscribed", topic: m.topic }));
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "reference-test",
        email: "reference@example.test",
        displayName: "Player",
        role: "player",
      };
    else if (
      path === "/api/teen-patti-live/config" ||
      path.includes("/config/")
    )
      body = config;
    else if (path === "/api/teen-patti-live/round") {
      if (!snapshotDelivered) {
        const deliveredAt = Date.now();
        snapshot = {
          ...snapshot,
          now: deliveredAt,
          bettingEndsAt: deliveredAt + (options.remaining ?? 20000),
          revealEndsAt: deliveredAt + (options.late ? 150 : 29000),
          settleEndsAt: deliveredAt + 34000,
        };
        snapshotDelivered = true;
      }
      body = { ...snapshot, now: Date.now() };
    } else if (path === "/api/teen-patti-live/bet") {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      body = {
        slipId: `slip-${requests.length}`,
        roundId: payload.roundId,
        totalStake: payload.bets
          .reduce(
            (sum: bigint, bet: { amountPaise: string }) =>
              sum + BigInt(bet.amountPaise),
            0n,
          )
          .toString(),
      };
    } else if (path.includes("/wallet/"))
      body = { balance: "1000000", currency: "INR", scope: "teen-patti-live" };
    else if (
      path === "/api/teen-patti-live/recent" ||
      path === "/api/game/registry"
    )
      body = [];
    await route.fulfill({ json: body });
  });
  await page.goto("/teen-patti-live");
  await expect(page.getByTestId("tpl-flat-table")).toBeVisible();
  const emit = (payload: object) =>
    socket.send(
      JSON.stringify({
        op: "event",
        topic: "table-rounds:teen-patti-live",
        payload,
      }),
    );
  return {
    requests,
    reveal(remaining = 9000) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        phase: "reveal",
        bettingEndsAt: now,
        revealEndsAt: now + remaining,
        outcome,
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "reveal",
        endsAt: snapshot.revealEndsAt,
        ts: now,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 1,
      });
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome,
        serverSeed: "test",
      });
    },
    repeat() {
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome,
        serverSeed: "test",
      });
    },
    next() {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        roundId: "reference-round-2",
        phase: "betting",
        bettingEndsAt: now + 20000,
        revealEndsAt: now + 29000,
        outcome: null,
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "betting",
        endsAt: snapshot.bettingEndsAt,
        ts: now,
        serverSeedHash: "next",
        clientSeed: "test",
        nonce: 2,
      });
    },
  };
}

test("approved reference footage plays with live IST time and server cards before announcing the winner", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1642, height: 950 });
  const errors: string[] = [],
    videoRequests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\.(mp4|webm)(\?|$)/.test(r.url())) videoRequests.push(r.url());
  });
  const round = await table(page);
  const dealer = page.getByTestId("tp20-dealer-video");
  const camera = await page.locator(".tp20-camera").boundingBox();
  expect(Math.abs(camera!.width / camera!.height - 1036 / 586)).toBeLessThan(
    0.03,
  );
  await expect(dealer).toHaveAttribute(
    "src",
    /\/reference-sequential(?:-mobile)?-v4\.mp4$/,
  );
  await expect
    .poll(() =>
      dealer.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await dealer.evaluate(
      (element: HTMLVideoElement) => element.muted && !element.controls,
    ),
  ).toBe(true);
  const mediaTime = await dealer.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  await expect
    .poll(() =>
      dealer.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(mediaTime);
  await expect(page.getByTestId("teen-patti-table")).toHaveAttribute(
    "data-presentation",
    "reference-dealer-footage",
  );
  await expect(page.getByTestId("tp20-history")).toHaveText("B");
  await expect(page.getByTestId("tp20-paytable")).toContainText("30.00×");
  const time = page.getByTestId("tp20-table-clock").locator("time");
  const first = await time.textContent();
  await expect.poll(() => time.textContent()).not.toBe(first);
  const expected = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await expect(time).toContainText(expected);
  await page.getByTestId("chip-100").click();
  await page.getByTestId("spot-playerA").click();
  await expect(page.getByTestId("tp20-felt-playerA")).toHaveText("100");
  await page.screenshot({
    path: info.outputPath("desktop-betting.png"),
    fullPage: true,
  });
  round.reveal();
  await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
  await expect(page.getByTestId("spot-playerA")).toBeDisabled();
  for (const [step, index] of [0, 3, 1, 4, 2, 5].entries()) {
    await expect(
      page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
    ).toHaveCount(step + 1);
    await expect(page.getByTestId(`tp20-readout-${index}`)).toHaveAttribute(
      "data-face-up",
      "true",
    );
    await expect(page.getByTestId(`tp20-table-card-${index}`)).toHaveAttribute(
      "data-face-up",
      "true",
    );
    if (step < 5)
      await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
    if (step === 1) {
      round.repeat();
      await page.screenshot({
        path: info.outputPath("two-cards-open.png"),
        fullPage: true,
      });
    }
  }
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.locator(".tp20-camera .tp20-physical-card")).toHaveCount(0);
  expect(
    await page
      .locator('.tp20-hand-readout svg[data-face-up="true"]')
      .evaluateAll((cards) =>
        cards.map((card) => Number(card.getAttribute("data-card-value"))),
      ),
  ).toEqual([...outcome.handACards, ...outcome.handBCards]);
  await expect(page.getByTestId("badge-deal-winner")).toBeVisible({
    timeout: 12000,
  });
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("tp20-readout-0")).toHaveAttribute(
    "aria-label",
    "A♠",
  );
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await page.getByTestId("tpl-result-ok").click();
  round.repeat();
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("desktop-result.png"),
    fullPage: true,
  });
  round.next();
  await expect(page.getByTestId("spot-playerA")).toBeEnabled();
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(videoRequests.length).toBeGreaterThan(0);
  expect(
    videoRequests.every((url) =>
      /reference-sequential(?:-mobile)?-v4\.mp4/.test(url),
    ),
  ).toBe(true);
});

test("late join and reduced motion finish without replaying a deal", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => null,
    }),
  );
  await table(page, { late: true });
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  expect(
    await page
      .getByTestId("tp20-dealer-video")
      .evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true);
});

test("real opening hands cover the small felt cards without runtime pixel processing", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    CanvasRenderingContext2D.prototype.getImageData = () => {
      throw new Error("No runtime hand processing");
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const round = await table(page);
  const video = page.getByTestId("tp20-dealer-video");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((el) => {
    el.dataset.seekCount = "0";
    el.addEventListener("seeking", () => {
      el.dataset.seekCount = String(Number(el.dataset.seekCount) + 1);
    });
  });
  round.reveal();
  await expect(video).toHaveAttribute("data-motion", "opening");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(18.3);
  await expect
    .poll(() =>
      page.locator(".tp20-felt-cards clipPath path").getAttribute("d"),
    )
    .not.toBe("M0,0H1036V586H0Z");
  await expect(page.getByTestId("tp20-readout-0")).toHaveAttribute(
    "data-face-up",
    "true",
  );
  await page.screenshot({
    path: info.outputPath("hand-opening.png"),
    fullPage: true,
  });
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("badge-deal-winner")).toBeVisible();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(29.3);
  await expect(
    page.locator(
      ".tp20-camera canvas, .tp20-hand-clip, .tp20-card-overlay, .tp20-physical-card",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".tp20-camera video")).toHaveCount(1);
  expect(
    await video.evaluate((el) => Number(el.dataset.seekCount)),
  ).toBeLessThanOrEqual(3);
  const quality = await video.evaluate((el: HTMLVideoElement) => {
    const q = el.getVideoPlaybackQuality();
    return {
      decoded: q.totalVideoFrames,
      dropped: q.droppedVideoFrames,
      rate: el.playbackRate,
    };
  });
  await info.attach("native-video-playback", {
    body: JSON.stringify(quality),
    contentType: "application/json",
  });
  await page.getByTestId("tpl-result-ok").click();
  await page.screenshot({
    path: info.outputPath("natural-hands-result.png"),
    fullPage: true,
  });
  round.next();
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(0);
  await expect(video).toHaveAttribute("data-motion", "betting");
  await expect(page.locator(".tp20-felt-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unavailable footage keeps server cards and round settlement working", async ({
  page,
}) => {
  await page.route("**/reference-sequential*-v4.mp4", (route) => route.abort());
  const round = await table(page);
  await expect(
    page.getByText("Dealer footage unavailable", { exact: true }),
  ).toBeVisible();
  round.reveal(150);
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
});

test("returning from a hidden tab catches up to the round deadline", async ({
  page,
}) => {
  const round = await table(page);
  round.reveal(2500);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
});

test("late join advances to elapsed reveal time with normal animation", async ({
  page,
}) => {
  await table(page, { late: true });
  await expect(
    page.locator('.tp20-hand-readout svg[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("badge-deal-winner")).toBeVisible();
});

test("a selected chip is submitted once against the current round at cutoff", async ({
  page,
}) => {
  const round = await table(page, { remaining: 9000 });
  await page.getByTestId("chip-100").click();
  await page.getByTestId("spot-playerB").click();
  await expect.poll(() => round.requests.length, { timeout: 12000 }).toBe(1);
  expect(round.requests[0]).toMatchObject({
    roundId: "reference-round-1",
    bets: [{ type: "playerB", amountPaise: "10000" }],
  });
  // The cheaper seconds-only UI must still close at the original safety cutoff.
  await expect(page.getByTestId("spot-playerB")).toBeDisabled();
  round.reveal();
  await expect(page.getByTestId("spot-playerB")).toBeDisabled();
  expect(round.requests).toHaveLength(1);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 740 },
  { width: 844, height: 390 },
]) {
  test(`table and all five bet targets fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const round = await table(page);
    await expect(page.getByTestId("tp20-dealer-video")).toHaveAttribute(
      "src",
      viewport.width <= 760
        ? /reference-sequential-mobile-v4\.mp4$/
        : /reference-sequential-v4\.mp4$/,
    );
    const camera = await page.locator(".tp20-camera").boundingBox();
    expect(Math.abs(camera!.width / camera!.height - 1036 / 586)).toBeLessThan(
      0.03,
    );
    for (const spot of [
      "playerA",
      "pairPlusA",
      "tie",
      "playerB",
      "pairPlusB",
    ]) {
      const button = page.getByTestId(`spot-${spot}`);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: info.outputPath(`betting-${viewport.width}.png`),
      fullPage: true,
    });
    round.reveal();
    await expect(page.getByTestId("badge-deal-winner")).toBeVisible();
    const railCard = await page.getByTestId("tp20-readout-0").boundingBox();
    const feltCard = await page.getByTestId("tp20-table-card-0").boundingBox();
    expect(railCard!.width).toBeGreaterThanOrEqual(17);
    expect(feltCard!.width).toBeLessThan(railCard!.width * 0.8);
    await page.screenshot({
      path: info.outputPath(`result-${viewport.width}.png`),
      fullPage: true,
    });
  });
}
