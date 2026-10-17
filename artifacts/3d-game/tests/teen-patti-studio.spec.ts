import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { MyBet } from "../src/components/table/useTableRound";

import {
  DEALER_FILM,
  PAPER_QUADS,
  TURN_ORDER,
} from "../src/components/teenpattiLive/dealerFilm";

const outcome = {
  handACards: [0, 13, 26],
  handBCards: [9, 24, 38],
  handA: { category: "trail", score: 6 },
  handB: { category: "highCard", score: 1 },
  winner: "playerA",
};
async function studio(page: Page, late = false) {
  let socket: WebSocketRoute;
  let walletBalance = 1000000n;
  const betRequests: { bets: { type: string; amountPaise: string }[] }[] = [];
  let nextBetError: string | null = null;
  let nextBetGate: Promise<void> | null = null;
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
    roundId: "studio-round-1",
    gameCode: "teen-patti-live",
    phase: late ? "reveal" : "betting",
    now,
    bettingEndsAt: now + 20000,
    revealEndsAt: late ? now + 400 : now + 29000,
    settleEndsAt: now + 34000,
    serverSeedHash: "test",
    clientSeed: "test",
    nonce: 1,
    outcome: late ? outcome : null,
    serverSeed: null,
    totalStake: "0",
    playerCount: 0,
    config,
    liveBets: [],
    myBets: [] as MyBet[],
    recent: [],
  };
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
        id: "studio-preview",
        email: "studio@example.test",
        displayName: "Player",
        role: "player",
      };
    else if (path === "/api/teen-patti-live/config") body = config;
    else if (
      path === "/api/teen-patti-live/bet" &&
      route.request().method() === "POST"
    ) {
      const request = route.request().postDataJSON();
      betRequests.push(request);
      const gate = nextBetGate;
      nextBetGate = null;
      if (gate) await gate;
      const error =
        nextBetError ??
        (snapshot.phase !== "betting"
          ? "Betting is closed for this round"
          : null);
      nextBetError = null;
      if (error) {
        await route.fulfill({
          status: 400,
          json: { error: { code: "BAD_REQUEST", message: error } },
        });
        return;
      }
      const stake = request.bets.reduce(
        (sum: bigint, bet: { amountPaise: string }) =>
          sum + BigInt(bet.amountPaise),
        0n,
      );
      walletBalance -= stake;
      const slipId = `studio-slip-${betRequests.length}`;
      snapshot.myBets = [
        ...snapshot.myBets,
        {
          slipId,
          totalStake: stake.toString(),
          bets: request.bets,
          status: "pending",
          payoutAmount: "0",
          auditRoundId: null,
        },
      ];
      body = {
        slipId,
        roundId: snapshot.roundId,
        totalStake: stake.toString(),
      };
    } else if (path === "/api/teen-patti-live/round")
      body = { ...snapshot, now: Date.now() };
    else if (path === "/api/teen-patti-live/recent") body = [];
    else if (path === "/api/game/registry") body = [];
    else if (path.includes("/wallet/"))
      body = {
        balance: walletBalance.toString(),
        currency: "INR",
        scope: "teen-patti-live",
      };
    else if (path.includes("/config/"))
      body = { ...config, gameCode: "teen-patti-live" };
    await route.fulfill({ json: body });
  });
  await page.goto("/teen-patti-live");
  await expect(page.getByTestId("tpl-dealer-film")).toBeAttached();
  const emit = (payload: object) =>
    socket.send(
      JSON.stringify({
        op: "event",
        topic: "table-rounds:teen-patti-live",
        payload,
      }),
    );
  return {
    betRequests,
    rejectNextBet(message: string) {
      nextBetError = message;
    },
    holdNextBet() {
      let release!: () => void;
      nextBetGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    betting(remaining = 20000, roundId = snapshot.roundId) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        myBets: roundId === snapshot.roundId ? snapshot.myBets : [],
        roundId,
        phase: "betting",
        bettingEndsAt: now + remaining,
        revealEndsAt: now + remaining + 9000,
        settleEndsAt: now + remaining + 14000,
        outcome: null,
      };
      emit({
        type: "phase",
        roundId,
        phase: "betting",
        endsAt: snapshot.bettingEndsAt,
        ts: now,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 1,
      });
    },
    reveal(duration = 9000, roundId = snapshot.roundId) {
      const now = Date.now();
      snapshot = {
        ...snapshot,
        roundId,
        phase: "reveal",
        bettingEndsAt: now,
        revealEndsAt: now + duration,
        settleEndsAt: now + duration + 5000,
        outcome,
      };
      emit({
        type: "phase",
        roundId,
        phase: "reveal",
        endsAt: snapshot.revealEndsAt,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 1,
        ts: now,
      });
      emit({ type: "result", roundId, outcome, serverSeed: "test" });
    },
    repeat() {
      emit({
        type: "result",
        roundId: snapshot.roundId,
        outcome,
        serverSeed: "test",
      });
    },
  };
}

