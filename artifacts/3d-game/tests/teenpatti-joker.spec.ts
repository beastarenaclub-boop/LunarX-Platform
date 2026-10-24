import { test, expect, type Page } from "@playwright/test";
import {
  dealJoker,
  jokerPayout,
  jokerCardLabel,
} from "@workspace/api-zod/teenpatti-joker";

async function setup(
  page: Page,
  wallet = 100000,
  revealMs = 2000,
  settleMs = 6000,
  deck = [3, 16, 26, 47, 36, 39, 37],
) {
  let phase = "betting",
    id = 1,
    end = Date.now() + 60000,
    offline = false,
    dropped = false,
    rejected = false;
  let bets: any[] = [],
    history: any[] = [];
  const errors: string[] = [],
    posts: any[] = [];
  const outcome = dealJoker(deck);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: any = {};
    if (path === "/api/auth/me")
      json = {
        id: "joker-test",
        email: "joker@example.test",
        displayName: "Joker Player",
        role: "player",
      };
    else if (path === "/api/wallet/balance")
      json = { balance: String(wallet), scope: "lunar", currency: "INR" };
    else if (path === "/api/wallet/balances")
      json = { balances: { lunar: String(wallet) }, currency: "INR" };
    else if (path.startsWith("/api/teen-patti-joker")) {
      if (offline)
        return route.fulfill({
          status: 503,
          json: { detail: "Table offline" },
        });
      if (path.endsWith("/config"))
        json = {
          enabled: true,
          minStakePaise: "1000",
          maxStakePaise: "20000000",
        };
      else if (path.endsWith("/history")) json = history;
      else if (path.endsWith("/verify"))
        json = {
          verified: true,
          serverSeed: "server",
          serverSeedHash: "hash",
          clientSeed: "client",
          nonce: 0,
        };
      else if (path.endsWith("/round"))
        json = {
          roundId: `joker-${id}`,
          gameCode: "teen-patti-joker",
          phase,
          now: Date.now(),
          bettingEndsAt: end,
          revealEndsAt: end + revealMs,
          settleEndsAt: end + revealMs + settleMs,
          serverSeedHash: "committed-hash",
          clientSeed: "client",
          nonce: 0,
          outcome: phase === "betting" ? null : outcome,
          serverSeed: phase === "betting" ? null : "server",
          myBets: bets,
          recent: history
            .filter((h) => h.outcome)
            .map((h) => ({ roundId: h.roundId, outcome: h.outcome })),
          liveBets: [],
          playerCount: bets.length,
          totalStake: bets[0]?.totalStake ?? "0",
          config: {
            minStakePaise: "1000",
            maxStakePaise: "20000000",
            bettingWindowMs: 60000,
            revealDurationMs: revealMs,
            settleDurationMs: settleMs,
          },
        };
      else if (path.endsWith("/bet")) {
        const body = route.request().postDataJSON();
        posts.push(body);
        if (rejected)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: "BAD_REQUEST",
                message: "Betting is closed. Please wait for the next round.",
              },
            },
          });
        if (!bets.length) {
          const total = body.bets.reduce(
            (n: number, b: any) => n + Number(b.amountPaise),
            0,
          );
          wallet -= total;
          bets = [
            {
              slipId: `slip-${id}`,
              bets: body.bets,
              totalStake: String(total),
              payoutAmount: "0",
              status: "pending",
            },
          ];
        }
        if (dropped) {
          dropped = false;
          return route.abort();
        }
        json = {
          slipId: bets[0].slipId,
          roundId: `joker-${id}`,
          totalStake: bets[0].totalStake,
        };
      }
    }
    await route.fulfill({ json });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Bet on Player A", exact: true }),
  ).toBeEnabled();
  return {
    errors,
    posts,
    outcome,
    wallet: () => wallet,
    offline: () => {
      offline = true;
    },
    drop: () => {
      dropped = true;
    },
    reject: () => {
      rejected = true;
    },
    reveal: (elapsedMs = 0) => {
      phase = "reveal";
      end = Date.now() - elapsedMs;
    },
    settle: (elapsedMs = 200) => {
      phase = "settling";
      end = Date.now() - revealMs - elapsedMs;
      if (bets.length) {
        const payout = jokerPayout(bets[0].bets, outcome);
        wallet += Number(payout);
        bets[0].status = "settled";
        bets[0].payoutAmount = String(payout);
        history.unshift({
          roundId: `joker-${id}`,
          outcome,
          bets: bets[0].bets,
          totalStake: bets[0].totalStake,
          payoutAmount: String(payout),
          status: "settled",
          createdAt: new Date().toISOString(),
        });
      }
    },
    next: () => {
      phase = "betting";
      id++;
      end = Date.now() + 60000;
      bets = [];
    },
  };
}
test("select, undo, clear, confirm, reveal, settle and repeat a real-shaped slip", async ({
  page,
}) => {
  const state = await setup(page);
  const player = page.getByRole("button", {
    name: "Bet on Player A",
    exact: true,
  });
  await player.click();
  await page
    .getByRole("button", { name: "Bet on Hearts", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo last chip" }).click();
  await expect(page.locator(".j20-total b")).toHaveText("10");
  await page.getByRole("button", { name: "Clear bets" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm bet", exact: true }),
  ).toBeDisabled();
  await player.click();
  await page
    .getByRole("button", { name: "Bet on Spades", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm bet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirmed ✓", exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].bets).toEqual([
    { spot: "playerA", amountPaise: "1000" },
    { spot: "spades", amountPaise: "1000" },
  ]);
  expect(state.wallet()).toBe(98000);
  await expect(player).toBeDisabled();
  await expect(page.locator(".j20-studio .j20-card.is-up")).toHaveCount(0);
  state.reveal();
  await expect(page.locator(".j20-studio .j20-card.is-up")).toHaveCount(7, {
    timeout: 5000,
  });
  await expect(page.locator(".j20-status")).toContainText("PLAYER A WINS");
  await expect(page.locator(".j20-studio .is-wild")).toHaveCount(1);
  state.settle();
  await page.getByRole("button", { name: "My bets" }).click();
  await expect(page.getByRole("dialog")).toContainText("Player A wins");
  await expect(page.getByRole("dialog")).toContainText("Return 57.3");
  await page.keyboard.press("Escape");
  state.next();
  await expect(player).toBeEnabled();
  await page.getByRole("button", { name: "Repeat previous bet" }).click();
  await expect(page.locator(".j20-total b")).toHaveText("20");
  expect(state.errors).toEqual([]);
});
test("lost acknowledgement reconciles without a second debit, including refresh", async ({
  page,
}) => {
  const state = await setup(page);
  state.drop();
  await page
    .getByRole("button", { name: "Bet on Player B", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm bet", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Confirmed ✓", exact: true }),
  ).toBeVisible();
  expect(state.wallet()).toBe(99000);
  expect(state.posts).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
test("a rejected confirmation displays the server reason and releases its pending receipt", async ({
  page,
}) => {
  const state = await setup(page);
  state.reject();
  await page
    .getByRole("button", { name: "Bet on Player A", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm bet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Betting is closed");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("teenpatti-joker:pending:joker-test"),
    ),
  ).toBeNull();
  expect(state.wallet()).toBe(100000);
  expect(state.errors).toEqual([]);
});

test("insufficient funds and stale connections cannot add or confirm bets", async ({
  page,
}) => {
  const state = await setup(page, 500);
  await page
    .getByRole("button", { name: "Bet on Player A", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Insufficient wallet balance",
  );
  await expect(
    page.getByRole("button", { name: "Confirm bet", exact: true }),
  ).toBeDisabled();
  state.offline();
  await expect(
    page.getByRole("button", { name: "Bet on Player A", exact: true }),
  ).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
test("one lightweight player keeps moving through confirmation, dealing and collection", async ({
  page,
}) => {
  const forbidden: string[] = [],
    films: string[] = [];
  page.on("request", (request) => {
    if (
      /dealer-reference.*\.mp4|paper-tracks|JokerPaperInk/.test(request.url())
    )
      forbidden.push(request.url());
    if (/dealer-playback-v4\.mp4/.test(request.url()))
      films.push(request.url());
  });
  const state = await setup(page, 100000, 49000, 17000);
  const video = page.locator(".j20-dealer-video");
  await expect(video).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
    )
    .toBe(true);
  await video.evaluate((v) => {
    v.dataset.originalPlayer = "true";
  });
  const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await video.evaluate((v) => {
    v.dataset.seeks = "0";
    v.addEventListener("seeking", () => {
      v.dataset.seeks = String(Number(v.dataset.seeks) + 1);
    });
  });
  await page.waitForTimeout(3000);
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThan(before + 2.5);
  await expect(video).toHaveAttribute("data-seeks", "0");
  await page
    .getByRole("button", { name: "Bet on Player A", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm bet", exact: true }).click();
  await expect(page.locator(".j20-status")).toContainText("BETS CONFIRMED");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(before + 0.5);
  state.reveal(14000);
  await expect(video).toHaveAttribute("data-action", "dealing");
  await expect
    .poll(() =>
      video.evaluate(
        (v: HTMLVideoElement) =>
          !v.paused && v.currentTime >= 34 && v.playbackRate === 1,
      ),
    )
    .toBe(true);
  const dealing = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(dealing + 0.7);
  state.reveal(48000);
  await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(7);
  await expect(page.locator(".j20-status")).toContainText("PLAYER A WINS");
  state.settle();
  await expect(video).toHaveAttribute("data-action", "collecting");
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime >= 69),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Pause dealer animation" }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.getByRole("button", { name: "Play dealer animation" }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused))
    .toBe(true);
  state.next();
  await expect(
    page.getByRole("button", { name: "Bet on Player A", exact: true }),
  ).toBeEnabled();
  await expect(video).toHaveAttribute("data-action", "preparing");
  await expect(video).toHaveAttribute("data-original-player", "true");
  await expect(page.locator(".j20-studio canvas")).toHaveCount(0);
  expect([...new Set(films)]).toHaveLength(1);
  expect(forbidden).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("mobile decodes the 540p film and advances native frames", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  const video = page.locator(".j20-dealer-video");
  await expect
    .poll(() =>
      video.evaluate(
        (v: HTMLVideoElement) =>
          v.videoWidth === 960 && v.videoHeight === 540 && !v.paused,
      ),
    )
    .toBe(true);
  const frames = await video.evaluate(
    (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
  );
  await expect
    .poll(() =>
      video.evaluate(
        (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
      ),
    )
    .toBeGreaterThan(frames + 12);
  await expect(page.locator(".j20-studio canvas")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("a missed loadeddata event cannot leave the dealer hidden behind its poster", async ({
  page,
}) => {
  await page.addInitScript(() =>
    document.addEventListener(
      "loadeddata",
      (e) => e.stopImmediatePropagation(),
      true,
    ),
  );
  const state = await setup(page);
  await expect(page.locator(".j20-dealer-video")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      page
        .locator(".j20-dealer-video")
        .evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
    )
    .toBe(true);
  expect(state.errors).toEqual([]);
});

test("hidden and disconnected tables pause decoding and resume on return", async ({
  page,
}) => {
  const state = await setup(page);
  const video = page.locator(".j20-dealer-video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused))
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused))
    .toBe(true);
  state.offline();
  await expect(
    page.getByRole("button", { name: "Bet on Player A", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  expect(state.errors).toEqual([]);
});

test("a failed film can be retried without blocking the table", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/dealer-playback-v4.mp4", (route) =>
    fail ? route.abort() : route.continue(),
  );
  const state = await setup(page);
  await expect(
    page.getByRole("button", { name: "Retry dealer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Bet on Player A", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm bet", exact: true }),
  ).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "Retry dealer", exact: true }).click();
  await expect(page.locator(".j20-dealer-video")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      page
        .locator(".j20-dealer-video")
        .evaluate((v: HTMLVideoElement) => !v.paused),
    )
    .toBe(true);
  expect(state.errors).toEqual([]);
});

test("Joker and alternating A/B cards follow server timing and reveal the server's values", async ({
  page,
}) => {
  // A custom long window keeps each asserted landing distinct despite polling.
  const state = await setup(page, 100000, 80000);
  const order = [
    ".j20-joker .j20-card",
    ".j20-hand-A .j20-card",
    ".j20-hand-B .j20-card",
    ".j20-hand-A .j20-card",
    ".j20-hand-B .j20-card",
    ".j20-hand-A .j20-card",
    ".j20-hand-B .j20-card",
  ];
  const cards = [
    state.outcome.joker,
    ...state.outcome.handACards.flatMap((card, index) => [
      card,
      state.outcome.handBCards[index],
    ]),
  ];
  for (const [index, selector] of order.entries()) {
    state.reveal(([8, 15, 20, 27, 34, 41, 48][index] * 80000) / 49 + 100);
    await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(
      index + 1,
    );
    const dealtIndex = index === 0 ? 0 : Math.floor((index - 1) / 2);
    const card = page
      .locator(selector)
      .nth(selector.includes("hand-B") ? 2 - dealtIndex : dealtIndex);
    await expect(card).toHaveAttribute(
      "aria-label",
      new RegExp(jokerCardLabel(cards[index])),
    );
  }
  await expect(page.locator(".j20-status")).toContainText("PLAYER A WINS");
  state.next();
  await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("reduced motion waits for an explicit play while server cards still reveal", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  const image = page.locator(".j20-studio-image");
  const source = await image.getAttribute("src");
  state.reveal();
  await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(7);
  await expect(image).toHaveAttribute("src", source!);
  await expect(
    page.locator(".j20-studio video, .j20-studio canvas"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Play dealer animation" }).click();
  await expect(page.locator(".j20-dealer-video")).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      page
        .locator(".j20-dealer-video")
        .evaluate((v: HTMLVideoElement) => !v.paused),
    )
    .toBe(true);
  expect(state.errors).toEqual([]);
});

for (const width of [360, 390, 1440])
  test(`table and rules fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 1000 ? 1000 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await setup(page);
    await expect(page.locator(".j20-studio-image")).toBeVisible();
    expect(
      await page
        .locator(".j20-studio-image")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const name of [
      "Player A",
      "Player B",
      "Even",
      "Odd",
      "Red",
      "Black",
      "Spades",
      "Hearts",
      "Diamonds",
      "Clubs",
    ])
      await expect(
        page.getByRole("button", { name: `Bet on ${name}`, exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Game rules", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Pure Sequence ranks above Trail",
    );
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

for (const width of [360, 390, 1440])
  test(`server ranks are legible on the table and card rail at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await setup(
      page,
      100000,
      49000,
      17000,
      [9, 22, 38, 12, 11, 10, 0],
    );
    await expect(page.locator(".j20-table-card")).toHaveCount(0);
    state.reveal(48100);
    await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(7);
    await expect(page.locator(".j20-table-card")).toHaveCount(7);
    await page.getByRole("button", { name: "Pause dealer animation" }).click();
    await page.locator(".j20-dealer-video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 70;
    });
    await expect(page.locator(".j20-table-card")).toHaveCount(7);
    const order = [
      state.outcome.joker,
      state.outcome.handACards[0],
      state.outcome.handBCards[0],
      state.outcome.handACards[1],
      state.outcome.handBCards[1],
      state.outcome.handACards[2],
      state.outcome.handBCards[2],
    ];
    expect(
      await page
        .locator(".j20-table-card")
        .evaluateAll((cards) =>
          cards.map((card) => Number(card.getAttribute("data-card"))),
        ),
    ).toEqual(order);
    for (const [index, value] of order.entries()) {
      await expect(page.locator(".j20-table-rank").nth(index)).toHaveText(
        jokerCardLabel(value),
      );
    }
    await expect(page.locator(".j20-joker .j20-card-rank")).toHaveText("10");
    await expect(page.locator(".j20-hand-A .j20-card-rank")).toHaveText([
      "10",
      "K",
      "J",
    ]);
    await expect(page.locator(".j20-hand-B .j20-card-rank")).toHaveText([
      "A",
      "Q",
      "K",
    ]);
    expect(
      await page
        .locator(".j20-hands .j20-card-rank")
        .evaluateAll((ranks) =>
          ranks.every(
            (rank) => parseFloat(getComputedStyle(rank).fontSize) >= 22,
          ),
        ),
    ).toBe(true);
    expect(
      await page
        .locator(".j20-hands .j20-card")
        .evaluateAll((cards) =>
          cards.every((card) => card.getBoundingClientRect().width >= 34),
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".j20-studio canvas")).toHaveCount(0);
    await page.locator(".j20-studio").screenshot({
      path: `../../tmp/teenpatti-joker/card-ranks-${width}.png`,
    });
    state.next();
    await expect(page.locator(".j20-table-card")).toHaveCount(0);
    await expect(page.locator(".j20-hands .j20-card.is-up")).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
