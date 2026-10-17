import { execSync } from "node:child_process";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Teen Patti 20-20 Live end-to-end: a real player signs in, stakes a chip
 * during the betting window and the round settles against the server's deal.
 *
 * Rounds are shared and server-driven (50s betting / 5s reveal / 5s settling),
 * so the test joins a live round rather than driving the clock.
 */

const DB_URL = process.env.DATABASE_URL;
const STORAGE_KEY = "aviator:v1";
const FUND_PAISE = 1_000_000n; // ₹10,000 into the teen-patti-live wallet
const STAKE_RUPEES = 100;

function sql(query: string): string {
  return execSync(`psql "${DB_URL}" -At -v ON_ERROR_STOP=1`, {
    encoding: "utf8",
    input: query,
  }).trim();
}

/**
 * Wallets are fully separate per game, so a fresh signup has ₹0 in the
 * teen-patti-live scope. Credit it directly through the ledger (the same
 * append-only shape the wallet service writes) so the bet has funds behind it.
 */
function fundTeenPattiLiveWallet(userId: string): void {
  const rid = `pw_${Math.random().toString(36).slice(2, 12)}`;
  sql(`
    INSERT INTO wallets (id, user_id, currency, scope)
    VALUES ('w_${rid}', '${userId}', 'INR', 'teen-patti-live')
    ON CONFLICT (user_id, currency, scope) DO NOTHING;
    INSERT INTO wallet_ledger (id, wallet_id, user_id, type, amount, balance_after, ref_type, memo)
    SELECT 'l_${rid}', w.id, '${userId}', 'deposit', ${FUND_PAISE}, ${FUND_PAISE},
           'test_funding', 'playwright teen-patti-live funding'
      FROM wallets w
     WHERE w.user_id = '${userId}' AND w.currency = 'INR' AND w.scope = 'teen-patti-live';
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
        email: `playwright-tpl-${unique}@example.com`,
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

interface DealWatch {
  /** Every distinct (readout, badge-present) pair the page ever showed. */
  readouts: { text: string; badge: boolean }[];
  /** State captured in the same tick the winner badge first appeared. */
  badgeAt: { cards: number; minM11: number } | null;
  /** First time a win/loss figure was shown while a slip was still open. */
  moneyBeforeSettled: { line: string; slips: string[] } | null;
}

/**
 * Watch the table from inside the page.
 *
 * The winner must never be knowable before the cards are face up — not through
 * the visible badge and not through the screen-reader readout — so this records
 * every readout the page published and, at the exact moment the badge appeared,
 * how far through their flip the DOM cards were. `m11` of a `rotateY` transform
 * is `cos(angle)`: 1 is face up, -1 is still face down.
 *
 * It also watches the money: a win or loss figure may only appear once every
 * slip the player holds has settled, because an unsettled winning slip still
 * reads as a zero payout and would be shown as a loss.
 */
async function installDealWatch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tpl: DealWatch };
    w.__tpl = { readouts: [], badgeAt: null, moneyBeforeSettled: null };
    const check = () => {
      const badge = !!document.querySelector(
        '[data-testid="badge-deal-winner"]',
      );
      const readout =
        document
          .querySelector('[data-testid="text-deal-readout"]')
          ?.textContent?.trim() ?? null;
      if (readout != null) {
        const last = w.__tpl.readouts[w.__tpl.readouts.length - 1];
        if (!last || last.text !== readout || last.badge !== badge) {
          w.__tpl.readouts.push({ text: readout, badge });
        }
      }
      if (badge && !w.__tpl.badgeAt && readout != null) {
        const inners = Array.from(
          document.querySelectorAll('[data-testid^="card-"] > div'),
        );
        let minM11 = 1;
        for (const el of inners) {
          const tr = getComputedStyle(el).transform;
          if (!tr || tr === "none") continue;
          const n = tr
            .replace(/^matrix3?d?\(/u, "")
            .replace(/\)$/u, "")
            .split(",")
            .map(Number);
          if (Number.isFinite(n[0])) minM11 = Math.min(minM11, n[0]);
        }
        w.__tpl.badgeAt = { cards: inners.length, minM11 };
      }
      const line =
        document
          .querySelector('[data-testid="text-result-line"]')
          ?.textContent?.trim() ?? "";
      if (!w.__tpl.moneyBeforeSettled && /[+-]₹/u.test(line)) {
        const slips = Array.from(
          document.querySelectorAll('[data-testid^="myslip-"]'),
        ).map((s) => s.textContent?.trim() ?? "");
        if (slips.length === 0 || slips.some((s) => !/settled/iu.test(s))) {
          w.__tpl.moneyBeforeSettled = { line, slips };
        }
      }
      requestAnimationFrame(check);
    };
    // Sampled per frame rather than through a MutationObserver: init scripts
    // run before `document.documentElement` exists, so there is nothing to
    // observe yet, and a frame is finer-grained than any flip being checked.
    requestAnimationFrame(check);
  });
}

/** Assert nothing gave the result away before the cards turned over. */
function expectNoSpoiler(watch: DealWatch) {
  expect(
    watch.readouts.length,
    "the in-page watch never sampled the table",
  ).toBeGreaterThan(0);
  const early = watch.readouts.filter(
    (r) => !r.badge && r.text !== "Dealing" && r.text !== "Waiting for the deal",
  );
  expect(
    early,
    `readout published a result before the cards landed: ${JSON.stringify(early)}`,
  ).toEqual([]);
  expect(
    watch.moneyBeforeSettled,
    "a win/loss figure was shown while a slip was still unsettled",
  ).toBeNull();
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
        const res = await page.request.get("/api/teen-patti-live/round");
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

test.describe("Teen Patti 20-20 Live table", () => {
  // A full betting → reveal → settling observation is one 60s round, and the
  // test may have to wait out most of a round before it can join one.
  test.setTimeout(240_000);

  test.skip(!DB_URL, "DATABASE_URL is required to fund the test wallet");

  test("stakes a chip and settles against the server's deal", async ({
    page,
    userId,
  }) => {
    // Media emulation must happen before the app reads it (never via test.use,
    // which does not apply with the auth-bootstrap fixture).
    await page.emulateMedia({ reducedMotion: "no-preference" });
    fundTeenPattiLiveWallet(userId);
    await seedOnboarded(page);
    await installDealWatch(page);

    await waitForJoinableBetting(page, 15_000);
    await page.goto("/teen-patti-live", { waitUntil: "domcontentloaded" });

    const table = page.locator('[data-testid="teen-patti-table"]');
    await expect(table).toBeVisible({ timeout: 20_000 });
    const balanceEl = page.locator('[data-testid="text-tpl-balance"]');
    await expect(balanceEl).toContainText("10,000.00", { timeout: 20_000 });

    // Payout multipliers come from the live server config, not a hard-coded
    // paytable — every main zone must be showing one before we bet.
    for (const spot of ["playerA", "tie", "playerB"]) {
      await expect(page.locator(`[data-testid="spot-${spot}"]`)).toContainText(
        /\d+\.\d{2}×/u,
      );
    }
    // Pair Plus quotes a ceiling (the trail price) instead of one multiplier.
    for (const spot of ["pairPlusA", "pairPlusB"]) {
      await expect(page.locator(`[data-testid="spot-${spot}"]`)).toContainText(
        /≤ \d+×/u,
      );
    }

    // ── Stage a chip on Player A and place it ───────────────────────────
    await control(page, `chip-${STAKE_RUPEES}`).click();
    await page.locator('[data-testid="spot-playerA"]').click();
    await expect(page.locator('[data-testid="chipstack-playerA"]')).toHaveText(
      String(STAKE_RUPEES),
    );
    await expect(control(page, "text-total-staked")).toHaveText(
      `₹${STAKE_RUPEES}`,
    );

    await control(page, "btn-place-bets").click();
    await expect(control(page, "text-placed-summary")).toContainText("1 slip", {
      timeout: 20_000,
    });
    const slip = page.locator('[data-testid^="myslip-"]').first();
    await expect(slip).toContainText("Player A");

    // Stake left the teen-patti-live wallet.
    await expect(balanceEl).toContainText("9,900.00", { timeout: 20_000 });

    // ── Reveal: the cards land on the round's deal ──────────────────────
    const resultLine = page.locator('[data-testid="text-result-line"]');
    await expect(resultLine).toBeVisible({ timeout: 70_000 });
    // "Dealing…" until the cards are face up, then the winner + category.
    await expect(resultLine).not.toContainText("Dealing", { timeout: 20_000 });

    // The winner is only named once the cards have actually turned over.
    const badge = page.locator('[data-testid="badge-deal-winner"]');
    await expect(badge).toBeVisible({ timeout: 20_000 });
    const winner = await badge.getAttribute("data-winner");
    expect(
      ["playerA", "playerB", "tie"].includes(winner ?? ""),
      `bad winner ${winner}`,
    ).toBe(true);
    // The accessible readout must agree with the badge.
    await expect(page.locator('[data-testid="text-deal-readout"]')).toHaveText(
      new RegExp(
        `^${
          winner === "tie"
            ? "Tie"
            : winner === "playerA"
              ? "Player A wins"
              : "Player B wins"
        } with `,
        "u",
      ),
    );

    // Nothing — badge or screen-reader readout — named the winner while the
    // cards were still in the air.
    expectNoSpoiler(
      await page.evaluate(() => (window as unknown as { __tpl: DealWatch }).__tpl),
    );

    const winningSpot = winner === "tie" ? "tie" : winner;
    await expect(
      page.locator(`[data-testid="spot-${winningSpot}"]`),
      "the winning zone should be highlighted",
    ).toContainText(/wins/iu);

    // ── Settlement: the slip flips to settled with the right payout ─────
    await expect(slip).toContainText("settled", { timeout: 30_000 });
    const payout = rupees(
      (await slip.locator("span").last().innerText()).trim(),
    );
    if (winner === "playerA") {
      expect(payout, "Player A won — the slip should pay").toBeGreaterThan(
        STAKE_RUPEES,
      );
    } else if (winner === "tie") {
      // An exact tie pushes a Player A / Player B bet: the stake comes back.
      expect(payout, "a tie pushes the Player A bet").toBe(STAKE_RUPEES);
    } else {
      expect(payout, "Player B won — the Player A slip pays nothing").toBe(0);
    }

    // The round joins the player's own verifiable history.
    await expect(
      page.locator('[data-testid^="btn-verify-"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // Balance reflects the settlement.
    await expect(balanceEl).toContainText(
      winner === "playerA"
        ? /1[0-9],\d\d\d\.\d\d/u
        : winner === "tie"
          ? "10,000.00"
          : "9,900.00",
      { timeout: 30_000 },
    );

    // Across the whole round the table never put a figure on the result until
    // the slips were settled — a winning bet reads as zero until then.
    expect(
      (
        await page.evaluate(
          () => (window as unknown as { __tpl: DealWatch }).__tpl,
        )
      ).moneyBeforeSettled,
      "a win/loss figure was shown while a slip was still unsettled",
    ).toBeNull();

    // A past round stays verifiable from the table itself.
    await page.locator('[data-testid^="btn-verify-"]').first().click();
    await expect(page.locator('[data-testid="text-verify-result"]')).toHaveText(
      /Verified/u,
      { timeout: 20_000 },
    );
  });

  test("joining mid-reveal never calls the winner before the cards turn", async ({
    page,
    userId,
  }) => {
    expect(userId, "the table needs a signed-in player").toBeTruthy();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Force the flat table: it is the path whose cards are DOM elements with a
    // fixed CSS flip, so a shortened deal is where the badge could outrun them.
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
    await seedOnboarded(page);
    await installDealWatch(page);

    // Land on the table just as the reveal starts, so the deal has to be
    // squeezed into what is left of the window instead of the full five
    // seconds — the case where the plan ends before a DOM card has finished
    // its (fixed-length) CSS flip.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/teen-patti-live/round");
          if (!res.ok()) return null;
          const body = (await res.json()) as {
            phase?: string;
            now?: number;
            revealEndsAt?: number;
          } | null;
          if (body?.phase !== "reveal") return null;
          const left = (body.revealEndsAt ?? 0) - (body.now ?? 0);
          return left > 4_000 ? "fresh-reveal" : null;
        },
        { timeout: 150_000, intervals: [100] },
      )
      .toBe("fresh-reveal");
    await page.goto("/teen-patti-live", { waitUntil: "commit" });

    const badge = page.locator('[data-testid="badge-deal-winner"]');
    await expect(badge).toBeVisible({ timeout: 30_000 });

    const watch = await page.evaluate(
      () => (window as unknown as { __tpl: DealWatch }).__tpl,
    );
    expectNoSpoiler(watch);
    expect(
      watch.readouts.some((r) => r.text === "Dealing"),
      "the shortened deal should still animate, not snap",
    ).toBe(true);
    expect(watch.badgeAt, "badge appearance was not observed").not.toBeNull();
    expect(watch.badgeAt!.cards, "both hands should be on the felt").toBe(6);
    expect(
      watch.badgeAt!.minM11,
      "a card was still mid-flip when the winner was announced",
    ).toBeGreaterThan(0.999);
  });

  test("reduced motion shows the flat table instead of the 3D one", async ({
    page,
    userId,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    fundTeenPattiLiveWallet(userId);
    await seedOnboarded(page);
    await page.goto("/teen-patti-live", { waitUntil: "domcontentloaded" });

    const table = page.locator('[data-testid="teen-patti-table"]');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table).toHaveAttribute("data-mode", "flat");
    await expect(page.locator('[data-testid="tpl-flat-table"]')).toBeVisible();
    await expect(table.locator("canvas")).toHaveCount(0);
    // Give the lazy chunk a chance to mount if it were going to.
    await page.waitForTimeout(1_500);
    await expect(table.locator("canvas")).toHaveCount(0);
    await expect(page.locator('[data-testid="text-deal-readout"]')).toBeAttached();
    // The round is still fully playable without the scene.
    await expect(control(page, "btn-place-bets")).toBeVisible();
  });

  test("falls back to the flat table when WebGL is unavailable", async ({
    page,
    userId,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    fundTeenPattiLiveWallet(userId);
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
    await page.goto("/teen-patti-live", { waitUntil: "domcontentloaded" });

    const table = page.locator('[data-testid="teen-patti-table"]');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table).toHaveAttribute("data-mode", "flat");
    await expect(page.locator('[data-testid="tpl-flat-table"]')).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(table.locator("canvas")).toHaveCount(0);
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