test("filmed dealer plays while all six server cards reveal before the winner; duplicate results do not replay", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const round = await studio(page);
  await expect
    .poll(() =>
      page
        .getByTestId("tpl-dealer-film")
        .evaluate((el: HTMLVideoElement) => el.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page
      .getByTestId("tpl-dealer-film")
      .evaluate((video: HTMLVideoElement) => ({
        width: video.videoWidth,
        height: video.videoHeight,
        filter: getComputedStyle(video).filter,
      })),
  ).toEqual({ width: 1920, height: 1080, filter: "none" });
  await page.getByTestId("chip-100").click();
  await page.getByTestId("spot-playerA").click();
  await expect(page.getByTestId("tpl-flat-spot-playerA")).toContainText("100");
  await page.screenshot({
    path: info.outputPath("desktop-betting.png"),
    fullPage: true,
  });
  round.reveal();
  await expect(page.getByTestId("text-deal-readout")).toHaveText("Dealing");
  await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
  await expect
    .poll(() => page.getByTestId("tpl-flat-table").getAttribute("data-action"))
    .toBe("opening");
  await page.screenshot({ path: info.outputPath("dealer-opening.png") });
  // Sample the displayed frames, rather than just the plan's formulas.
  const frames = await page.evaluate(async () => {
    const samples: {
      up: number;
      badge: boolean;
      media: number;
      progress: number;
      decoded: number;
      printed: number[];
      customer: number[];
    }[] = [];
    // RAF can run at 120/144 Hz. Observe the complete server window instead
    // of assuming 620 browser frames cover a nine-second performance.
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const progress = Number(
        document
          .querySelector('[data-testid="tpl-flat-table"]')
          ?.getAttribute("data-deal-progress"),
      );
      samples.push({
        customer: [
          ...document.querySelectorAll(
            '.tpl-customer-card[data-face-up="true"]',
          ),
        ].map((el) =>
          Number(el.getAttribute("data-testid")!.split("-").at(-1)),
        ),
        decoded: Number(
          document
            .querySelector('[data-testid="tpl-flat-table"]')
            ?.getAttribute("data-media-time"),
        ),
        printed: [
          ...document.querySelectorAll(
            '.tpl-physical-ink g[data-testid][data-face-up="true"]',
          ),
        ].map((el) =>
          Number(el.getAttribute("data-testid")!.split("-").at(-1)),
        ),
        up: document.querySelectorAll(
          '.tpl-physical-ink g[data-face-up="true"]',
        ).length,
        badge: !!document.querySelector('[data-testid="badge-deal-winner"]'),
        media: (
          document.querySelector(
            '[data-testid="tpl-dealer-film"]',
          ) as HTMLVideoElement
        ).currentTime,
        progress,
      });
      if (progress >= 1 && samples.at(-1)?.badge) break;
    }
    return samples;
  });
  expect(
    Math.max(...frames.map((f) => f.media)) -
      Math.min(...frames.map((f) => f.media)),
  ).toBeGreaterThan(2);
  expect(frames.every((f) => !f.badge || f.up === 6)).toBe(true);
  const revealOrder: number[] = [];
  for (const frame of frames)
    for (const card of frame.customer)
      if (!revealOrder.includes(card)) revealOrder.push(card);
  expect(revealOrder).toEqual([...TURN_ORDER]);
  for (const frame of frames.filter((f) => f.progress < 1)) {
    for (const index of frame.printed)
      expect(frame.decoded).toBeGreaterThanOrEqual(
        DEALER_FILM.printAfter[index],
      );
    for (const index of frame.customer)
      expect(frame.decoded).toBeGreaterThanOrEqual(
        DEALER_FILM.printAfter[index],
      );
  }
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(
    page.locator('.tpl-customer-card[data-face-up="true"]'),
  ).toHaveCount(6);
  expect(
    await page
      .locator(".tpl-customer-card")
      .evaluateAll((cards) =>
        cards.map((card) => Number(card.getAttribute("data-card"))),
      ),
  ).toEqual([...outcome.handACards, ...outcome.handBCards]);
  await expect
    .poll(() =>
      page
        .getByTestId("tpl-dealer-film")
        .evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await expect(
    page.locator(".tpl-hands-readout, .tpl-readout-cards"),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("desktop-result.png"),
    fullPage: true,
  });
  round.repeat();
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-deal-progress",
    "1.0000",
  );
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  expect(errors).toEqual([]);
});

test("native HD paired turns move both hands while the camera stays fixed", async ({
  page,
}) => {
  await studio(page);
  const motion = await page
    .getByTestId("tpl-dealer-film")
    .evaluate(async (runtime: HTMLVideoElement) => {
      const film = document.createElement("video");
      film.muted = true;
      film.src = runtime.currentSrc || runtime.src;
      await new Promise<void>((resolve, reject) => {
        film.onloadeddata = () => resolve();
        film.onerror = () => reject(new Error("HD media failed"));
        film.load();
      });
      const canvas = document.createElement("canvas");
      canvas.width = 864;
      canvas.height = 486;
      const ctx = canvas.getContext("2d")!;
      const capture = async (time: number) => {
        await new Promise<void>((resolve) => {
          film.onseeked = () => resolve();
          film.currentTime = time;
        });
        ctx.drawImage(film, 0, 0, 864, 486);
        return [
          ctx.getImageData(215, 330, 190, 115).data,
          ctx.getImageData(445, 330, 190, 115).data,
          ctx.getImageData(40, 40, 100, 220).data,
        ];
      };
      // Native, independently inspected frames of the first paired grip.
      const a = await capture(6.875),
        b = await capture(7.625);
      const diff = (x: Uint8ClampedArray, y: Uint8ClampedArray) =>
        x.reduce(
          (sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - y[i])),
          0,
        ) /
        (x.length * 0.75);
      const result = {
        width: film.videoWidth,
        height: film.videoHeight,
        left: diff(a[0], b[0]),
        right: diff(a[1], b[1]),
        room: diff(a[2], b[2]),
      };
      film.removeAttribute("src");
      film.load();
      return result;
    });
  expect(motion.width).toBe(1920);
  expect(motion.height).toBe(1080);
  expect(motion.left).toBeGreaterThan(3);
  expect(motion.right).toBeGreaterThan(3);
  expect(motion.room).toBeLessThan(2);
});

