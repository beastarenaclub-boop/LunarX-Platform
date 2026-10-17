import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { DEALER } from "../src/components/lucky7live/dealerTimeline";
import {
  l7Payout,
  type L7Bet,
  type L7Card,
} from "@workspace/api-zod/lucky7-live";
const screenshot = (name: string) =>
  path.resolve(import.meta.dirname, "../../../tmp/lucky7-live", name);
async function setup(
  page: Page,
  options: { low?: boolean; drop?: boolean } = {},
) {
  let wallet = options.low ? 1000n : 1000000n,
    phase = "betting",
    id = 1,
    card: L7Card | null = null,
    offline = false,
    dropped = false;
  // Begin the fixture's betting clock when its first snapshot is requested;
  // a cold browser/video load must not consume the test's betting window.
  let deadline = 0,
    myBets: any[] = [];
  const history: any[] = [],
    recent: any[] = [],
    posts: any[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "l7-test",
        email: "l7@example.test",
        displayName: "Player",
        role: "player",
      };
    else if (path === "/api/wallet/balance")
      body = {
        balance: String(wallet),
        scope: "lunar",
        currency: "INR",
        walletId: "shared",
      };
    else if (path === "/api/wallet/balances")
      body = { balances: { lunar: String(wallet) }, currency: "INR" };
    else if (path.startsWith("/api/lucky-7-live")) {
      if (offline)
        return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      if (path.endsWith("/config"))
        body = {
          enabled: true,
          minStakePaise: "5000",
          maxStakePaise: "20000000",
        };
      else if (path.endsWith("/history")) body = history;
      else if (path.endsWith("/verify"))
        body = {
          verified: true,
          serverSeed: "committed-seed",
          clientSeed: "table-seed",
          nonce: 0,
        };
      else if (path.endsWith("/round")) {
        deadline ||= Date.now() + 60000;
        body = {
          roundId: `lucky-live-${id}`,
          phase,
          now: Date.now(),
          bettingEndsAt: deadline,
          revealEndsAt: deadline + 3000,
          settleEndsAt: deadline + 9000,
          outcome: card,
          myBets,
          recent,
          liveBets: [],
          playerCount: myBets.length,
          totalStake: myBets[0]?.totalStake ?? "0",
          config: {
            minStakePaise: "5000",
            maxStakePaise: "20000000",
            maxMultiplier: 12,
            bettingWindowMs: 60000,
            revealDurationMs: 3000,
            settleDurationMs: 6000,
          },
        };
      } else if (path.endsWith("/bet")) {
        const input = route.request().postDataJSON();
        posts.push(input);
        if (!myBets.length) {
          const stake = input.bets.reduce(
            (a: bigint, b: L7Bet) => a + BigInt(b.amountPaise),
            0n,
          );
          wallet -= stake;
          myBets = [
            {
              slipId: `slip-${id}`,
              bets: input.bets,
              totalStake: String(stake),
              status: "pending",
              payoutAmount: "0",
            },
          ];
        }
        if (options.drop && !dropped) {
          dropped = true;
          return route.abort("connectionreset");
        }
        body = { slipId: `slip-${id}`, roundId: `lucky-live-${id}` };
      }
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/lucky-7-live");
  await expect(
    page.getByRole("button", { name: "Bet on 7 Up", exact: true }),
  ).toBeEnabled();
  return {
    posts,
    errors,
    get wallet() {
      return wallet;
    },
    disconnect() {
      offline = true;
    },
    reveal(elapsed = 0) {
      phase = "reveal";
      deadline = Date.now() - elapsed;
    },
    disclose(result: L7Card = { rank: 7, suit: "hearts" }) {
      card = result;
    },
    settle(result: L7Card = { rank: 7, suit: "hearts" }) {
      card = result;
      phase = "settling";
      deadline = Date.now() - 3001;
      if (myBets[0]) {
        const payout = l7Payout(myBets[0].bets, card);
        wallet += payout;
        myBets[0] = {
          ...myBets[0],
          status: "settled",
          payoutAmount: String(payout),
        };
        history.unshift({
          ...myBets[0],
          roundId: `lucky-live-${id}`,
          card,
          createdAt: new Date().toISOString(),
        });
      }
    },
    next() {
      recent.unshift({ roundId: `lucky-live-${id}`, outcome: card });
      id++;
      phase = "betting";
      myBets = [];
      card = null;
      deadline = Date.now() + 60000;
    },
  };
}
test("table music starts on interaction, obeys mute, and stops when leaving", async ({
  page,
}) => {
  const f = await setup(page);
  const music = page.getByTestId("l7-background-music");
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.2);
  expect(
    await music.evaluate((a: HTMLAudioElement) => ({
      loop: a.loop,
      volume: a.volume,
      paused: a.paused,
    })),
  ).toEqual({ loop: true, volume: 0.16, paused: false });
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable sound", exact: true }),
  ).toBeVisible();
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false);
  const element = await music.elementHandle();
  await page.route("**/api/game/registry", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.getByRole("link", { name: /More Games/ }).click();
  expect(await element!.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("chips, undo, double, shared balance settlement and repeat", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Bet on Lucky 7" }).click();
  await page.getByRole("button", { name: "Bet on Red", exact: true }).click();
  await page.getByRole("button", { name: "Double", exact: true }).click();
  await expect(page.locator(".l7-confirm")).toContainText("₹200");
  await page.getByRole("button", { name: "Undo last chip" }).click();
  await expect(page.locator(".l7-confirm")).toContainText("₹100");
  await page.locator(".l7-confirm").click();
  await expect(page.locator(".l7-confirm")).toContainText("Bets confirmed");
  await expect(page.getByTestId("l7-wallet")).toHaveText("₹9,900");
  expect(f.posts).toHaveLength(1);
  f.reveal();
  await expect(page.locator(".l7-deal-zone")).toHaveClass(/is-dealing/);
  await expect(
    page.getByRole("button", { name: "Bet on Red", exact: true }),
  ).toBeDisabled();
  f.settle();
  await expect(page.locator(".l7-result")).toContainText("LUCKY 7 WINS");
  await expect(page.getByTestId("l7-wallet")).toHaveText("₹10,595");
  await expect(page.locator(".l7-spot.is-winner")).toHaveCount(3);
  await page.getByRole("button", { name: "Bet history", exact: true }).click();
  await expect(page.locator(".l7-history")).toContainText("₹695");
  await page.getByRole("button", { name: "Verify round" }).click();
  await expect(page.locator(".l7-verification")).toContainText("Verified");
  await page.keyboard.press("Escape");
  f.next();
  await expect(
    page.getByRole("button", { name: "Repeat", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await expect(page.locator(".l7-confirm")).toContainText("₹100");
  expect(f.posts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
test("dealer physically opens each round, resyncs on reload, and clears the previous face", async ({
  page,
}) => {
  const f = await setup(page);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  f.reveal();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "deal",
  );
  await expect(page.getByTestId("l7-dealt-card")).toHaveCount(0);
  // Even an early outcome response must not print a face on the back of the prop.
  f.disclose();
  const firstFrame = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(firstFrame).toBeLessThan(DEALER.faceAt);
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  f.settle();
  await expect(page.getByTestId("l7-dealt-card")).toContainText("7");
  await expect(
    page.getByTestId("l7-result-card").getByRole("img"),
  ).toHaveAccessibleName("7 of hearts");
  await page.reload();
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "hold",
  );
  await page.screenshot({
    path: screenshot("dealer-result-desktop.png"),
  });
  f.next();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "reset",
  );
  // The result UI clears, but the physical card stays printed until the
  // dealer actually collects and turns it toward the discard tray.
  await expect(page.locator(".l7-result")).toHaveCount(0);
  await expect(page.getByTestId("l7-dealt-card")).toContainText("7");
  await expect(page.getByTestId("l7-dealt-card")).toHaveCount(0);
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "idle",
  );
  f.reveal(1100);
  await page.reload();
  // Loading may finish after the remaining 1.9 seconds of the reveal.
  // A late join must follow the current server phase, not replay the opening.
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    /^(deal|hold)$/,
  );
  await expect(page.getByTestId("l7-dealt-card")).toHaveCount(0);
  f.settle({ rank: 12, suit: "spades" });
  await expect(page.getByTestId("l7-dealt-card")).toContainText("Q");
  await expect(page.locator(".l7-result")).toContainText("7 UP WINS");
  await page.setViewportSize({ width: 390, height: 844 });
  const resultBox = await page.getByTestId("l7-result-card").boundingBox();
  expect(resultBox!.width).toBeGreaterThanOrEqual(35);
  expect(resultBox!.height).toBeGreaterThanOrEqual(50);
  await expect(
    page.getByTestId("l7-result-card").getByRole("img"),
  ).toHaveAccessibleName("Q of spades");
  await page.screenshot({
    path: screenshot("dealer-result-mobile.png"),
  });
  expect(f.errors).toEqual([]);
});

test("card reveal continues into the result without seeking or dissolving", async ({
  page,
}) => {
  const f = await setup(page);
  f.reveal();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "deal",
  );
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => (v as HTMLVideoElement).seeking),
    )
    .toBe(false);
  await page.locator("video").evaluate((v) => {
    (window as any).revealSeeks = [];
    v.addEventListener("seeking", () =>
      (window as any).revealSeeks.push((v as HTMLVideoElement).currentTime),
    );
  });
  f.disclose({ rank: 12, suit: "hearts" });
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "hold",
  );
  expect(await page.evaluate(() => (window as any).revealSeeks)).toEqual([]);
  await expect(page.locator(".l7-dealer-transition")).toHaveCSS("opacity", "0");
  await expect(page.getByTestId("l7-dealt-card")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByTestId("l7-dealt-card")).toHaveCSS(
    "mask-image",
    "none",
  );
  expect(f.errors).toEqual([]);
});

