import { test, expect, type Browser } from "@playwright/test";
async function player(browser: Browser, name: string) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5398",
    viewport: { width: 392, height: 850 },
    isMobile: true,
    hasTouch: true,
  });
  const login = await context.request.post("/api/test/ludo/login", {
    data: { name },
  });
  expect(login.ok()).toBeTruthy();
  const { id } = await login.json();
  await context.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", {
      value: (array: Uint8Array) => {
        if (array instanceof Uint8Array && array.length === 1) {
          array[0] = ((window as any).__snakeRoll ?? 4) - 1;
          return array;
        }
        return original(array);
      },
    });
  });
  const page = await context.newPage();
  await page.goto("/ludo");
  await expect(
    page.getByRole("button", { name: "Snakes and Ladders", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const open = () =>
    page
      .getByRole("button", { name: "Snakes and Ladders", exact: true })
      .click();
  return { page, context, id, open };
}
test("reference home, four Snake modes, Nature theme, four local players and ladder resume", async ({
  browser,
}) => {
  const p = await player(browser, "Aarav");
  const errors: string[] = [];
  p.page.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.page.screenshot({ path: "tmp/ludo-refined/home.png" });
    await expect(p.page.locator(".ld-video-hero")).toBeVisible();
    await expect(p.page.locator(".ld-video-member")).toBeVisible();
    await p.open();
    await expect(p.page.locator(".sn-mode")).toHaveCount(4);
    await p.page.screenshot({ path: "tmp/ludo-refined/snakes-home.png" });
    await p.page
      .getByRole("button", { name: "Snake settings", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Sound on", exact: true }).click();
    await expect(
      p.page.getByRole("button", { name: "Sound off", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await p.page.getByRole("button", { name: "Close", exact: true }).click();
    await p.page.setViewportSize({ width: 844, height: 390 });
    for (const mode of [
      "Play Online",
      "Play with Friends",
      "Computer",
      "Pass n Play",
    ])
      await expect(
        p.page.getByRole("button", { name: mode, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    await p.page
      .getByRole("button", { name: "Back to Ludo home", exact: true })
      .click();
    await expect(p.page.locator(".ld-video-hero")).toBeVisible();
    await p.page.setViewportSize({ width: 392, height: 850 });
    await p.open();
    await p.page
      .getByRole("button", { name: "Choose theme", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Next theme", exact: true })
      .click();
    await expect(p.page.locator(".sn-theme-picker")).toContainText("Nature");
    await p.page.screenshot({ path: "tmp/ludo-refined/snakes-nature.png" });
    await p.page.getByRole("button", { name: "Try now", exact: true }).click();
    await p.page
      .getByRole("button", { name: "Pass n Play", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "4 players", exact: true })
      .click();
    await p.page.getByLabel("Player 2 name", { exact: true }).fill("Meera");
    await p.page
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await expect(p.page.locator(".sn-token")).toHaveCount(4);
    await expect(p.page.locator(".sn-board")).toHaveAttribute(
      "data-theme",
      "nature",
    );
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(p.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-moving",
      "true",
    );
    await expect(p.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      "25",
    );
    await expect(p.page.getByRole("status")).toContainText("Ladder! 4 → 25");
    await p.page.screenshot({ path: "tmp/ludo-refined/snakes-match.png" });
    await p.page.reload();
    await p.open();
    await p.page.getByRole("button", { name: /Resume local game/ }).click();
    await expect(p.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      "25",
    );
    await expect(p.page.locator(".sn-players")).toContainText("Meera");
    await p.page.setViewportSize({ width: 844, height: 390 });
    await expect(
      p.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await p.page.screenshot({ path: "tmp/ludo-refined/snakes-landscape.png" });
    expect(
      (await (await p.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
    expect(errors).toEqual([]);
  } finally {
    await p.context.close();
  }
});
test("snake slide follows intermediate curve points; exact home wins and restart requires confirmation", async ({
  browser,
}) => {
  const p = await player(browser, "Snake tester");
  try {
    await p.page.evaluate(
      (id) =>
        localStorage.setItem(
          `ludo-snakes-v2:${id}`,
          JSON.stringify({
            id: "motion-check",
            state: {
              players: [
                { id: "a", name: "Snake tester", kind: "human", position: 25 },
                { id: "b", name: "Second", kind: "human", position: 0 },
              ],
              turn: 0,
              dice: null,
              winner: null,
              sequence: 0,
              last: null,
            },
          }),
        ),
      p.id,
    );
    await p.open();
    await p.page.getByRole("button", { name: /Resume local game/ }).click();
    await p.page.evaluate(() => {
      (window as any).__snakeRoll = 2;
      (window as any).__snakeTransforms = [];
      const token = document.querySelector('.sn-token[data-seat="0"]')!;
      new MutationObserver(() => {
        (window as any).__snakeTransforms.push(token.getAttribute("transform"));
      }).observe(token, { attributes: true, attributeFilter: ["transform"] });
    });
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(p.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      "5",
    );
    expect(
      await p.page.evaluate(
        () => new Set((window as any).__snakeTransforms).size,
      ),
    ).toBeGreaterThan(12);
    await p.page.getByRole("button", { name: "New game", exact: true }).click();
    await expect(p.page.getByRole("dialog")).toContainText("saved local board");
    await p.page
      .getByRole("button", { name: "Keep playing", exact: true })
      .click();
    await expect(p.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      "5",
    );
    await p.page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem(`ludo-snakes-v2:${id}`)!);
      saved.state.players[0].position = 96;
      saved.state.turn = 0;
      saved.state.last = null;
      localStorage.setItem(`ludo-snakes-v2:${id}`, JSON.stringify(saved));
    }, p.id);
    await p.page.reload();
    await p.open();
    await p.page.getByRole("button", { name: /Resume local game/ }).click();
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(p.page.getByRole("status")).toContainText(
      "Snake tester wins!",
    );
    await expect(
      p.page.getByRole("button", { name: "Play again", exact: true }),
    ).toBeVisible();
  } finally {
    await p.context.close();
  }
});
test("two real accounts join a free Friends Snake room, roll the same board and reconnect", async ({
  browser,
}) => {
  const a = await player(browser, "Snake host"),
    b = await player(browser, "Snake guest");
  try {
    await a.open();
    await a.page
      .getByRole("button", { name: "Play with Friends", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    const host = (
      await (await a.context.request.get("/api/ludo/snakes/state")).json()
    ).room;
    expect(host.code).toMatch(/^\d{8}$/);
    await a.page.screenshot({ path: "tmp/ludo-refined/snakes-private.png" });
    await b.open();
    await b.page
      .getByRole("button", { name: "Play with Friends", exact: true })
      .click();
    await b.page
      .getByLabel("Snakes room code", { exact: true })
      .fill(host.code);
    await b.page
      .getByRole("button", { name: "Join room", exact: true })
      .click();
    await expect(a.page.locator(".sn-board")).toBeVisible();
    await expect(b.page.locator(".sn-board")).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeDisabled();
    const beforeRoll = await (
      await a.context.request.get("/api/ludo/snakes/state")
    ).json();
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await a.context.request.get("/api/ludo/snakes/state")).json())
            .room.state.sequence,
      )
      .toBe(1);
    const after = (
      await (await a.context.request.get("/api/ludo/snakes/state")).json()
    ).room;
    await expect(b.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      String(after.state.players[0].position),
    );
    await expect(a.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      String(after.state.players[0].position),
    );
    // A stale polling reply cannot undo the action response on the host's board.
    let staleReplies = 0;
    await a.page.route("**/api/ludo/snakes/state", async (route) => {
      staleReplies++;
      await route.fulfill({ json: beforeRoll });
    });
    await expect.poll(() => staleReplies).toBeGreaterThanOrEqual(2);
    await expect(a.page.locator('.sn-token[data-seat="0"]')).toHaveAttribute(
      "data-position",
      String(after.state.players[0].position),
    );
    await a.page.unroute("**/api/ludo/snakes/state");
    await a.page.reload();
    await a.open();
    await expect(a.page.locator(".sn-board")).toBeVisible();
    expect(
      (await (await a.context.request.get("/api/ludo/snakes/state")).json())
        .room.id,
    ).toBe(host.id);
    expect(
      (await (await a.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
    expect(
      (await (await b.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
    await a.page.getByRole("button", { name: "Leave", exact: true }).click();
    await a.page
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    await expect(b.page.getByRole("status")).toContainText("Snake guest wins!");
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
test("Computer takes its turn and Disco theme persists without changing the game", async ({
  browser,
}) => {
  const p = await player(browser, "Computer tester");
  try {
    await p.open();
    await p.page.getByRole("button", { name: "Computer", exact: true }).click();
    await p.page
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(() =>
        p.page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem(`ludo-snakes-v2:${id}`)!).state
              .sequence,
          p.id,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await expect(
      p.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    await p.page.getByRole("button", { name: "Theme", exact: true }).click();
    await p.page
      .getByRole("button", { name: "Previous theme", exact: true })
      .click();
    await expect(p.page.locator(".sn-theme-picker")).toContainText("Disco");
    await p.page.screenshot({ path: "tmp/ludo-refined/snakes-disco.png" });
    await p.page.getByRole("button", { name: "Try now", exact: true }).click();
    await expect(p.page.locator(".sn-board")).toHaveAttribute(
      "data-theme",
      "disco",
    );
    await p.page.setViewportSize({ width: 320, height: 740 });
    await expect(
      p.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeInViewport({ ratio: 1 });
  } finally {
    await p.context.close();
  }
});