test("every filmed card leaves empty felt during its lift and returns to its own separate slot", async ({
  page,
}, info) => {
  await studio(page);
  const result = await page.getByTestId("tpl-dealer-film").evaluate(
    async (runtime: HTMLVideoElement, data) => {
      const film = document.createElement("video");
      film.muted = true;
      film.src = runtime.currentSrc || runtime.src;
      await new Promise<void>((resolve, reject) => {
        film.onloadeddata = () => resolve();
        film.onerror = () => reject(new Error("card media failed"));
        film.load();
      });
      const canvas = document.createElement("canvas");
      canvas.width = 864;
      canvas.height = 486;
      const ctx = canvas.getContext("2d")!;
      const capture = async (seconds: number) => {
        await new Promise<void>((resolve) => {
          film.onseeked = () => resolve();
          film.currentTime = seconds;
        });
        ctx.drawImage(film, 0, 0, 864, 486);
      };
      // Sample near the photographed front edge: an upright card can hide
      // the rear half of its vacated slot without creating a duplicate.
      const centers = data.quads.map((q) => ({
        x: Math.round(
          (q[0][0] + q[1][0]) * 0.125 + (q[2][0] + q[3][0]) * 0.375,
        ),
        y: Math.round(
          (q[0][1] + q[1][1]) * 0.125 + (q[2][1] + q[3][1]) * 0.375,
        ),
      }));
      const color = (index: number) => {
        const { x, y } = centers[index];
        const pixels = ctx.getImageData(x - 3, y - 2, 7, 5).data;
        const rgb = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4)
          for (let c = 0; c < 3; c++) rgb[c] += pixels[i + c] / 35;
        return rgb;
      };
      const empty = [];
      for (let index = 0; index < 6; index++) {
        let green = 0;
        for (
          let time = data.lifts[index] + 0.125;
          time < data.lands[index] - 0.15;
          time += 0.125
        ) {
          await capture(data.offset + time);
          const [r, g, b] = color(index);
          if (g > r * 1.18 && g > b * 1.05) green++;
        }
        empty.push(green);
      }
      await capture(data.offset + data.end);
      const final = centers.map((_, index) => color(index));
      const image = canvas.toDataURL("image/png");
      film.removeAttribute("src");
      film.load();
      return { empty, final, image };
    },
    {
      offset: DEALER_FILM.sceneOffset,
      lifts: DEALER_FILM.lifts,
      lands: DEALER_FILM.lands,
      end: DEALER_FILM.actionEnd,
      quads: PAPER_QUADS,
    },
  );
  await writeFile(
    info.outputPath("native-six-card-result.png"),
    Buffer.from(result.image.split(",")[1], "base64"),
  );
  for (const samples of result.empty) expect(samples).toBeGreaterThanOrEqual(2);
  for (const [r, g, b] of result.final) {
    expect(Math.min(r, g, b)).toBeGreaterThan(120);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(100);
  }
});

test("short reveal and the next round keep the winner behind the last flip", async ({
  page,
}) => {
  const round = await studio(page);
  await expect
    .poll(() =>
      page
        .getByTestId("tpl-dealer-film")
        .evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  round.reveal(2500);
  await expect(page.getByTestId("text-deal-readout")).toHaveText("Dealing");
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-frame-ready",
    "true",
  );
  const shortMotion = await page
    .getByTestId("tpl-dealer-film")
    .evaluate((v: HTMLVideoElement) => ({
      rate: v.playbackRate,
      time: v.currentTime,
    }));
  expect(shortMotion.rate).toBe(1);
  expect(shortMotion.time - DEALER_FILM.sceneOffset).toBeGreaterThan(6);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(6);
  round.reveal(3000, "studio-round-2");
  await expect(page.getByTestId("text-deal-readout")).toHaveText("Dealing");
  await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(6);
});

test("late join shows the actual hands immediately", async ({ page }) => {
  await studio(page, true);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(6);
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-film-state",
    "rest",
  );
  await expect(page.getByTestId("tpl-result-poster")).toBeVisible();
  await expect(page.getByTestId("tpl-dealer-film")).toBeHidden();
});

test("mobile and no WebGL retain the dealer, wallet, chip controls and reduced-motion result", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  const round = await studio(page);
  await expect(page.getByTestId("text-tpl-balance")).toBeVisible();
  await expect(page.getByTestId("instant-bet-status-mobile")).toBeVisible();
  await expect(page.getByTestId("btn-place-bets-mobile")).toHaveCount(0);
  await page.getByTestId("chip-mobile-100").click();
  await page.getByTestId("spot-playerB").click();
  await expect(page.getByTestId("tpl-flat-spot-playerB")).toContainText("100");
  round.reveal();
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-deal-progress",
    "1.0000",
  );
  await expect(
    page.getByTestId("teen-patti-table").locator("canvas"),
  ).toHaveCount(0);
  expect(
    await page
      .getByTestId("tpl-dealer-film")
      .evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-result.png"),
    fullPage: true,
  });
});