test("dealer keeps natural speed throughout settlement and stops seeking after its end", async ({
  page,
}) => {
  const f = await setup(page);
  f.reveal();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "deal",
  );
  f.disclose();
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "hold",
  );
  const samples = await page
    .locator("video")
    .evaluate(async (video: HTMLVideoElement) => {
      const rates: number[] = [],
        frames: number[] = [],
        seeks: number[] = [];
      let callback = 0;
      const onSeek = () => seeks.push(video.currentTime);
      video.addEventListener("seeking", onSeek);
      const frame = (now: number) => {
        rates.push(video.playbackRate);
        frames.push(now);
        callback = video.requestVideoFrameCallback(frame);
      };
      callback = video.requestVideoFrameCallback(frame);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeking", onSeek);
      return { rates, frames, seeks };
    });
  expect(Math.min(...samples.rates)).toBeGreaterThanOrEqual(0.95);
  expect(Math.max(...samples.rates)).toBeLessThanOrEqual(1.05);
  // The old stretched take delivered only about 10 fps and then rewound.
  expect(samples.frames.length).toBeGreaterThan(100);
  expect(samples.seeks).toEqual([]);
  await page.waitForTimeout(2000);
  const endSeeks = await page
    .locator("video")
    .evaluate(async (video: HTMLVideoElement) => {
      let seeks = 0;
      const onSeek = () => seeks++;
      video.addEventListener("seeking", onSeek);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      video.removeEventListener("seeking", onSeek);
      return seeks;
    });
  expect(endSeeks).toBe(0);
  expect(f.errors).toEqual([]);
});

