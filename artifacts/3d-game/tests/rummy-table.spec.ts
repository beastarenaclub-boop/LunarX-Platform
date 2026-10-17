import { rummySessionReducer } from "@workspace/api-zod/rummy-session";
import { expect, test, type Page } from "@playwright/test";
import {
  beginPlay,
  createDeck,
  initialTable,
  startRound,
  type TableState,
} from "../src/game/rummy/engine";

async function setup(page: Page, state?: TableState) {
  const errors: string[] = [];
  const moneyRequests: string[] = [];
  let session = { table: state ?? { ...initialTable(), balance: 10000 }, auto: null, autoPlay: false, notice: "" } as import("@workspace/api-zod/rummy-session").RummySession;
  let version = 0, deadline = 0;
  const apply = (action: import("@workspace/api-zod/rummy-session").Action) => {
    session = rummySessionReducer(session, action); version++;
    const t = session.table; deadline = Date.now() + (t.phase === "dealing" ? 2600 : t.phase === "finished" ? 6000 : t.current !== 0 || session.autoPlay ? 950 : 20000);
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((state) => {
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    );

  }, state);
  await page.routeWebSocket("**/ws", (ws) => ws.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      route.request().method() === "POST" &&
      /bet|wallet|cash|deposit/.test(path)
    )
      moneyRequests.push(path);
    if (path.startsWith("/api/rummy/")) {
      if (route.request().method() === "POST") apply(route.request().postDataJSON().action);
      else if (deadline && Date.now() >= deadline) {
        const phase = session.table.phase;
        if (phase === "dealing") apply({ type: "dealt" });
        else if (phase === "playing") apply({ type: "step" });
        else if (phase === "finished" && session.auto) apply({ type: "auto-next" });
      }
      await route.fulfill({ json: { ...session, version, deadline, serverNow: Date.now() } });
      return;
    }
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "rummy-test",
        displayName: "You",
        email: "rummy@example.test",
        role: "player",
      };
    else if (path.includes("/config")) body = { enabled: false };
    else if (path.includes("/registry")) body = [];
    await route.fulfill({ json: body });
  });
  await page.goto("/rummy");
  await expect(page.getByTestId("rummy-page")).toBeVisible();
  return { errors, moneyRequests };
}

function winningState() {
  const s = beginPlay(startRound({ ...initialTable(), balance: 10000 }, 50, () => 0.35));
  const ids = "H3 H4 H5 S7 S8 S9 D11 C11 H11 C1 C2 C3 C4 D13"
    .split(" ")
    .map((token) => `0-${token[0]}-${token.slice(1)}`);
  const deck = createDeck();
  const hand = ids.map((id) => deck.find((c) => c.id === id)!);
  const remaining = deck.filter(
    (c) => !ids.includes(c.id) && c.id !== "0-D-10",
  );
  s.players[0].hand = hand;
  for (let i = 1; i <= 3; i++) s.players[i].hand = remaining.splice(0, 13);
  s.indicator = deck.find((c) => c.id === "0-D-10")!;
  s.wild = 10;
  s.discard = [remaining.pop()!];
  s.stock = remaining;
  s.step = "discard";
  return s;
}

for (const [label, width, height] of [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
  ["small phone", 320, 568],
  ["landscape", 844, 390],
] as const) {
  test(`${label}: playable table fits the viewport and deals 13 cards`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const { errors, moneyRequests } = await setup(page);
    await expect(
      page.getByRole("img", { name: /Asha, animated computer dealer/ }),
    ).toBeVisible();
    await expect(page.getByTestId("rummy-balance")).toHaveText("10,000");
    await expect(page.getByTestId("rummy-studio")).toHaveAttribute(
      "data-mode",
      "poster",
    );
    await expect(page.getByTestId("rummy-dealer-video")).toHaveCount(0);
    await page.screenshot({
      path: `../../tmp/rummy-studio-${label.replaceAll(" ", "-")}-ready.png`,
    });
    await page.getByTestId("rummy-start").click();
    await expect(page.getByTestId("rummy-page")).toHaveAttribute(
      "data-phase",
      "playing",
    );
    await expect(
      page.getByTestId("rummy-hand").locator("[data-card-id]"),
    ).toHaveCount(13);
    await expect(page.getByTestId("rummy-balance")).toHaveText("9,950");
    await page.getByTestId("rummy-draw-stock").click();
    await expect(
      page.getByTestId("rummy-hand").locator("[data-card-id]"),
    ).toHaveCount(14);
    await page
      .getByTestId("rummy-hand")
      .locator("[data-card-id]")
      .first()
      .click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(
      page.getByTestId("rummy-hand").locator("[data-card-id]"),
    ).toHaveCount(13);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../tmp/rummy-studio-${label.replaceAll(" ", "-")}-playing.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(moneyRequests).toEqual([]);
  });
}