test("table audio plays six recorded lifts and placements, mutes and stops on leaving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const starts: string[] = [];
    (window as any).__paperStarts = starts;
    const bytesToUrl = new WeakMap<ArrayBuffer, string>();
    const buffersToUrl = new WeakMap<AudioBuffer, string>();
    const fetchAudio = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetchAudio(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.includes("tp-card-")) {
        const arrayBuffer = response.arrayBuffer.bind(response);
        response.arrayBuffer = async () => {
          const bytes = await arrayBuffer();
          bytesToUrl.set(bytes, url);
          return bytes;
        };
      }
      return response;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (bytes) {
      return decode.call(this, bytes).then((buffer) => {
        const url = bytesToUrl.get(bytes);
        if (url) buffersToUrl.set(buffer, url);
        return buffer;
      });
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (...args: Parameters<typeof start>) => {
        const clip = source.buffer && buffersToUrl.get(source.buffer);
        if (clip) starts.push(clip);
        return start(...args);
      };
      return source;
    };
  });
  const round = await studio(page);
  const music = page.getByTestId("tpl-music");
  const ambience = page.getByTestId("tpl-ambience");
  await expect(music).toHaveAttribute("src", /lounge-jazz/);
  await expect(ambience).toHaveAttribute("src", /casino-room/);
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.getByTestId("tpl-audio-settings").click();
  await page.getByTestId("tpl-sound-toggle").click();
  await expect(page.getByTestId("tpl-sound-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await music.evaluate((a: HTMLAudioElement) => a.volume > 0 && a.loop),
  ).toBe(true);
  await expect
    .poll(() => ambience.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await ambience.evaluate((a: HTMLAudioElement) => a.volume > 0 && a.loop),
  ).toBe(true);
  const normalVolume = await music.evaluate((a: HTMLAudioElement) => a.volume);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
  round.reveal();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.volume))
    .toBeLessThan(normalVolume);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.volume))
    .toBeCloseTo(normalVolume);
  await expect
    .poll(() => page.evaluate(() => (window as any).__paperStarts.length))
    .toBe(12);
  const played: string[] = await page.evaluate(
    () => (window as any).__paperStarts,
  );
  expect(played.filter((url) => url.includes("tp-card-slide")).length).toBe(6);
  expect(played.filter((url) => url.includes("tp-card-place")).length).toBe(6);
  await page.getByTestId("tpl-audio-settings").click();
  await page.getByTestId("tpl-music-toggle").click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  expect(await ambience.evaluate((a: HTMLAudioElement) => a.paused)).toBe(
    false,
  );
  await page.getByTestId("tpl-ambience-toggle").click();
  await expect
    .poll(() => ambience.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  await page.getByTestId("tpl-ambience-toggle").click();
  await expect
    .poll(() => ambience.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false);
  await page.getByTestId("tpl-music-toggle").click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false);
  await page.getByTestId("tpl-sound-toggle").click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  expect(await ambience.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.getByTestId("tpl-sound-toggle").click();
  await expect
    .poll(() => music.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false);
  await expect
    .poll(() => ambience.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false);
  await ambience.evaluate((a) => {
    (window as any).__tableAmbience = a;
  });
  await music.evaluate((a) => {
    (window as any).__tableMusic = a;
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("btn-back").click();
  expect(
    await page.evaluate(() => (window as any).__tableAmbience.paused),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).__tableMusic.paused)).toBe(
    true,
  );
});

test("a failed video still reveals server cards and settles", async ({
  page,
}) => {
  await page.route("**/*riya-hd-studio*.mp4*", (route) =>
    route.request().resourceType() === "media"
      ? route.abort()
      : route.continue(),
  );
  const round = await studio(page);
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-film-state",
    "fallback",
  );
  round.reveal(2200);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(6);
});

test("side shoe shuffles, deals six backs, then hand camera opens and overhead camera shows complete cards", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const round = await studio(page);
  const table = page.getByTestId("tpl-flat-table");
  round.betting(20000, "camera-round");
  await expect(table).toHaveAttribute("data-stage", "shuffle");
  await expect(table).toHaveAttribute("data-dealt-count", "0");
  await expect(page.getByTestId("tpl-shuffle-shoe")).toBeVisible();
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(0);
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("shuffle-tray.png") });
  round.betting(4300, "camera-round");
  await expect(table).toHaveAttribute("data-stage", "dealing");
  const travel = await page.evaluate(async () => {
    const observations: { x: number; count: number }[] = [];
    for (let i = 0; i < 90; i++) {
      await new Promise(requestAnimationFrame);
      const card = document.querySelector(
        '[data-testid="tpl-dealt-card-3"]',
      ) as unknown as SVGGElement;
      observations.push({
        x: card.transform.baseVal.consolidate()?.matrix.e ?? 0,
        count: Number(
          document
            .querySelector('[data-testid="tpl-flat-table"]')
            ?.getAttribute("data-dealt-count"),
        ),
      });
    }
    return observations;
  });
  expect(
    Math.max(...travel.map((p) => p.x)) - Math.min(...travel.map((p) => p.x)),
  ).toBeGreaterThan(30);
  expect(travel.some((p) => p.count > 0 && p.count < 6)).toBe(true);
  await expect(table).toHaveAttribute("data-dealt-count", "6");
  await expect(
    page.locator('[data-testid^="tpl-dealt-card-"][data-dealt="true"]'),
  ).toHaveCount(6);
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("six-dealt.png") });
  round.reveal();
  await expect(table).toHaveAttribute("data-camera", "hands");
  await expect
    .poll(() =>
      page
        .getByTestId("tpl-dealer-film")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(DEALER_FILM.sceneOffset + 2.0);
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("hand-closeup.png") });
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(table).toHaveAttribute("data-camera", "hands");
  await page.getByTestId("tpl-camera-cards").click();
  await expect(table).toHaveAttribute("data-camera", "cards");
  await expect(
    page.locator('.tpl-overhead-card[data-face-up="true"]'),
  ).toHaveCount(6);
  expect(
    await page
      .locator(".tpl-overhead-card")
      .evaluateAll((cards) =>
        cards.map((c) => Number(c.getAttribute("data-card"))),
      ),
  ).toEqual([...outcome.handACards, ...outcome.handBCards]);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("overhead-cards.png") });
  await page.getByTestId("tpl-camera-dealer").click();
  await expect(table).toHaveAttribute("data-camera", "dealer");
  await expect(page.getByTestId("tpl-result-poster")).toBeVisible();
  await page.getByTestId("tpl-camera-auto").click();
  round.betting(20000, "camera-round-next");
  await expect(table).toHaveAttribute("data-stage", "shuffle");
  await expect(page.getByTestId("badge-deal-winner")).toHaveCount(0);
  await expect(
    page.locator('.tpl-physical-ink g[data-face-up="true"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("tpl-customer-view")).toBeHidden();
  await expect(
    page.locator('.tpl-customer-card[data-face-up="true"]'),
  ).toHaveCount(0);
});

