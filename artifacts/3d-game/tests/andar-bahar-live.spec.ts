import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { writeFileSync } from "node:fs";
import type { Deal } from "../src/components/andarbaharlive/model";
import {
  cardQuad,
  dealerCue,
  shownCards,
  TRACKS,
} from "../src/components/andarbaharlive/dealerTimeline";
import type { TableRoundSnapshot } from "../src/components/table/useTableRound";
import {
  AB_TIMING,
  andarBaharRevealMs,
} from "@workspace/api-zod/andar-bahar-live";

const sample: Deal = {
  joker: 5,
  firstSide: "andar",
  winner: "bahar",
  cardsDealt: 6,
  andarCards: [7, 10, 11],
  baharCards: [23, 15, 31],
};

test("dealer keeps moving through each complete card slot and uses the longer waiting take", () => {
  const snapshot = {
    bettingEndsAt: 100000,
    revealEndsAt: 100000 + andarBaharRevealMs(sample.cardsDealt),
    config: { andarBaharMotionVersion: 1, bettingWindowMs: 30000 },
  } as TableRoundSnapshot;
  for (const elapsed of [
    0,
    AB_TIMING.jokerMs,
    AB_TIMING.jokerMs + AB_TIMING.cardMs,
  ]) {
    const slot = elapsed === 0 ? AB_TIMING.jokerMs : AB_TIMING.cardMs;
    const nearEnd = dealerCue(snapshot, sample, 100000 + elapsed + slot - 150);
    const before = dealerCue(snapshot, sample, 100000 + elapsed + slot - 350);
    // Regression: the old timeline returned the identical final frame here.
    expect(nearEnd.time - before.time).toBeGreaterThan(0.1);
    expect(nearEnd.time).toBeLessThan(nearEnd.end - 1 / 30);
    expect(nearEnd.rate).toBeCloseTo(1, 5);
    expect(
      shownCards(nearEnd, TRACKS[nearEnd.side].release - 0.01, sample).dealt,
    ).toBe(Math.max(0, nearEnd.index));
  }
  expect(dealerCue(snapshot, null, 76000).time).toBeGreaterThan(6);
  expect(snapshot.config.bettingWindowMs).toBe(30000);
});

test("every card waits for its hand release, including a 49-card round and both first sides", () => {
  for (const firstSide of ["andar", "bahar"] as const)
    for (const count of [1, 6, 49]) {
      const result = {
        ...sample,
        firstSide,
        cardsDealt: count,
        andarCards: Array(25).fill(7),
        baharCards: Array(25).fill(9),
      };
      const snapshot = {
        bettingEndsAt: 100000,
        revealEndsAt: 100000 + andarBaharRevealMs(count),
        config: { andarBaharMotionVersion: 1, bettingWindowMs: 30000 },
      } as TableRoundSnapshot;
      const opening = dealerCue(snapshot, result, 100000);
      expect(shownCards(opening, TRACKS.joker.release - 0.01, result)).toEqual({
        joker: false,
        dealt: 0,
      });
      expect(cardQuad("joker", TRACKS.joker.face - 0.01)).toBeNull();
      for (let i = 0; i < count; i++) {
        const cue = dealerCue(
          snapshot,
          result,
          100000 + AB_TIMING.jokerMs + i * AB_TIMING.cardMs + 1,
        );
        expect(cue.index).toBe(i);
        expect(cue.side).toBe(
          i % 2 === 0 ? firstSide : firstSide === "andar" ? "bahar" : "andar",
        );
        expect(
          shownCards(cue, TRACKS[cue.side].release - 0.01, result).dealt,
        ).toBe(i);
        expect(
          shownCards(cue, TRACKS[cue.side].release + 0.01, result).dealt,
        ).toBe(i + 1);
        expect(cardQuad(cue.side, TRACKS[cue.side].face - 0.01)).toBeNull();
      }
      expect(dealerCue(snapshot, result, snapshot.revealEndsAt - 1).kind).toBe(
        "hold",
      );
    }
});

