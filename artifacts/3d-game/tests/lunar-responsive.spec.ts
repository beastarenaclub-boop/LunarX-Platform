import { test as base, expect, type Page } from "@playwright/test";

// /play is gated by `useAuth`; unauthenticated users get redirected to login.
// Bootstrap a fresh authenticated session per test by registering a unique
// throwaway account via POST /api/auth/signup on the same origin so the session
// cookie is stored on the browser context (demo mode has been removed).
//
// The signup route is behind authRateLimiter, so forward x-test-bypass when
// TEST_RATE_LIMIT_BYPASS is set to keep the 11-viewport matrix from tripping it.
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const unique = `${testInfo.testId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const headers: Record<string, string> = {};
    if (process.env.TEST_RATE_LIMIT_BYPASS) {
      headers["x-test-bypass"] = process.env.TEST_RATE_LIMIT_BYPASS;
    }
    const res = await page.request.post("/api/auth/signup", {
      headers,
      data: {
        email: `playwright-${unique}@example.com`,
        password: "playwright-test-pw",
        displayName: "Playwright",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Failed to bootstrap auth: ${res.status()} ${await res.text()}`,
      );
    }
    await use(page);
  },
});

type Viewport = { name: string; width: number; height: number };

const VIEWPORTS: Viewport[] = [
  { name: "320x720 (smallest phone)", width: 320, height: 720 },
  { name: "360x740 (common phone)", width: 360, height: 740 },
  { name: "400x800 (large phone)", width: 400, height: 800 },
  { name: "500x800 (phablet/dual-bet breakpoint)", width: 500, height: 800 },
  { name: "768x1024 (tablet portrait)", width: 768, height: 1024 },
  { name: "1024x768 (desktop breakpoint)", width: 1024, height: 768 },
  { name: "1280x720 (laptop)", width: 1280, height: 720 },
  { name: "1440x900 (desktop)", width: 1440, height: 900 },
  { name: "1920x1080 (large desktop)", width: 1920, height: 1080 },
  { name: "1366x600 (short-height laptop)", width: 1366, height: 600 },
  { name: "740x360 (landscape phone)", width: 740, height: 360 },
];

const STORAGE_KEY = "aviator:v1";

async function seedOnboarded(page: Page) {
  // The persisted store reader returns `panels: undefined` when the saved
  // payload lacks a `panels` array, which would clobber the in-memory default
  // and crash BetPanel. Always include a minimal `panels` pair in the seed.
  await page.addInitScript((key) => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      const settings = { ...(parsed.settings ?? {}), onboarded: true };
      const panels = Array.isArray(parsed.panels) && parsed.panels.length === 2
        ? parsed.panels
        : [{}, {}];
      localStorage.setItem(
        key,
        JSON.stringify({ ...parsed, settings, panels }),
      );
    } catch {
      localStorage.setItem(
        key,
        JSON.stringify({ settings: { onboarded: true }, panels: [{}, {}] }),
      );
    }
  }, STORAGE_KEY);
}

async function dismissTransientOverlays(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible');
  if (await dialog.first().isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function isInsideViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) return { inside: false, reason: "no bounding box", box: null };
  const viewport = page.viewportSize();
  if (!viewport) return { inside: false, reason: "no viewport", box };
  const tol = 1;
  const inside =
    box.x >= -tol &&
    box.y >= -tol &&
    box.x + box.width <= viewport.width + tol &&
    box.y + box.height <= viewport.height + tol;
  return { inside, reason: inside ? "ok" : "out of viewport bounds", box };
}

