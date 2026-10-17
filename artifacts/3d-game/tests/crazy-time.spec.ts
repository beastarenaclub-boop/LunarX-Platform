import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  CRAZY_TIME_WHEEL,
  CRAZY_TIME_ROUND_TIMING,
  type CrazyTimeOutcome,
  type CrazyTimeSpot,
  type CrazyTimeBet,
} from "../../../lib/api-zod/src/crazy-time-game";

import { STUDIO_CUES } from "../src/components/crazyTime/studioTiming";

const config = {
  enabled: true,
  minStakePaise: "100",
  maxStakePaise: "100000000",
  houseEdge: 0.03,
  maxMultiplier: 5001,
  ...CRAZY_TIME_ROUND_TIMING,
};
function outcome(winner: CrazyTimeSpot): CrazyTimeOutcome {
  return {
    version: 1,
    segment: CRAZY_TIME_WHEEL.indexOf(winner),
    winner,
    topSlot: { spot: "5", multiplier: 3 },
    bonus:
      winner === "coin-flip"
        ? { kind: winner, sides: [10, 25], side: 1 }
        : winner === "cash-hunt"
          ? {
              kind: winner,
              grid: Array.from({ length: 108 }, (_, i) =>
                i === 14 ? 100 : 10,
              ),
            }
          : winner === "pachinko"
            ? {
                kind: winner,
                slots: Array.from({ length: 16 }, () => 25),
                slot: 8,
                path: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
                doubles: 1,
              }
            : winner === "crazy-time"
              ? { kind: winner, pointers: [25, 50, 100], boosts: [2] }
              : null,
  };
}
async function fixture(
  page: Page,
  options: {
    bettingMs?: number;
    reject?: boolean;
    unavailable?: boolean;
    lateJoin?: CrazyTimeSpot;
  } = {},
) {
  let socket: WebSocketRoute | undefined;
  const now = Date.now(),
    bettingMs = options.bettingMs ?? config.bettingWindowMs;
  let wallet = 1000000n;
  let snapshot = {
    roundId: "ct-browser-round",
    gameCode: "crazy-time",
    phase: options.lateJoin ? "settling" : "betting",
    now,
    bettingEndsAt: now + bettingMs,
    revealEndsAt: now + bettingMs + config.revealDurationMs,
    settleEndsAt:
      now + bettingMs + config.revealDurationMs + config.settleDurationMs,
    serverSeedHash: "commitment",
    serverSeed: null as string | null,
    clientSeed: "client",
    nonce: 0,
    config,
    outcome: options.lateJoin
      ? outcome(options.lateJoin)
      : (null as CrazyTimeOutcome | null),
    totalStake: "0",
    playerCount: 0,
    liveBets: [],
    myBets: [] as {
      slipId: string;
      bets: CrazyTimeBet[];
      status: string;
      totalStake: string;
      payoutAmount: string;
      auditRoundId: string | null;
    }[],
    recent: ["2", "1", "coin-flip", "5", "1", "10", "cash-hunt", "2", "1"].map(
      (s, i) => ({
        roundId: `prior-${i}`,
        outcome: outcome(s as CrazyTimeSpot),
        settledAt: new Date().toISOString(),
      }),
    ),
  };
  const submissions: { roundId: string; bets: CrazyTimeBet[] }[] = [];
  let firstSnapshot = true;
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
    let json: unknown = {};
    if (path === "/api/auth/me")
      json = {
        id: "crazy-ui-test",
        displayName: "Player",
        email: "crazy@example.test",
        role: "player",
      };
    else if (path === "/api/game/registry")
      json = [
        {
          gameCode: "crazy-time",
          title: "Crazy Time",
          route: "/crazy-time",
          enabled: true,
        },
      ];
    else if (path === "/api/crazy-time/config") {
      if (options.unavailable)
        return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      json = config;
    } else if (path === "/api/crazy-time/round") {
      if (firstSnapshot && snapshot.phase === "betting") {
        const delay = Date.now() - now;
        snapshot.bettingEndsAt += delay;
        snapshot.revealEndsAt += delay;
        snapshot.settleEndsAt += delay;
      }
      firstSnapshot = false;
      json = options.unavailable ? {} : { ...snapshot, now: Date.now() };
    } else if (path === "/api/crazy-time/recent") json = [];
    else if (path.endsWith("/verify"))
      json = { roundId: "ct-browser-round", verified: true };
    else if (path.includes("/wallet/"))
      json = { balance: wallet.toString(), currency: "INR", scope: "lunar" };
    else if (path === "/api/crazy-time/bet") {
      const input = route.request().postDataJSON();
      submissions.push(input);
      if (options.reject)
        return route.fulfill({
          status: 400,
          json: { detail: "Insufficient wallet balance." },
        });
      const totalStake = input.bets
        .reduce(
          (sum: bigint, b: CrazyTimeBet) => sum + BigInt(b.amountPaise),
          0n,
        )
        .toString();
      wallet -= BigInt(totalStake);
      snapshot.myBets = [
        {
          slipId: "ct-slip",
          bets: input.bets,
          status: "pending",
          totalStake,
          payoutAmount: "0",
          auditRoundId: null,
        },
      ];
      json = { slipId: "ct-slip", roundId: snapshot.roundId, totalStake };
    } else if (path.includes("/config/"))
      json = { ...config, gameCode: "crazy-time" };
    await route.fulfill({ json });
  });
  await page.goto("/crazy-time");
  await expect(page.getByTestId("crazy-betting")).toBeVisible();
  const emit = (payload: object) =>
    socket?.send(
      JSON.stringify({
        op: "event",
        topic: "table-rounds:crazy-time",
        payload,
      }),
    );
  return {
    submissions,
    reveal(
      winner: CrazyTimeSpot,
      duration = config.revealDurationMs,
      elapsedMs = 0,
    ) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        phase: "reveal",
        bettingEndsAt: now - elapsedMs,
        revealEndsAt: now + duration - elapsedMs,
        settleEndsAt: now + duration + config.settleDurationMs - elapsedMs,
        outcome: outcome(winner),
        serverSeed: "server",
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "reveal",
        endsAt: snapshot.revealEndsAt,
        ts: now,
      });
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome: snapshot.outcome,
        serverSeed: "server",
      });
    },
    settle(payout: string) {
      const now = Date.now();
      wallet += BigInt(payout);
      snapshot = {
        ...snapshot,
        phase: "settling",
        settleEndsAt: now + config.settleDurationMs,
        myBets: snapshot.myBets.map((b) => ({
          ...b,
          status: "settled",
          payoutAmount: payout,
        })),
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "settling",
        endsAt: snapshot.settleEndsAt,
        ts: now,
      });
    },
    next() {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        roundId: "ct-next",
        phase: "betting",
        bettingEndsAt: now + config.bettingWindowMs,
        revealEndsAt: now + config.bettingWindowMs + config.revealDurationMs,
        settleEndsAt:
          now +
          config.bettingWindowMs +
          config.revealDurationMs +
          config.settleDurationMs,
        outcome: null,
        myBets: [],
      };
      emit({
        type: "phase",
        roundId: snapshot.roundId,
        phase: "betting",
        endsAt: snapshot.bettingEndsAt,
        ts: now,
      });
    },
  };
}

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
  ["small-phone", 320, 568],
  ["landscape", 844, 390],
] as const) {
  test(`${name}: wheel, host, all eight bets and coins fit without overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page);
    await expect(page.getByTestId("crazy-host")).toBeVisible();
    await expect(page.locator(".ct-bet-grid>button")).toHaveCount(8);
    for (const button of await page.locator(".ct-bet-grid>button").all()) {
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(
      page.getByRole("button", { name: "₹100 coin", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "₹100 coin", exact: true }).click();
    await page.getByTestId("crazy-spot-5").click();
    await expect(page.getByTestId("crazy-total")).toHaveText("₹100.00");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.getByTestId("crazy-studio-scene")).toHaveAttribute(
      "data-performance",
      "betting",
    );
    await page.screenshot({
      path: `test-results/crazy-time-${name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
test("1080p host frames own the pull, buffered video cannot spin the wheel early", async ({
  page,
}) => {
  const game = await fixture(page);
  const scene = page.getByTestId("crazy-studio-scene");
  await expect(scene).toHaveAttribute("data-media", "video");
  const active = page.locator('.ct-studio-film[data-active="true"]');
  expect(
    await active.evaluate((v: HTMLVideoElement) => [
      v.videoWidth,
      v.videoHeight,
    ]),
  ).toEqual([1920, 1080]);
  const disc = page.getByTestId("wheel-disc");
  const rest = await disc.evaluate((w: SVGElement) => w.style.transform);
  await page.waitForTimeout(1200);
  expect(await disc.evaluate((w: SVGElement) => w.style.transform)).toBe(rest);
  const revealRequestedAt = Date.now();
  game.reveal("5");
  await expect(scene).toHaveAttribute("data-performance", "spinning");
  const spin = page.getByTestId("crazy-host-spin");
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1.8);
  await spin.evaluate((v: HTMLVideoElement) => v.pause());
  expect(
    await spin.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeLessThan(STUDIO_CUES.wheelPull);
  await page.waitForTimeout(4200);
  expect(Date.now() - revealRequestedAt).toBeGreaterThan(
    STUDIO_CUES.wheelPull * 1000,
  );
  // The wall clock has passed the pull, but no pull frame has been displayed.
  expect(await disc.evaluate((w: SVGElement) => w.style.transform)).toBe(rest);
  await spin.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => disc.evaluate((w: SVGElement) => w.style.transform))
    .not.toBe(rest);
  expect(
    Number(await scene.getAttribute("data-frame-time")),
  ).toBeGreaterThanOrEqual(STUDIO_CUES.wheelPull);
  await page.screenshot({
    path: "test-results/crazy-time-film-pull.png",
    fullPage: true,
  });
  await expect(disc).toHaveAttribute(
    "data-segment",
    String(CRAZY_TIME_WHEEL.indexOf("5")),
    { timeout: 15000 },
  );
  await expect(scene).toHaveAttribute("data-performance", "result");
  game.settle("0");
  await expect(page.getByLabel("Next round in seconds")).toBeVisible();
  game.next();
  await expect(scene).toHaveAttribute("data-performance", "betting");
  await expect(disc).not.toHaveAttribute("data-segment");
});

test("reloading mid-spin resumes the current host frame and lands on the server result", async ({
  page,
}) => {
  const game = await fixture(page);
  game.reveal("10", config.revealDurationMs, 5000);
  await page.reload();
  const scene = page.getByTestId("crazy-studio-scene");
  await expect(scene).toHaveAttribute("data-media", "video");
  await expect(scene).toHaveAttribute("data-performance", "spinning");
  expect(
    await page
      .getByTestId("crazy-host-spin")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThan(4.9);
  await expect(page.getByTestId("wheel-disc")).toHaveAttribute(
    "data-segment",
    String(CRAZY_TIME_WHEEL.indexOf("10")),
  );
});

test("complete clips load in priority order and wheel interpolates between video frames", async ({
  page,
}) => {
  const requests: string[] = [];
  let concurrent = 0,
    peakConcurrent = 0,
    bytes = 0;
  await page.route("**/studio-v3-*.mp4*", async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    requests.push(new URL(route.request().url()).pathname);
    peakConcurrent = Math.max(peakConcurrent, ++concurrent);
    const response = await route.fetch();
    const body = await response.body();
    bytes += body.length;
    await new Promise((resolve) => setTimeout(resolve, 450));
    concurrent--;
    await route.fulfill({ response, body });
  });
  const game = await fixture(page);
  const scene = page.getByTestId("crazy-studio-scene");
  await expect(scene).toHaveAttribute("data-media", "video");
  expect(requests[0]).toMatch(/welcome|choices/);
  await expect(scene).toHaveAttribute("data-loaded", "5", { timeout: 25000 });
  expect(peakConcurrent).toBeLessThanOrEqual(2);
  expect(requests).toHaveLength(5);
  expect(bytes).toBeLessThan(10_000_000);
  game.reveal("2");
  const spin = page.getByTestId("crazy-host-spin");
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(4);
  const frames = await page.evaluate(async () => {
    const disc = document.querySelector<SVGElement>(
      '[data-testid="wheel-disc"]',
    )!;
    const samples: { at: number; angle: string }[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      function tick(at: number) {
        samples.push({ at, angle: disc.style.transform });
        if (at - start < 1100) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    return samples;
  });
  expect(frames.length).toBeGreaterThan(12);
  expect(
    new Set(frames.map((f) => f.angle)).size / frames.length,
  ).toBeGreaterThan(0.7);
  await spin.evaluate((v: HTMLVideoElement) => v.pause());
  await page.waitForTimeout(100);
  const frozen = await page.getByTestId("wheel-disc").getAttribute("style");
  await page.waitForTimeout(350);
  expect(await page.getByTestId("wheel-disc").getAttribute("style")).toBe(
    frozen,
  );
  await spin.evaluate((v: HTMLVideoElement) => v.play());
  expect(requests).toHaveLength(5);
  await test
    .info()
    .attach("studio-playback-measurements", {
      body: JSON.stringify({ bytes, peakConcurrent, frames }),
      contentType: "application/json",
    });
});

test("host clips vary with the round and share the sound switch", async ({
  page,
}) => {
  // Observe real speech PCM at its output, not just a mute flag on silent video.
  await page.addInitScript(() => {
    const state = { analysers: [] as AnalyserNode[], speechStarts: 0 };
    (window as any).studioAudioTest = state;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: any, ...rest: any[]) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 1024;
        state.analysers.push(analyser);
        connect.call(analyser, destination);
        return connect.call(this, analyser);
      }
      return (connect as any).call(this, destination, ...rest);
    } as typeof connect;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<typeof start>
    ) {
      if (this.buffer && this.buffer.duration > 5) state.speechStarts++;
      return start.apply(this, args);
    };
  });
  await fixture(page);
  const scene = page.getByTestId("crazy-studio-scene");
  await expect(scene).toHaveAttribute("data-media", "video");
  const active = page.locator('.ct-studio-film[data-active="true"]');
  expect(await active.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await page.getByRole("button", { name: "Enable sound" }).click();
  await expect.poll(() => scene.getAttribute("data-voice")).toBe("playing");
  const outputPeak = () =>
    page.evaluate(() => {
      return Math.max(
        0,
        ...(window as any).studioAudioTest.analysers.map((a: AnalyserNode) => {
          const pcm = new Float32Array(a.fftSize);
          a.getFloatTimeDomainData(pcm);
          return Math.max(...pcm.map(Math.abs));
        }),
      );
    });
  await expect.poll(outputPeak).toBeGreaterThan(0.003);
  expect(
    await page.evaluate(() => (window as any).studioAudioTest.speechStarts),
  ).toBeGreaterThan(0);
  const first = await scene.getAttribute("data-clip");
  await expect
    .poll(() => scene.getAttribute("data-clip"), { timeout: 11000 })
    .not.toBe(first);
  expect(
    await page
      .locator(".ct-studio-film")
      .evaluateAll(
        (videos) =>
          videos.filter((v) => !(v as HTMLVideoElement).paused).length,
      ),
  ).toBe(1);
  await page.getByRole("button", { name: "Mute sound" }).click();
  await expect(scene).toHaveAttribute("data-voice", "silent");
  await expect.poll(outputPeak).toBeLessThan(0.00001);
  await expect
    .poll(() => active.evaluate((v: HTMLVideoElement) => v.muted))
    .toBe(true);
  await expect(scene).toHaveAttribute("data-clip", "lastCall", {
    timeout: 24000,
  });
  await expect(scene).toHaveAttribute("data-performance", "betting");
});

for (const fallback of ["media failure", "reduced motion"] as const) {
  test(`${fallback} keeps betting and results working with the studio poster`, async ({
    page,
  }) => {
    if (fallback === "media failure")
      await page.route("**/studio-v3-*.mp4*", (route) =>
        ["media", "fetch"].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
    else await page.emulateMedia({ reducedMotion: "reduce" });
    const game = await fixture(page);
    await expect(page.getByTestId("crazy-studio-scene")).toHaveAttribute(
      "data-media",
      "poster",
    );
    await page.getByTestId("crazy-spot-1").click();
    await expect(page.getByTestId("crazy-total")).not.toHaveText("₹0.00");
    game.reveal("1", config.revealDurationMs, config.revealDurationMs - 1000);
    await expect(page.getByTestId("crazy-spot-1")).toHaveAttribute(
      "data-winner",
      "true",
    );
    game.settle("0");
    await expect(page.getByLabel("Next round in seconds")).toBeVisible();
  });
}

test("auto bet locks choices once, settles wallet, and never carries drafts into next round", async ({
  page,
}) => {
  const game = await fixture(page, { bettingMs: 16000 });
  await page.getByRole("button", { name: "Bonus picks" }).click();
  await page
    .getByRole("button", { name: "Cash Hunt box 15", exact: true })
    .click();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await page.getByRole("button", { name: "Save picks" }).click();
  await page.getByRole("button", { name: "₹100 coin", exact: true }).click();
  await page.getByTestId("crazy-spot-5").click();
  await page.getByTestId("crazy-spot-cash-hunt").click();
  await page.getByTestId("crazy-spot-crazy-time").click();
  expect(game.submissions).toHaveLength(0);
  await expect.poll(() => game.submissions.length, { timeout: 19000 }).toBe(1);
  expect(game.submissions[0].bets).toEqual([
    { type: "5", amountPaise: "10000" },
    { type: "cash-hunt", amountPaise: "10000", choice: 14 },
    { type: "crazy-time", amountPaise: "10000", choice: 1 },
  ]);
  await expect(page.getByTestId("crazy-balance")).toHaveText("₹9,700.00");
  game.reveal("5");
  await expect(page.getByTestId("crazy-spot-5")).toBeDisabled();
  await expect(page.getByTestId("crazy-spot-5")).toHaveAttribute(
    "data-winner",
    "true",
    { timeout: 17000 },
  );
  await expect(page.getByTestId("wheel-disc")).toHaveAttribute(
    "data-segment",
    String(CRAZY_TIME_WHEEL.indexOf("5")),
  );
  game.settle("160000");
  await expect(page.getByTestId("crazy-balance")).toHaveText("₹11,300.00");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button").last().click();
  game.next();
  await expect(page.getByTestId("crazy-total")).toHaveText("₹0.00");
  expect(game.submissions).toHaveLength(1);
  await page.getByRole("button", { name: "Repeat last bet" }).click();
  await expect(page.getByTestId("crazy-total")).toHaveText("₹300.00");
  expect(game.submissions).toHaveLength(1);
});
for (const spot of [
  "coin-flip",
  "cash-hunt",
  "pachinko",
  "crazy-time",
] as const) {
  test(`${spot}: late join shows bonus and correct wheel segment without replay`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, { lateJoin: spot });
    await expect(page.getByTestId("crazy-bonus")).toBeVisible();
    await expect(page.getByTestId("wheel-disc")).toHaveAttribute(
      "data-segment",
      String(CRAZY_TIME_WHEEL.indexOf(spot)),
    );
    await expect(page.getByTestId(`crazy-spot-${spot}`)).toHaveAttribute(
      "data-winner",
      "true",
    );
    await page.screenshot({
      path: `test-results/crazy-time-${spot}.png`,
      fullPage: true,
    });
  });
}
test("rejected wagers clear the draft without changing balance", async ({
  page,
}) => {
  const game = await fixture(page, { bettingMs: 9000, reject: true });
  await page.getByTestId("crazy-spot-1").click();
  await expect.poll(() => game.submissions.length, { timeout: 13000 }).toBe(1);
  await expect(page.getByTestId("crazy-total")).toHaveText("₹0.00");
  await expect(page.getByTestId("crazy-balance")).toHaveText("₹10,000.00");
  game.next();
  await expect(page.getByTestId("crazy-total")).toHaveText("₹0.00");
  expect(game.submissions).toHaveLength(1);
});
test("unavailable table locks bets and offers reconnect", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page, { unavailable: true });
  await expect(page.getByTestId("crazy-spot-1")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("original wheel, coin and win sounds render and mute suppresses playback", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  const rendered = await page.evaluate(async () => {
    const { audio, design } = (window as any).soundTest;
    audio.setAudioGame("crazy-time");
    await audio.unlockAudio();
    const results = ["tick", "bet", "reveal", "win", "lose"].map((cue) => {
      const pcm = design.renderGameSound("crazy-time", cue);
      return {
        cue,
        samples: pcm.length,
        peak: pcm.reduce(
          (max: number, n: number) => Math.max(max, Math.abs(n)),
          0,
        ),
      };
    });
    audio.playGameSound("bet", "crazy-time");
    return results;
  });
  for (const sound of rendered) {
    expect(sound.samples).toBeGreaterThan(1000);
    expect(sound.peak).toBeGreaterThan(0.001);
  }
  await expect
    .poll(() => page.evaluate(() => (window as any).soundTest.events.length))
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    (window as any).soundTest.audio.setVolumes(0, 0, 0, 0),
  );
  const before = await page.evaluate(
    () => (window as any).soundTest.events.length,
  );
  await page.evaluate(() =>
    (window as any).soundTest.audio.playGameSound("win", "crazy-time"),
  );
  expect(
    await page.evaluate(() => (window as any).soundTest.events.length),
  ).toBe(before);
});

