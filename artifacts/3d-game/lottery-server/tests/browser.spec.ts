import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import type { Data, Draw, Game } from "../../lottery/src/types";
import { TITLI } from "../../lottery/src/api";
const screenshots = path.resolve(
  import.meta.dirname,
  "../../../../tmp/lottery-review",
);
const ids = {
  shop: "SHP-3001",
  admin: "ADM-1001",
  agent: "AGT-2001",
  user: "USR-4001",
};
async function login(page: Page, role: keyof typeof ids) {
  await page.goto(`/${role}`);
  await page
    .getByLabel(role === "user" ? "User ID" : "Account ID", { exact: true })
    .fill(ids[role]);
  await page.getByLabel("Password", { exact: true }).fill("Lottery@123");
  await page
    .getByRole("button", {
      name:
        role === "user"
          ? "Sign in to your account"
          : `Sign in to ${role} panel`,
    })
    .click();
  await expect(
    page.locator(role === "user" ? ".player-shell" : ".sidebar"),
  ).toBeAttached();
}
for (const role of ["user", "shop"] as const) {
  test(`${role} desktop keeps tickets, numbers and checkout inside the screen`, async ({
    page,
  }) => {
    await login(page, role);
    await page.getByRole("button", { name: "Number 07", exact: true }).click();
    const action = page.locator(
      role === "user" ? ".player-buy" : ".sale-button",
    );
    for (const [width, height] of [
      [1280, 720],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [1366, 650],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector("main")!.scrollTop = 0;
      });
      expect(
        await page.evaluate(() => ({
          horizontal: document.documentElement.scrollWidth > innerWidth + 1,
          vertical: document.documentElement.scrollHeight > innerHeight + 1,
          main:
            document.querySelector("main")!.scrollHeight >
            document.querySelector("main")!.clientHeight + 1,
        })),
      ).toEqual({ horizontal: false, vertical: false, main: false });
      const cards = page.locator(".nice-paper-ticket");
      for (const index of [0, 4, 5, 9]) {
        await expect(
          cards.nth(index).locator(".nice-ticket-price"),
        ).toBeInViewport({ ratio: 1 });
      }
      await expect(
        page.getByRole("button", {
          name: role === "user" ? "Number 24" : "Number 99",
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
      await expect(action).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    if (role === "user") {
      await page.getByRole("checkbox", { name: "Ek se zyada tickets" }).check();
      for (let i = 11; i <= 19; i++)
        await page
          .getByRole("button", { name: `Irland Lotto ${i}`, exact: true })
          .click();
    } else {
      await page
        .getByRole("checkbox", { name: "All series", exact: true })
        .check();
    }
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(
      page.locator(role === "user" ? ".player-total" : ".slip-total"),
    ).toContainText("₹33,300");
    await expect(action).toBeDisabled();
    if (role === "user") {
      await page.locator(".easy-options summary").click();
      await page
        .locator(".game-tabs")
        .getByRole("button", { name: "3D", exact: true })
        .click();
      await page.locator(".easy-options summary").click();
      await page
        .getByRole("combobox", { name: "Hundreds group" })
        .selectOption("9");
      await expect(
        page.getByRole("button", { name: "Number 900", exact: true }),
      ).toBeInViewport({ ratio: 1 });
    } else {
      await page
        .locator(".game-tabs")
        .getByRole("button", { name: /3D/ })
        .click();
      await page
        .getByRole("button", { name: "Number 099", exact: true })
        .click();
    }
    await expect(action).toBeInViewport({ ratio: 1 });
  });
}

test("user home shows published results for every series without changing the bet", async ({
  page,
}) => {
  await login(page, "user");
  const data: Data = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "user" },
    })
  ).json();
  const latest = data.draws
    .filter((draw) => draw.status === "settled" && draw.results)
    .sort((a, b) => b.ends - a.ends)[0];
  expect(latest).toBeTruthy();
  const results = page.getByRole("region", { name: "Latest draw result" });
  await expect(results).toBeVisible();
  await expect(results.locator("time")).toHaveAttribute(
    "datetime",
    new Date(latest.ends).toISOString(),
  );
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  const cells = results.locator("[data-series]");
  await expect(cells).toHaveCount(10);
  for (const game of ["2D", "3D", "Titli"] as Game[]) {
    await results.getByRole("button", { name: game, exact: true }).click();
    await expect(cells.locator("dd")).toHaveText(
      Array.from({ length: 10 }, (_, i) => {
        const number = latest.results![`JP${10 + i}`][game];
        return game === "Titli" ? TITLI[Number(number)] : number;
      }),
    );
    await expect(
      page.getByRole("button", { name: "Number 07", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".player-total")).toContainText("₹100");
  }
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await cells.evaluateAll((elements) =>
        elements.every(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ),
    ).toBe(true);
  }
  const colors = await cells.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  expect(new Set(colors).size).toBe(10);
  await results.getByRole("button", { name: "2D", exact: true }).click();
  await page.screenshot({
    path: path.join(screenshots, "15-user-home-results-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, "16-user-home-results-mobile.png"),
    fullPage: true,
  });
  await results.getByRole("button", { name: "Sabhi results" }).click();
  await expect(page).toHaveURL(/\/user\/results$/);
  await expect(page.locator(".winning-grid article")).toHaveCount(10);
});