test("does not expose recorded card results if the clean table asset fails", async ({
  page,
}) => {
  await page.route("**/felt-plate-v3.png", (route) => route.abort());
  await setup(page);
  await expect(
    page.getByText("Studio video unavailable · Table remains connected"),
  ).toBeVisible();
  const pixel = await page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext("webgl")!;
      const pixel = new Uint8Array(4);
      gl.readPixels(980, 70, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel.slice(0, 3)];
    });
  expect(pixel).toEqual([0, 0, 0]);
  await expect(
    page.getByRole("button", { name: "Bet on Andar", exact: true }),
  ).toBeEnabled();
});
async function setup(
  page: Page,
  options: { wallet?: number; drop?: boolean; min?: string } = {},
) {
  let phase = "betting",
    deadline = 0,
    offline = false,
    wallet = options.wallet ?? 500000,
    round = 1;
  let outcome: Deal | null = null;
  let myBets: any[] = [];
  const posts: any[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/auth/me")
      body = {
        id: "ab-live-test",
        email: "ab@example.test",
        displayName: "Table tester",
        role: "player",
      };
    else if (url.pathname === "/api/wallet/balance")
      body = {
        walletId: "shared",
        balance: String(wallet),
        currency: "INR",
        scope: "lunar",
      };
    else if (url.pathname === "/api/wallet/balances")
      body = { balances: { lunar: String(wallet) }, currency: "INR" };
    else if (url.pathname.startsWith("/api/andar-bahar")) {
      if (offline)
        return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
      if (url.pathname.endsWith("/config"))
        body = {
          enabled: true,
          maxBetsPerDeal: 6,
          maxMultiplier: 130,
          maxStakePaise: "20000000",
          payouts: {
            firstSide: 1.65,
            secondSide: 1.75,
            ranges: Object.fromEntries(
              [
                "range1_5",
                "range6_10",
                "range11_15",
                "range16_25",
                "range26_30",
                "range31_35",
                "range36_40",
                "range41_49",
              ].map((s, i) => [
                s,
                {
                  multiplier: [
                    3.13, 3.91, 5.02, 3.89, 13.93, 22.98, 44.81, 107.28,
                  ][i],
                },
              ]),
            ),
          },
        };
      else if (url.pathname.endsWith("/recent")) body = [];
      else if (url.pathname.endsWith("/round")) {
        deadline ||= Date.now() + AB_TIMING.bettingWindowMs;
        const revealMs = outcome
          ? andarBaharRevealMs(outcome.cardsDealt)
          : 5000;
        body = {
          roundId: `ab-${round}`,
          gameCode: "andar-bahar",
          phase,
          now: Date.now(),
          bettingEndsAt: deadline,
          revealEndsAt: deadline + revealMs,
          settleEndsAt: deadline + revealMs + 5000,
          config: {
            andarBaharMotionVersion: 1,
            bettingWindowMs: AB_TIMING.bettingWindowMs,
            revealDurationMs: revealMs,
            settleDurationMs: 5000,
            minStakePaise: options.min ?? "10000",
            maxStakePaise: "20000000",
          },
          myBets,
          liveBets: [],
          outcome,
          recent: Array.from({ length: 30 }, (_, i) => ({
            roundId: `past-${i}`,
            outcome: { ...sample, winner: i % 3 === 0 ? "andar" : "bahar" },
          })),
          playerCount: myBets.length,
          totalStake: "0",
          serverSeedHash: "test-commitment",
          clientSeed: "test",
          nonce: round,
        };
      } else if (url.pathname.endsWith("/deal")) {
        const input = route.request().postDataJSON();
        posts.push(input);
        const stake = input.bets.reduce(
          (sum: number, b: any) => sum + Number(b.amountPaise),
          0,
        );
        wallet -= stake;
        myBets.push({
          slipId: `slip-${posts.length}`,
          bets: input.bets,
          totalStake: String(stake),
          payoutAmount: "0",
          status: "pending",
        });
        if (options.drop) return route.abort("connectionreset");
        body = { slipId: myBets.at(-1).slipId };
      }
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/andar-bahar-live");
  await expect(
    page.getByRole("button", { name: "Bet on Andar", exact: true }),
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
    reveal(elapsed = 0, result = sample) {
      outcome = result;
      phase = "reveal";
      deadline = Date.now() - elapsed;
    },
    next() {
      round++;
      phase = "betting";
      outcome = null;
      myBets = [];
      deadline = Date.now() + AB_TIMING.bettingWindowMs;
    },
  };
}

test("edits the slip, undoes exactly one action and confirms only once", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("button", { name: "Select ₹200 chip", exact: true })
    .click();
  await page.getByRole("button", { name: "Bet on Andar", exact: true }).click();
  await page.getByRole("button", { name: "Bet on Bahar", exact: true }).click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹400");
  await page.getByRole("button", { name: "Undo last bet" }).click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹200");
  await page.getByRole("button", { name: "Double bets" }).click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹400");
  await page
    .getByRole("button", { name: "CONFIRM BETS", exact: true })
    .dblclick();
  await expect(
    page.getByRole("button", { name: "BETS CONFIRMED ✓" }),
  ).toBeDisabled();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toEqual({
    roundId: "ab-1",
    bets: [{ type: "andar", amountPaise: "40000" }],
  });
  expect(state.wallet).toBe(460000);
  expect(state.errors).toEqual([]);
  state.next();
  await expect(
    page.getByRole("button", { name: "Repeat last bets" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Repeat last bets" }).click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹400");
  await page.getByRole("button", { name: "Clear bets" }).click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹0");
});

test("does not allow an empty slip when the server minimum is zero", async ({
  page,
}) => {
  const state = await setup(page, { min: "0", wallet: 0 });
  await expect(
    page.getByRole("button", { name: "CONFIRM BETS", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ab-footer")).toContainText("₹100");
  await page.getByRole("button", { name: "Bet on Andar", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Insufficient wallet balance.",
  );
  expect(state.posts).toHaveLength(0);
});

test("reconciles a lost bet response without sending another debit", async ({
  page,
}) => {
  const state = await setup(page, { drop: true });
  await page.getByRole("button", { name: "Bet on Bahar", exact: true }).click();
  await page.getByRole("button", { name: "CONFIRM BETS", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "BETS CONFIRMED ✓" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "BETS CONFIRMED ✓" }),
  ).toBeDisabled();
  expect(state.posts).toHaveLength(1);
  expect(state.wallet).toBe(490000);
});

test("paces server cards, highlights the matching side and hides results next round", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(page.getByTestId("ab-joker")).toHaveText("JOKER");
  state.reveal(800);
  await expect(page.getByTestId("ab-joker")).toHaveText("JOKER");
  await expect(
    page.getByTestId("ab-joker").getByRole("img", { name: "6 of spades" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bet on Andar", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("ab-card-count")).not.toHaveText("6");
  await expect(page.locator(".ab-result")).toContainText("Bahar wins", {
    timeout: 16000,
  });
  await expect(page.locator('[data-spot="bahar"]')).toHaveClass(/is-winner/);
  await expect(page.locator('[data-spot="range6_10"]')).toHaveClass(
    /is-winner/,
  );
  await expect(page.getByTestId("ab-card-count")).toHaveText("6");
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/andar-bahar-live/result-desktop.png",
    ),
  });
  state.next();
  await expect(page.getByTestId("ab-joker")).toHaveText("JOKER");
  await expect(page.locator(".ab-result")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("a card opening keeps rendering intermediate hand frames without an early reveal", async ({
  page,
}) => {
  const state = await setup(page);
  state.reveal();
  await expect(page.locator("canvas")).toHaveAttribute("data-cue", "card:0");
  const before = await page.locator("canvas").evaluate((c) => ({
    paints: Number(c.dataset.paints),
    seeks: Number(c.dataset.seeks),
  }));
  const samples = await page.evaluate(
    () =>
      new Promise<{ time: number; dealt: number; cue: string; rate: number }[]>(
        (resolve) => {
          const samples: {
            time: number;
            dealt: number;
            cue: string;
            rate: number;
          }[] = [];
          const start = performance.now();
          function sample() {
            const c = document.querySelector("canvas")!;
            samples.push({
              time: Number(c.dataset.frame),
              dealt: Number(c.dataset.dealt),
              cue: c.dataset.cue!,
              rate: Number(c.dataset.playbackRate),
            });
            if (performance.now() - start >= 900) resolve(samples);
            else requestAnimationFrame(sample);
          }
          sample();
        },
      ),
  );
  const after = await page.locator("canvas").evaluate((c) => ({
    paints: Number(c.dataset.paints),
    seeks: Number(c.dataset.seeks),
  }));
  expect(after.paints - before.paints).toBeGreaterThan(25);
  expect(after.seeks - before.seeks).toBeLessThanOrEqual(1);
  const opening = samples.filter((s) => s.cue === "card:0");
  expect(opening.length).toBeGreaterThan(10);
  for (const frame of opening) {
    expect(frame.dealt).toBe(Number(frame.time >= TRACKS.andar.release));
    expect(frame.rate).toBeGreaterThanOrEqual(0.95);
    expect(frame.rate).toBeLessThanOrEqual(1.05);
  }
  expect(
    await page
      .locator('video[data-active="true"]')
      .evaluate((v) => (v as HTMLVideoElement).paused),
  ).toBe(false);
  expect(state.errors).toEqual([]);
});

test("Bahar-first hands survive reconnect and recorded ranks stay erased", async ({
  page,
}) => {
  const state = await setup(page);
  state.reveal(0, {
    ...sample,
    joker: 18,
    firstSide: "bahar",
    winner: "andar",
    andarCards: [7, 10, 44],
    baharCards: [23, 15, 11],
  });
  await expect(page.locator("canvas")).toHaveAttribute("data-cue", "card:0");
  await expect(page.locator("canvas")).toHaveAttribute("data-dealt", "1");
  const videoTime = Number(
    await page.locator("canvas").getAttribute("data-frame"),
  );
  expect(videoTime).toBeGreaterThanOrEqual(TRACKS.bahar.release);
  await page.reload();
  await expect(page.getByTestId("ab-card-count")).not.toHaveText("0");
  await expect(page.locator(".ab-result")).toContainText("Andar wins", {
    timeout: 16000,
  });
  await expect(page.locator("canvas")).toHaveAttribute("data-cue", "hold");
  await page.waitForTimeout(250);
  const ghostPixels = await page
    .locator("canvas")
    .evaluate(async (canvas: HTMLCanvasElement) => {
      const img = new Image();
      img.src = "/media/andar-bahar-live/felt-plate-v3.png";
      await img.decode();
      const clean = document.createElement("canvas");
      clean.width = 1430;
      clean.height = 610;
      const context = clean.getContext("2d")!;
      context.drawImage(img, 0, 0);
      const a = context.getImageData(945, 520, 70, 35).data;
      const gl = canvas.getContext("webgl")!;
      const b = new Uint8Array(70 * 35 * 4);
      gl.readPixels(945, 55, 70, 35, gl.RGBA, gl.UNSIGNED_BYTE, b);
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        const j = ((34 - Math.floor(i / 280)) * 70 + ((i / 4) % 70)) * 4;
        if (
          Math.max(
            Math.abs(a[i] - b[j]),
            Math.abs(a[i + 1] - b[j + 1]),
            Math.abs(a[i + 2] - b[j + 2]),
          ) > 18
        )
          changed++;
      }
      return changed;
    });
  expect(ghostPixels).toBeLessThan(12);
  const drawerBorderPixels = await page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext("webgl")!;
      const pixels = new Uint8Array(116 * 28 * 4);
      gl.readPixels(656, 0, 116, 28, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let gray = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 180 && pixels[i + 2] > pixels[i + 1] * 0.9) gray++;
      return gray;
    });
  expect(drawerBorderPixels).toBeLessThan(3);
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/andar-bahar-live/hand-hold.png",
    ),
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const banner = await page.locator(".ab-result").boundingBox();
    // The filmed dealer's face starts at x=720 in the 1430px source.
    expect(banner!.x + banner!.width).toBeLessThan((width * 720) / 1430);
  }
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      "../../../tmp/andar-bahar-live/result-mobile.png",
    ),
  });
  expect(state.errors).toEqual([]);
});

