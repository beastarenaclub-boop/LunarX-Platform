import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { LudoTable } from "@workspace/api-zod/ludo";
const base = "http://127.0.0.1:5398";
async function player(
  browser: Browser,
  name: string,
  viewport = { width: 1440, height: 1000 },
  screen: "home" | "online" = "online",
) {
  const context = await browser.newContext({ baseURL: base, viewport });
  const login = await context.request.post("/api/test/ludo/login", {
    data: { name },
  });
  expect(login.ok()).toBeTruthy();
  const { id } = await login.json();
  const page = await context.newPage();
  await page.goto("/ludo");
  await expect(
    page.getByRole("button", { name: "Online multiplayer", exact: true }),
  ).toBeVisible();
  if (screen === "home") return { context, page, id };
  await page
    .getByRole("button", { name: "Online multiplayer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Find a match" }),
  ).toBeEnabled();
  return { context, page, id };
}
const state = async (context: BrowserContext) =>
  (await (await context.request.get("/api/ludo/state")).json()) as LudoTable;

for (const capacity of [2, 4] as const)
  test(`Computer menu starts ${capacity} seats immediately, resumes and settles through the wallet`, async ({
    browser,
  }) => {
    const p = await player(
      browser,
      "Computer Mode Player",
      { width: 390, height: 844 },
      "home",
    );
    try {
      await p.page
        .getByRole("button", { name: "Play against Computer", exact: true })
        .click();
      await expect(
        p.page.getByText("PLAY AGAINST COMPUTER", { exact: true }),
      ).toBeVisible();
      if (capacity === 4)
        await p.page
          .getByRole("button", { name: "4 players Classic battle" })
          .click();
      await p.page.getByRole("button", { name: "Find a match" }).click();
      await expect(
        p.page.getByRole("heading", { name: "Your turn", exact: true }),
      ).toBeVisible();
      await expect(p.page.locator(".ld-search-screen")).toHaveCount(0);
      const before = await state(p.context);
      expect(before.match!.capacity).toBe(capacity);
      expect(
        before.match!.state.players.filter((x) => x?.kind === "computer"),
      ).toHaveLength(capacity - 1);
      expect(before.balancePaise).toBe("99000");
      await p.page.reload();
      await expect(p.page.locator(".ld-match-id")).toContainText(
        before.match!.id.slice(0, 8).toUpperCase(),
      );
      expect((await state(p.context)).balancePaise).toBe("99000");
      await finish(p.context, p.page);
      expect((await state(p.context)).balancePaise).toBe(
        String(99000 + capacity * 900),
      );
    } finally {
      await p.context.close();
    }
  });
async function finish(
  context: BrowserContext,
  page: Page,
  seat = 0,
  color?: string,
) {
  const t = await state(context);
  await context.request.post("/api/test/ludo/winning-move", {
    data: { id: t.match!.id, seat },
  });
  await expect(
    page.getByRole("button", { name: "Move 4", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: color ? `${color} token 4, move` : "Move 4",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "You take the crown!" }),
  ).toBeVisible();
}
test("two accounts play the same real board, receive private WS events and resume after refresh", async ({
  browser,
}) => {
  const a = await player(browser, "Aarav"),
    b = await player(browser, "Meera");
  const events: string[] = [];
  a.page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => events.push(String(f.payload))),
  );
  await a.page.reload();
  try {
    await a.page
      .getByRole("button", { name: "green tokens", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "red tokens", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Finding your opponents" }),
    ).toBeVisible();
    await expect(a.page.locator(".ld-versus-seat")).toHaveCount(2);
    await expect(a.page.getByRole("group", { name: "Ludo board" })).toHaveCount(
      0,
    );
    await a.page.screenshot({
      path: "tmp/ludo-start-checks/search-two.png",
      fullPage: true,
    });
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Your turn", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("heading", { name: "Aarav's turn" }),
    ).toBeVisible();
    const [one, two] = await Promise.all([state(a.context), state(b.context)]);
    expect(one.match!.id).toBe(two.match!.id);
    expect(one.match!.you).toBe(0);
    expect(two.match!.you).toBe(1);
    expect(one.balancePaise).toBe("99000");
    expect(one.match!.state.players.map((p) => p?.color)).toEqual([
      "red",
      "yellow",
    ]);
    await expect(a.page.locator(".ld-seat-green[data-you]")).toBeVisible();
    await expect(b.page.locator(".ld-seat-red[data-you]")).toBeVisible();
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(async () => (await state(b.context)).match!.state.rollNonce)
      .toBe(1);
    await a.page.reload();
    await expect(a.page.locator(".ld-match-id")).toContainText(
      one.match!.id.slice(0, 8).toUpperCase(),
    );
    expect((await state(a.context)).balancePaise).toBe("99000");
    await expect(a.page.locator(".ld-seat-green[data-you]")).toBeVisible();
    await expect
      .poll(() =>
        events.some(
          (e) => e.includes(`ludo:${a.id}`) && e.includes('"op":"event"'),
        ),
      )
      .toBeTruthy();
    const denied = await a.page.evaluate(
      (other) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://${location.host}/ws`);
          ws.onopen = () =>
            ws.send(
              JSON.stringify({ op: "subscribe", topic: `ludo:${other}` }),
            );
          ws.onmessage = ({ data }) => {
            const m = JSON.parse(data);
            if (m.op === "denied") {
              ws.close();
              resolve(m.reason);
            }
          };
        }),
      b.id,
    );
    expect(denied).toBe("forbidden");
    await finish(a.context, a.page, 0, "green");
    await expect(
      b.page.getByRole("heading", { name: "Aarav wins!" }),
    ).toBeVisible();
    expect((await state(a.context)).balancePaise).toBe("100800");
    if (await a.page.evaluate(() => document.fullscreenEnabled)) {
      await a.page
        .getByRole("button", { name: "Fullscreen", exact: true })
        .click();
      await expect(
        a.page.getByRole("button", { name: "Exit fullscreen" }),
      ).toBeVisible();
      await a.page.getByRole("button", { name: "How to play" }).click();
      await expect(a.page.getByRole("dialog")).toBeVisible();
      await a.page.getByRole("button", { name: "Close", exact: true }).click();
      await a.page.getByRole("button", { name: "Exit fullscreen" }).click();
    }
    await a.page.screenshot({
      path: "tmp/ludo-ui-checks/desktop-result.png",
      fullPage: true,
    });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