test("valid declaration settles once and survives reload", async ({ page }) => {
  await setup(page, winningState());
  await page.locator('[data-card-id="0-D-13"]').click();
  await page.getByRole("button", { name: "Declare", exact: true }).click();
  await expect(page.getByTestId("rummy-result")).toContainText(
    "You won the table",
  );
  await expect(page.getByTestId("rummy-balance")).toHaveText("10,150");
  await expect(page.getByText("Winning hand · You")).toBeVisible();
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  await expect(page.getByTestId("round-win-profit")).toHaveText("+\u20b9150.00");
  await expect(page.getByTestId("round-win-payout")).toHaveText("\u20b9200.00");
  await page.getByTestId("round-win-ok").click();
  await page.reload();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  await expect(page.getByTestId("rummy-balance")).toHaveText("10,150");
  await expect(page.getByTestId("rummy-result")).toContainText(
    "You won the table",
  );
});

test("auto-bet start, stop, limits and reload do not create extra entries", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Auto bet" }).click();
  await page.getByLabel("Stop loss chips").fill("10");
  await expect(page.getByTestId("rummy-start")).toBeDisabled();
  await page.getByLabel("Stop loss chips").fill("100");
  await page.getByLabel("Auto bet rounds").selectOption("3");
  await page.getByTestId("rummy-start").click();
  await expect(page.getByTestId("rummy-stop-auto")).toContainText("2 left");
  await expect(
    page.getByRole("switch", { name: "Auto-play my hand" }),
  ).toBeChecked();
  await page.getByTestId("rummy-stop-auto").click();
  await expect(page.getByTestId("rummy-stop-auto")).toHaveCount(0);
  await expect(page.getByTestId("rummy-balance")).toHaveText("9,950");
  await page.reload();
  await expect(page.getByTestId("rummy-balance")).toHaveText("9,950");
  await expect(
    page.getByRole("switch", { name: "Auto-play my hand" }),
  ).toBeChecked();
  await expect(page.getByTestId("rummy-stop-auto")).toHaveCount(0);
});

test("rules are accessible and unauthenticated visits remain gated", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("btn-game-rules").click();
  await expect(page.getByRole("dialog")).toContainText("Win the pot");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { error: "Unauthorized" } }),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});

test("chip selection does not bet and repeat uses the actual previous entry", async ({
  page,
}) => {
  await setup(page, winningState());
  await page.locator('[data-card-id="0-D-13"]').click();
  await page.getByRole("button", { name: "Declare", exact: true }).click();
  await expect(page.getByTestId("rummy-balance")).toHaveText("10,150");
  await page.getByTestId("round-win-ok").click();
  await page
    .getByRole("button", { name: "Entry 200 chips", exact: true })
    .click();
  await expect(page.getByTestId("rummy-selected-entry")).toContainText("200");
  await expect(page.getByTestId("rummy-balance")).toHaveText("10,150");
  await page.getByRole("button", { name: "Repeat last entry" }).click();
  await expect(page.getByTestId("rummy-balance")).toHaveText("10,100");
  await page.getByRole("button", { name: "Bet controls", exact: true }).click();
  await expect(page.getByTestId("rummy-selected-entry")).toContainText("50");
  await expect(
    page.getByRole("button", { name: "Repeat last entry" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Entry 200 chips", exact: true }),
  ).toBeDisabled();
});

test("studio video stays in its seated segment and falls back if the media fails", async ({
  page,
}) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const video = page.getByTestId("rummy-dealer-video");
  await expect(page.getByTestId("rummy-studio")).toHaveAttribute(
    "data-mode",
    "video",
  );
  await video.evaluate((el) => {
    (el as HTMLVideoElement).currentTime = 5.75;
  });
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
    .toBeLessThan(2);
  await video.evaluate((el) => el.dispatchEvent(new Event("error")));
  await expect(page.getByTestId("rummy-studio")).toHaveAttribute(
    "data-mode",
    "poster",
  );
  await expect(video).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: /Asha, animated computer dealer/ }),
  ).toBeVisible();
  await expect(page.getByTestId("rummy-start")).toBeEnabled();
});

test("mobile chips up to 10k preserve auto limits and debit the selected entry once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, moneyRequests } = await setup(page);
  for (const value of [1000, 2000, 5000, 10000]) {
    const chip = page.getByRole("button", {
      name: `Entry ${value} chips`,
      exact: true,
    });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("rummy-selected-entry")).toHaveText(
      `${value.toLocaleString("en-IN")} chips`,
    );
    await expect(page.getByTestId("rummy-balance")).toHaveText("10,000");
  }
  await page.getByRole("tab", { name: "Auto bet" }).click();
  await expect(page.getByLabel("Stop loss chips")).toHaveValue("500");
  await expect(page.getByTestId("rummy-start")).toBeDisabled();
  await expect(
    page.getByText("Stop loss must be at least 10,000 chips for this entry."),
  ).toBeVisible();
  await page.getByLabel("Stop loss chips").fill("10000");
  await page.getByTestId("rummy-start").click();
  await expect(page.getByTestId("rummy-balance")).toHaveText("0");
  await expect(page.locator(".rm-pot strong")).toContainText("40,000");
  await page.getByTestId("rummy-stop-auto").click();
  await page.reload();
  await expect(page.getByTestId("rummy-balance")).toHaveText("0");
  await expect(page.locator(".rm-pot strong")).toContainText("40,000");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(moneyRequests).toEqual([]);
});