test("normal-speed openings join at the same resting hand pose without a playback gap", async ({
  page,
}) => {
  const state = await setup(page);
  const seams = await page.evaluate(async (tracks) => {
    const v = document.createElement("video");
    v.muted = true;
    v.src = "/media/andar-bahar-live/dealer-continuous-v7.mp4";
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = reject;
    });
    const c = document.createElement("canvas");
    c.width = 420;
    c.height = 220;
    const ctx = c.getContext("2d")!;
    async function pixels(t: number) {
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = t;
      });
      ctx.drawImage(v, 620, 370, 420, 220, 0, 0, 420, 220);
      return ctx.getImageData(0, 0, 420, 220).data;
    }
    const resting = await pixels(tracks.joker.start);
    const differences: Record<string, number> = {};
    for (const [name, take] of Object.entries(tracks)) {
      for (const [edge, time] of [
        ["start", take.start],
        ["end", take.end - 1 / 60],
      ] as const) {
        const p = await pixels(time);
        let diff = 0;
        for (let i = 0; i < p.length; i++)
          if (i % 4 !== 3) diff += Math.abs(p[i] - resting[i]);
        differences[`${name}:${edge}`] = diff / (420 * 220 * 3);
      }
    }
    v.removeAttribute("src");
    v.load();
    return differences;
  }, TRACKS);
  for (const difference of Object.values(seams))
    expect(difference).toBeLessThan(5);
  state.reveal();
  await expect(page.locator("canvas")).toHaveAttribute("data-cue", "card:0");
  const playback = await page.evaluate(
    () =>
      new Promise<{
        gaps: number[];
        cues: string[];
        backwards: number;
        slow: unknown[];
      }>((resolve) => {
        const gaps: number[] = [],
          cues: string[] = [];
        const slow: unknown[] = [];
        let lastPaint = "",
          lastAt = performance.now(),
          lastCue = "",
          lastTime = 0,
          backwards = 0;
        const start = lastAt;
        function sample(now: number) {
          const c = document.querySelector("canvas")!;
          if (c.dataset.paints !== lastPaint) {
            const cue = c.dataset.cue!;
            const time = Number(c.dataset.frame);
            if (lastPaint) {
              gaps.push(now - lastAt);
              if (now - lastAt > 70)
                slow.push({
                  from: lastCue,
                  to: cue,
                  fromTime: lastTime,
                  toTime: time,
                  gap: now - lastAt,
                  seeks: c.dataset.seeks,
                });
            }
            if (cue !== lastCue) cues.push(cue);
            else if (time + 0.002 < lastTime) backwards++;
            lastPaint = c.dataset.paints!;
            lastAt = now;
            lastCue = cue;
            lastTime = time;
          }
          if (now - start > 11000) resolve({ gaps, cues, backwards, slow });
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }),
  );
  console.info("Continuous motion", {
    seams,
    maxFrameGapMs: Math.max(...playback.gaps),
    slow: playback.slow,
  });
  expect(playback.cues).toEqual([
    "card:0",
    "card:1",
    "card:2",
    "card:3",
    "card:4",
    "card:5",
    "hold",
  ]);
  expect(playback.backwards).toBe(0);
  expect(Math.max(...playback.gaps)).toBeLessThan(180);
  await test
    .info()
    .attach("continuous-motion", {
      body: JSON.stringify({
        seams,
        maxFrameGapMs: Math.max(...playback.gaps),
        frames: playback.gaps.length,
        cues: playback.cues,
      }),
      contentType: "application/json",
    });
  expect(state.errors).toEqual([]);
});