test("user home waits for results then automatically shows the newest settled draw", async ({
  page,
}) => {
  await login(page, "user");
  const data: Data = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "user" },
    })
  ).json();
  const open = data.draws.filter((draw) => draw.status === "open");
  let published: Draw[] = [];
  // Only the browser response is mocked; no draw or balance is modified.
  await page.route("**/api/lottery/bootstrap", (route) =>
    route.fulfill({
      json: { ...data, serverTime: Date.now(), draws: [...published, ...open] },
    }),
  );
  await page.reload();
  const results = page.getByRole("region", { name: "Latest draw result" });
  await expect(results).toContainText(
    "Pehla draw hone ke baad result yahan dikhega.",
  );
  await expect(results.locator("[data-series]")).toHaveCount(0);
  const newest: Draw = {
    ...open[0],
    id: "home-result-newest",
    status: "settled",
    ends: Date.now() - 60000,
    results: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `JP${10 + i}`,
        { "2D": `0${i}`, "3D": `00${i}`, Titli: String(i) },
      ]),
    ),
  };
  // Put newest first, followed by an older draw, an unpublished settled draw
  // and future open draws to ensure array position cannot choose the result.
  published = [
    newest,
    {
      ...newest,
      id: "home-result-older",
      ends: newest.ends - 900000,
      results: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `JP${10 + i}`,
          { "2D": "99", "3D": "999", Titli: "9" },
        ]),
      ),
    },
    {
      ...newest,
      id: "home-result-unpublished",
      ends: newest.ends + 1000,
      results: null,
    },
  ];
  await expect(results.locator("time")).toHaveAttribute(
    "datetime",
    new Date(newest.ends).toISOString(),
  );
  await expect(results.locator("dd")).toHaveText([
    "00",
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
  ]);
  await results.getByRole("button", { name: "3D", exact: true }).click();
  await expect(results.locator("dd").first()).toHaveText("000");
  await results.getByRole("button", { name: "Titli", exact: true }).click();
  await expect(results.locator("dd")).toHaveText(TITLI);
});

