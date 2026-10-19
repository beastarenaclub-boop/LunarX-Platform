import { test, expect, chromium, type Page } from "@playwright/test";
import path from "node:path";
import {
  W20_WHEEL,
  w20Payout,
  type W20Outcome,
} from "@workspace/api-zod/wheel20-live";
import {
  spinAngle,
  wheelAngle,
} from "../src/components/wheel20live/PrizeWheel";
import {
  W20_CUES,
  performanceProgress,
} from "../src/components/wheel20live/studioTiming";
const outcome: W20Outcome = {
  version: 1,
  segment: W20_WHEEL.indexOf("20"),
  winner: "20",
  boostSpot: "20",
  boost: 5,
};
// Read at the next decoded frame, before WebGL discards its drawing buffer.
async function hostPixels(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        count: number;
        x: number;
        time: number;
        corner: number;
        fraction: number;
      }>((resolve) => {
        const video = document.querySelector<HTMLVideoElement>(
          'video[data-active="true"]',
        )!;
        video.requestVideoFrameCallback(() => {
          const host = document.querySelector<HTMLCanvasElement>(
            ".w20-host-foreground",
          )!;
          const copy = document.createElement("canvas");
          copy.width = host.width;
          copy.height = host.height;
          const context = copy.getContext("2d")!;
          context.drawImage(host, 0, 0);
          const pixels = context.getImageData(
            0,
            0,
            copy.width,
            copy.height,
          ).data;
          let count = 0,
            sum = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i + 3] > 128) {
              count++;
              sum += (i / 4) % copy.width;
            }
          resolve({
            count,
            x: sum / count,
            time: Number(host.dataset.frameTime),
            corner: pixels[3],
            fraction: count / (copy.width * copy.height),
          });
        });
      }),
  );
}
async function setup(page: Page, low = false, waitForBoard = true) {
  let wallet = low ? 500 : 1000000,
    phase = "betting",
    round = 1,
    deadline = 0,
    revealMs = 2500,
    result: W20Outcome | null = null,
    offline = false,
    drop = false;
  let myBets: any[] = [];
  const history: any[] = [],
    posts: any[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    let body: any = {};
    if (p === "/api/auth/me")
      body = {
        id: "w20-test",
        email: "wheel@example.test",
        role: "player",
        displayName: "Player",
      };
    else if (p === "/api/wallet/balance")
      body = { balance: String(wallet), scope: "lunar", currency: "INR" };
    else if (p === "/api/wallet/balances")
      body = { balances: { lunar: String(wallet) }, currency: "INR" };
    else if (p.startsWith("/api/wheel-2-live")) {
      if (offline)
        return route.fulfill({ status: 503, json: { detail: "Offline" } });
      if (p.endsWith("/config"))
        body = {
          enabled: true,
          minStakePaise: "1000",
          maxStakePaise: "20000000",
        };
      else if (p.endsWith("/history")) body = history;
      else if (p.endsWith("/verify")) body = { verified: true };
      else if (p.endsWith("/round")) {
        deadline ||= Date.now() + 60000;
        body = {
          roundId: `wheel-${round}`,
          phase,
          now: Date.now(),
          bettingEndsAt: deadline,
          revealEndsAt: deadline + revealMs,
          settleEndsAt: deadline + revealMs + 6000,
          outcome: result,
          serverSeedHash: "abc123committed",
          myBets,
          recent: history
            .filter((h) => h.outcome)
            .map((h) => ({ roundId: h.roundId, outcome: h.outcome })),
          liveBets: [],
          playerCount: myBets.length,
          totalStake: myBets[0]?.totalStake ?? "0",
          config: {
            minStakePaise: "1000",
            maxStakePaise: "20000000",
            bettingWindowMs: 60000,
            revealDurationMs: revealMs,
            settleDurationMs: 6000,
          },
        };
      } else if (p.endsWith("/bet")) {
        const input = route.request().postDataJSON();
        posts.push(input);
        if (!myBets.length) {
          const stake = input.bets.reduce(
            (n: number, b: any) => n + Number(b.amountPaise),
            0,
          );
          wallet -= stake;
          myBets = [
            {
              slipId: `s${round}`,
              bets: input.bets,
              totalStake: String(stake),
              status: "pending",
            },
          ];
        }
        if (drop) {
          drop = false;
          return route.abort();
        }
        body = myBets[0];
      }
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (waitForBoard)
    await expect(
      page.getByRole("button", { name: "Bet on 20", exact: true }),
    ).toBeEnabled();
  return {
    posts,
    errors,
    balance: () => wallet,
    offline: () => {
      offline = true;
    },
    closing: () => {
      deadline = Date.now() + 8000;
    },
    drop: () => {
      drop = true;
    },
    reveal: (duration = 2500) => {
      revealMs = duration;
      phase = "reveal";
      deadline = Date.now();
      result = outcome;
    },
    settle: () => {
      phase = "settling";
      deadline = Date.now() - revealMs - 100;
      if (myBets.length) {
        const payout = Number(w20Payout(myBets[0].bets, outcome));
        wallet += payout;
        history.unshift({
          roundId: `wheel-${round}`,
          outcome,
          bets: myBets[0].bets,
          totalStake: myBets[0].totalStake,
          payoutAmount: String(payout),
          status: "settled",
          createdAt: new Date().toISOString(),
        });
      }
    },
    next: () => {
      round++;
      phase = "betting";
      deadline = Date.now() + 60000;
      result = null;
      myBets = [];
    },
  };
}
test("wheel stops on every authoritative pocket without backwards motion", () => {
  for (let segment = 0; segment < 54; segment++) {
    const end = spinAngle(7, segment, 1),
      delta = (((end - wheelAngle(segment)) % 360) + 360) % 360;
    expect(Math.min(delta, 360 - delta)).toBeLessThan(0.00001);
    let previous = spinAngle(7, segment, 0);
    for (let i = 1; i <= 100; i++) {
      const a = spinAngle(7, segment, i / 100);
      expect(a).toBeGreaterThanOrEqual(previous);
      previous = a;
    }
  }
});

for (const width of [1440, 390, 320]) {
  test(`readable numbers and a correctly framed winning close-up at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const f = await setup(page);
    await expect(page.locator(".w20-host-foreground")).toBeVisible();
    await expect(page.locator(".w20-host-foreground")).toHaveAttribute(
      "data-format",
      "green",
    );
    await page.locator(".w20-commentary").click();
    await expect(page.locator(".w20-performance")).toHaveAttribute(
      "data-commentary",
      "playing",
    );
    await page.screenshot({
      path: path.resolve(
        import.meta.dirname,
        `../../../tmp/wheel20-live/v4/studio-${width}.png`,
      ),
    });
    await expect(page.locator(".w20-pocket-number")).toHaveCount(54);
    await expect(page.locator(".w20-pocket-number").first()).toHaveCSS(
      "fill",
      "rgb(16, 13, 18)",
    );
    f.reveal(6000);
    await expect(page.locator(".w20-camera")).toHaveAttribute(
      "data-view",
      "closeup",
    );
    await expect(page.getByTestId("w20-result")).toHaveCount(0);
    await expect(page.getByTestId("w20-result")).toBeVisible();
    await expect(page.getByTestId("w20-wheel")).toHaveAttribute(
      "data-landed",
      "true",
    );
    await expect(page.locator(".w20-pocket.is-winner")).toHaveAttribute(
      "data-pocket",
      String(outcome.segment),
    );
    await expect(
      page.locator(".w20-pocket.is-winner .w20-number-plate"),
    ).toHaveCSS("fill", "rgb(255, 255, 255)");
    const framing = await page.evaluate(() => {
      const stage = document
        .querySelector(".w20-stage")!
        .getBoundingClientRect();
      const pocket = document
        .querySelector(".w20-pocket.is-winner")!
        .getBoundingClientRect();
      return {
        fits:
          pocket.left >= stage.left &&
          pocket.right <= stage.right &&
          pocket.top >= stage.top &&
          pocket.bottom <= stage.bottom,
        focused: Number(
          (
            document.querySelector(".w20-camera") as HTMLElement
          ).style.getPropertyValue("--w20-focus"),
        ),
      };
    });
    expect(framing).toEqual({ fits: true, focused: 1 });
    await page.screenshot({
      path: path.resolve(
        import.meta.dirname,
        `../../../tmp/wheel20-live/v4/result-${width}.png`,
      ),
    });
    f.next();
    await expect(page.locator(".w20-camera")).toHaveAttribute(
      "data-view",
      "wide",
    );
    await expect(page.getByTestId("w20-result")).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
}

test("a browser without WebGL still keys the host and can finish a round", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: any[]
    ) {
      if (type === "webgl") return null;
      return original.call(this, type as "2d", ...args);
    } as typeof original;
  });
  const f = await setup(page);
  await expect(page.locator(".w20-host-foreground")).toBeVisible();
  await expect(page.locator(".w20-host-foreground")).toHaveAttribute(
    "data-renderer",
    "canvas",
  );
  const sample = await hostPixels(page);
  expect(sample.corner).toBe(0);
  expect(sample.fraction).toBeGreaterThan(0.01);
  expect(sample.fraction).toBeLessThan(0.4);
  f.reveal();
  await expect(page.getByTestId("w20-result")).toBeVisible();
  expect(f.errors).toEqual([]);
});
test("chip editing, confirmation, authoritative landing, settlement and verification", async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Bet on 20", exact: true }).click();
  await page.getByRole("button", { name: "Double bets", exact: true }).click();
  await expect(page.getByTestId("w20-total")).toHaveText("₹20");
  await page.getByRole("button", { name: "Undo bet", exact: true }).click();
  await expect(page.getByTestId("w20-total")).toHaveText("₹10");
  await page
    .getByRole("button", { name: "CONFIRM BETS", exact: true })
    .dblclick();
  await expect(
    page.getByRole("button", { name: "CONFIRMED", exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(1);
  expect(f.balance()).toBe(999000);
  f.reveal();
  await expect(page.locator(".w20-studio-sign")).toContainText("5×");
  await expect(page.getByTestId("w20-result")).toBeVisible();
  await expect(page.getByTestId("w20-rotor")).toHaveAttribute(
    "data-segment",
    String(outcome.segment),
  );
  await expect(
    page.getByRole("button", { name: "Bet on 20", exact: true }),
  ).toBeDisabled();
  f.settle();
  await expect(page.getByTestId("w20-balance")).toHaveText("₹11,000");
  await page.getByRole("button", { name: "Bet history", exact: true }).click();
  await expect(page.getByText("Number 20 · 100:1")).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("Verified round wheel-1")).toBeVisible();
  await page.keyboard.press("Escape");
  f.next();
  await expect(
    page.getByRole("button", { name: "Repeat previous bets", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Repeat previous bets", exact: true })
    .click();
  await expect(page.getByTestId("w20-total")).toHaveText("₹10");
  expect(f.errors).toEqual([]);
});
test("insufficient balance and lost connection cannot place new stakes", async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.getByRole("button", { name: "Bet on 1", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Insufficient");
  expect(f.posts).toHaveLength(0);
  f.offline();
  await expect(
    page.getByRole("button", { name: "Bet on 1", exact: true }),
  ).toBeDisabled();
});
test("lost confirmation response reconciles without a second debit", async ({
  page,
}) => {
  const f = await setup(page);
  f.drop();
  await page.getByRole("button", { name: "Bet on 2", exact: true }).click();
  await page.getByRole("button", { name: "CONFIRM BETS", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "CONFIRMED", exact: true }),
  ).toBeVisible();
  expect(f.posts).toHaveLength(1);
  expect(f.balance()).toBe(999000);
});
test("presenter video decodes and plays; mute preference survives reload", async ({
  page,
}) => {
  await setup(page);
  await expect
    .poll(() =>
      page
        .locator('video[data-active="true"]')
        .evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBe(1280);
  const initial = await page
    .locator('video[data-active="true"]')
    .evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() =>
      page
        .locator('video[data-active="true"]')
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .not.toBe(initial);
  if (
    await page
      .getByRole("button", { name: "Enable sound", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Enable sound", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Mute sound", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Enable sound", exact: true }),
  ).toBeVisible();
});

test("saved mute has a visible one-tap recovery and commentary clicks never mute it", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("w20:commentary:auto-v1") === null)
      localStorage.setItem("w20:commentary:auto-v1", "off");
  });
  const f = await setup(page);
  const cdp = await context.newCDPSession(page);
  // Observe the native media path without rerouting it through Web Audio or
  // granting additional user activation through Playwright evaluate.
  const nativeState = async () => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const v = document.querySelector('video[data-active="true"]');
        return {
          audible: !!v && !v.muted && !v.paused && v.readyState >= 3,
          decoded: v?.webkitAudioDecodedByteCount ?? 0,
          preference: localStorage.getItem('w20:commentary:auto-v1')
        };
      })()`,
      returnByValue: true,
      userGesture: false,
    });
    return result.value;
  };
  const start = page.locator(".w20-audio-start");
  await expect(start).toContainText("Sound off");
  expect((await nativeState()).audible).toBe(false);
  await start.click();
  await expect.poll(async () => (await nativeState()).audible).toBe(true);
  await expect
    .poll(async () => (await nativeState()).decoded)
    .toBeGreaterThan(0);
  await expect(start).toHaveCount(0);
  await page.locator(".w20-commentary").click();
  await expect.poll(async () => (await nativeState()).preference).toBe("on");
  await expect.poll(async () => (await nativeState()).audible).toBe(true);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect(start).toContainText("Sound off");
  await expect.poll(async () => (await nativeState()).audible).toBe(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(start).toContainText("Sound off");
  await start.click();
  await expect.poll(async () => (await nativeState()).audible).toBe(true);
  expect(f.errors).toEqual([]);
});
test("one tap produces actual Hindi audio samples; the last-call stays audible and mute is silent", async ({
  page,
}) => {
  const f = await setup(page, false, false);
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression:
          "document.querySelector('.w20-performance')?.dataset.commentary",
        returnByValue: true,
        userGesture: false,
      });
      return result.value;
    })
    .toBe("blocked");
  await expect(page.locator(".w20-audio-start")).toBeVisible();
  await page.evaluate(() => {
    const ctx = new AudioContext();
    (window as any).voiceContext = ctx;
    const probes: Record<string, AnalyserNode> = {};
    for (const clip of ["welcome", "lastCall"]) {
      const v = document.querySelector<HTMLVideoElement>(
        `video[data-clip="${clip}"]`,
      )!;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaElementSource(v).connect(analyser);
      analyser.connect(ctx.destination);
      probes[clip] = analyser;
    }
    (window as any).voiceProbe = (clip: string) => {
      const samples = new Float32Array(probes[clip].fftSize);
      probes[clip].getFloatTimeDomainData(samples);
      return Math.sqrt(
        samples.reduce((n, sample) => n + sample * sample, 0) / samples.length,
      );
    };
    document.addEventListener("pointerdown", () => void ctx.resume(), {
      once: true,
    });
  });
  await page.locator(".w20-audio-start").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).voiceProbe("welcome")), {
      timeout: 8000,
    })
    .toBeGreaterThan(0.003)
    .catch(async (error) => {
      console.log(
        await page.evaluate(() => ({
          context: (window as any).voiceContext.state,
          activation: navigator.userActivation.hasBeenActive,
          status: document
            .querySelector(".w20-performance")
            ?.getAttribute("data-commentary"),
          videos: [...document.querySelectorAll("video")].map((v) => ({
            clip: v.dataset.clip,
            time: v.currentTime,
            paused: v.paused,
            muted: v.muted,
            ready: v.readyState,
            seeking: v.seeking,
            active: v.dataset.active,
          })),
        })),
      );
      throw error;
    });
  await expect(page.locator(".w20-audio-start")).toHaveCount(0);
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-commentary",
    "playing",
  );
  f.closing();
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-clip",
    "lastCall",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).voiceProbe("lastCall")), {
      timeout: 6000,
    })
    .toBeGreaterThan(0.003);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).voiceProbe("lastCall")))
    .toBeLessThan(0.0001);
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-commentary",
    "muted",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Enable sound", exact: true }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("permitted autoplay: all commentary phases and reload play without a user gesture", async ({
  baseURL,
}) => {
  const browser = await chromium.launch({
    channel: process.platform === "win32" ? "chrome" : undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    // The old toggle could accidentally save mute. The automatic mode starts
    // enabled, while retaining any explicit choice made in the new controls.
    await page.addInitScript(() =>
      localStorage.setItem("w20:commentary", "off"),
    );
    const f = await setup(page, false, false);
    const cdp = await context.newCDPSession(page);
    const state = async () => {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const v = document.querySelector('video[data-active="true"]');
          return {
            activated: navigator.userActivation.hasBeenActive,
            audible: !!v && !v.muted && !v.paused && v.readyState >= 3 && v.webkitAudioDecodedByteCount > 0,
            clip: v?.dataset.clip,
            status: document.querySelector('.w20-performance')?.dataset.commentary
          };
        })()`,
        returnByValue: true,
        userGesture: false,
      });
      return result.value;
    };
    const expectVoice = async (clip: string) => {
      await expect.poll(state).toEqual({
        activated: false,
        audible: true,
        clip,
        status: "playing",
      });
    };
    await expectVoice("welcome");
    f.closing();
    await expectVoice("lastCall");
    f.reveal(14000);
    await expectVoice("spin");
    f.settle();
    await expectVoice("result");
    f.next();
    await expectVoice("welcome");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectVoice("welcome");
    expect(f.errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("a normal game click starts commentary when the browser blocks autoplay", async ({
  page,
  context,
}) => {
  const f = await setup(page, false, false);
  const cdp = await context.newCDPSession(page);
  const read = async (expression: string) => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      userGesture: false,
    });
    return result.value;
  };
  await expect
    .poll(() =>
      read("document.querySelector('.w20-performance')?.dataset.commentary"),
    )
    .toBe("blocked");
  expect(await read("navigator.userActivation.hasBeenActive")).toBe(false);
  const point = await read(`(() => {
    const r = document.querySelector('.w20-stage').getBoundingClientRect();
    return { x: r.x + 10, y: r.y + 10 };
  })()`);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      read(`(() => {
    const v = document.querySelector('video[data-active="true"]');
    return !!v && !v.muted && !v.paused && v.readyState >= 3 && v.webkitAudioDecodedByteCount > 0;
  })()`),
    )
    .toBe(true);
  await expect(page.locator(".w20-audio-start")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test("walking host stays in front of the wheel with a tracked transparent foreground", async ({
  page,
}) => {
  const f = await setup(page);
  const frame = () => hostPixels(page);
  await expect(page.locator(".w20-host-foreground")).toBeVisible();
  await expect.poll(async () => (await frame()).time).toBeGreaterThan(0.5);
  const start = await frame();
  await expect.poll(async () => (await frame()).time).toBeGreaterThan(4.8);
  const walked = await frame();
  expect(walked.count).toBeGreaterThan(15000);
  expect(walked.count).toBeLessThan(130000);
  expect(walked.corner).toBe(0);
  expect(Math.abs(start.x - walked.x)).toBeGreaterThan(8);
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/wheel20-live/v4/walking-in-game.png",
    ),
  });
  expect(f.errors).toEqual([]);
});

test("phone streams the current take and preserves the transparent host foreground", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = new Set<string>();
  page.on("request", (request) => {
    if (/\/media\/wheel20-live\/.*\.mp4/.test(request.url()))
      requests.add(request.url());
  });
  const f = await setup(page);
  const foreground = page.locator(".w20-host-foreground");
  await expect(foreground).toBeVisible();
  const active = page.locator('video[data-active="true"]');
  await expect
    .poll(() => active.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(1280);
  const mask = await hostPixels(page);
  expect(mask.fraction).toBeGreaterThan(0.01);
  expect(mask.fraction).toBeLessThan(0.4);
  expect(mask.corner).toBe(0);
  expect(requests.size).toBeLessThanOrEqual(2);
  expect(f.errors).toEqual([]);
});

test("GPU host playback avoids CPU pixel readback and keeps advancing under load", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    (window as any).hostReadbacks = 0;
    const original = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (
      ...args: Parameters<typeof original>
    ) {
      (window as any).hostReadbacks++;
      return original.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(page);
  const foreground = page.locator(".w20-host-foreground");
  await expect(foreground).toBeVisible();
  await expect(foreground).toHaveAttribute("data-renderer", "webgl");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const first = Number(await foreground.getAttribute("data-frame-time"));
  await expect
    .poll(async () => Number(await foreground.getAttribute("data-frame-time")))
    .toBeGreaterThan(first + 2);
  expect(await page.evaluate(() => (window as any).hostReadbacks)).toBe(0);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(f.errors).toEqual([]);
});

test("reduced motion pauses the presenter and a failed video keeps the studio visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  expect(
    await page
      .locator("video")
      .evaluateAll((videos: HTMLVideoElement[]) =>
        videos.every((v) => v.paused && v.muted),
      ),
  ).toBe(true);
  await page.route("**/media/wheel20-live/*.mp4", (r) => r.abort());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-media",
    "poster",
  );
  await expect(page.locator(".w20-poster")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bet on 1", exact: true }),
  ).toBeEnabled();
});
for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["phone", 390, 844],
  ["small-phone", 320, 640],
  ["short-phone", 320, 568],
  ["laptop", 1366, 768],
  ["tablet", 768, 1024],
  ["landscape", 844, 390],
  ["short-landscape", 667, 375],
  ["compact-landscape", 568, 320],
] as const)
  test(`${name}: studio, controls and rules fit`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const f = await setup(page);
    await expect(page.locator(".w20-poster")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".w20-poster")
          .evaluate((e: HTMLImageElement) => e.naturalWidth),
      )
      .toBeGreaterThan(1000);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const bounds = await page.evaluate(() => {
      const selectors = [
        ".w20-header",
        ".w20-dock",
        ".w20-footer",
        ".w20-wheel",
        ".w20-confirm",
        ".w20-chips",
      ];
      return selectors.map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return {
          selector,
          fits:
            r.x >= -1 &&
            r.y >= -1 &&
            r.right <= innerWidth + 1 &&
            r.bottom <= innerHeight + 1,
        };
      });
    });
    expect(bounds.filter((b) => !b.fits)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    for (const spot of ["1", "20", "40"])
      await expect(
        page.getByRole("button", { name: `Bet on ${spot}`, exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: path.resolve(
        import.meta.dirname,
        `../../../tmp/wheel20-live/${name}.png`,
      ),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Game rules", exact: true }).click();
    await expect(page.getByText(/animated studio presenter/)).toBeVisible();
    expect(f.errors).toEqual([]);
  });

test("only the displayed pull frame releases the wheel; stale and waiting frames do not", () => {
  const frame = {
    roundId: "r1",
    stage: "spin" as const,
    mediaTime: W20_CUES.pull - 1 / 24,
    ready: true,
  };
  expect(performanceProgress(frame, "r1")).toBe(0);
  expect(
    performanceProgress({ ...frame, mediaTime: W20_CUES.pull + 0.5 }, "r1"),
  ).toBeGreaterThan(0);
  expect(
    performanceProgress({ ...frame, mediaTime: W20_CUES.stop }, "r1"),
  ).toBe(1);
  expect(
    performanceProgress({ ...frame, mediaTime: W20_CUES.stop }, "r2"),
  ).toBe(0);
  expect(
    performanceProgress(
      { ...frame, mediaTime: W20_CUES.stop, ready: false },
      "r1",
    ),
  ).toBe(0);
});

test("native commentary, physical pull, reload and authoritative result stay synchronized", async ({
  page,
}) => {
  const f = await setup(page);
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-presenter",
    "host",
  );
  const background = await page.locator(".w20-poster").getAttribute("src");
  if (
    await page
      .getByRole("button", { name: "Enable sound", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Enable sound", exact: true })
      .click();
  f.reveal(14000);
  // The spin starts streaming when the round calls for it. It must still
  // decode in time for the physical pull and stay on the authoritative clock.
  await expect
    .poll(() =>
      page
        .locator('video[data-clip="spin"]')
        .evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(2);
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-clip",
    "spin",
  );
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-presenter",
    "spinner",
  );
  expect(await page.locator(".w20-poster").getAttribute("src")).toBe(
    background,
  );
  const spin = page.locator('video[data-clip="spin"]');
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(W20_CUES.pull);
  await expect(page.getByTestId("w20-rotor")).toHaveAttribute(
    "data-progress",
    "0.0000",
  );
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => !v.muted && !v.paused))
    .toBe(true);
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(2.7);
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/wheel20-live/v2/hand-contact-in-game.png",
    ),
  });
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(W20_CUES.pull + 0.3);
  const sample = await page.evaluate(() => ({
    time: Number(
      (document.querySelector(".w20-performance") as HTMLElement).dataset
        .frameTime,
    ),
    progress: Number(
      (document.querySelector('[data-testid="w20-rotor"]') as HTMLElement)
        .dataset.progress,
    ),
    otherSilent: [
      ...document.querySelectorAll<HTMLVideoElement>(
        'video:not([data-clip="spin"])',
      ),
    ].every((v) => v.muted && v.paused),
  }));
  expect(
    Math.abs(
      sample.progress -
        (sample.time - W20_CUES.pull) / (W20_CUES.stop - W20_CUES.pull),
    ),
  ).toBeLessThan(0.04);
  expect(sample.otherSilent).toBe(true);
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/wheel20-live/v2/spin-in-game.png",
    ),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-clip",
    "spin",
  );
  await expect
    .poll(() => spin.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(sample.time);
  await expect(page.getByTestId("w20-result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("w20-rotor")).toHaveAttribute(
    "data-segment",
    String(outcome.segment),
  );
  f.settle();
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-clip",
    "result",
  );
  await expect(page.locator(".w20-performance")).toHaveAttribute(
    "data-presenter",
    "host",
  );
  expect(await page.locator(".w20-poster").getAttribute("src")).toBe(
    background,
  );
  expect(f.errors).toEqual([]);
});