test("blocks betting offline, rejects overspending and limits the slip to six spots", async ({
  page,
}) => {
  const state = await setup(page, { wallet: 100000 });
  await page
    .getByRole("button", { name: "Select ₹5000 chip", exact: true })
    .click();
  await page.getByRole("button", { name: "Bet on Andar", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Insufficient wallet balance.",
  );
  await expect(page.getByTestId("ab-total")).toHaveText("₹0");
  await page
    .getByRole("button", { name: "Select ₹100 chip", exact: true })
    .click();
  for (const name of [
    "Andar",
    "Bahar",
    "1–5",
    "6–10",
    "11–15",
    "16–25",
    "26–30",
  ])
    await page
      .getByRole("button", { name: `Bet on ${name}`, exact: true })
      .click();
  await expect(page.getByTestId("ab-total")).toHaveText("₹600");
  await expect(page.getByRole("alert")).toContainText("up to 6");
  state.disconnect();
  await expect(
    page.getByRole("button", { name: "CONFIRM BETS", exact: true }),
  ).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test("cards render at display pixel density and survive resizing during a round", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    const state = await setup(page);
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-renderer", "gpu");
    const density = () =>
      canvas.evaluate((c: HTMLCanvasElement) => ({
        actual: c.width,
        needed: Math.ceil(
          Math.min(c.clientWidth, (c.clientHeight * 1430) / 565) *
            devicePixelRatio,
        ),
      }));
    await expect
      .poll(async () => {
        const { actual, needed } = await density();
        return actual - needed;
      })
      .toBe(0);
    expect((await density()).actual).toBeGreaterThan(2500);
    state.reveal(andarBaharRevealMs(sample.cardsDealt) - 400);
    await expect(canvas).toHaveAttribute("data-cue", "hold");
    await expect(canvas).toHaveAttribute("data-dealt", "6");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(canvas).toHaveJSProperty("width", 1430);
    await expect(canvas).toHaveAttribute("data-dealt", "6");
    expect(
      await canvas.evaluate((c: HTMLCanvasElement) =>
        c.getContext("webgl")!.isContextLost(),
      ),
    ).toBe(false);
    expect(state.errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("source hand pixels survive compositing and the next opening is already decoded", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('video[data-take="andar"]')).toHaveJSProperty(
    "readyState",
    4,
  );
  await expect
    .poll(() =>
      page
        .locator('video[data-take="andar"]')
        .evaluate((v: HTMLVideoElement) => v.seeking),
    )
    .toBe(false);
  const warm = await page
    .locator('video[data-take="andar"]')
    .evaluate((v: HTMLVideoElement) => ({
      time: v.currentTime,
      paused: v.paused,
    }));
  expect(warm.time).toBeCloseTo(TRACKS.andar.start - 0.4, 2);
  expect(warm.paused).toBe(true);
  const moduleUrl =
    "/@fs/" +
    path
      .resolve(
        import.meta.dirname,
        "../src/components/andarbaharlive/studioRenderer.ts",
      )
      .replaceAll("\\", "/");
  const result = await page.evaluate(async (moduleUrl) => {
    const { createStudioRenderer } = await import(moduleUrl);
    const { cardQuad, restingQuad } = await import(
      moduleUrl.replace("studioRenderer.ts", "dealerTimeline.ts")
    );
    const v = document.createElement("video");
    v.muted = true;
    v.src = "/media/andar-bahar-live/dealer-continuous-v7.mp4";
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = reject;
    });
    await new Promise<void>((resolve) => {
      v.onseeked = () => resolve();
      // Inspect an intermediate 60-fps frame, between two recorded frames.
      v.currentTime = 17.983333;
    });
    const plate = new Image();
    plate.src = "/media/andar-bahar-live/felt-plate-v3.png";
    await plate.decode();
    const output = document.createElement("canvas");
    output.width = 1430;
    output.height = 565;
    const renderer = createStudioRenderer(output);
    renderer.setPlate(plate);
    renderer.render(v, [
      { card: 18, quad: restingQuad("joker") },
      { card: 23, quad: restingQuad("bahar") },
      { card: 38, quad: cardQuad("andar", v.currentTime) },
    ]);
    const source = document.createElement("canvas");
    source.width = 1430;
    source.height = 744;
    const context = source.getContext("2d")!;
    context.drawImage(v, 0, 0);
    const native = context.getImageData(695, 480, 35, 42).data;
    const gl = output.getContext("webgl")!;
    const actual = new Uint8Array(35 * 42 * 4);
    gl.readPixels(695, 610 - 522, 35, 42, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    let difference = 0;
    for (let y = 0; y < 42; y++)
      for (let x = 0; x < 35; x++)
        for (let channel = 0; channel < 3; channel++)
          difference += Math.abs(
            native[(y * 35 + x) * 4 + channel] -
              actual[((41 - y) * 35 + x) * 4 + channel],
          );
    const crop = document.createElement("canvas");
    crop.width = 1000;
    crop.height = 400;
    crop
      .getContext("2d")!
      .drawImage(output, 620, 365, 500, 200, 0, 0, 1000, 400);
    const image = crop.toDataURL();
    renderer.dispose();
    v.removeAttribute("src");
    v.load();
    return { difference: difference / (35 * 42 * 3), image };
  }, moduleUrl);
  expect(result.difference).toBeLessThan(2);
  writeFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../tmp/andar-bahar-live/native-hand-table-closeup.png",
    ),
    Buffer.from(result.image.split(",")[1], "base64"),
  );
  await test.info().attach("native-hand-table-closeup", {
    body: Buffer.from(result.image.split(",")[1], "base64"),
    contentType: "image/png",
  });
});