test("natural waiting expressions keep hands calm while the shuffler interleaves a full deck", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const round = await studio(page);
  const idle = page.getByTestId("tpl-dealer-film");
  const persistentPlayer = await idle.elementHandle();
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  round.betting(20000, "expression-round");
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-idle-active",
    "true",
  );
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await expect(page.locator(".tpl-shuffle-sheet")).toHaveCount(52);
  await expect
    .poll(() => page.locator('.tpl-shuffle-sheet[data-fed="true"]').count())
    .toBeGreaterThan(0);
  expect(
    await page.locator('.tpl-shuffle-sheet[data-fed="true"]').count(),
  ).toBeLessThan(52);
  const motion = await idle.evaluate(async (v: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 288;
    canvas.height = 165;
    const context = canvas.getContext("2d")!;
    const capture = () => {
      context.drawImage(v, 0, 0, 288, 165);
      return context.getImageData(0, 0, 288, 165).data;
    };
    const before = capture();
    const first = v.currentTime;
    let eyeChange = 0;
    let fixedChange = 0;
    let handChange = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise<void>((resolve) =>
        v.requestVideoFrameCallback(() => resolve()),
      );
      const after = capture();
      let changed = 0,
        total = 0,
        count = 0,
        hands = 0,
        handPixels = 0;
      for (let i = 0; i < before.length; i += 4) {
        const x = (i / 4) % 288,
          y = Math.floor(i / 4 / 288);
        const delta =
          Math.abs(before[i] - after[i]) +
          Math.abs(before[i + 1] - after[i + 1]) +
          Math.abs(before[i + 2] - after[i + 2]);
        // Native blinks and small expressions are allowed; this is a whole
        // performance, not eye patches over a frozen face. Hands stay at rest.
        if (((x >= 90 && x <= 123) || (x >= 154 && x <= 189)) && y >= 115 && y <= 137) {
          hands += delta;
          handPixels++;
        }
        if (x >= 133 && x <= 160 && y >= 26 && y <= 37) {
          if (delta > 15) changed++;
        } else {
          total += delta;
          count++;
        }
      }
      eyeChange = Math.max(eyeChange, changed);
      fixedChange = Math.max(fixedChange, total / count / 3);
      handChange = Math.max(handChange, hands / handPixels / 3);
    }
    return { eyeChange, fixedChange, handChange, first, last: v.currentTime };
  });
  expect(motion.eyeChange).toBeGreaterThan(20);
  expect(motion.fixedChange).toBeLessThan(3);
  expect(motion.handChange).toBeLessThan(3);
  expect(motion.first).not.toBe(motion.last);
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("dealer-expressions-shuffle.png") });
  await expect(page.getByTestId("tpl-shuffle-mechanism")).toHaveAttribute(
    "data-collected",
    "52",
  );
  await expect(page.getByTestId("tpl-shuffle-mechanism")).toHaveAttribute(
    "data-shuffle-phase",
    "ready",
  );
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  round.betting(20000, "mobile-expression-round");
  await expect(page.getByTestId("tpl-shuffle-closeup")).toBeVisible();
  await page
    .getByTestId("teen-patti-table")
    .screenshot({ path: info.outputPath("mobile-expressions-shuffle.png") });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  round.reveal();
  await expect
    .poll(() => idle.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(DEALER_FILM.sceneOffset + 0.375);
  expect(
    await idle.evaluate((v, original) => v === original, persistentPlayer),
  ).toBe(true);
  await expect(page.locator(".tpl-film-stage video")).toHaveCount(1);
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-idle-active",
    "false",
  );
});

