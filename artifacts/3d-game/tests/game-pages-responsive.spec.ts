import { test as base, expect, type Page, type Locator } from "@playwright/test";

// Mirrors the bootstrap pattern used by lunar-responsive.spec.ts: every test
// starts from a fresh authenticated session by registering a unique throwaway
// account via POST /api/auth/signup (demo mode has been removed). The signup
// route is behind authRateLimiter, so we forward x-test-bypass when
// TEST_RATE_LIMIT_BYPASS is set to keep the matrix from tripping the limit.
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

// Same 11-viewport matrix used by the Lunar shell suite.
const VIEWPORTS: Viewport[] = [
  { name: "320x720 (smallest phone)", width: 320, height: 720 },
  { name: "360x740 (common phone)", width: 360, height: 740 },
  { name: "400x800 (large phone)", width: 400, height: 800 },
  { name: "500x800 (phablet/dual-bet breakpoint)", width: 500, height: 800 },
  { name: "600x900 (embedded preview / small tablet)", width: 600, height: 900 },
  { name: "768x1024 (tablet portrait)", width: 768, height: 1024 },
  { name: "850x1100 (mid-width window)", width: 850, height: 1100 },
  { name: "1024x768 (desktop breakpoint)", width: 1024, height: 768 },
  { name: "1280x720 (laptop)", width: 1280, height: 720 },
  { name: "1440x900 (desktop)", width: 1440, height: 900 },
  { name: "1920x1080 (large desktop)", width: 1920, height: 1080 },
  { name: "1366x600 (short-height laptop)", width: 1366, height: 600 },
  { name: "740x360 (landscape phone)", width: 740, height: 360 },
];

const STORAGE_KEY = "aviator:v1";

