import { test, expect, type Page } from "@playwright/test";
import type { ODTable } from "@workspace/api-zod/dragon-tiger-one-day";
import { quotes } from "../../api-server/src/services/dragonTigerOneDayMath";
import {
  commentaryKey,
  readCommentaryClips,
} from "../src/components/dragonTigerOneDay/commentary";

test("commentary uses revealed Dragon information and only announces confirmed results", () => {
  for (let card = 0; card < 416; card++) {
    const rank = (card % 13) + 1;
    const expected =
      rank === 1
        ? "ace"
        : rank <= 6
          ? "low"
          : rank === 7
            ? "seven"
            : rank < 13
              ? "high"
              : "king";
    expect(commentaryKey("second", card)).toBe(expected);
    expect(commentaryKey("dragon-reveal", card, "dragon")).toBeNull();
    expect(commentaryKey("tiger-reveal", card, "tiger")).toBeNull();
  }
  expect(commentaryKey("second")).toBeNull();
  expect(commentaryKey("second", 416)).toBeNull();
  expect(commentaryKey("result", 12)).toBeNull();
  expect(commentaryKey("result", 12, "dragon")).toBe("dragon-wins");
  expect(commentaryKey("result", 0, "tie")).toBe("tie");
  expect(
    readCommentaryClips({
      clips: {
        opening: { file: "opening.mp4", duration: 8, transcript: "Welcome" },
        ace: {
          file: "https://external.test/voice.mp4",
          duration: 5,
          transcript: "Wrong origin",
        },
        king: {
          file: "king.mp4",
          duration: 60,
          transcript: "Too long for the phase",
        },
      },
    }),
  ).toEqual({
    opening: { file: "opening.mp4", duration: 8, transcript: "Welcome" },
  });
});
function initial(): ODTable {
  const now = Date.now();
  return {
    serverNow: now,
    balancePaise: "1000000",
    quoteId: "1:first:v1",
    quotes: quotes().filter((q) => q.side === "match"),
    slips: [],
    recent: [],
    history: [],
    round: {
      id: 1,
      phase: "first",
      phaseEndsAt: now + 20000,
      firstClosesAt: now + 20000,
      secondOpensAt: now + 23000,
      secondClosesAt: now + 38000,
      revealsAt: now + 41000,
      endsAt: now + 48000,
      commitment: "a".repeat(64),
    },
  };
}
async function setup(page: Page, settings: Record<string, unknown> = {}) {
  let state = initial(),
    offline = false,
    rolling = true,
    posts = 0;
  const errors: string[] = [];
  let readGate: { started: () => void; wait: Promise<void> } | null = null;
  let frozenServerNow: number | null = null;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (settings) =>
      localStorage.setItem(
        "aviator:v1",
        JSON.stringify({
          settings: { onboarded: true, sound: false, ...settings },
        }),
      ),
    settings,
  );
  await page.routeWebSocket("**/ws", (socket) => socket.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/dragon-tiger-one-day/")) {
      if (offline)
        return route.fulfill({ status: 503, json: { detail: "Offline" } });
      if (rolling) state.round.phaseEndsAt = Date.now() + 20000;
      if (path.endsWith("/table") && readGate) {
        const gate = readGate;
        readGate = null;
        frozenServerNow = Date.now();
        const snapshot = structuredClone({
          ...state,
          serverNow: frozenServerNow,
        });
        gate.started();
        await gate.wait;
        return route.fulfill({ json: snapshot });
      }
      if (path.endsWith("/bet")) {
        posts++;
        const body = route.request().postDataJSON();
        expect(body.quoteId).toBe(state.quoteId);
        expect(body.stage).toBe(state.round.phase);
        const stake = body.selections.reduce(
          (sum: number, b: { amountPaise: string }) =>
            sum + Number(b.amountPaise),
          0,
        );
        state.balancePaise = String(Number(state.balancePaise) - stake);
        state.slips.push({
          id: posts,
          roundId: state.round.id,
          stage: body.stage,
          selections: body.selections.map(
            (b: { market: string; amountPaise: string }) => ({
              ...b,
              oddsHundredths: state.quotes.find((q) => q.id === b.market)!
                .oddsHundredths,
            }),
          ),
          stakePaise: String(stake),
          payoutPaise: null,
        });
      }
      return route.fulfill({
        json: { ...state, serverNow: frozenServerNow ?? Date.now() },
      });
    }
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "od-test",
        displayName: "You",
        email: "od@example.test",
        role: "player",
      };
    else if (path.includes("/registry")) body = [];
    else if (path.includes("/config")) body = { enabled: false };
    else if (path.includes("/wallet/balance"))
      body = { balance: state.balancePaise, currency: "INR", scope: "lunar" };
    return route.fulfill({ json: body });
  });
  await page.goto("/dragon-tiger-one-day");
  await expect(page.getByTestId("od-balance")).toContainText("10,000", {
    timeout: 30000,
  });
  return {
    get: () => state,
    set: (next: ODTable) => {
      state = next;
    },
    offline: () => {
      offline = true;
    },
    deadline: (at: number) => {
      rolling = false;
      state.round.phaseEndsAt = at;
    },
    posts: () => posts,
    errors,
    holdRead: () => {
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        readGate = { started: resolve, wait };
      });
      return { started, release };
    },
  };
}
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["tablet", 768, 1024],
  ["phone", 390, 844],
  ["small-phone", 320, 568],
  ["landscape", 844, 390],
] as const) {
  test(`${name}: studio, all markets and shared controls remain usable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    await expect(page.getByTestId("od-card-tiger")).toHaveAttribute(
      "aria-label",
      "Tiger: face down",
    );
    await expect
      .poll(() =>
        page
          .locator("video")
          .first()
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBe(1920);
    await expect(page.locator("video").first()).toHaveJSProperty("muted", true);
    // Felt occupies the bottom of the uncropped 16:9 footage at every size.
    const frame = (await page.locator(".od-studio").boundingBox())!;
    expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(0.03);
    await expect
      .poll(() =>
        page
          .locator(".od-card-placement")
          .evaluateAll((nodes) =>
            nodes.every((node) =>
              node
                .getAnimations()
                .every((animation) => animation.playState === "finished"),
            ),
          ),
      )
      .toBe(true);
    for (const side of ["dragon", "tiger"]) {
      const card = (await page.getByTestId(`od-card-${side}`).boundingBox())!;
      expect(card.y).toBeGreaterThan(frame.y + frame.height * 0.7);
      expect(card.y + card.height).toBeLessThan(frame.y + frame.height * 0.94);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.getByTestId("od-second-options")).toHaveCount(0);
    for (const side of ["dragon", "tiger"]) {
      await expect(
        page
          .getByRole("group", {
            name: `${side === "dragon" ? "Dragon" : "Tiger"} exact card`,
          })
          .getByRole("button"),
      ).toHaveCount(13);
      await expect(
        page.getByTestId(`od-market-${side}-rank-13`),
      ).toBeDisabled();
    }
    const studio = await page.locator(".od-studio-column").boundingBox();
    const betting = await page.locator(".od-markets-panel").boundingBox();
    expect(studio!.y + studio!.height).toBeLessThanOrEqual(betting!.y);
    await page.getByTestId("od-confirm").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("od-confirm")).toBeInViewport();
    await page.getByTestId("od-market-tiger").click();
    await expect(page.getByTestId("od-staged")).toContainText("100");
    await page.getByTestId("od-confirm").click();
    await expect(page.getByTestId("od-balance")).toContainText("9,900");
    await expect(page.getByTestId("od-market-tiger")).toBeDisabled();
    await page.getByTestId("coin-settings-button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("btn-game-rules").click();
    await expect(page.getByRole("dialog")).toContainText("Seven loses");
    await page.keyboard.press("Escape");
    await page.locator(".game-viewport").evaluate((e) => e.scrollTo(0, 0));
    if (name === "desktop" || name === "phone")
      await page.screenshot({
        path: `test-results/one-day-${name}.png`,
        fullPage: true,
      });
    expect(state.errors).toEqual([]);
  });
}
test("first and second bets preserve prices, revealed Dragon locks, hidden Tiger stays hidden", async ({
  page,
}) => {
  const state = await setup(page);
  const firstPrice = state
    .get()
    .quotes.find((q) => q.id === "tiger")!.oddsHundredths;
  await page.getByTestId("od-market-tiger").click();
  await page.getByTestId("od-confirm").click();
  await expect(page.getByTestId("od-balance")).toContainText("9,900");
  const s = state.get();
  state.set({
    ...s,
    quoteId: "1:second:v1",
    quotes: quotes(0).filter((q) => q.side !== "dragon"),
    round: { ...s.round, phase: "second", dragon: 0 },
  });
  const secondPrice = state
    .get()
    .quotes.find((q) => q.id === "tiger-red")!.oddsHundredths;
  await expect(page.getByTestId("one-day-page")).toHaveAttribute(
    "data-phase",
    "second",
  );
  await expect(page.getByTestId("od-card-dragon")).toHaveAttribute(
    "aria-label",
    "Dragon: A♠",
  );
  await expect(page.getByTestId("od-card-tiger")).toHaveAttribute(
    "aria-label",
    "Tiger: face down",
  );
  await expect(page.getByTestId("od-market-dragon")).toBeDisabled();
  await expect(page.getByTestId("od-market-tiger-red")).toContainText(
    `${(secondPrice / 100).toFixed(2)}\u00d7`,
  );
  await expect(page.getByTestId("od-market-dragon-red")).toBeDisabled();
  await page.getByTestId("od-market-tiger-red").click();
  await page.getByTestId("od-confirm").click();
  await expect(page.getByTestId("od-balance")).toContainText("9,800");
  expect(state.posts()).toBe(2);
  expect(state.get().slips.map((s) => s.selections[0].oddsHundredths)).toEqual([
    firstPrice,
    secondPrice,
  ]);
  await page.reload();
  await expect(page.getByTestId("od-debited")).toHaveText("\u20b9200");
  await expect(page.getByTestId("od-confirm")).toBeDisabled();
  expect(state.posts()).toBe(2);
});
test("selected bets auto-submit once at deadline; opening second chance never repeats first draft", async ({
  page,
}) => {
  const state = await setup(page);
  state.deadline(Date.now() + 3800);
  await page.getByTestId("od-market-tiger").click();
  await expect.poll(state.posts).toBe(1);
  const s = state.get();
  state.set({
    ...s,
    quoteId: "1:second:v1",
    quotes: quotes(6).filter((q) => q.side !== "dragon"),
    round: {
      ...s.round,
      phase: "second",
      dragon: 6,
      phaseEndsAt: Date.now() + 4000,
    },
  });
  await expect(page.getByTestId("one-day-page")).toHaveAttribute(
    "data-phase",
    "second",
  );
  await expect(page.getByTestId("od-staged")).toHaveText("₹0");
  await page.waitForTimeout(4100);
  expect(state.posts()).toBe(1);
});
test("disconnect closes controls and never sends a stale draft", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByTestId("od-market-tiger").click();
  state.offline();
  await expect(page.getByTestId("od-market-tiger")).toBeDisabled();
  await expect(page.getByTestId("od-confirm")).toBeDisabled();
  expect(state.posts()).toBe(0);
});

test("second options require an accepted first bet, including direct entry and reload", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByTestId("od-market-dragon").click();
  await expect(page.getByTestId("od-second-options")).toHaveCount(0);
  const s = state.get();
  state.set({
    ...s,
    quotes: [],
    quoteId: "1:second:v1",
    round: { ...s.round, phase: "second", dragon: 6 },
  });
  await expect(page.getByTestId("one-day-page")).toHaveAttribute(
    "data-phase",
    "second",
  );
  await expect(page.getByTestId("od-second-options")).toHaveCount(0);
  await expect(page.getByTestId("od-confirm")).toBeDisabled();
  await expect(page.getByTestId("od-staged")).toHaveText("₹0");
  await page.reload();
  await expect(page.getByTestId("od-second-locked")).toBeVisible();
  await expect(page.getByTestId("od-confirm")).toBeDisabled();
  expect(state.posts()).toBe(0);
});

test("a delayed pre-bet poll and rapid confirm clicks cannot roll back the wallet or charge twice", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByTestId("od-market-tiger").click();
  await expect(page.getByTestId("od-balance")).toHaveText("₹10,000");
  const held = state.holdRead();
  await held.started;
  await page.getByTestId("od-confirm").evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByTestId("od-balance")).toHaveText("₹9,900");
  held.release();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("od-balance")).toHaveText("₹9,900");
  await expect(page.getByTestId("od-debited")).toHaveText("₹100");
  await expect(page.getByTestId("od-confirm")).toBeDisabled();
  expect(state.posts()).toBe(1);
});

test("second market groups fit on phone and dealer gestures follow reveal sides", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await page.getByTestId("od-market-tiger").click();
  await page.getByTestId("od-confirm").click();
  await expect(page.getByTestId("od-balance")).toHaveText("₹9,900");
  let s = state.get();
  state.set({ ...s, round: { ...s.round, phase: "dragon-reveal" } });
  await expect(page.getByTestId("od-dealer")).toHaveAttribute(
    "data-take",
    "dragon",
  );
  s = state.get();
  state.set({
    ...s,
    quoteId: "1:second:v1",
    quotes: quotes(6).filter((q) => q.side !== "dragon"),
    round: { ...s.round, phase: "second", dragon: 6 },
  });
  await expect(page.getByTestId("od-second-options")).toBeVisible();
  await page.getByTestId("od-market-tiger-rank-13").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("od-market-tiger-rank-13")).toBeInViewport();
  await expect(page.getByTestId("od-market-dragon-rank-13")).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByTestId("od-market-tiger-red").click();
  await page.locator(".od-extra-markets summary").click();
  await page.getByTestId("od-market-tiger-hearts").click();
  await page.getByTestId("od-market-tiger-rank-13").click();
  await expect(page.getByTestId("od-staged")).toHaveText("₹300");
  await expect(page.getByTestId("od-balance")).toHaveText("₹9,900");
  await page.getByTestId("od-confirm").click();
  await expect(page.getByTestId("od-balance")).toHaveText("₹9,600");
  await expect(page.getByTestId("od-debited")).toHaveText("₹400");
  await page.getByTestId("od-receipt").click();
  await expect(page.getByRole("dialog")).toContainText(
    "Second chance · ₹300 debited",
  );
  await page.keyboard.press("Escape");
  await page.locator(".od-extra-markets summary").click();
  await page.locator(".game-viewport").evaluate((e) => e.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/one-day-second-phone.png",
    fullPage: true,
    style:
      '.game-viewport[data-game-viewport="dragon-tiger-one-day"] { height: auto !important; overflow: visible !important; }',
  });
  s = state.get();
  state.set({ ...s, round: { ...s.round, phase: "tiger-reveal" } });
  await expect(page.getByTestId("od-dealer")).toHaveAttribute(
    "data-take",
    "tiger",
  );
});

test("game sounds never enable dealer commentary, including later rounds and reload", async ({
  page,
}) => {
  const commentaryRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/dragon-tiger-one-day/commentary/"))
      commentaryRequests.push(request.url());
  });
  const state = await setup(page);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  const music = page.getByTestId("od-studio-music");
  await expect(music).toHaveJSProperty("paused", false);
  await expect(
    page.getByRole("button", { name: "Make dealer voice loud" }),
  ).toHaveCount(0);
  for (const phase of [
    "first",
    "dragon-reveal",
    "second",
    "tiger-reveal",
    "result",
  ] as const) {
    const snapshot = state.get();
    state.set({
      ...snapshot,
      round: {
        ...snapshot.round,
        phase,
        dragon: 12,
        winner: phase === "result" ? "dragon" : undefined,
      },
    });
    await expect(page.getByTestId("one-day-page")).toHaveAttribute(
      "data-phase",
      phase,
    );
    await expect(page.getByTestId("od-dealer-speech")).toHaveCount(0);
    await expect(page.getByTestId("od-dealer")).not.toHaveAttribute(
      "data-take",
      "speech",
    );
    await expect(music).toHaveAttribute("data-ducked", "false");
  }
  await page.getByRole("button", { name: "Mute game sounds" }).click();
  await expect(music).toHaveJSProperty("paused", true);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  await expect(music).toHaveJSProperty("paused", false);
  await page.reload();
  await expect(page.getByTestId("one-day-page")).toHaveAttribute(
    "data-phase",
    "result",
  );
  await expect(page.getByTestId("od-dealer-speech")).toHaveCount(0);
  expect(commentaryRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`studio camera at ${width}px zooms the felt and cards together without revealing Tiger`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page);
    const snapshot = state.get();
    state.set({
      ...snapshot,
      round: { ...snapshot.round, phase: "second", dragon: 9 },
    });
    const dragon = page.getByTestId("od-card-dragon");
    const tiger = page.getByTestId("od-card-tiger");
    const camera = page.getByTestId("od-studio-camera");
    await expect(dragon).toHaveAttribute("aria-label", "Dragon: 10♠");
    // Full face art must match the server rank, while the hidden card has no ink.
    await expect(
      dragon.locator('text[dominant-baseline="central"]'),
    ).toHaveCount(10);
    await expect(tiger.locator("text")).toHaveCount(0);
    await expect
      .poll(() =>
        dragon.evaluate((node) =>
          node
            .getAnimations()
            .every((animation) => animation.playState === "finished"),
        ),
      )
      .toBe(true);
    const before = (await dragon.boundingBox())!;
    await page.getByRole("button", { name: "Cards camera view" }).click();
    await expect(camera).toHaveAttribute("data-zoom", "2.00");
    await expect
      .poll(async () => (await dragon.boundingBox())!.width / before.width)
      .toBeCloseTo(2, 1);
    const frame = (await page.locator(".od-studio").boundingBox())!;
    for (const card of [dragon, tiger]) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThan(frame.x);
      expect(box.x + box.width).toBeLessThan(frame.x + frame.width);
      expect(box.y).toBeGreaterThan(frame.y);
      expect(box.y + box.height).toBeLessThan(frame.y + frame.height);
    }
    await expect(tiger).toHaveAttribute("aria-label", "Tiger: face down");
    expect(await camera.locator(".od-dealer").count()).toBe(1);
    expect(await camera.locator(".od-table-cards").count()).toBe(1);
    await page.screenshot({
      path: `test-results/one-day-cards-zoom-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Dealer camera view" }).click();
    await expect(camera).toHaveAttribute("data-zoom", "1.50");
    await page.getByRole("button", { name: "Zoom studio in" }).click();
    await expect(camera).toHaveAttribute("data-zoom", "1.60");
    await page.getByRole("button", { name: "Wide camera view" }).click();
    await expect(camera).toHaveAttribute("data-zoom", "1.00");
    const slider = page.getByRole("slider", { name: "Studio zoom" });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(camera).toHaveAttribute("data-zoom", "2.00");
    await expect(
      page.getByRole("button", { name: "Zoom studio in" }),
    ).toBeDisabled();
    await page.keyboard.press("Home");
    await expect(camera).toHaveAttribute("data-zoom", "1.00");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
}

test("zoom and fullscreen preserve background music without enabling commentary", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  const music = page.getByTestId("od-studio-music");
  await expect(music).toHaveJSProperty("paused", false);
  await music.evaluate((audio: HTMLAudioElement) => {
    (window as any).__zoomAudio = audio;
    (window as any).__zoomTime = audio.currentTime;
  });
  await page.getByRole("button", { name: "Dealer camera view" }).click();
  await page.getByRole("button", { name: "Open studio fullscreen" }).click();
  await expect(page.getByTestId("od-studio-player")).toHaveAttribute(
    "data-expanded",
    "true",
  );
  expect(
    await music.evaluate(
      (audio: HTMLAudioElement) =>
        audio === (window as any).__zoomAudio &&
        audio.currentTime >= (window as any).__zoomTime,
    ),
  ).toBe(true);
  await expect(page.getByTestId("od-dealer-speech")).toHaveCount(0);
  await page.getByRole("button", { name: "Exit studio fullscreen" }).click();
  await expect(page.getByTestId("od-studio-player")).toHaveAttribute(
    "data-expanded",
    "false",
  );
  await expect(music).toHaveJSProperty("paused", false);
});