test("forward waiting loop stays out of the action, and hidden opening resumes at normal speed", async ({
  page,
}) => {
  const round = await studio(page);
  const film = page.getByTestId("tpl-dealer-film");
  const table = page.getByTestId("tpl-flat-table");
  await expect(table).toHaveAttribute("data-idle-active", "true");
  const waitingFrames = await film.evaluate(async (video: HTMLVideoElement) => {
    const frames: number[] = [];
    for (let i = 0; i < 162; i++) {
      await new Promise<void>((resolve) =>
        video.requestVideoFrameCallback((_now, frame) => {
          frames.push(frame.mediaTime);
          resolve();
        }),
      );
    }
    return frames;
  });
  expect(Math.max(...waitingFrames)).toBeLessThan(DEALER_FILM.sceneOffset);
  const resets = waitingFrames
    .slice(1)
    .filter((value, i) => value < waitingFrames[i] - 0.05);
  expect(resets.length).toBeGreaterThan(0);
  expect(resets.every((time) => time < 0.1)).toBe(true);
  round.reveal();
  await expect(table).toHaveAttribute("data-frame-ready", "true");
  await expect(page.getByTestId("tpl-film-bridge")).toHaveAttribute(
    "data-held",
    "false",
  );
  const before = Number(await table.getAttribute("data-media-time"));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await film.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.waitForTimeout(850);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(table).toHaveAttribute("data-frame-ready", "true");
  expect(Number(await table.getAttribute("data-media-time"))).toBeGreaterThan(
    before + 0.6,
  );
  expect(await film.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1);
  await expect(page.getByTestId("tpl-film-bridge")).toHaveAttribute(
    "data-held",
    "false",
  );
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-overhead-card[data-face-up="true"]'),
  ).toHaveCount(6);
});