async function seedOnboarded(page: Page) {
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

async function dismissDevelopmentPreviewBanner(page: Page) {
  const close = page.getByRole("button", { name: "Close banner" });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

async function dismissTransientOverlays(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible');
  if (await dialog.first().isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function checkNoHorizontalScroll(page: Page) {
  const result = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    result.docScroll,
    `documentElement.scrollWidth (${result.docScroll}) exceeds innerWidth (${result.innerWidth})`,
  ).toBeLessThanOrEqual(result.innerWidth + 1);
  expect(
    result.bodyScroll,
    `body.scrollWidth (${result.bodyScroll}) exceeds innerWidth (${result.innerWidth})`,
  ).toBeLessThanOrEqual(result.innerWidth + 1);
}

async function pickFirstVisible(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function assertPrimaryAction(
  page: Page,
  width: number,
  selectors: string[],
  label: string,
) {
  let found: Locator | null = null;
  for (const sel of selectors) {
    found = await pickFirstVisible(page.locator(sel));
    if (found) break;
  }
  expect(
    found,
    `${label}: none of the primary-action selectors were visible: ${selectors.join(", ")}`,
  ).not.toBeNull();
  await found!.scrollIntoViewIfNeeded().catch(() => {});
  await expect(found!, `${label}: primary action not visible`).toBeVisible();

  const box = await found!.boundingBox();
  expect(box, `${label}: primary action has no bounding box`).not.toBeNull();
  expect(box!.width, `${label}: primary action zero width`).toBeGreaterThan(0);
  expect(box!.height, `${label}: primary action zero height`).toBeGreaterThan(0);
  expect(
    box!.x,
    `${label}: primary action x=${box!.x} starts off-screen left`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${label}: primary action right edge ${box!.x + box!.width} exceeds width ${width}`,
  ).toBeLessThanOrEqual(width + 1);

  // Tappability contract: primary action must be a real interactive control
  // (button / link / role=tab), not visually disabled, accept pointer events,
  // and actually be the topmost element at its center point so a real tap
  // would land on it (not a sticky overlay or invisible blocker).
  const tap = await found!.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const isInteractive =
      tag === "button" ||
      tag === "a" ||
      tag === "input" ||
      role === "button" ||
      role === "link" ||
      role === "tab";
    const cs = window.getComputedStyle(el as HTMLElement);
    const disabledAttr = (el as HTMLButtonElement).disabled === true;
    const ariaDisabled = el.getAttribute("aria-disabled") === "true";
    const pointerOk = cs.pointerEvents !== "none";
    const rect = (el as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hitsSelf = !!top && (top === el || el.contains(top) || top.contains(el));
    return { tag, role, isInteractive, disabledAttr, ariaDisabled, pointerOk, hitsSelf };
  });
  expect(
    tap.isInteractive,
    `${label}: primary action <${tap.tag} role=${tap.role}> is not an interactive control`,
  ).toBe(true);
  expect(
    tap.disabledAttr,
    `${label}: primary action is disabled (disabled attr)`,
  ).toBe(false);
  expect(
    tap.ariaDisabled,
    `${label}: primary action is aria-disabled`,
  ).toBe(false);
  expect(tap.pointerOk, `${label}: primary action has pointer-events:none`).toBe(true);
  expect(
    tap.hitsSelf,
    `${label}: primary action is occluded — elementFromPoint did not hit it`,
  ).toBe(true);
}

// Spot-check that visible interactive controls don't horizontally overflow the
// viewport. We only inspect controls inside the page body (skipping native
// chrome) and skip elements with zero width (likely hidden via CSS) to keep
// the assertion robust across responsive layouts.
async function assertNoHorizontalClipping(page: Page, width: number) {
  const offenders = await page.evaluate((vw) => {
    const tol = 1;
    const out: { tag: string; testid: string | null; right: number; left: number }[] = [];
    // Items inside an intentional horizontal scroller may extend past the
    // viewport. Clipping ancestors are not exempt: a page root using
    // overflow-x:clip must not hide an otherwise interactive control.
    function insideHorizontalScroller(el: HTMLElement): boolean {
      let cur: HTMLElement | null = el.parentElement;
      while (cur && cur !== document.documentElement) {
        const cs = window.getComputedStyle(cur);
        const ox = cs.overflowX;
        if (ox === "auto" || ox === "scroll") {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    }
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [role="button"], [role="link"], [role="tab"]',
      ),
    );
    for (const n of nodes) {
      const rect = n.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(n);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      if (rect.left >= -tol && rect.right <= vw + tol) continue;
      if (insideHorizontalScroller(n)) continue;
      out.push({
        tag: n.tagName.toLowerCase(),
        testid: n.getAttribute("data-testid"),
        right: Math.round(rect.right),
        left: Math.round(rect.left),
      });
      if (out.length >= 5) break;
    }
    return out;
  }, width);
  expect(
    offenders,
    `Found elements clipped outside viewport (width=${width}): ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

// Assert two controls (first visible match per selector list) do not overlap.
async function assertNoOverlap(
  page: Page,
  aSelectors: string[],
  bSelectors: string[],
  label: string,
) {
  let a: Locator | null = null;
  for (const sel of aSelectors) {
    a = await pickFirstVisible(page.locator(sel));
    if (a) break;
  }
  let b: Locator | null = null;
  for (const sel of bSelectors) {
    b = await pickFirstVisible(page.locator(sel));
    if (b) break;
  }
  expect(a, `${label}: first element not visible (${aSelectors.join(", ")})`).not.toBeNull();
  expect(b, `${label}: second element not visible (${bSelectors.join(", ")})`).not.toBeNull();
  const boxA = await a!.boundingBox();
  const boxB = await b!.boundingBox();
  expect(boxA, `${label}: first element has no box`).not.toBeNull();
  expect(boxB, `${label}: second element has no box`).not.toBeNull();
  const tol = 1;
  const separated =
    boxA!.x + boxA!.width <= boxB!.x + tol ||
    boxB!.x + boxB!.width <= boxA!.x + tol ||
    boxA!.y + boxA!.height <= boxB!.y + tol ||
    boxB!.y + boxB!.height <= boxA!.y + tol;
  expect(
    separated,
    `${label}: elements overlap — A=${JSON.stringify(boxA)} B=${JSON.stringify(boxB)}`,
  ).toBe(true);
}

async function assertControlBox(
  page: Page,
  control: Locator,
  width: number,
  label: string,
  minHeight = 40,
) {
  // Center non-fixed controls so sticky game headers and preview chrome cannot
  // mask a control that Playwright otherwise considers geometrically visible.
  await control
    .evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }))
    .catch(() => {});
  await expect(control, `${label}: control is not visible`).toBeVisible();
  const box = await control.boundingBox();
  expect(box, `${label}: control has no bounding box`).not.toBeNull();
  expect(box!.width, `${label}: control has no usable width`).toBeGreaterThanOrEqual(36);
  expect(box!.height, `${label}: control is too short to use`).toBeGreaterThanOrEqual(minHeight);
  expect(box!.x, `${label}: control starts off-screen`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label}: control extends past the viewport`).toBeLessThanOrEqual(
    width + 1,
  );

  const hit = await control.evaluate((el) => {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    return {
      inVerticalViewport: rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
      hitsSelf: !!top && (top === el || el.contains(top) || top.contains(el)),
    };
  });
  expect(hit.inVerticalViewport, `${label}: control is vertically clipped`).toBe(true);
  expect(hit.hitsSelf, `${label}: another element blocks the control`).toBe(true);
}

type TableControlSpec = {
  stageSelector: string;
  boardSelector?: string;
};

async function checkTableBettingControls(
  page: Page,
  width: number,
  spec: TableControlSpec,
) {
  const rack = await pickFirstVisible(
    page.locator('[data-testid="chip-rack"], [data-testid="chip-rack-mobile"]'),
  );
  expect(rack, "table game: no visible chip rack").not.toBeNull();

  if (spec.boardSelector && width >= 1024) {
    const board = await pickFirstVisible(page.locator(spec.boardSelector));
    expect(board, "roulette: board section is not visible").not.toBeNull();
    const boardBox = await board!.boundingBox();
    const rackBox = await rack!.boundingBox();
    expect(boardBox, "roulette: board section has no box").not.toBeNull();
    expect(rackBox, "roulette: chip rack has no box").not.toBeNull();
    expect(
      rackBox!.y,
      `roulette: chip rack is not below board (board=${JSON.stringify(boardBox)} rack=${JSON.stringify(rackBox)})`,
    ).toBeGreaterThanOrEqual(boardBox!.y + boardBox!.height - 1);
  }

  const largest = rack!.locator('[data-testid$="-1000"]');
  await largest.scrollIntoViewIfNeeded();
  await assertControlBox(page, largest, width, "1K chip", width < 500 ? 44 : 36);
  await largest.click();

  let custom = rack!.locator('[data-testid$="-custom"]');
  await custom.scrollIntoViewIfNeeded();
  await assertControlBox(page, custom, width, "ANY chip", width < 500 ? 44 : 36);
  await custom.click();

  let customInput = rack!.locator('[data-testid$="-custom-input"]');
  let customApply = rack!.locator('[data-testid$="-custom-apply"]');
  await assertControlBox(page, customInput, width, "custom amount field");
  await assertControlBox(page, customApply, width, "custom amount confirmation");
  await checkNoHorizontalScroll(page);
  await assertNoHorizontalClipping(page, width);

  // Escape must close without changing the selected chip.
  await customInput.press("Escape");
  await expect(customInput).toBeHidden();

  // Enter applies a keyboard-entered amount.
  custom = rack!.locator('[data-testid$="-custom"]');
  await custom.click();
  customInput = rack!.locator('[data-testid$="-custom-input"]');
  await customInput.fill("987654321");
  await customInput.press("Enter");
  await expect(customInput).toBeHidden();

  // Re-open and exercise the explicit touch/click confirmation control.
  custom = rack!.locator('[data-testid$="-custom"]');
  await custom.click();
  customInput = rack!.locator('[data-testid$="-custom-input"]');
  customApply = rack!.locator('[data-testid$="-custom-apply"]');
  await customInput.fill("123456789");

  const total = await pickFirstVisible(
    page.locator(
      '[data-testid="text-total-staked"], [data-testid="text-total-staked-mobile"]',
    ),
  );
  expect(total, "table game: staged total is hidden while ANY is open").not.toBeNull();
  await expect(total!).toBeVisible();
  await assertNoOverlap(
    page,
    ['[data-testid$="-custom-input"]'],
    ['[data-testid="text-total-staked"]', '[data-testid="text-total-staked-mobile"]'],
    "custom amount field vs staged total",
  );
  await assertNoOverlap(
    page,
    ['[data-testid="chip-rack"]', '[data-testid="chip-rack-mobile"]'],
    ['[data-testid="btn-undo"]', '[data-testid="btn-undo-mobile"]'],
    "expanded chip rack vs actions",
  );
  await customApply.click();
  await expect(customInput).toBeHidden();

  // Staging a long custom value must keep the total and every action usable.
  const stageSpot = page.locator(spec.stageSelector).first();
  await stageSpot.scrollIntoViewIfNeeded();
  await stageSpot.click();
  const totalText = (await total!.innerText()).replace(/\s/g, "");
  expect(
    totalText,
    "long custom amount is not represented in the staged total",
  ).toMatch(/12,34,56,789|123456\.8k/);

  const undo = await pickFirstVisible(
    page.locator('[data-testid="btn-undo"], [data-testid="btn-undo-mobile"]'),
  );
  const clear = await pickFirstVisible(
    page.locator('[data-testid="btn-clear"], [data-testid="btn-clear-mobile"]'),
  );
  const rebet = await pickFirstVisible(
    page.locator('[data-testid="btn-rebet"], [data-testid="btn-rebet-mobile"]'),
  );
  const place = await pickFirstVisible(
    page.locator('[data-testid="btn-place-bets"], [data-testid="btn-place-bets-mobile"]'),
  );
  expect(undo).not.toBeNull();
  expect(clear).not.toBeNull();
  expect(rebet).not.toBeNull();
  expect(place).not.toBeNull();
  await expect(undo!).toBeEnabled();
  await expect(clear!).toBeEnabled();
  await expect(place!).toBeEnabled();
  await assertControlBox(page, undo!, width, "Undo action");
  await assertControlBox(page, clear!, width, "Clear action");
  await assertControlBox(page, place!, width, "Place Bets action");
  await expect(rebet!).toBeVisible();

  // Undo must remove the amount that was actually staged, not whichever chip
  // denomination happens to be selected at undo time.
  const differentChip = rack!.locator('[data-testid$="-10"]');
  await differentChip.scrollIntoViewIfNeeded();
  await differentChip.click();
  await undo!.click();
  await expect(total!).toContainText("0");
  await stageSpot.click();
  await clear!.click();
  await expect(total!).toContainText("0");
  await stageSpot.click();
  await expect(place!).toBeEnabled();

  await checkNoHorizontalScroll(page);
  await assertNoHorizontalClipping(page, width);
}

type StakeControlSpec = {
  inputSelector: string;
  quickSelector: string;
  actionSelectors: string[];
};

async function checkStakeControls(page: Page, width: number, spec: StakeControlSpec) {
  const input = await pickFirstVisible(page.locator(spec.inputSelector));
  const quick = await pickFirstVisible(page.locator(spec.quickSelector));
  expect(input, `stake input missing: ${spec.inputSelector}`).not.toBeNull();
  expect(quick, `quick-stake control missing: ${spec.quickSelector}`).not.toBeNull();

  await assertControlBox(page, input!, width, "stake input");
  await assertControlBox(page, quick!, width, "largest quick-stake button");

  await expect(input!, "stake input is not enabled for player interaction").toBeEnabled({
    timeout: 65_000,
  });
  await input!.fill("123456789.99");
  await expect(input!).toHaveValue("123456789.99");
  await checkNoHorizontalScroll(page);
  await assertNoHorizontalClipping(page, width);

  // Live games can roll into a new window between two assertions. Re-resolve
  // the current visible controls, wait for their real enabled state, then use
  // Playwright's normal click path rather than altering disabled attributes.
  await expect(async () => {
    const currentQuick = await pickFirstVisible(page.locator(spec.quickSelector));
    const currentInput = await pickFirstVisible(page.locator(spec.inputSelector));
    expect(currentQuick).not.toBeNull();
    expect(currentInput).not.toBeNull();
    await expect(currentQuick!).toBeEnabled({ timeout: 1_000 });
    await currentQuick!.click();
    await expect(currentInput!).toHaveValue("1000", { timeout: 1_000 });
  }).toPass({ timeout: 65_000, intervals: [100, 250, 500, 1_000] });

  let action: Locator | null = null;
  for (const selector of spec.actionSelectors) {
    action = await pickFirstVisible(page.locator(selector));
    if (action) break;
  }
  expect(action, `stake action missing: ${spec.actionSelectors.join(", ")}`).not.toBeNull();
  await action!.scrollIntoViewIfNeeded().catch(() => {});
  await expect(action!).toBeVisible();
  const actionBox = await action!.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.x).toBeGreaterThanOrEqual(-1);
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(width + 1);
  await assertNoOverlap(
    page,
    [spec.inputSelector],
    spec.actionSelectors,
    "stake input vs primary action",
  );
}

type PageSpec = {
  name: string;
  path: string;
  // Selector(s) that confirm the page has rendered. Tried in order; first
  // visible match wins.
  readySelectors: string[];
  // Per-page primary CTA selectors. The first visible match per viewport wins
  // so we can fall back gracefully when a button is collapsed into a menu.
  primarySelectors: string[];
  // Optional per-test setup (e.g. switching tabs) before assertions run.
  setup?: (page: Page, width: number) => Promise<void>;
  // Optional media/emulation applied before the page loads.
  emulate?: (page: Page) => Promise<void>;
  // Optional pairs of controls that must never overlap (e.g. the chip rack
  // and the bet action buttons on the table games).
  noOverlap?: { a: string[]; b: string[]; label: string }[];
  // Deeper game-specific checks for stake/chip controls.
  controlCheck?: (page: Page, width: number) => Promise<void>;
};

// Shared overlap contract for the 4 chip-based table games: the chip rack
// must not collide with the Undo button or the Place Bets CTA.
const TABLE_GAME_OVERLAPS = [
  {
    a: ['[data-testid="chip-rack"]', '[data-testid="chip-rack-mobile"]'],
    b: ['[data-testid="btn-undo"]', '[data-testid="btn-undo-mobile"]'],
    label: "chip rack vs undo",
  },
  {
    a: ['[data-testid="chip-rack"]', '[data-testid="chip-rack-mobile"]'],
    b: [
      '[data-testid="btn-place-bets"]',
      '[data-testid="btn-place-bets-mobile"]',
    ],
    label: "chip rack vs place-bets",
  },
  {
    a: ['[data-testid="chip-rack"]', '[data-testid="chip-rack-mobile"]'],
    b: [
      '[data-testid="text-total-staked"]',
      '[data-testid="text-total-staked-mobile"]',
    ],
    label: "chip rack vs staged total",
  },
];

const PAGES: PageSpec[] = [
  {
    name: "Home /",
    path: "/",
    readySelectors: ['[data-testid="link-home"]'],
    // The green DEPOSIT action-bar button (crick99bet-style redesign) is the
    // primary monetisation action; the Lunar Crash lobby card is a fallback.
    primarySelectors: [
      '[data-testid="btn-action-deposit"]',
      '[data-testid="card-game-lunar"]',
    ],
  },
  {
    name: "Dice /dice",
    path: "/dice",
    readySelectors: ['[data-testid="btn-roll"]'],
    primarySelectors: ['[data-testid="btn-roll"]'],
    controlCheck: (page, width) =>
      checkStakeControls(page, width, {
        inputSelector: '[data-testid="input-dice-stake"]',
        quickSelector: '[data-testid="chip-dice-1000"]',
        actionSelectors: ['[data-testid="btn-roll"]'],
      }),
  },
  {
    name: "Plinko /plinko",
    path: "/plinko",
    readySelectors: ['[data-testid="btn-drop"]'],
    primarySelectors: ['[data-testid="btn-drop"]'],
    controlCheck: (page, width) =>
      checkStakeControls(page, width, {
        inputSelector: '[data-testid="input-plinko-stake"]',
        quickSelector: '[data-testid="chip-plinko-1000"]',
        actionSelectors: ['[data-testid="btn-drop"]'],
      }),
  },
  {
    name: "Mines /mines",
    path: "/mines",
    readySelectors: [
      '[data-testid="btn-place-mines"]',
      '[data-testid="btn-mines-cashout"]',
      '[data-testid="btn-mines-new-round"]',
    ],
    primarySelectors: [
      '[data-testid="btn-place-mines"]',
      '[data-testid="btn-mines-cashout"]',
      '[data-testid="btn-mines-new-round"]',
    ],
    controlCheck: (page, width) =>
      checkStakeControls(page, width, {
        inputSelector: '[data-testid="input-mines-stake"]',
        quickSelector: '[data-testid="chip-mines-1000"]',
        actionSelectors: ['[data-testid="btn-place-mines"]'],
      }),
  },
  {
    name: "Wallet /wallet",
    path: "/wallet",
    readySelectors: ['[data-testid="tab-deposit"]'],
    // Deposit submit may be hidden behind the deposits-unavailable banner,
    // so the deposit tab itself is the most reliable always-rendered CTA.
    primarySelectors: [
      '[data-testid="btn-deposit-submit"]',
      '[data-testid="tab-deposit"]',
    ],
  },
  {
    name: "History /history",
    path: "/history",
    readySelectors: ['[data-testid="tab-history-bets"]'],
    primarySelectors: ['[data-testid="tab-history-bets"]'],
  },
  {
    name: "Profile /profile",
    path: "/profile",
    readySelectors: [
      '[data-testid="text-profile-email"]',
      '[data-testid="btn-back-home"]',
    ],
    // KYC submit only renders when the resubmit form is shown; the always-
    // present back-home button is the page's tappable primary navigation
    // control across every viewport. Both selectors resolve to <button>.
    primarySelectors: [
      '[data-testid="btn-kyc-submit"]',
      '[data-testid="btn-back-home"]',
    ],
  },
  {
    name: "Baccarat /baccarat",
    path: "/baccarat",
    readySelectors: ['[data-testid="btn-place-bets"]'],
    // Place-bets is disabled until chips are staged; the always-tappable
    // back button is the reliable primary control at every width.
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
    controlCheck: (page, width) =>
      checkTableBettingControls(page, width, { stageSelector: '[data-testid="spot-player"]' }),
  },
  {
    name: "Roulette /roulette",
    path: "/roulette",
    readySelectors: [
      '[data-testid="btn-place-bets"]',
      '[data-testid="btn-place-bets-mobile"]',
    ],
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
    controlCheck: (page, width) =>
      checkTableBettingControls(page, width, {
        stageSelector: '[data-testid="cell-1"]',
        boardSelector: '[data-testid="roulette-board"]',
      }),
  },
  {
    name: "Teen Patti /teen-patti",
    path: "/teen-patti",
    readySelectors: ['[data-testid="btn-place-bets"]'],
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
    controlCheck: (page, width) =>
      checkTableBettingControls(page, width, { stageSelector: '[data-testid="spot-playerA"]' }),
  },
  {
    name: "Teen Patti Live /teen-patti-live",
    path: "/teen-patti-live",
    // One selector matching either copy of the CTA: listing them separately
    // makes narrow viewports sit through the desktop one's timeout first.
    readySelectors: [
      '[data-testid="last-result-banner"]',
    ],
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
    // The 3D felt and the flat fallback sit in the same fixed-aspect frame, so
    // the layout contract is identical either way. Take the flat one: loading
    // the scene and its models on all 13 viewports costs minutes and leaves
    // the slower ones brushing the test timeout. The scene itself is covered
    // by teen-patti-live-round.spec.ts.
    emulate: (page) => page.emulateMedia({ reducedMotion: "reduce" }),
  },
  {
    name: "Andar Bahar /andar-bahar",
    path: "/andar-bahar",
    readySelectors: ['[data-testid="btn-place-bets"]'],
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
    controlCheck: (page, width) =>
      checkTableBettingControls(page, width, { stageSelector: '[data-testid="spot-andar"]' }),
  },
  {
    name: "Lucky 7 /lucky-7",
    path: "/lucky-7",
    readySelectors: [
      '[data-testid="lucky7-betting-dock"]',
    ],
    primarySelectors: ['[data-testid="btn-back"]'],
    noOverlap: TABLE_GAME_OVERLAPS,
  },
  {
    name: "Blackjack /blackjack",
    path: "/blackjack",
    readySelectors: [
      '[data-testid="btn-deal"]',
      '[data-testid="btn-hit"]',
      '[data-testid="btn-insurance-take"]',
      '[data-testid="btn-insurance-take-m"]',
    ],
    primarySelectors: ['[data-testid="btn-back"]'],
    controlCheck: (page, width) =>
      checkStakeControls(page, width, {
        inputSelector: '[data-testid="input-blackjack-stake"]',
        quickSelector: '[data-testid="chip-blackjack-1000"]',
        actionSelectors: ['[data-testid="btn-deal"]'],
      }),
  },
  {
    name: "Promotions /promotions",
    path: "/promotions",
    readySelectors: ['[data-testid="btn-claim-welcome"]'],
    // Each promo card has a Claim CTA; welcome is the first one and is
    // rendered in the document order so it lands above the fold on every
    // viewport in the matrix.
    primarySelectors: ['[data-testid="btn-claim-welcome"]'],
  },
];

for (const spec of PAGES) {
  test.describe(`${spec.name} responsive layout contract`, () => {
    for (const vp of VIEWPORTS) {
      test(`stays responsive at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (spec.emulate) await spec.emulate(page);
        await seedOnboarded(page);
        await page.goto(spec.path, { waitUntil: "domcontentloaded" });

        // Wait for the page to actually render. Try each ready selector in
        // turn so pages with multiple end-states (e.g. Mines) work in any
        // mode.
        let ready: Locator | null = null;
        for (const sel of spec.readySelectors) {
          // Some pages render the same control twice (desktop panel + mobile
          // bottom bar); match only the visible instance at this viewport.
          const loc = page.locator(`${sel} >> visible=true`).first();
          try {
            await loc.waitFor({ state: "visible", timeout: 15_000 });
            ready = loc;
            break;
          } catch {
            // try next
          }
        }
        expect(
          ready,
          `${spec.name}: none of the readiness selectors became visible: ${spec.readySelectors.join(", ")}`,
        ).not.toBeNull();

        await page.waitForTimeout(300);
        await dismissDevelopmentPreviewBanner(page);
        await dismissTransientOverlays(page);
        await page.waitForTimeout(150);

        if (spec.setup) await spec.setup(page, vp.width);

        await page.evaluate(() => window.scrollTo(0, 0));
        await checkNoHorizontalScroll(page);
        await assertPrimaryAction(page, vp.width, spec.primarySelectors, spec.name);
        await assertNoHorizontalClipping(page, vp.width);
        for (const pair of spec.noOverlap ?? []) {
          await assertNoOverlap(
            page,
            pair.a,
            pair.b,
            `${spec.name} @ ${vp.name}: ${pair.label}`,
          );
        }
        if (spec.controlCheck) await spec.controlCheck(page, vp.width);
      });
    }
  });
}

test.describe("Lunar stake controls responsive layout contract", () => {
  for (const vp of VIEWPORTS) {
    test(`fits long and quick stake values at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedOnboarded(page);
      await page.goto("/play", { waitUntil: "domcontentloaded" });

      const input = page.locator('[data-testid="input-amount-0"] >> visible=true').first();
      await input.waitFor({ state: "visible", timeout: 15_000 });
      await dismissDevelopmentPreviewBanner(page);
      await checkStakeControls(page, vp.width, {
        inputSelector: '[data-testid="input-amount-0"]',
        quickSelector: '[data-testid="chip-lunar-0-1000"]',
        actionSelectors: [
          '[data-testid="btn-bet-0"]',
          '[data-testid="btn-cancel-0"]',
          '[data-testid="btn-cashout-0"]',
        ],
      });
      await checkNoHorizontalScroll(page);
      await assertNoHorizontalClipping(page, vp.width);
    });
  }
});