test("shop sale, receipt-only printing, duplicate copy and cancellation refund", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/shop");
  await expect(
    page.getByRole("heading", { name: "Your counter. Connected." }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "01-login-desktop.png"),
    fullPage: true,
  });
  await login(page, "shop");
  await expect(
    page.getByRole("heading", { name: "Ticket terminal", exact: true }),
  ).toBeVisible();
  // Keep receipt/PDF checks clear of the next draw's cancellation cutoff.
  await page
    .getByRole("combobox", { name: "Draw time", exact: true })
    .selectOption({ index: 1 });
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await page.getByRole("button", { name: "Number 24", exact: true }).click();
  await page
    .locator(".nice-ticket-picker")
    .getByRole("button", { name: "Irland Lotto 11", exact: true })
    .click();
  await expect(page.locator(".slip-total")).toContainText("₹600");
  await page.getByRole("checkbox", { name: "All series", exact: true }).check();
  await expect(
    page.locator(".nice-paper-ticket[aria-pressed='true']"),
  ).toHaveCount(10);
  await expect(page.locator(".slip-total")).toContainText("₹66,600");
  await expect(
    page.getByRole("button", { name: "Issue ticket" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "All series", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "Issue ticket" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Number 07", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Irland Lotto 10", exact: true }).click();
  await page.getByRole("button", { name: "Irland Lotto 11", exact: true }).click();
  await expect(page.locator(".slip-total")).toContainText("₹600");
  await page.screenshot({
    path: path.join(screenshots, "02-shop-terminal-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Issue ticket" }).click();
  await page.getByRole("button", { name: "Confirm & issue" }).click();
  await expect(
    page.getByRole("heading", { name: "Ticket issued", exact: true }),
  ).toBeVisible();
  const id = await page.locator(".success-panel code").innerText();
  await page.evaluate(() => {
    (window as any).__prints = 0;
    window.print = () => {
      (window as any).__prints++;
    };
  });
  await page
    .getByRole("button", { name: "Print receipt", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__prints))
    .toBe(1);
  await expect(page.locator("#print-receipt")).toContainText(id);
  await expect(page.locator("#print-receipt")).toContainText("Irland Lotto 10");
  await expect(page.locator("#print-receipt")).not.toContainText("JP10");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-receipt")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.pdf({
    path: path.join(screenshots, "shop-receipt.pdf"),
    width: "80mm",
    height: "220mm",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Print receipt", exact: true })
    .click();
  await expect(page.locator("#print-receipt")).toContainText("DUPLICATE COPY");
  await page.getByRole("button", { name: "View ticket", exact: true }).click();
  await page.getByRole("button", { name: id, exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel ticket", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.locator(".ticket-detail-head .badge")).toHaveText(
    "Cancelled",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.locator(".data-table")).toContainText("Cancelled");
  expect(errors).toEqual([]);
});
test("admin creates an agent, funds it and sees scoped reports without print controls", async ({
  page,
}) => {
  await login(page, "admin");
  await page.screenshot({
    path: path.join(screenshots, "03-admin-overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".series-price-settings input")).toHaveCount(10);
  await expect(
    page.getByLabel("Irland Lotto 10 price (₹)", { exact: true }),
  ).toHaveValue("100");
  await expect(
    page.getByLabel("Irland Lotto 19 price (₹)", { exact: true }),
  ).toHaveValue("10000");
  await page.getByLabel("Irland Lotto 19 price (₹)", { exact: true }).fill("9500");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel("Irland Lotto 19 price (₹)", { exact: true }),
  ).toHaveValue("9500");
  await page.getByLabel("Irland Lotto 19 price (₹)", { exact: true }).fill("10000");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Network & accounts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Browser Test Agent");
  await page.getByLabel("Initial password").fill("Agent-Test-12345");
  await page.waitForTimeout(1200); // Let the live clock rerender without stealing keyboard focus.
  await expect(page.getByLabel("Initial password")).toBeFocused();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account created" }),
  ).toBeVisible();
  const id = await page.locator(".success-panel code").innerText();
  expect(id).toMatch(/^AGT-/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Wallet & ledger", exact: true })
    .click();
  await page.getByRole("button", { name: "Allocate balance" }).click();
  await page.getByLabel("Destination account").selectOption(id);
  await page.getByLabel("Amount (₹)").fill("2500");
  await page
    .getByLabel("Transfer reference")
    .fill("Browser verified opening allocation");
  await page.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".data-table")).toContainText("Browser Test Agent");
  await page
    .getByRole("button", { name: "Sales reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sales & settlement reports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /print|reprint/i }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  expect((await download).suggestedFilename()).toMatch(/lottery-report.*csv/);
});
test("agent creates a shop and can fund only their network", async ({
  page,
}) => {
  await login(page, "agent");
  await page.getByRole("button", { name: "My shops", exact: true }).click();
  await page.screenshot({
    path: path.join(screenshots, "04-agent-shops.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Riverside Test Counter");
  await page.getByLabel("Initial password").fill("Counter-Test-12345");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const id = await page.locator(".success-panel code").innerText();
  expect(id).toMatch(/^SHP-/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Wallet & ledger", exact: true })
    .click();
  await page.getByRole("button", { name: "Fund a shop" }).click();
  await page.getByLabel("Destination account").selectOption(id);
  await page.getByLabel("Amount (₹)").fill("300");
  await page.getByLabel("Transfer reference").fill("Counter opening credits");
  await page.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".data-table")).toContainText(
    "Riverside Test Counter",
  );
  await expect(
    page.getByRole("button", { name: /print|reprint/i }),
  ).toHaveCount(0);
});
test("user buys a digital 3D ticket and cannot access the receipt endpoint", async ({
  page,
}) => {
  await login(page, "user");
  await page.locator(".easy-options summary").click();
  await page.locator(".game-tabs").getByRole("button", { name: /3D/ }).click();
  await page.getByRole("button", { name: "Number 007", exact: true }).click();
  await page.locator(".easy-options summary").click();
  await page.getByRole("button", { name: /^Bet lagayein ·/ }).click();
  await page.getByRole("button", { name: /^Confirm bet/ }).click();
  const id = await page.locator(".success-panel code").innerText();
  await expect(
    page.getByRole("button", { name: /print|reprint/i }),
  ).toHaveCount(0);
  const result = await page.request.post(`/api/lottery/tickets/${id}/receipt`, {
    headers: { "X-Lottery-Role": "user", "X-Lottery-Request": "1" },
    data: {},
  });
  expect(result.status()).toBe(403);
  await page.getByRole("button", { name: "Nayi bet" }).click();
  await page.locator(".easy-options summary").click();
  await page
    .locator(".game-tabs")
    .getByRole("button", { name: /Titli/ })
    .click();
  await page.getByRole("button", { name: /Butterfly/ }).click();
  await page.screenshot({
    path: path.join(screenshots, "05-user-titli.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Draw results", exact: true }).click();
  await page.getByRole("button", { name: "Verify draw", exact: true }).click();
  await page.getByRole("button", { name: "Verify commitment" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Verified: this seed matches",
  );
});
test("mobile shop layout and actual mobile navigation have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "shop");
  await page.getByRole("button", { name: "Number 09", exact: true }).click();
  await page.getByRole("button", { name: "Irland Lotto 19", exact: true }).click();
  await expect(page.locator(".slip-total")).toContainText("₹10,100");
  await page
    .getByRole("button", { name: "Irland Lotto 10", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(screenshots, "06-shop-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Tickets & claims", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tickets & claims" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  for (const width of [360, 768, 1024, 1916]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/shop/terminal");
    await expect(
      page.getByRole("heading", { name: "Ticket terminal", exact: true }),
    ).toBeVisible();
    const cards = page.locator(".nice-paper-ticket");
    await expect(cards).toHaveCount(10);
    const rows = await cards.evaluateAll((elements) => {
      const counts = new Map<number, number>();
      for (const element of elements) {
        const top = Math.round(element.getBoundingClientRect().top);
        counts.set(top, (counts.get(top) ?? 0) + 1);
      }
      return [...counts.values()];
    });
    expect(rows).toEqual([5, 5]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("player number pages preserve picks, series and quantities in the purchase", async ({
  page,
}) => {
  await login(page, "user");
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".player-number-grid button")).toHaveCount(25);
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await page.getByRole("button", { name: "75 – 99", exact: true }).click();
  await page.getByRole("button", { name: "Number 99", exact: true }).click();
  await page.getByRole("button", { name: "00 – 24", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Number 07", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Remove 99", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Ek se zyada tickets" }).check();
  await page.getByRole("button", { name: "Irland Lotto 11", exact: true }).click();
  await page
    .getByRole("button", { name: "5 units per number", exact: true })
    .click();
  await expect(page.locator(".player-total")).toContainText("₹3,000");
  await page.screenshot({
    path: path.join(screenshots, "07-user-easy-rupees-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: /^Bet lagayein ·/, exact: true })
    .click();
  const saleResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lottery/tickets") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Confirm bet/, exact: true }).click();
  const ticket = await (await saleResponse).json();
  expect(ticket.total).toBe(3000);
  expect(
    ticket.lines
      .map((line: { unitPrice: number }) => line.unitPrice)
      .sort((a: number, b: number) => a - b),
  ).toEqual([100, 100, 200, 200]);
  expect(ticket.lines).toHaveLength(4);
  expect(
    ticket.lines
      .map(
        (line: { series: string; number: string; quantity: number }) =>
          `${line.series}:${line.number}:${line.quantity}`,
      )
      .sort(),
  ).toEqual(["JP10:07:5", "JP10:99:5", "JP11:07:5", "JP11:99:5"]);
  await expect(page.locator(".success-panel code")).toHaveText(ticket.id);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "My tickets", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My tickets", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".data-table")).toContainText(ticket.id);
  await page.getByRole("button", { name: ticket.id, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Irland Lotto 10");
  await expect(page.getByRole("dialog")).toContainText("Irland Lotto 11");
  await expect(page.getByRole("dialog")).not.toContainText("JP10");
});

test("player mobile navigation, range selection and wallet remain usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/user");
  await expect(page.locator(".player-login")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "09-user-login-mobile.png"),
    fullPage: true,
  });
  await login(page, "user");
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await page
    .getByRole("button", { name: "10 units per number", exact: true })
    .click();
  await expect(page.locator(".player-total")).toContainText("₹1,000");
  await page.screenshot({
    path: path.join(screenshots, "08-user-easy-rupees-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const navigation = page.getByRole("navigation", {
    name: "Mobile player navigation",
  });
  await navigation
    .getByRole("button", { name: "My tickets", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My tickets", exact: true }),
  ).toBeVisible();
  await navigation.getByRole("button", { name: "Wallet", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Wallet & ledger", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await navigation
    .getByRole("button", { name: "Play lottery", exact: true })
    .click();
  for (const width of [360, 600, 768, 1024, 1440, 1916]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(page.locator(".player-numbers-panel")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("paper Irland Lotto  tickets stay in two rows and select the intended series", async ({
  page,
}) => {
  await login(page, "user");
  const cards = page.locator(".nice-paper-ticket");
  const selected = page.locator('.nice-paper-ticket[aria-pressed="true"]');
  const rows = () =>
    cards.evaluateAll((nodes) => {
      const tops = nodes.map((n) => Math.round(n.getBoundingClientRect().top));
      return [...new Set(tops)].map(
        (top) => tops.filter((y) => y === top).length,
      );
    });
  await expect(cards).toHaveCount(10);
  expect(await rows()).toEqual([5, 5]);
  await expect(
    page.getByRole("button", { name: "Irland Lotto 10", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await page
    .getByRole("button", { name: "5 units per number", exact: true })
    .click();
  await page.getByRole("button", { name: "Irland Lotto 19", exact: true }).click();
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-label", "Irland Lotto 19");
  await expect(page.locator(".player-total")).toContainText("₹50,000");
  await expect(page.locator(".player-buy")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Number 07", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("checkbox", { name: "Ek se zyada tickets" }).check();
  await page.getByRole("button", { name: "Irland Lotto 10", exact: true }).click();
  await expect(selected).toHaveCount(2);
  await expect(page.locator(".player-total")).toContainText("₹50,500");
  await page.screenshot({
    path: path.join(screenshots, "12-nice-paper-tickets-desktop.png"),
    fullPage: true,
  });
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await rows()).toEqual([5, 5]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const rail = page.getByRole("region", {
    name: "Irland Lotto tickets",
    exact: true,
  });
  expect(
    await rail.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await rail.evaluate((node) => (node.scrollLeft = node.scrollWidth));
  await page.getByRole("button", { name: "Irland Lotto 19", exact: true }).click();
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-label", "Irland Lotto 10");
  await page.getByRole("button", { name: "Irland Lotto 19", exact: true }).click();
  await page.getByRole("checkbox", { name: "Ek se zyada tickets" }).uncheck();
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-label", "Irland Lotto 10");
  await rail.evaluate((node) => (node.scrollLeft = 0));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, "13-nice-paper-tickets-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Mobile bet lagayein", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Irland Lotto 10");
  await expect(page.getByRole("dialog")).toContainText("₹500");
  await expect(page.getByRole("dialog")).not.toContainText("JP10");
});

test("player All Even Odd selection uses the whole number group and correct rupee totals", async ({
  page,
}) => {
  const adminHeaders = { "X-Lottery-Role": "admin", "X-Lottery-Request": "1" };
  expect(
    (
      await page.request.post("/api/lottery/login", {
        headers: adminHeaders,
        data: { role: "admin", id: ids.admin, password: "Lottery@123" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/lottery/transfers", {
        headers: { ...adminHeaders, "Idempotency-Key": "parity-price-fixture" },
        data: {
          targetId: ids.user,
          amount: 10000,
          note: "Browser parity pricing fixture",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "user");
  await page.locator(".easy-options summary").click();
  await page
    .getByRole("combobox", { name: "Draw time", exact: true })
    .selectOption({ index: 1 });
  await page.locator(".easy-options summary").click();
  const controls = page.getByRole("group", {
    name: "Select All, Even or Odd numbers",
  });
  const picked = page.locator(".player-picked-numbers button");
  await expect(controls).toBeVisible();
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await controls.getByRole("button", { name: "Even", exact: true }).click();
  await expect(picked).toHaveCount(50);
  await expect(
    page.getByRole("button", { name: "Remove 07", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".player-total")).toContainText("₹5,000");
  await controls.getByRole("button", { name: "Even", exact: true }).click();
  await expect(picked).toHaveCount(50);
  await page.getByRole("button", { name: "75 – 99", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Number 98", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Number 99", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await controls.getByRole("button", { name: "Odd", exact: true }).click();
  await expect(picked).toHaveCount(50);
  await expect(
    page.getByRole("button", { name: "Number 99", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Number 98", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await controls.getByRole("button", { name: "All", exact: true }).click();
  await expect(picked).toHaveCount(100);
  await expect(page.locator(".player-total")).toContainText("₹10,000");
  await controls.getByRole("button", { name: "Even", exact: true }).click();
  await page.getByRole("button", { name: "00 – 24", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(screenshots, "10-user-even-odd-mobile.png"),
    fullPage: true,
  });
  const saleResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lottery/tickets") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Mobile bet lagayein", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm bet · ₹5,000", exact: true })
    .click();
  const ticket = await (await saleResponse).json();
  expect(ticket.total).toBe(5000);
  expect(
    ticket.lines.map((line: { number: string }) => line.number).sort(),
  ).toEqual(
    Array.from({ length: 50 }, (_, i) => String(i * 2).padStart(2, "0")),
  );
  await page.getByRole("button", { name: "Nayi bet", exact: true }).click();
  await page.locator(".easy-options summary").click();
  await page
    .locator(".game-tabs")
    .getByRole("button", { name: "3D", exact: true })
    .click();
  await page.locator(".easy-options summary").click();
  await page.getByLabel("Number likhein", { exact: true }).fill("7");
  await page.getByLabel("Number likhein", { exact: true }).press("Enter");
  await page
    .getByRole("combobox", { name: "Hundreds group", exact: true })
    .selectOption("3");
  await controls.getByRole("button", { name: "Even", exact: true }).click();
  await expect(picked).toHaveCount(51);
  await expect(
    page.getByRole("button", { name: "Remove 007", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Number 300", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await controls.getByRole("button", { name: "Odd", exact: true }).click();
  await expect(picked).toHaveCount(51);
  await expect(
    page.getByRole("button", { name: "Remove 007", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Number 300", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Number 301", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(screenshots, "11-user-even-odd-desktop.png"),
    fullPage: true,
  });
  await page.locator(".easy-options summary").click();
  await page
    .locator(".game-tabs")
    .getByRole("button", { name: "Titli", exact: true })
    .click();
  await expect(controls).toHaveCount(0);
});

test("fixed-price direct number entry keeps leading zeroes and mobile confirmation debits once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "user");
  const entry = page.getByLabel("Number likhein", { exact: true });
  await entry.fill("xyz");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("00 se 99");
  await entry.fill("7");
  await entry.press("Enter");
  await entry.fill("07");
  await entry.press("Enter");
  await expect(page.locator(".player-picked-numbers button")).toHaveCount(1);
  await expect(page.locator(".player-picked-numbers")).toContainText("07");
  await expect(page.locator(".player-total")).toContainText("₹100");
  const before = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "user" },
    })
  ).json();
  await page
    .getByRole("button", { name: "Mobile bet lagayein", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Wallet se ₹100 katega");
  const purchase = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lottery/tickets") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirm bet · ₹100", exact: true })
    .click();
  const ticket = await (await purchase).json();
  expect(ticket.total).toBe(100);
  expect(ticket.lines).toEqual([
    { series: "JP10", number: "07", quantity: 1, unitPrice: 100 },
  ]);
  const after = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "user" },
    })
  ).json();
  expect(after.account.balance).toBe(before.account.balance - 100);
  expect(
    after.ledger.filter(
      (l: { reference: string; kind: string }) =>
        l.reference === ticket.id && l.kind === "ticket_sale",
    ),
  ).toHaveLength(1);
  await expect(page.locator(".success-panel code")).toHaveText(ticket.id);
});

test("shop sells a Irland Lotto 19 ticket at 10000 and prints its fixed rate", async ({
  page,
}) => {
  await login(page, "shop");
  await page
    .getByRole("combobox", { name: "Draw time", exact: true })
    .selectOption({ index: 1 });
  const before = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "shop" },
    })
  ).json();
  const prices = [
    "₹100",
    "₹200",
    "₹500",
    "₹1,000",
    "₹2,000",
    "₹3,000",
    "₹4,000",
    "₹5,000",
    "₹7,500",
    "₹10,000",
  ];
  for (let i = 0; i < prices.length; i++) {
    await expect(
      page
        .getByRole("button", { name: `Irland Lotto ${10 + i}`, exact: true })
        .locator(".nice-ticket-price"),
    ).toContainText(prices[i]);
  }
  await page.getByRole("button", { name: "Irland Lotto 10", exact: true }).click();
  await page.getByRole("button", { name: "Irland Lotto 19", exact: true }).click();
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await expect(page.locator(".slip-total")).toContainText("₹10,000");
  await page.getByRole("button", { name: "Issue ticket" }).click();
  const sold = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lottery/tickets") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirm & issue", exact: true })
    .click();
  const ticket = await (await sold).json();
  expect(ticket.total).toBe(10000);
  expect(ticket.lines).toEqual([
    { series: "JP19", number: "07", quantity: 1, unitPrice: 10000 },
  ]);
  const after = await (
    await page.request.get("/api/lottery/bootstrap", {
      headers: { "X-Lottery-Role": "shop" },
    })
  ).json();
  expect(after.account.balance).toBe(before.account.balance - 10000);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print receipt", exact: true })
    .click();
  await expect(page.locator("#print-receipt tbody tr")).toContainText("Irland Lotto 19");
  await expect(
    page.locator("#print-receipt .receipt-amount").first(),
  ).toHaveText("₹10,000");
});
