import { execSync } from "node:child_process";
import { test, expect, request as pwRequest, type Page } from "@playwright/test";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL is required for realtime E2E tests");
}

const REALTIME_WAIT_MS = 7_000;

function sql(query: string): string {
  return execSync(`psql "${DB_URL}" -At -v ON_ERROR_STOP=1`, {
    encoding: "utf8",
    input: query,
  }).trim();
}

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function bypassHeaders(): Record<string, string> {
  const v = process.env.TEST_RATE_LIMIT_BYPASS;
  const headers: Record<string, string> = {
    "x-device-id": `pw-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
  if (v) headers["x-test-bypass"] = v;
  return headers;
}

async function signupViaApi(
  baseURL: string,
  body: { email: string; password: string; referralCode?: string },
): Promise<string> {
  const ctx = await pwRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: bypassHeaders(),
  });
  try {
    const res = await ctx.post("/api/auth/signup", { data: body });
    if (!res.ok()) {
      throw new Error(
        `signup failed (${res.status()}) for ${body.email}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { user: { id: string } };
    await ctx.post("/api/auth/logout").catch(() => undefined);
    return json.user.id;
  } finally {
    await ctx.dispose();
  }
}

async function apiLogin(
  page: Page,
  endpoint: "/api/auth/login" | "/api/auth/agent-login",
  email: string,
  password: string,
): Promise<void> {
  const res = await page.request.post(endpoint, {
    data: { email, password },
    headers: bypassHeaders(),
  });
  if (!res.ok()) {
    throw new Error(
      `Login via ${endpoint} failed (${res.status()}): ${await res.text()}`,
    );
  }
}