test("opening still runs without a canvas context or decoded-frame API", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestVideoFrameCallback",
      { value: undefined, configurable: true },
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const round = await studio(page);
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-idle-active",
    "true",
  );
  round.reveal(3000);
  await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
    "data-frame-ready",
    "true",
  );
  expect(
    await page
      .getByTestId("tpl-dealer-film")
      .evaluate((v: HTMLVideoElement) => v.playbackRate),
  ).toBe(1);
  await expect(page.getByTestId("text-deal-readout")).toHaveText(
    "Player A wins with Trail",
  );
  await expect(
    page.locator('.tpl-overhead-card[data-face-up="true"]'),
  ).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("opening and result keep the same card direction, with overhead available manually at every screen size", async ({
  page,
}, info) => {
  test.setTimeout(90_000); // Five full media sequences, including screenshots.
  const round = await studio(page);
  for (const width of [320, 390, 640, 844, 1440]) {
    await page.getByTestId("tpl-camera-auto").click();
    await page.setViewportSize({ width, height: 960 });
    round.betting(8000, `before-zoom-${width}`);
    await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
      "data-camera",
      "dealer",
    );
    await expect
      .poll(() =>
        page
          .getByTestId("tpl-dealer-film")
          .evaluate((el) =>
            Math.abs(
              el.getBoundingClientRect().width -
                document
                  .querySelector(".tpl-film-viewport")!
                  .getBoundingClientRect().width,
            ),
          ),
      )
      .toBeLessThan(1);
    const dealerWidth = (await page
      .getByTestId("tpl-dealer-film")
      .boundingBox())!.width;
    round.reveal(9000, `framing-${width}`);
    await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
      "data-camera",
      "hands",
    );
    const firstFrames = await page.evaluate(async () => {
      const inside: boolean[] = [];
      for (let i = 0; i < 32; i++) {
        await new Promise(requestAnimationFrame);
        const viewport = document
          .querySelector(".tpl-film-viewport")!
          .getBoundingClientRect();
        const matrix = (
          document.querySelector(".tpl-physical-ink") as SVGSVGElement
        ).getScreenCTM()!;
        inside.push(
          [
            [10, 10],
            [854, 10],
            [10, 476],
            [854, 476],
          ].every(([x, y]) => {
            const point = new DOMPoint(x, y).matrixTransform(matrix);
            return (
              point.x >= viewport.left &&
              point.x <= viewport.right &&
              point.y >= viewport.top &&
              point.y <= viewport.bottom
            );
          }),
        );
      }
      return inside;
    });
    expect(firstFrames.every(Boolean)).toBe(true);
    await expect(page.getByTestId("tpl-customer-view")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("tpl-dealer-film")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(DEALER_FILM.sceneOffset + 3.8);
    const framing = await page.evaluate(() => {
      const viewport = document
        .querySelector('[data-testid="tpl-film-viewport"]')!
        .getBoundingClientRect();
      const film = document
        .querySelector('[data-testid="tpl-dealer-film"]')!
        .getBoundingClientRect();
      const ink = document.querySelector(".tpl-physical-ink") as SVGSVGElement;
      const overlay = ink.getBoundingClientRect();
      const matrix = ink.getScreenCTM()!;
      // Preserve the whole native 16:9 composition, including head, fingers
      // and every filmed paper edge, even during the camera transition.
      const points = [
        [10, 10],
        [854, 10],
        [10, 476],
        [854, 476],
      ].map(([x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: p.x, y: p.y };
      });
      return {
        viewport: viewport.toJSON(),
        film: film.toJSON(),
        overlay: overlay.toJSON(),
        // Screenshots can scroll a full-width table taller than the window.
        // Camera continuity is relative to the film viewport, not the page.
        matrix: [
          matrix.a,
          matrix.b,
          matrix.c,
          matrix.d,
          matrix.e - viewport.left,
          matrix.f - viewport.top,
        ],
        points,
      };
    });
    expect(framing.film.width / framing.film.height).toBeCloseTo(16 / 9, 3);
    expect(framing.film.width).toBeCloseTo(framing.viewport.width, 0);
    expect(framing.film.width).toBeGreaterThanOrEqual(dealerWidth - 1);
    for (const dimension of ["x", "y", "width", "height"] as const)
      expect(framing.overlay[dimension]).toBeCloseTo(
        framing.film[dimension],
        2,
      );
    for (const point of framing.points) {
      expect(point.x).toBeGreaterThanOrEqual(framing.viewport.left + 2);
      expect(point.x).toBeLessThanOrEqual(framing.viewport.right - 2);
      expect(point.y).toBeGreaterThanOrEqual(framing.viewport.top + 2);
      expect(point.y).toBeLessThanOrEqual(framing.viewport.bottom - 2);
    }
    await page
      .getByTestId("teen-patti-table")
      .screenshot({ path: info.outputPath(`opening-${width}.png`) });
    round.reveal(200, `result-${width}`);
    await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
      "data-camera",
      "hands",
    );
    await expect(page.getByTestId("text-deal-readout")).toHaveText(
      "Player A wins with Trail",
    );
    const cuts = await page.evaluate(async () => {
      const visible = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        const matrix = (
          document.querySelector(".tpl-physical-ink") as SVGSVGElement
        ).getScreenCTM()!;
        const viewport = document
          .querySelector(".tpl-film-viewport")!
          .getBoundingClientRect();
        visible.push({
          matrix: [
            matrix.a,
            matrix.b,
            matrix.c,
            matrix.d,
            matrix.e - viewport.left,
            matrix.f - viewport.top,
          ],
          film: document
            .querySelector(".tpl-film-viewport")!
            .getBoundingClientRect().width,
          cards: document
            .querySelector(".tpl-overhead-camera")!
            .getBoundingClientRect().width,
        });
      }
      return visible;
    });
    expect(cuts.every((frame) => frame.film > 0 && frame.cards === 0)).toBe(
      true,
    );
    for (const frame of cuts)
      frame.matrix.forEach((value, i) =>
        expect(value).toBeCloseTo(framing.matrix[i], 2),
      );
    const front = await page.getByTestId("tpl-customer-view").evaluate((el) => {
      const panel = el.getBoundingClientRect();
      const film = document
        .querySelector(".tpl-film-viewport")!
        .getBoundingClientRect();
      return {
        panel: panel.toJSON(),
        film: film.toJSON(),
        cards: [...el.querySelectorAll(".tpl-customer-card")].map((card) => {
          const index = card.querySelector(
            ".tpl-customer-face text",
          ) as SVGTextElement;
          return {
            ...card.getBoundingClientRect().toJSON(),
            font:
              Number(index.getAttribute("font-size")) * index.getScreenCTM()!.a,
          };
        }),
      };
    });
    expect(front.cards).toHaveLength(6);
    expect(front.film.bottom).toBeLessThan(front.panel.top);
    for (const [index, card] of front.cards.entries()) {
      expect(card.width / card.height).toBeCloseTo(66 / 94, 2);
      expect(card.height).toBeGreaterThanOrEqual(50);
      expect(card.font).toBeGreaterThanOrEqual(12);
      expect(card.left).toBeGreaterThan(front.panel.left);
      expect(card.right).toBeLessThan(front.panel.right);
      expect(card.bottom).toBeLessThan(front.panel.bottom);
      if (index)
        expect(card.left).toBeGreaterThan(front.cards[index - 1].right);
    }
    await expect(
      page.locator('.tpl-customer-card[data-face-up="true"]'),
    ).toHaveCount(6);
    await page
      .getByTestId("teen-patti-table")
      .screenshot({ path: info.outputPath(`result-${width}.png`) });
    await page.getByTestId("tpl-camera-cards").click();
    await expect(page.getByTestId("tpl-flat-table")).toHaveAttribute(
      "data-camera",
      "cards",
    );
    const result = await page.getByTestId("tpl-card-camera").evaluate((el) => {
      const viewport = el.getBoundingClientRect();
      return {
        viewport: viewport.toJSON(),
        cards: [...el.querySelectorAll(".tpl-overhead-card")].map((card) =>
          card.getBoundingClientRect().toJSON(),
        ),
      };
    });
    for (const card of result.cards) {
      expect(card.left).toBeGreaterThan(result.viewport.left);
      expect(card.right).toBeLessThan(result.viewport.right);
      expect(card.width / card.height).toBeCloseTo(66 / 94, 1);
    }
    await page
      .getByTestId("teen-patti-table")
      .screenshot({ path: info.outputPath(`manual-overhead-${width}.png`) });
  }
});