test("four separate accounts join one table with four human seats", async ({
  browser,
}) => {
  const players = [];
  for (const name of [
    "Red Player",
    "Green Player",
    "Yellow Player",
    "Blue Player",
  ])
    players.push(await player(browser, name));
  try {
    for (const p of players) {
      await p.page
        .getByRole("button", { name: "4 players Classic battle" })
        .click();
      await p.page.getByRole("button", { name: "Find a match" }).click();
      await expect(p.page.locator(".ld-match-id")).toBeVisible();
      if (p === players[0]) {
        await expect(p.page.locator(".ld-versus-seat")).toHaveCount(4);
        await p.page.screenshot({
          path: "tmp/ludo-start-checks/search-four.png",
          fullPage: true,
        });
      }
    }
    const t = await state(players[0].context);
    expect(t.match!.capacity).toBe(4);
    expect(
      t.match!.state.players.every((p) => p?.kind === "human"),
    ).toBeTruthy();
    expect(t.match!.prizePaise).toBe("3600");
    for (const p of players) {
      expect((await state(p.context)).match!.id).toBe(t.match!.id);
      await expect(p.page.locator(".ld-player")).toHaveCount(4);
    }
    await players[0].page.screenshot({
      path: "tmp/ludo-ui-checks/four-players.png",
      fullPage: true,
    });
    await players[3].page
      .getByRole("button", { name: "Leave match", exact: true })
      .click();
    await players[3].page
      .getByRole("button", { name: "Forfeit & leave" })
      .click();
    await expect(
      players[3].page.getByRole("heading", { name: "You left the match" }),
    ).toBeVisible();
    expect((await state(players[0].context)).match!.status).toBe("playing");
    await players[3].page.getByRole("button", { name: "Play again" }).click();
    await expect(
      players[3].page.getByRole("button", { name: "Find a match" }),
    ).toBeEnabled();
    await finish(players[0].context, players[0].page);
    expect((await state(players[0].context)).balancePaise).toBe("102600");
  } finally {
    for (const p of players) await p.context.close();
  }
});
test("empty 4-player table fills with three labelled computers after the real countdown", async ({
  browser,
}) => {
  const p = await player(browser, "Solo Player", { width: 390, height: 844 });
  try {
    await p.page
      .getByRole("button", { name: "4 players Classic battle" })
      .click();
    await p.page.getByRole("button", { name: "Find a match" }).click();
    const searchBack = p.page.getByRole("button", {
      name: "Cancel search and refund entry",
    });
    await expect(searchBack).toBeVisible();
    const searchBackBox = await searchBack.boundingBox();
    const viewportBox = await p.page
      .locator('[data-game-viewport="ludo"]')
      .boundingBox();
    expect(searchBackBox!.y).toBeGreaterThanOrEqual(viewportBox!.y);
    await expect(
      p.page.getByRole("heading", { name: "Your turn", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const t = await state(p.context);
    expect(
      t.match!.state.players.filter((x) => x?.kind === "computer"),
    ).toHaveLength(3);
    await expect(
      p.page.locator(".ld-player").filter({ hasText: "Computer" }),
    ).toHaveCount(3);
    const roll = p.page.getByRole("button", { name: "Roll dice", exact: true });
    const rollBox = await roll.boundingBox();
    expect(rollBox!.y + rollBox!.height).toBeLessThanOrEqual(844);
    await roll.click();
    await expect
      .poll(async () => (await state(p.context)).match!.state.rollNonce)
      .toBeGreaterThan(0);
    await p.page.screenshot({
      path: "tmp/ludo-ui-checks/mobile-match.png",
      fullPage: true,
    });
    await p.context.setOffline(true);
    await expect(
      p.page.getByText("Reconnecting…", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await p.context.setOffline(false);
    await expect(p.page.getByText("LIVE TABLE", { exact: true })).toBeVisible();
    expect((await state(p.context)).match!.id).toBe(t.match!.id);
    let conflict = true;
    await p.page.route("**/api/ludo/*/action", async (route) => {
      if (route.request().postDataJSON()?.type === "leave" && conflict) {
        conflict = false;
        await route.fulfill({
          status: 409,
          json: {
            error: "The board changed. Please try again on the updated board.",
          },
        });
      } else await route.continue();
    });
    await p.page
      .getByRole("button", { name: "Leave match", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Forfeit & leave" }).click();
    await expect
      .poll(async () => (await state(p.context)).match!.status)
      .toBe("finished");
    expect((await state(p.context)).balancePaise).toBe("99000");
    expect(conflict).toBe(false);
  } finally {
    await p.context.setOffline(false);
    await p.context.close();
  }
});
test("lost join response can be retried without double debit; cancellation refunds once", async ({
  browser,
}) => {
  const p = await player(browser, "Retry Player");
  try {
    await p.page.route(
      "**/api/ludo/join",
      async (route) => {
        await route.fetch();
        await route.abort("failed");
      },
      { times: 1 },
    );
    await p.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      p.page.getByRole("button", { name: "Retry last action" }),
    ).toBeVisible();
    await p.page.getByRole("button", { name: "Retry last action" }).click();
    await expect(
      p.page.getByRole("button", { name: "Cancel & refund entry" }),
    ).toBeEnabled();
    expect((await state(p.context)).balancePaise).toBe("99000");
    await p.page.getByRole("button", { name: "Cancel & refund entry" }).click();
    await expect(
      p.page.getByRole("heading", { name: "Entry refunded" }),
    ).toBeVisible();
    expect((await state(p.context)).balancePaise).toBe("100000");
  } finally {
    await p.context.close();
  }
});
for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`lobby, controls and rules fit ${viewport.width}x${viewport.height}`, async ({
    browser,
  }) => {
    const p = await player(browser, "Mobile Player", viewport, "home");
    const errors: string[] = [];
    p.page.on("pageerror", (e) => errors.push(e.message));
    try {
      for (const name of ["Online multiplayer", "Play against Computer"]) {
        const tile = p.page.getByRole("button", { name, exact: true });
        const box = await tile.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await p.page.screenshot({
        path: `tmp/ludo-start-checks/home-${viewport.width}.png`,
        fullPage: true,
      });
      await p.page
        .getByRole("button", { name: "Game settings", exact: true })
        .click();
      await p.page.getByRole("button", { name: "Sound", exact: true }).click();
      await expect(
        p.page.getByRole("button", { name: "Sound", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await p.page.getByRole("button", { name: "Music", exact: true }).click();
      await expect(
        p.page.getByRole("button", { name: "Music", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      await p.page.reload();
      await p.page
        .getByRole("button", { name: "Game settings", exact: true })
        .click();
      await expect(
        p.page.getByRole("button", { name: "Sound", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        p.page.getByRole("button", { name: "Music", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await p.page.getByRole("button", { name: "Music", exact: true }).click();
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      await p.page
        .getByRole("button", { name: "Online multiplayer", exact: true })
        .click();
      expect(
        await p.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      const button = p.page.getByRole("button", { name: "Find a match" });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThan(150);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await p.page.getByRole("button", { name: "Higher entry fee" }).click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹90");
      await p.page
        .getByRole("button", { name: "4 players Classic battle" })
        .click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹180");
      await p.page.getByRole("button", { name: "Lower entry fee" }).click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹36");
      await p.page.getByRole("button", { name: "How to play" }).click();
      await expect(p.page.getByRole("dialog")).toContainText("10%");
      await expect(p.page.getByRole("dialog")).toContainText("platform funds");
      expect(errors).toEqual([]);
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      if (viewport.width === 320) {
        await p.page.route("**/api/ludo/state", async (route) => {
          const response = await route.fetch();
          const json = await response.json();
          await route.fulfill({
            response,
            json: { ...json, balancePaise: "1000000000000" },
          });
        });
        await p.page.reload();
        await expect(p.page.locator(".ld-wallet b")).toContainText(
          "10,00,00,00,000",
        );
        const rules = p.page.getByRole("button", {
          name: "Game rules",
          exact: true,
        });
        const headerBox = await rules.boundingBox();
        expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(320);
        await rules.click();
        await expect(p.page.getByRole("dialog")).toBeVisible();
        await p.page
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await p.page.screenshot({
        path: `tmp/ludo-ui-checks/preview-${viewport.width}.png`,
        fullPage: true,
      });
    } finally {
      await p.context.close();
    }
  });