test.describe("Realtime referral & bonus flows", () => {
  test("referee signup pushes realtime updates to referrer Promotions and agent Players", async ({
    browser,
    baseURL,
  }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const agentEmail = `agent+${suffix}@e2e-realtime.test`;
    const refereeEmail = `referee+${suffix}@e2e-realtime.test`;
    const refCode = `E2E${suffix.toUpperCase()}`;
    const password = "TestPass123!";

    sql(
      `DELETE FROM agents WHERE user_id IN (SELECT id FROM users WHERE email_normalized IN ('${agentEmail.toLowerCase()}', '${refereeEmail.toLowerCase()}'));
       DELETE FROM users WHERE email_normalized IN ('${agentEmail.toLowerCase()}', '${refereeEmail.toLowerCase()}');`,
    );

    const agentId = await signupViaApi(baseURL!, { email: agentEmail, password });
    const agentRowId = rid("agent");
    sql(
      `UPDATE users SET role='agent', referral_code='${refCode}' WHERE id='${agentId}';
       INSERT INTO agents (id, user_id, commission_rate, status) VALUES ('${agentRowId}', '${agentId}', 10, 'active');`,
    );

    const promoCtx = await browser.newContext();
    const agentCtx = await browser.newContext();

    try {
      const promoPage = await promoCtx.newPage();
      await apiLogin(promoPage, "/api/auth/login", agentEmail, password);
      await promoPage.goto("/promotions");
      const referCard = promoPage.getByTestId("card-refer-earn");
      await expect(referCard).toBeVisible();
      const friendsValue = referCard
        .locator("div", { has: promoPage.locator("text=Friends") })
        .last()
        .locator("..");
      // Sanity: the page initially shows 0 referred friends.
      await expect(referCard).toContainText("Friends");
      await expect(referCard).toContainText("0");

      const agentPage = await agentCtx.newPage();
      await apiLogin(agentPage, "/api/auth/agent-login", agentEmail, password);
      await agentPage.goto("/agent/players");
      await expect(
        agentPage.getByRole("heading", { name: "My Users" }),
      ).toBeVisible();
      await expect(agentPage.locator("body")).toContainText("(0 total)");

      const refereeId = await signupViaApi(baseURL!, {
        email: refereeEmail,
        password,
        referralCode: refCode,
      });

      // PROMO must auto-refresh via the bonus:{referrerId} push.
      await expect
        .poll(async () => referCard.locator(`[data-testid="row-referral-${refereeId}"]`).count(), {
          timeout: REALTIME_WAIT_MS,
          message: "Promotions page did not realtime-refresh after referee signup",
        })
        .toBeGreaterThan(0);
      await expect(
        referCard.locator(`[data-testid="row-referral-${refereeId}"]`),
      ).toContainText(/signed up/i);
      await expect(referCard).toContainText("Friends");
      await expect(friendsValue).toBeVisible();

      // AGENT players must auto-refresh via the agent:{userId} player_added push.
      await expect
        .poll(async () => (await agentPage.locator("body").innerText()).includes("(1 total)"), {
          timeout: REALTIME_WAIT_MS,
          message: "Agent players page did not realtime-refresh after referee signup",
        })
        .toBe(true);
      const escaped = refereeEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await expect(
        agentPage.getByRole("row", { name: new RegExp(escaped, "i") }),
      ).toBeVisible();
    } finally {
      await promoCtx.close();
      await agentCtx.close();
    }
  });

  test("bonus_credit_overflow event reaches admin Activity feed via realtime", async ({
    browser,
    baseURL,
  }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const adminEmail = `admin+${suffix}@e2e-realtime.test`;
    const depositorEmail = `depositor+${suffix}@e2e-realtime.test`;
    const password = "TestPass123!";
    const depositId = rid("e2eDep");

    sql(
      `DELETE FROM users WHERE email_normalized IN ('${adminEmail.toLowerCase()}', '${depositorEmail.toLowerCase()}');`,
    );

    const adminId = await signupViaApi(baseURL!, { email: adminEmail, password });
    const depositorId = await signupViaApi(baseURL!, {
      email: depositorEmail,
      password,
    });
    sql(`UPDATE users SET role='super_admin' WHERE id='${adminId}';`);

    // Force creditBonus to overflow when the deposit-tier bonus is applied.
    sql(
      `INSERT INTO bonus_wagering (user_id, total_issued, required_wager, wagered_so_far)
       VALUES ('${depositorId}', 9223372036854775000, 0, 0)
       ON CONFLICT (user_id) DO UPDATE SET total_issued = EXCLUDED.total_issued, required_wager = EXCLUDED.required_wager;
       UPDATE promotion_settings SET enabled = true,
         deposit_tiers = '[{"minPaise":"500000","maxPaise":"999999","bonusPaise":"100000"}]'::jsonb
         WHERE id = 'singleton';
       INSERT INTO payment_requests (id, user_id, kind, method, status, amount, currency, created_at)
       VALUES ('${depositId}', '${depositorId}', 'deposit', 'manual', 'pending', 600000, 'INR', NOW());`,
    );

    const adminCtx = await browser.newContext();
    try {
      const adminPage = await adminCtx.newPage();
      await apiLogin(adminPage, "/api/auth/login", adminEmail, password);
      await adminPage.goto("/admin/promotions");
      await adminPage.getByTestId("tab-activity").click();
      // Wait for the activity table to be present (header row shows "Type").
      await expect(adminPage.locator("body")).toContainText("Type");

      // Approve the pending deposit through a separate API context so the
      // browser cookie jar doesn't get touched and the only signal of update
      // is the realtime push.
      const apiCtx = await pwRequest.newContext({
        baseURL,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: bypassHeaders(),
      });
      try {
        const login = await apiCtx.post("/api/auth/login", {
          data: { email: adminEmail, password },
        });
        expect(login.ok()).toBeTruthy();
        const decision = await apiCtx.post(
          `/api/admin/deposits/${depositId}/decision`,
          { data: { decision: "approve" } },
        );
        expect(decision.ok()).toBeTruthy();
      } finally {
        await apiCtx.dispose();
      }

      // The admin:bonus-events realtime push must surface a row for our
      // depositor with type bonus_credit_overflow without manual reload.
      await expect
        .poll(
          async () => {
            const rows = adminPage.locator('[data-testid^="row-event-"]');
            const count = await rows.count();
            for (let i = 0; i < count; i += 1) {
              const text = (await rows.nth(i).innerText()).toLowerCase();
              if (
                text.includes("bonus_credit_overflow") &&
                text.includes(depositorId.toLowerCase())
              ) {
                return true;
              }
            }
            return false;
          },
          {
            timeout: REALTIME_WAIT_MS,
            message:
              "Admin Activity feed did not receive bonus_credit_overflow via realtime",
          },
        )
        .toBe(true);
    } finally {
      await adminCtx.close();
      // Cleanup so subsequent test runs aren't affected.
      sql(
        `UPDATE bonus_wagering SET total_issued = 0, required_wager = 0 WHERE user_id = '${depositorId}';
         UPDATE promotion_settings SET deposit_tiers = '[]'::jsonb WHERE id = 'singleton';`,
      );
    }
  });
});
