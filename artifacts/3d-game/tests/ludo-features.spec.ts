import { test, expect, type Browser } from "@playwright/test";
async function player(browser: Browser, name: string) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5398",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const login = await context.request.post("/api/test/ludo/login", {
    data: { name },
  });
  expect(login.ok()).toBeTruthy();
  const { id } = await login.json();
  const page = await context.newPage();
  await page.goto("/ludo");
  // The full application is transformed on the first cold Vite request.
  await expect(page.locator(".ld-crafted-home")).toBeVisible({ timeout: 60000 });
  return { context, page, id };
}
test("original home artwork, reward claim and inventory work without a reference screenshot", async ({
  browser,
}) => {
  const p = await player(browser, "Graphic review");
  const errors: string[] = [];
  p.page.on("pageerror", (e) => errors.push(e.message));
  try {
    await expect(p.page.locator(".ld-crafted-home img")).toHaveCount(0);
    await expect(p.page.locator(".ld-crafted-tile")).toHaveCount(5);
    await p.page.screenshot({ path: "tmp/ludo-crafted/home-portrait.png" });
    await p.page
      .getByRole("button", { name: "Inventory", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "crown token style", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: "crown token style", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await p.page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Daily ₹100 reward", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Claim ₹100", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: "Claimed today" }),
    ).toBeDisabled();
    expect(
      (await (await p.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("110000");
    await p.page.screenshot({ path: "tmp/ludo-crafted/daily-claimed.png" });
    await p.page.reload();
    await p.page
      .getByRole("button", { name: "Daily ₹100 reward", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: "Claimed today" }),
    ).toBeDisabled();
    await p.page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await p.page.setViewportSize({ width: 844, height: 390 });
    await expect(
      p.page.getByRole("button", { name: "Pass n Play", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await p.page.screenshot({ path: "tmp/ludo-crafted/home-landscape.png" });
    await p.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(p.page.locator(".ld-art-heart").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    expect(errors).toEqual([]);
  } finally {
    await p.context.close();
  }
});
test("Pass n Play moves real tokens, hands off turns and resumes a saved local game", async ({
  browser,
}) => {
  const p = await player(browser, "Local one");
  try {
    await p.page
      .getByRole("button", { name: "Pass n Play", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Quick", exact: true }).click();
    await p.page.getByLabel("Player 2 name", { exact: true }).fill("Local two");
    await p.page
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Token 1", exact: true }).click();
    await expect
      .poll(() =>
        p.page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem(`ludo-pass-play-v1:${id}`)!).state
              .players[0].tokens[0],
          p.id,
        ),
      )
      .toBeGreaterThan(0);
    await expect(p.page.locator(".ld-board")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await p.page.screenshot({ path: "tmp/ludo-crafted/pass-play.png" });
    const saved = await p.page.evaluate(
      (id) => localStorage.getItem(`ludo-pass-play-v1:${id}`),
      p.id,
    );
    await p.page.reload();
    await p.page
      .getByRole("button", { name: "Pass n Play", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: /Pass to .*Ready/ }),
    ).toBeVisible();
    expect(
      await p.page.evaluate(
        (id) => localStorage.getItem(`ludo-pass-play-v1:${id}`),
        p.id,
      ),
    ).toBe(saved);
    expect(
      (await (await p.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
  } finally {
    await p.context.close();
  }
});
test("two friends accept, chat and join an invited room only after confirming its fee", async ({
  browser,
}) => {
  const a = await player(browser, "Invite host"),
    b = await player(browser, "Invite friend");
  try {
    await a.page.getByRole("button", { name: "Social", exact: true }).click();
    await b.page.getByRole("button", { name: "Social", exact: true }).click();
    const bp = await (await b.context.request.get("/api/ludo/social")).json();
    await a.page.getByLabel("Add by friend code").fill(bp.friendCode);
    await a.page
      .getByRole("button", { name: "Send friend request", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "Accept Invite host", exact: true })
      .click();
    await b.page.getByRole("button", { name: "Chat", exact: true }).click();
    await a.page.getByRole("button", { name: "Chat", exact: true }).click();
    await a.page.getByLabel("Message your friend").fill("Ready for our room?");
    await a.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(b.page.getByRole("log")).toContainText("Ready for our room?");
    await a.page
      .getByRole("button", { name: "Back to friends", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Play with Friends", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    await expect(a.page.locator(".ld-private-code")).toBeVisible();
    await a.page
      .getByRole("button", { name: "Invite friends", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Chat", exact: true }).click();
    await a.page.getByRole("button", { name: /Invite to room/ }).click();
    await b.page.getByRole("button", { name: /View room/ }).click();
    await expect(b.page.getByRole("dialog")).toContainText("₹10");
    expect(
      (await (await b.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
    await b.page
      .getByRole("button", { name: "Join for ₹10", exact: true })
      .click();
    await expect(b.page.locator(".ld-board")).toBeVisible();
    const host = await (await a.context.request.get("/api/ludo/state")).json(),
      guest = await (await b.context.request.get("/api/ludo/state")).json();
    expect(guest.match.id).toBe(host.match.id);
    expect(guest.balancePaise).toBe("99000");
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
test("Snakes and Ladders rolls and saves a free local board", async ({
  browser,
}) => {
  const p = await player(browser, "Ladder player");
  try {
    await p.page
      .getByRole("button", { name: "Snakes and Ladders", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Pass n Play", exact: true })
      .click();
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
            JSON.parse(localStorage.getItem(`ludo-snakes-v2:${id}`)!).state.players[0].position,
          p.id,
        ),
      )
      .toBeGreaterThan(0);
    await p.page.screenshot({ path: "tmp/ludo-crafted/snakes.png" });
    expect(
      (await (await p.context.request.get("/api/ludo/state")).json())
        .balancePaise,
    ).toBe("100000");
  } finally {
    await p.context.close();
  }
});