test("the video and tracked ink share decoded timestamps during the card turn", async ({
  page,
}) => {
  const f = await setup(page);
  // The tracking surface must already exist before the first face-up frame.
  await expect(page.locator(".l7-table-card")).toHaveCount(1);
  f.reveal();
  f.disclose({ rank: 10, suit: "spades" });
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  const samples = await page
    .locator("video")
    .evaluate(async (video: HTMLVideoElement) => {
      const samples: { media: number; ink: number }[] = [];
      let callback = 0;
      const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        // All callbacks for this decoded frame finish before this next paint.
        requestAnimationFrame(() => {
          const card = document.querySelector<HTMLElement>(".l7-table-card");
          if (card?.style.visibility === "visible")
            samples.push({
              media: metadata.mediaTime,
              ink: Number(card.dataset.mediaTime),
            });
        });
        callback = video.requestVideoFrameCallback(frame);
      };
      callback = video.requestVideoFrameCallback(frame);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      video.cancelVideoFrameCallback(callback);
      return samples;
    });
  expect(samples.length).toBeGreaterThan(10);
  expect(
    Math.max(...samples.map((sample) => Math.abs(sample.media - sample.ink))),
  ).toBeLessThan(0.045);
  expect(f.errors).toEqual([]);
});
test("paused dealer and unavailable video still show authoritative results", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Table settings" }).click();
  await page
    .getByRole("button", { name: "Pause dealer video", exact: true })
    .click();
  await page.keyboard.press("Escape");
  f.settle();
  await expect(page.getByTestId("l7-dealt-card")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await page.route("**/dealer-natural*v5.mp4", (route) => route.abort());
  await page.reload();
  await expect(page.locator(".l7-media-note")).toBeVisible();
  await expect(page.locator(".l7-result")).toContainText("LUCKY 7 WINS");
  expect(f.posts).toHaveLength(0);
});
test("dealer waiting footage plays continuously without a short repeated gesture", async ({
  page,
}) => {
  await setup(page);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".l7-camera")).toHaveAttribute(
    "data-dealer-cue",
    "idle",
  );
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    (window as any).__l7IdleSeeks = 0;
    v.addEventListener("seeking", () => (window as any).__l7IdleSeeks++);
  });
  // The old 1.35-second loop snapped back 8+ times in this same interval.
  await page.waitForTimeout(12000);
  expect(
    await page.evaluate(() => (window as any).__l7IdleSeeks),
  ).toBeLessThanOrEqual(3);
  await expect(page.locator(".l7-media-note")).toHaveCount(0);
  await expect(page.locator("video")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
});
test("insufficient funds and stale connection never submit a bet", async ({
  page,
}) => {
  const f = await setup(page, { low: true });
  await page.getByRole("button", { name: "Bet on 7 Up", exact: true }).click();
  await expect(page.locator(".l7-error")).toContainText("Insufficient");
  await expect(page.locator(".l7-confirm")).toBeDisabled();
  f.disconnect();
  await expect(
    page.getByRole("button", { name: "Bet on 7 Up", exact: true }),
  ).toBeDisabled();
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test("accepted bet with lost response reconciles and survives reload", async ({
  page,
}) => {
  const f = await setup(page, { drop: true });
  await page.getByRole("button", { name: "Bet on 7 Up", exact: true }).click();
  await page.locator(".l7-confirm").click();
  await expect(page.locator(".l7-confirm")).toContainText("Bets confirmed");
  await page.reload();
  await expect(page.locator(".l7-confirm")).toContainText("Bets confirmed");
  await expect(page.getByTestId("l7-wallet")).toHaveText("₹9,950");
  expect(f.posts).toHaveLength(1);
  expect(f.wallet).toBe(995000n);
});
for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`layout and generated video ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const f = await setup(page);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(0.1);
    await expect(
      page.getByRole("button", { name: "Bet on Lucky 7" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: screenshot(`table-${size.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Game rules", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("11:1");
    expect(f.errors).toEqual([]);
  });