test("coin presets and a larger Any button fit phones, landscape and desktop with the total below", async ({
  page,
}) => {
  const round = await studio(page);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [640, 800],
    [844, 390],
    [1024, 768],
    [1440, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    round.betting(60000);
    const rack = page.locator('[data-testid^="chip-rack"]:visible');
    await expect(rack).toHaveCount(1);
    if (width < 1024 && height >= 568) {
      // The coin dock must not cover any of the five mobile bet targets.
      for (const spot of [
        "playerA",
        "tie",
        "playerB",
        "pairPlusA",
        "pairPlusB",
      ]) {
        const target = page.getByTestId(`spot-${spot}`);
        await expect(target).toBeInViewport({ ratio: 1 });
        expect(
          await target.evaluate((button) => {
            const box = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        ).toBe(true);
      }
    }
    await rack.scrollIntoViewIfNeeded();
    const buttons = rack.getByRole("button");
    await expect(buttons).toHaveCount(8);
    for (const value of [100, 200, 500, 1000, 2000, 5000, 10000]) {
      await expect(
        rack.getByRole("button", {
          name: `₹${value.toLocaleString("en-IN")} coin`,
          exact: true,
        }),
      ).toBeVisible();
    }
    for (const button of await buttons.all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1);
    }
    const custom = rack.getByRole("button", { name: "Custom amount" });
    const rect = (await custom.boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(60);
    expect(rect.height).toBeGreaterThanOrEqual(48);
    const total = page.locator('[data-testid^="text-placed-summary"]:visible');
    const rackRect = (await rack.boundingBox())!;
    expect((await total.boundingBox())!.y).toBeGreaterThanOrEqual(
      rackRect.y + rackRect.height,
    );
    await custom.click();
    const input = page
      .getByRole("dialog", { name: "Custom coin amount" })
      .locator("input");
    await input.fill("750");
    await input.press("Enter");
    await expect(custom).toHaveText("750");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(round.betRequests).toHaveLength(0);
  }
});

test("instant bets submit the selected chip once and reconcile chips and wallet without Place Bet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const round = await studio(page);
  await expect(page.getByTestId("btn-place-bets")).toHaveCount(0);
  await expect(page.getByTestId("btn-undo")).toHaveCount(0);
  await expect(page.getByTestId("btn-clear")).toHaveCount(0);
  await page.getByTestId("chip-100").click();
  expect(round.betRequests).toHaveLength(0);
  const release = round.holdNextBet();
  // Dispatch two taps in one JS task to exercise the synchronous request lock.
  await page
    .getByTestId("spot-playerA")
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => round.betRequests.length).toBe(1);
  await expect(page.getByTestId("spot-playerB")).toBeDisabled();
  await expect(page.getByTestId("instant-bet-status")).toContainText("Placing");
  await expect(page.getByTestId("chipstack-playerA")).toHaveCount(0);
  release();
  await expect(page.getByTestId("text-tpl-balance")).toHaveText("₹9,900.00");
  await expect(page.getByTestId("chipstack-playerA")).toHaveText("100");
  await expect(page.getByTestId("text-total-staked")).toHaveText("₹100.00");
  expect(round.betRequests).toEqual([
    { bets: [{ type: "playerA", amountPaise: "10000" }] },
  ]);
  await page.getByTestId("spot-playerA").click();
  await expect(page.getByTestId("text-tpl-balance")).toHaveText("₹9,800.00");
  await expect(page.getByTestId("chipstack-playerA")).toHaveText("200");
  await expect(page.getByTestId("tpl-flat-spot-playerA")).toContainText("200");
  await expect(page.getByTestId("text-total-staked")).toHaveText("₹200.00");
  expect(round.betRequests).toHaveLength(2);
  round.reveal();
  await expect(page.getByTestId("spot-playerA")).toHaveCount(0);
  await expect(page.getByTestId("chip-rack")).toHaveCount(0);
  round.betting(20000, "studio-round-2");
  await expect(page.getByTestId("spot-playerA")).toBeEnabled();
  await expect(page.getByTestId("chipstack-playerA")).toHaveCount(0);
  await expect(page.getByTestId("text-total-staked")).toHaveText("₹0.00");
  await page.waitForTimeout(700);
  expect(round.betRequests).toHaveLength(2);
});

test("rejected instant bets show the server error and never queue into another round", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const round = await studio(page);
  round.rejectNextBet("Insufficient balance");
  await page.getByTestId("spot-playerB").click();
  await expect(
    page.getByText("Insufficient balance", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("text-tpl-balance")).toHaveText("₹10,000.00");
  await expect(page.getByTestId("chipstack-playerB")).toHaveCount(0);
  await expect(page.getByTestId("spot-playerB")).toBeEnabled();
  round.rejectNextBet("Betting is closed for this round");
  await page.getByTestId("spot-playerB").click();
  await expect(
    page.getByText("Betting is closed for this round", { exact: true }),
  ).toBeVisible();
  round.reveal();
  await expect(page.getByTestId("spot-playerB")).toHaveCount(0);
  round.betting(20000, "studio-round-2");
  await expect(page.getByTestId("spot-playerB")).toBeEnabled();
  await page.waitForTimeout(700);
  expect(round.betRequests).toHaveLength(2);
  await expect(page.getByTestId("text-total-staked")).toHaveText("₹0.00");
  await page.getByTestId("spot-playerB").click();
  await expect(page.getByTestId("chipstack-playerB")).toHaveText("100");
  expect(round.betRequests).toHaveLength(3);
});

test("instant betting enforces chip limits, balance and the betting deadline before submitting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const round = await studio(page);
  await page.getByTestId("chip-custom").click();
  await page.getByTestId("chip-custom-input").fill("1");
  await page.getByTestId("chip-custom-apply").click();
  await page.getByTestId("spot-playerA").click();
  await expect(
    page.getByText("Choose a chip within the table limits", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("chip-custom").click();
  await page.getByTestId("chip-custom-input").fill("20000");
  await page.getByTestId("chip-custom-apply").click();
  await page.getByTestId("spot-playerA").click();
  await expect(
    page.getByText("Insufficient balance", { exact: true }),
  ).toBeVisible();
  round.betting(200);
  await expect(page.getByTestId("spot-playerA")).toHaveCount(0);
  await expect(page.getByTestId("chip-rack-mobile")).toHaveCount(0);
  expect(round.betRequests).toHaveLength(0);
});