test("decoded video drives GPU frames without CPU pixel readback or repeated seeks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData;
    (window as any).studioReadbacks = 0;
    CanvasRenderingContext2D.prototype.getImageData = function (
      ...args: Parameters<typeof original>
    ) {
      (window as any).studioReadbacks++;
      return original.apply(this, args);
    };
  });
  const state = await setup(page);
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "gpu");
  const before = await page.locator("canvas").evaluate((c) => ({
    paints: Number(c.dataset.paints),
    seeks: Number(c.dataset.seeks),
  }));
  await page.waitForTimeout(2500);
  const after = await page.locator("canvas").evaluate((c) => ({
    paints: Number(c.dataset.paints),
    seeks: Number(c.dataset.seeks),
    p95: Number(c.dataset.paintP95),
  }));
  expect(after.paints - before.paints).toBeGreaterThan(80);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-prepared-fps",
    "60",
  );
  expect(after.seeks - before.seeks).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (window as any).studioReadbacks)).toBe(0);
  const media = await page
    .locator('video[data-active="true"]')
    .evaluate((v: HTMLVideoElement) => ({
      width: v.videoWidth,
      height: v.videoHeight,
    }));
  expect(media).toEqual({ width: 1430, height: 744 });
  console.info("Studio playback", {
    framesIn2500ms: after.paints - before.paints,
    seeks: after.seeks - before.seeks,
    paintP95ms: after.p95,
  });
  await test.info().attach("studio-performance", {
    body: JSON.stringify({
      frames: after.paints - before.paints,
      seeks: after.seeks - before.seeks,
      paintP95: after.p95,
    }),
    contentType: "application/json",
  });
  expect(state.errors).toEqual([]);
});

for (const [width, height] of [
  [1440, 900],
  [1366, 768],
  [390, 844],
  [320, 740],
  [320, 568],
  [844, 390],
]) {
  test(`studio, chips and betting controls fit ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    await expect
      .poll(() =>
        page
          .locator('video[data-active="true"]')
          .evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    const before = await page
      .locator('video[data-active="true"]')
      .evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(600);
    const after = await page
      .locator('video[data-active="true"]')
      .evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(after).not.toBe(before);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    );
    expect(overflow).toBe(false);
    for (const selector of [
      ".ab-main-spots",
      ".ab-range-spots",
      ".ab-actions",
      ".ab-chips",
      ".ab-header",
      ".ab-footer",
    ]) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
    }
    await expect(page.locator("canvas")).toHaveCSS("object-fit", "contain");
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-renderer",
      "gpu",
    );
    await page.screenshot({
      path: path.resolve(
        import.meta.dirname,
        `../../../tmp/andar-bahar-live/table-${width}.png`,
      ),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Game rules", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("recorded footage");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Dealer & card motion" })
      .uncheck();
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page
          .locator('video[data-active="true"]')
          .evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(true);
    expect(state.errors).toEqual([]);
  });
}
