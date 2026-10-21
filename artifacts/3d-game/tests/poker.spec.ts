import { test, expect, type Page } from "@playwright/test";
import {
  POKER_GAMES,
  POKER_TITLES,
  type PokerGame,
  type PokerTable,
  type PokerBetInput,
} from "@workspace/api-zod/poker";
import {
  quotesFor,
  lockSelections,
  commitment,
  outcome,
} from "../../api-server/src/services/pokerMath";
const sixHands = [
  [17, 29],
  [0, 39],
  [36, 6],
  [44, 19],
  [40, 20],
  [24, 14],
];
const board = [1, 4, 35, 10, 11],
  headsUp = [
    [26, 20],
    [28, 39],
  ];
async function setup(page: Page, game: PokerGame) {
  const now = Date.now(),
    hands = game === "poker-six-players" ? sixHands : headsUp;
  let state: PokerTable = {
    enabled: true,
    serverNow: now,
    balancePaise: "150000",
    quoteId: `${game}:108:v1`,
    quotes: quotesFor(game, hands),
    slips: [],
    recent: [],
    history: [],
    round: {
      id: 108,
      game,
      phase: "betting",
      phaseEndsAt: now + 120000,
      closesAt: now + 120000,
      revealsAt: now + 131000,
      endsAt: now + 138000,
      commitment: commitment(game, hands, board, "browser-nonce"),
      hands:
        game === "poker-six-players"
          ? hands
          : [
              [null, null],
              [null, null],
            ],
      board: [null, null, null, null, null],
    },
  };
  let offline = false,
    drop = false;
  const requests: PokerBetInput[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (socket) => socket.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/poker/")) {
      if (offline)
        return route.fulfill({ status: 503, json: { detail: "Offline" } });
      if (path.endsWith("/bet")) {
        const input: PokerBetInput = route.request().postDataJSON();
        requests.push(input);
        if (drop) {
          drop = false;
          return route.abort("failed");
        }
        if (!state.slips.some((s) => s.requestId === input.requestId)) {
          const locked = lockSelections(input.selections, state.quotes);
          state.balancePaise = String(
            BigInt(state.balancePaise) - locked.debit,
          );
          state.slips.push({
            id: requests.length,
            requestId: input.requestId,
            roundId: state.round.id,
            selections: locked.selections,
            stakePaise: String(locked.debit),
            payoutPaise: null,
          });
        }
      }
      return route.fulfill({ json: { ...state, serverNow: Date.now() } });
    }
    const body = path.endsWith("/auth/me")
      ? {
          id: "poker-browser",
          displayName: "Demo",
          email: "poker@test.invalid",
          role: "player",
        }
      : path.includes("/wallet/balance")
        ? { balance: state.balancePaise, currency: "INR", scope: "lunar" }
        : path.includes("/registry")
          ? []
          : {};
    return route.fulfill({ json: body });
  });
  await page.goto(`/${game}`);
  await expect(page.getByTestId("market-p0-back")).toBeEnabled();
  return {
    get state() {
      return state;
    },
    requests,
    errors,
    offline: () => {
      offline = true;
    },
    drop: () => {
      drop = true;
    },
    close: () => {
      state.round = {
        ...state.round,
        phase: "deal",
        hands,
        closesAt: Date.now() - 10,
        phaseEndsAt: Date.now() + 10000,
      };
    },
    reveal: () => {
      state.round = {
        ...state.round,
        phase: "result",
        hands,
        board,
        nonce: "browser-nonce",
        outcome: outcome(hands, board),
        phaseEndsAt: Date.now() + 60000,
      };
      state.history = [{ id: 108, ...outcome(hands, board) }];
    },
    reset: () => {
      state = {
        ...state,
        quoteId: `${game}:109:v1`,
        round: { ...state.round, id: 109 },
        slips: [],
      };
    },
  };
}
for (const game of POKER_GAMES) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${game} fits ${width}px and shows all betting markets`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      const app = await setup(page, game);
      await expect(
        page.getByRole("heading", { name: POKER_TITLES[game], exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pk-market")).toHaveCount(
        game === "poker-one-day" ? 8 : game === "poker-20-20" ? 18 : 6,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".pk-shell")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      if (width === 390 || (width === 1440 && game === "poker-six-players")) {
        await page.screenshot({
          path: testInfo.outputPath(`${game}-${width}.png`),
          fullPage: true,
        });
      }
      await page.getByTestId("market-p0-back").click();
      await expect(page.getByTestId("poker-debit")).toHaveText("₹100");
      await page.getByTestId("poker-confirm").click();
      await expect(page.getByTestId("poker-balance")).toContainText("1,400");
      expect(app.requests).toHaveLength(1);
      app.close();
      await expect(page.getByTestId("market-p0-back")).toBeDisabled();
      await expect(page.locator(".pk-lock")).toHaveCount(
        game === "poker-one-day" ? 8 : game === "poker-20-20" ? 18 : 6,
      );
      expect(app.errors).toEqual([]);
    });
  }
}
test("one-day lay liability, bonus rules, animated table and round verification", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await setup(page, "poker-one-day");
  await page.getByTestId("market-p0-lay").click();
  await expect(page.getByTestId("poker-debit")).toHaveText("₹102");
  await page.getByRole("button", { name: "Clear selected bets" }).click();
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1 TO 100");
  await expect(page.getByRole("dialog")).toContainText("₹102");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByTestId("poker-board").locator(".pk-card-back"),
  ).toHaveCount(5);
  await expect(page.locator(".pk-seat")).toHaveCount(2);
  app.reveal();
  await expect(page.getByTestId("poker-result")).toBeVisible();
  await expect(
    page.getByTestId("poker-board").locator(".pk-card-face"),
  ).toHaveCount(5);
  await expect(page.locator(".pk-seat-winner")).toHaveCount(
    app.state.round.outcome!.winners.length,
  );
  await page
    .getByRole("button", { name: "Round verification", exact: true })
    .click();
  await page.getByRole("button", { name: "Verify revealed cards" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Verified: these cards match",
  );
  expect(app.errors).toEqual([]);
});
test("network interruption retries one request across reload without a second debit", async ({
  page,
}) => {
  const app = await setup(page, "poker-20-20");
  await page.getByTestId("market-p0-back").click();
  app.drop();
  await page.getByTestId("poker-confirm").click();
  await expect(page.getByTestId("poker-confirm")).toHaveText(
    "Retry confirmation",
  );
  await page.reload();
  await expect(page.getByTestId("poker-confirm")).toHaveText(
    "Retry confirmation",
  );
  await page.getByTestId("poker-confirm").click();
  await expect(page.getByTestId("poker-balance")).toContainText("1,400");
  expect(app.requests).toHaveLength(2);
  expect(app.requests[0].requestId).toBe(app.requests[1].requestId);
  expect(app.state.slips).toHaveLength(1);
});
test("offline markets lock, stale selections clear on a new round, six-player pattern shows real history", async ({
  page,
}) => {
  const app = await setup(page, "poker-six-players");
  await page.getByTestId("market-p0-back").click();
  app.reset();
  await expect(page.getByTestId("poker-debit")).toHaveText("₹0");
  await page.getByRole("tab", { name: "Pattern" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "Completed rounds will appear here",
  );
  app.reveal();
  await expect(page.getByRole("tabpanel")).toContainText("#108");
  await page.getByRole("tab", { name: "Hands" }).click();
  app.offline();
  await expect(
    page.getByRole("status").filter({ hasText: "Reconnecting" }),
  ).toBeVisible();
  await expect(page.getByTestId("market-p0-back")).toBeDisabled();
});