test("real isolated preview completes an authenticated automatic round", async ({
  page,
}) => {
  test.skip(
    process.env.CRAZY_TIME_LIVE_PREVIEW !== "1",
    "Opt in against the isolated preview database only",
  );
  const login = await page.request.post("/api/auth/login", {
    data: { email: "crazy-preview@local.test", password: "CrazyTime@2026" },
  });
  expect(login.ok()).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/crazy-time");
  await expect(page.getByTestId("crazy-betting")).toBeVisible();
  await expect
    .poll(
      async () => {
        const snap = await (
          await page.request.get("/api/crazy-time/round")
        ).json();
        return (
          snap?.phase === "betting" && snap.bettingEndsAt - Date.now() > 6000
        );
      },
      { timeout: 40000, intervals: [700] },
    )
    .toBe(true);
  const before = await (await page.request.get("/api/wallet/balance")).json();
  await expect(page.getByTestId("crazy-spot-1")).toBeEnabled();
  await page.getByRole("button", { name: "₹100 coin", exact: true }).click();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/crazy-time/bet") &&
      r.request().method() === "POST",
    { timeout: 25000 },
  );
  for (const spot of CRAZY_TIME_TYPES_LOCAL)
    await page.getByTestId(`crazy-spot-${spot}`).click();
  const accepted = await response;
  expect(accepted.ok()).toBe(true);
  const slip = await accepted.json();
  let verification: any;
  await expect
    .poll(
      async () => {
        const r = await page.request.get(
          `/api/crazy-time/${slip.roundId}/verify`,
        );
        if (!r.ok()) return false;
        verification = await r.json();
        return verification.slips.some((s: any) => s.status === "settled");
      },
      { timeout: 14000, intervals: [600] },
    )
    .toBe(true);
  expect(verification.verified).toBe(true);
  expect(verification.slips[0].payoutMatch).toBe(true);
  const after = await (await page.request.get("/api/wallet/balance")).json();
  expect(BigInt(after.balance)).toBe(
    BigInt(before.balance) -
      BigInt(slip.totalStake) +
      BigInt(verification.slips[0].payoutAmount),
  );
  await page.screenshot({
    path: "test-results/crazy-time-live-preview.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
const CRAZY_TIME_TYPES_LOCAL = [
  "1",
  "2",
  "5",
  "10",
  "coin-flip",
  "cash-hunt",
  "pachinko",
  "crazy-time",
];
