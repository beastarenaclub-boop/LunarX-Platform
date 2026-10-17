import { execSync } from "node:child_process";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Lucky 7 table end-to-end: a real player signs in, stakes a chip during the
 * betting window and the round settles against the server's roll.
 *
 * Rounds are shared and server-driven (50s betting / 5s reveal / 5s settling),
 * so the test joins a live round rather than driving the clock.
 */

const DB_URL = process.env.DATABASE_URL;
const STORAGE_KEY = "aviator:v1";
const FUND_PAISE = 1_000_000n; // ₹10,000 into the lucky-7 wallet
const STAKE_RUPEES = 100;

function sql(query: string): string {
  return execSync(`psql "${DB_URL}" -At -v ON_ERROR_STOP=1`, {
    encoding: "utf8",
    input: query,
  }).trim();
}

/**
 * Wallets are fully separate per game, so a fresh signup has ₹0 in the
 * lucky-7 scope. Credit it directly through the ledger (the same append-only
 * shape the wallet service writes) so the bet has funds behind it.
 */
function fundLucky7Wallet(userId: string): void {
  const rid = `pw_${Math.random().toString(36).slice(2, 12)}`;
  sql(`
    INSERT INTO wallets (id, user_id, currency, scope)
    VALUES ('w_${rid}', '${userId}', 'INR', 'lucky-7')
    ON CONFLICT (user_id, currency, scope) DO NOTHING;
    INSERT INTO wallet_ledger (id, wallet_id, user_id, type, amount, balance_after, ref_type, memo)
    SELECT 'l_${rid}', w.id, '${userId}', 'deposit', ${FUND_PAISE}, ${FUND_PAISE},
           'test_funding', 'playwright lucky-7 funding'
      FROM wallets w
     WHERE w.user_id = '${userId}' AND w.currency = 'INR' AND w.scope = 'lucky-7';
  `);
}

/** Same bootstrap as the other player-app suites, plus a funded wallet. */
const test = base.extend<{ userId: string }>({
  userId: async ({ page }, use, testInfo) => {
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
        email: `playwright-lucky7-${unique}@example.com`,
        password: "playwright-test-pw",
        displayName: "Playwright",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Failed to bootstrap auth: ${res.status()} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { user: { id: string } };
    await use(body.user.id);
  },
});

async function seedOnboarded(page: Page, sound = false) {
  await page.addInitScript(
    ({ key, sound }) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        const settings = { ...(parsed.settings ?? {}), onboarded: true, sound };
        localStorage.setItem(key, JSON.stringify({ ...parsed, settings }));
      } catch {
        localStorage.setItem(
          key,
          JSON.stringify({ settings: { onboarded: true, sound } }),
        );
      }
    },
    { key: STORAGE_KEY, sound },
  );
}

/**
 * The table renders one set of controls for desktop and another inside the
 * fixed mobile bar, so every control lookup has to pick the visible variant.
 */
function control(page: Page, testId: string) {
  return page
    .locator(
      `[data-testid="${testId}"]:visible, [data-testid="${testId}-mobile"]:visible`,
    )
    .first();
}

/** Wait for a betting window with enough time left to load and bet. */
async function waitForJoinableBetting(page: Page, needMs: number) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/lucky-7/round");
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          phase?: string;
          now?: number;
          bettingEndsAt?: number;
          roundId?: string;
        } | null;
        if (!body || body.phase !== "betting") return null;
        const left = (body.bettingEndsAt ?? 0) - (body.now ?? 0);
        return left > needMs ? "joinable" : null;
      },
      { timeout: 150_000, intervals: [250] },
    )
    .toBe("joinable");
}

function rupees(text: string): number {
  return Number(text.replace(/[^0-9.]/gu, ""));
}

