import { test, expect, type Browser } from "@playwright/test";
import type { LudoTable } from "@workspace/api-zod/ludo";

async function player(browser: Browser, name: string) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5398",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  expect(
    (
      await context.request.post("/api/test/ludo/login", { data: { name } })
    ).ok(),
  ).toBeTruthy();
  const page = await context.newPage();
  await page.goto("/ludo");
  await expect(
    page.getByRole("button", { name: "Play with Friends", exact: true }),
  ).toBeVisible();
  return {
    page,
    context,
    state: async () =>
      (await (
        await context.request.get("/api/ludo/state")
      ).json()) as LudoTable,
  };
}

test("video menu: token styles and themes persist and Quick starts with a live outside token", async ({
  browser,
}) => {
  const p = await player(browser, "Aarav");
  const errors: string[] = [];
  p.page.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.page.screenshot({ path: "tmp/ludo-video-update/home.png" });
    await p.page
      .getByRole("button", { name: "Choose theme", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Next theme", exact: true })
      .click();
    await expect(
      p.page.getByRole("heading", { name: "Nature", exact: true }),
    ).toBeVisible();
    await p.page.screenshot({ path: "tmp/ludo-video-update/theme-picker.png" });
    await p.page.getByRole("button", { name: "SELECT", exact: true }).click();
    await expect(p.page.locator(".ld-app")).toHaveClass(/ld-theme-nature/);
    await p.page
      .getByRole("button", { name: "Play against Computer", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "gem token style", exact: true })
      .click();
    await p.page.reload();
    await expect(
      p.page.getByRole("button", { name: "gem token style", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(p.page.locator(".ld-app")).toHaveClass(/ld-theme-nature/);
    await p.page.getByRole("button", { name: "Quick", exact: true }).click();
    await p.page.screenshot({ path: "tmp/ludo-video-update/quick-setup.png" });
    await p.page
      .getByRole("button", { name: "Find a match", exact: true })
      .click();
    await expect(p.page.locator(".ld-board")).toBeVisible();
    const table = await p.state();
    expect(table.match!.state.variant).toBe("quick");
    expect(table.match!.state.players[0]!.tokens).toEqual([0, -1, -1, -1]);
    await expect(p.page.locator(".ld-board .ld-pin-gem")).toHaveCount(8);
    const response = await p.context.request.post("/api/test/ludo/roll-ready", {
      data: { id: table.match!.id, seat: 0, face: 1, tokens: [55, -1, -1, -1] },
    });
    expect(response.ok()).toBeTruthy();
    const { version } = await response.json();
    const synced = p.page.waitForResponse(
      async (r) =>
        r.url().endsWith("/api/ludo/state") &&
        r.ok() &&
        (await r.json()).match?.version >= version,
    );
    await p.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await synced;
    await expect(
      p.page.locator('[data-seat="0"][data-token="0"]'),
    ).toHaveAttribute("data-position", "55");
    await expect(
      p.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(p.page.getByRole("dialog")).toContainText(
      "You take the crown!",
    );
    expect((await p.state()).balancePaise).toBe("100800");
    expect(errors).toEqual([]);
  } finally {
    await p.context.close();
  }
});

test("Friends code join previews the real fee, starts both players and refunds an expired empty room", async ({
  browser,
}) => {
  const a = await player(browser, "Room host"),
    b = await player(browser, "Room friend");
  try {
    await a.page
      .getByRole("button", { name: "Play with Friends", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Higher entry fee" }).click();
    await a.page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    const codeField = a.page.getByLabel("ROOM CODE", { exact: true });
    await expect(codeField).toBeVisible();
    const code = await codeField.inputValue();
    await a.page.screenshot({ path: "tmp/ludo-video-update/private-room.png" });
    await b.page
      .getByRole("button", { name: "Play with Friends", exact: true })
      .click();
    await b.page.getByRole("tab", { name: "Join", exact: true }).click();
    await b.page.getByRole("textbox", { name: "Private room code" }).fill(code);
    await b.page
      .getByRole("button", { name: "CHECK ROOM", exact: true })
      .click();
    await expect(b.page.locator(".ld-room-preview")).toContainText("Entry ₹50");
    expect((await b.state()).balancePaise).toBe("100000");
    await b.page.screenshot({ path: "tmp/ludo-video-update/join-room.png" });
    await b.page
      .getByRole("button", { name: "JOIN ROOM", exact: true })
      .click();
    await expect(a.page.locator(".ld-board")).toBeVisible();
    await expect(b.page.locator(".ld-board")).toBeVisible();
    expect((await a.state()).match!.id).toBe((await b.state()).match!.id);
    expect((await b.state()).balancePaise).toBe("95000");
    await b.page.reload();
    await expect(b.page.locator(".ld-board")).toBeVisible();
    const c = await player(browser, "Expiring host");
    try {
      await c.page
        .getByRole("button", { name: "Play with Friends", exact: true })
        .click();
      await c.page
        .getByRole("button", { name: "Create room", exact: true })
        .click();
      await expect(
        c.page.getByLabel("ROOM CODE", { exact: true }),
      ).toBeVisible();
      await c.context.request.post("/api/test/ludo/advance", {
        data: { id: (await c.state()).match!.id },
      });
      await expect(
        c.page.getByRole("heading", { name: "Entry refunded", exact: true }),
      ).toBeVisible();
      expect((await c.state()).balancePaise).toBe("100000");
    } finally {
      await c.context.close();
    }
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("Team Up enforces four seats, shows partners and confirms whole-team forfeiture", async ({
  browser,
}) => {
  const p = await player(browser, "Team captain");
  try {
    await p.page.getByRole("button", { name: "Team Up", exact: true }).click();
    await expect(
      p.page.getByRole("button", { name: "Team Up", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      p.page.getByRole("button", {
        name: "2 players Head to head",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(p.page.locator(".ld-fee")).toContainText(
      "₹18 per winning partner",
    );
    await p.page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Play against Computer", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Team Up", exact: true }).click();
    await p.page
      .getByRole("button", { name: "Find a match", exact: true })
      .click();
    await expect(p.page.locator(".ld-player")).toHaveCount(4);
    await expect(p.page.locator(".ld-team-label")).toHaveText([
      "T2",
      "T1",
      "T1",
      "T2",
    ]);
    await p.page.screenshot({ path: "tmp/ludo-video-update/team-match.png" });
    await p.page
      .getByRole("button", { name: "Leave match", exact: true })
      .click();
    await expect(p.page.getByRole("dialog")).toContainText("whole team");
    await p.page
      .getByRole("button", { name: "Forfeit & leave", exact: true })
      .click();
    await expect
      .poll(async () => (await p.state()).match!.status)
      .toBe("finished");
    expect((await p.state()).balancePaise).toBe("99000");
  } finally {
    await p.context.close();
  }
});

test("private room code and cancellation stay reachable for two and four friends through rotation", async ({
  browser,
}) => {
  for (const capacity of [2, 4] as const) {
    const p = await player(browser, "Friends on mobile");
    try {
      await p.page
        .getByRole("button", { name: "Play with Friends", exact: true })
        .click();
      if (capacity === 4)
        await p.page
          .getByRole("button", {
            name: "4 players Classic battle",
            exact: true,
          })
          .click();
      await p.page
        .getByRole("button", { name: "Create room", exact: true })
        .click();
      await expect(
        p.page.getByLabel("ROOM CODE", { exact: true }),
      ).toBeVisible();
      const id = (await p.state()).match!.id;
      for (const viewport of [
        { width: 320, height: 640 },
        { width: 568, height: 270 },
        { width: 640, height: 230 },
        { width: 390, height: 844 },
      ]) {
        await p.page.setViewportSize(viewport);
        for (const name of ["Copy room code", "Cancel & refund entry"]) {
          const control = p.page.getByRole("button", { name, exact: true });
          await expect(control).toBeInViewport({ ratio: 1 });
          await control.click({ trial: true });
          const box = (await control.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await p.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect((await p.state()).match!.id).toBe(id);
      }
      await p.page.screenshot({
        path: `tmp/ludo-video-update/private-${capacity}-players.png`,
      });
      await p.page
        .getByRole("button", { name: "Cancel & refund entry", exact: true })
        .click();
      await expect(
        p.page.getByRole("heading", { name: "Entry refunded", exact: true }),
      ).toBeVisible();
    } finally {
      await p.context.close();
    }
  }
});