async function getActiveBetButton(page: Page, panelIdx: 0 | 1) {
  // Both the desktop dual-panel wrapper AND the <500px tiny-tab wrapper
  // render BetPanel in the DOM (the inactive one is CSS-hidden via
  // `hidden`/`min-[500px]:hidden`). Walk every match and return the first
  // truly visible one rather than blindly taking .first().
  for (const id of [
    `btn-bet-${panelIdx}`,
    `btn-cashout-${panelIdx}`,
    `btn-cancel-${panelIdx}`,
  ]) {
    const loc = page.locator(`[data-testid="${id}"]`);
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

async function ensureMobileBetTab(page: Page, width: number) {
  if (width >= 1024) return;
  const betTab = page.getByRole("tab", { name: /^Bet$/i });
  if (await betTab.first().isVisible().catch(() => false)) {
    await betTab.first().click().catch(() => {});
  }
  if (width < 500) {
    const tinyTab = page.locator('[data-testid="btn-tiny-panel-0"]');
    if (await tinyTab.first().isVisible().catch(() => false)) {
      await tinyTab.first().click().catch(() => {});
    }
  }
}

async function checkNoHorizontalScroll(page: Page) {
  const result = await page.evaluate(() => {
    return {
      docScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(
    result.docScroll,
    `documentElement.scrollWidth (${result.docScroll}) exceeds innerWidth (${result.innerWidth})`,
  ).toBeLessThanOrEqual(result.innerWidth + 1);
  expect(
    result.bodyScroll,
    `body.scrollWidth (${result.bodyScroll}) exceeds innerWidth (${result.innerWidth})`,
  ).toBeLessThanOrEqual(result.innerWidth + 1);
}

async function checkBetButton(page: Page, width: number, height: number) {
  await ensureMobileBetTab(page, width);
  const btn = await getActiveBetButton(page, 0);
  expect(btn, "no bet/cashout/cancel button found for panel 0").not.toBeNull();
  await btn!.scrollIntoViewIfNeeded().catch(() => {});
  await expect(btn!).toBeVisible();

  // On desktop the page is height-clamped (lg:h-[100dvh]) so the button must
  // fit within the visible viewport. On mobile the page allows vertical
  // scrolling, so we only require visibility + no horizontal clipping.
  const box = await btn!.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width, "bet button has zero width").toBeGreaterThan(0);
  expect(box!.height, "bet button has zero height").toBeGreaterThan(0);
  expect(
    box!.x,
    `bet button x=${box!.x} starts off-screen left`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `bet button right edge ${box!.x + box!.width} exceeds width ${width}`,
  ).toBeLessThanOrEqual(width + 1);

  if (width >= 1024) {
    expect(
      box!.y,
      `bet button y=${box!.y} starts above viewport on desktop`,
    ).toBeGreaterThanOrEqual(-1);
    expect(
      box!.y + box!.height,
      `bet button bottom ${box!.y + box!.height} clipped below viewport ${height} on desktop`,
    ).toBeLessThanOrEqual(height + 1);
  }
}

async function getVisibleChatInput(page: Page) {
  // Chat composer is a plain <input> (not textarea) with placeholder
  // "Send a message..." (en) / "कोई संदेश भेजें..." (hi). Locate by
  // placeholder substring and pick the first visible match.
  const candidates = page.locator(
    'input[placeholder*="message" i], input[placeholder*="संदेश"]',
  );
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function getVisibleByRole(
  page: Page,
  role: "tablist",
  opts: { skipFirst?: number } = {},
) {
  const all = page.locator(`[role="${role}"]`);
  const count = await all.count();
  const skip = opts.skipFirst ?? 0;
  let visibleCount = 0;
  for (let i = 0; i < count; i++) {
    const el = all.nth(i);
    if (await el.isVisible().catch(() => false)) {
      if (visibleCount >= skip) return el;
      visibleCount++;
    }
  }
  return null;
}

async function assertWithinWidth(
  loc: ReturnType<Page["locator"]>,
  width: number,
  label: string,
) {
  const box = await loc.boundingBox();
  expect(box, `${label}: no bounding box`).not.toBeNull();
  expect(box!.width, `${label}: zero width`).toBeGreaterThan(0);
  expect(box!.x, `${label}: x=${box!.x} starts off-screen left`).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${label}: right edge ${box!.x + box!.width} exceeds width ${width}`,
  ).toBeLessThanOrEqual(width + 1);
}

async function checkChatAndSidePanel(page: Page, width: number) {
  if (width >= 1024) {
    // Desktop: both Chat and SidePanel rendered side-by-side.
    const chatInput = await getVisibleChatInput(page);
    expect(chatInput, "desktop: chat input not visible").not.toBeNull();
    const tabList = await getVisibleByRole(page, "tablist");
    expect(tabList, "desktop: no visible tablist").not.toBeNull();
    return;
  }

  // Mobile/tablet: switch tabs and verify each pane is reachable. The page is
  // not height-clamped on mobile (only `lg:h-[100dvh]`), so panes may extend
  // below the fold — scrollIntoViewIfNeeded before measuring.
  const chatTab = page.getByRole("tab", { name: /^Chat$/i }).first();
  await chatTab.click();
  await page.waitForTimeout(200);
  const chatInput = await getVisibleChatInput(page);
  expect(chatInput, "mobile: chat input not visible after switching to Chat tab").not.toBeNull();
  await chatInput!.scrollIntoViewIfNeeded().catch(() => {});
  await assertWithinWidth(chatInput!, width, "chat input");

  const playersTab = page.getByRole("tab", { name: /^Players$/i }).first();
  await playersTab.click();
  await page.waitForTimeout(200);
  // The first visible tablist on mobile is the bottom Bet/Players/Chat one;
  // the SidePanel's own tablist is the second visible one.
  const sideTabList = await getVisibleByRole(page, "tablist", { skipFirst: 1 });
  expect(sideTabList, "mobile: side panel tablist not visible after switching to Players tab").not.toBeNull();
  await sideTabList!.scrollIntoViewIfNeeded().catch(() => {});
  await assertWithinWidth(sideTabList!, width, "side panel tablist");

  // Return to Bet tab so subsequent dialog assertions render over the expected layout.
  const betTab = page.getByRole("tab", { name: /^Bet$/i }).first();
  await betTab.click();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 0));
}

type DialogTrigger = { name: string; selector: string };

const DIALOG_TRIGGERS: DialogTrigger[] = [
  { name: "Settings", selector: 'button[aria-label="Settings"]' },
  { name: "Stats", selector: 'button[aria-label="Stats"]' },
  { name: "Provably Fair", selector: 'button[aria-label="Provably Fair"]' },
  { name: "Achievements", selector: '[data-testid="btn-achievements"]' },
];

async function checkDialogsFitViewport(page: Page) {
  for (const trigger of DIALOG_TRIGGERS) {
    const btn = page.locator(trigger.selector).first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) continue; // Trigger hidden at this viewport — skip per spec.

    await btn.click();
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog, `${trigger.name} dialog did not open`).toBeVisible({
      timeout: 5000,
    });

    const { inside, box } = await isInsideViewport(page, dialog);
    expect(
      inside,
      `${trigger.name} dialog out of viewport: box=${JSON.stringify(box)}`,
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5000 });
  }
}

test.describe("Lunar /play responsive layout contract", () => {
  for (const vp of VIEWPORTS) {
    test(`stays responsive at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedOnboarded(page);
      await page.goto("/play", { waitUntil: "domcontentloaded" });

      // Wait for the lunar shell to render. Use a selector that is rendered
      // at every viewport — `btn-progression` is hidden on mobile
      // (`hidden md:flex`), so it can't gate readiness across the matrix.
      // `btn-achievements` is always present in TopBar.
      await page.waitForSelector('[data-testid="btn-achievements"]', {
        state: "visible",
        timeout: 15_000,
      });
      // Allow any layout/animation settle + game canvas hand-off.
      await page.waitForTimeout(400);
      await dismissTransientOverlays(page);
      await page.waitForTimeout(150);

      await checkNoHorizontalScroll(page);
      await checkBetButton(page, vp.width, vp.height);
      await checkChatAndSidePanel(page, vp.width);
      await checkDialogsFitViewport(page);
    });
  }
});