test.describe("Lucky 7 table", () => {
  // A full betting → reveal → settling observation is one 60s round, and the
  // test may have to wait out most of a round before it can join one.
  test.setTimeout(240_000);

  test.skip(!DB_URL, "DATABASE_URL is required to fund the test wallet");

  test("stakes a chip and settles against the server's roll", async ({
    page,
    userId,
  }) => {
    // Media emulation must happen before the app reads it (never via test.use,
    // which does not apply with the auth-bootstrap fixture).
    await page.emulateMedia({ reducedMotion: "no-preference" });
    fundLucky7Wallet(userId);
    await seedOnboarded(page);

    await waitForJoinableBetting(page, 15_000);
    await page.goto("/lucky-7", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="dice-table"]')).toBeVisible({
      timeout: 20_000,
    });
    const balanceEl = page.locator('[data-testid="text-lucky7-balance"]');
    await expect(balanceEl).toContainText("10,000.00", { timeout: 20_000 });

    // Payout multipliers come from the live server config, not a hard-coded
    // paytable — every zone must be showing one before we bet.
    for (const spot of ["under", "exactly", "over"]) {
      await expect(page.locator(`[data-testid="spot-${spot}"]`)).toContainText(
        /\d+\.\d{2}×/u,
      );
    }

    // A spot tap immediately places the selected coin.
    await control(page, `chip-${STAKE_RUPEES}`).click();
    await page.locator('[data-testid="spot-under"]').click();
    await expect(page.locator('[data-testid="chipstack-under"]')).toHaveText(
      STAKE_RUPEES.toFixed(2),
    );
    await expect(control(page, "text-total-staked")).toHaveText(
      `₹${STAKE_RUPEES.toFixed(2)}`,
    );

    await expect(control(page, "btn-place-bets")).toHaveCount(0);
    await expect(control(page, "text-placed-summary")).toContainText("1 slip", {
      timeout: 20_000,
    });
    const slip = page.locator('[data-testid^="myslip-"]').first();
    await expect(slip).toContainText("Under 7");

    // Stake left the lucky-7 wallet.
    await expect(balanceEl).toContainText("9,900.00", { timeout: 20_000 });

    // ── Reveal: the dice land on the round's roll ───────────────────────
    const resultLine = page.locator('[data-testid="text-result-line"]');
    await expect(resultLine).toBeVisible({ timeout: 70_000 });
    // "Rolling…" until the dice come to rest, then the zone + total.
    await expect(resultLine).not.toContainText("Rolling", { timeout: 20_000 });

    const badge = page.locator('[data-testid="badge-dice-total"]');
    const total = Number(await badge.getAttribute("data-total"));
    expect(
      Number.isFinite(total) && total >= 2 && total <= 12,
      `bad dice total ${total}`,
    ).toBe(true);
    // The accessible readout must agree with the badge.
    await expect(page.locator('[data-testid="text-dice-readout"]')).toHaveText(
      new RegExp(`total ${total}$`, "u"),
    );

    const expectedZone = total < 7 ? "under" : total > 7 ? "over" : "exactly";
    const won = expectedZone === "under";
    await expect(
      page.locator(`[data-testid="spot-${expectedZone}"]`),
      "the winning zone should be highlighted",
    ).toContainText("Wins");

    // ── Settlement: the slip flips to settled with the right payout ─────
    await expect(slip).toContainText("settled", { timeout: 30_000 });
    const payout = rupees(
      (await slip.locator("span").last().innerText()).trim(),
    );
    if (won) {
      expect(payout, `total ${total} is Under 7 — the slip should pay`).toBeGreaterThan(
        STAKE_RUPEES,
      );
    } else {
      expect(payout, `total ${total} is not Under 7 — the slip pays nothing`).toBe(
        0,
      );
    }

    // The round joins the player's own verifiable history.
    await expect(
      page.locator('[data-testid^="btn-verify-"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // Balance reflects the settlement.
    await expect(balanceEl).toContainText(
      won ? /9,9\d\d\.\d\d|1[0-9],\d\d\d\.\d\d/u : "9,900.00",
      { timeout: 30_000 },
    );
  });

  test("reduced motion shows the full dealer poster and CSS dice", async ({
    page,
    userId,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    fundLucky7Wallet(userId);
    await seedOnboarded(page);
    await page.goto("/lucky-7", { waitUntil: "domcontentloaded" });

    const table = page.locator('[data-testid="dice-table"]');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="lucky7-dice"]')).toBeVisible();
    await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "static");
    await expect(table.locator("canvas")).toHaveCount(0);
    // Give the lazy chunk a chance to mount if it were going to.
    await page.waitForTimeout(1_500);
    await expect(table.locator("canvas")).toHaveCount(0);
    await expect(page.locator('[data-testid="text-dice-readout"]')).toBeVisible();
  });

  test("dealer and CSS dice work when WebGL is unavailable", async ({
    page,
    userId,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    fundLucky7Wallet(userId);
    // Pretend the device can't give us a WebGL context at all.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        id: string,
        ...rest: unknown[]
      ) {
        if (id.startsWith("webgl") || id === "experimental-webgl") return null;
        return (
          original as (
            this: HTMLCanvasElement,
            id: string,
            ...rest: unknown[]
          ) => unknown
        ).call(this, id, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await seedOnboarded(page);
    await page.goto("/lucky-7", { waitUntil: "domcontentloaded" });

    const table = page.locator('[data-testid="dice-table"]');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="lucky7-dice"]')).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(table.locator("canvas")).toHaveCount(0);
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