test("fullscreen fallback keeps controls reachable and Escape restores the table", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new DOMException("Not supported", "NotAllowedError"));
  });
  await setup(page);
  await page.getByRole("button", { name: "Cards camera view" }).click();
  await page.getByRole("button", { name: "Open studio fullscreen" }).click();
  const player = page.getByTestId("od-studio-player");
  await expect(player).toHaveAttribute("data-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Exit studio fullscreen" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("slider", { name: "Studio zoom" }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/one-day-studio-fullscreen-phone.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(player).toHaveAttribute("data-expanded", "false");
  await expect(page.getByTestId("od-studio-camera")).toHaveAttribute(
    "data-zoom",
    "2.00",
  );
  await expect(
    page.getByRole("button", { name: "Open studio fullscreen" }),
  ).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).not.toBe("hidden");
});

test("late entry and lost connection cannot play stale commentary", async ({
  page,
}) => {
  const state = await setup(page);
  state.deadline(Date.now() + 3500);
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Enable game sounds" }).click();
  await expect(page.getByTestId("od-dealer-speech")).toHaveCount(0);
  const music = page.getByTestId("od-studio-music");
  await expect(music).toHaveJSProperty("paused", false);
  state.offline();
  await expect(music).toHaveJSProperty("paused", true);
  await expect(page.getByTestId("od-dealer-speech")).toHaveCount(0);
});
