import { test, expect, type Page } from "@playwright/test";

const panelBase = process.env.OPERATOR_TEST_BASE_URL ?? "http://127.0.0.1:5318";
async function masterPanel(
  page: Page,
  masterId = "north",
  name = "North Branch",
) {
  const writes: { path: string; body: Record<string, unknown> }[] = [],
    errors: string[] = [];
  const website = {
    masterId,
    name,
    domain: "b2b.lunarx.live",
    url: `https://b2b.lunarx.live/branch/${masterId}/`,
    loginUrl: `https://b2b.lunarx.live/branch/${masterId}/login`,
  };
  const own = {
    id: masterId,
    user_id: "owner",
    kind: "master",
    parent_id: null,
    parent_name: null,
    name,
    email: "master@example.test",
    status: "active",
    company_fee_bps: 1000,
    share_bps: 10000,
    players: 2,
    earned: "25000",
    settled: "10000",
    float_balance: "100000",
    website_url: website.url,
  };
  let agents = [
    {
      ...own,
      id: "agent-1",
      user_id: "agent-user",
      kind: "agent",
      parent_id: masterId,
      parent_name: name,
      name: "North Agent",
      email: "agent@example.test",
      share_bps: 5000,
      players: 2,
      float_balance: "25000",
    },
  ];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedLink = text;
        },
      },
    }),
  );
  await page.route("**/api/**", (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "owner",
          role: "agent",
          email: own.email,
          status: "active",
        },
      });
    if (req.method() !== "GET") {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path === "/api/network/nodes")
        agents.push({
          ...agents[0]!,
          id: "agent-2",
          user_id: "agent-2-user",
          name: body.name,
          email: body.email,
          share_bps: body.shareBps,
          players: 0,
          float_balance: "0",
        });
      if (path === "/api/network/transfers") {
        own.float_balance = String(
          BigInt(own.float_balance) - BigInt(body.amountPaise),
        );
        agents[0]!.float_balance = String(
          BigInt(agents[0]!.float_balance) + BigInt(body.amountPaise),
        );
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/network/context")
      return route.fulfill({
        json: {
          role: "master",
          node: {
            id: masterId,
            userId: "owner",
            name,
            companyFeeBps: 1000,
            shareBps: 10000,
          },
          website,
        },
      });
    if (path === "/api/network/nodes")
      return route.fulfill({ json: { nodes: [own, ...agents] } });
    if (path === "/api/network/players")
      return route.fulfill({
        json: {
          players: [
            {
              id: "player-1",
              email: "player@example.test",
              display_name: "North Player",
              status: "active",
              channel: "b2b",
              balance: "5000",
              net: "1000",
              agent: "North Agent",
              master: name,
              agent_id: "agent-1",
            },
          ],
          total: 1,
        },
      });
    if (path === "/api/network/ledger")
      return route.fulfill({ json: { entries: [], total: 0, summary: [] } });
    if (path === "/api/network/settlements")
      return route.fulfill({ json: { settlements: [] } });
    if (path === "/api/network/wallet-ledger")
      return route.fulfill({ json: { entries: [] } });
    return route.fulfill({ json: [] });
  });
  return { website, writes, errors };
}

for (const width of [390, 1440]) {
  test(`master playing links, reports and navigation work at ${width}px`, async ({
    page,
  }) => {
    const state = await masterPanel(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${panelBase}/master/`);
    await expect(
      page.getByRole("heading", { name: "Master panel", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("b2b.lunarx.live · North Branch", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Website links", exact: true })
      .click();
    await expect(page).toHaveURL(/\/master\/website$/);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Customer Playing Website" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open player website", exact: true }),
    ).toHaveAttribute("href", state.website.url);
    await page
      .getByRole("button", { name: "Copy player website", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Player website copied.");
    expect(await page.evaluate(() => (window as any).__copiedLink)).toBe(
      state.website.url,
    );
    for (const [label, path] of [
      ["Ledger", "ledger"],
      ["Settlements", "settlements"],
      ["Wallet ledger", "transactions"],
      ["Downline", "downline"],
    ]) {
      await page
        .getByRole("navigation", { name: "Network sections" })
        .getByRole("button", { name: label, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/master/${path}$`));
      await page.reload();
      await expect(
        page
          .getByRole("navigation", { name: "Network sections" })
          .getByRole("button", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    if (width < 768) {
      await page.getByTestId("button-open-menu").click();
      await page
        .getByRole("link", { name: "Website links", exact: true })
        .click();
      await expect(page.getByTestId("button-close-menu")).toBeHidden();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
    expect(state.writes).toEqual([]);
  });
}

test("each master receives its own playing link", async ({ page }) => {
  const state = await masterPanel(page, "south", "South Branch");
  await page.goto(`${panelBase}/master/website`);
  await expect(
    page.getByRole("link", { name: "Open player website", exact: true }),
  ).toHaveAttribute("href", state.website.url);
  await expect(page.getByText("South Branch", { exact: true })).toBeVisible();
  await expect(page.getByText("North Branch", { exact: true })).toHaveCount(0);
});

test("master can create an agent and fund only its downline", async ({
  page,
}) => {
  const state = await masterPanel(page);
  await page.goto(`${panelBase}/master/agents`);
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByLabel(/Name/).fill("Second Agent");
  await page.getByLabel(/email/i).fill("second@example.test");
  await page.getByLabel(/Password/).fill("Local-Test-Password");
  await page.getByLabel(/share.*%/i).fill("40");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({
    path: "/api/network/nodes",
    body: {
      name: "Second Agent",
      email: "second@example.test",
      shareBps: 4000,
    },
  });
  const row = page.locator("tr").filter({ hasText: "agent@example.test" });
  await row.getByRole("button", { name: "Funds", exact: true }).click();
  await page.getByLabel(/Amount/).fill("100");
  await page.getByLabel(/memo|reference/i).fill("Local test transfer");
  await page
    .getByRole("button", { name: /transfer|save/i })
    .last()
    .click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toMatchObject({
    path: "/api/network/transfers",
    body: { targetId: "agent-user", amountPaise: "10000", direction: "credit" },
  });
  await expect(
    page.getByRole("region", { name: "Available wallet balance" }),
  ).toContainText("900.00");
  expect(state.errors).toEqual([]);
});
