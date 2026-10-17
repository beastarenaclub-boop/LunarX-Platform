import { browserConnected } from "./location-fixture";
import {
  connectedAuth,
  fixtureLocation,
  browserLocation,
} from "./location-fixture";
import { type BrowserContext, type APIRequestContext } from "@playwright/test";
import { test, expect, completeEntry } from "./entry-fixture";
import { QUICK_BANKS } from "../src/live/banks";
import { DOCUMENT_KINDS } from "../src/live/types";

const baseURL = "http://127.0.0.1:5201";
const rawAdminHeaders = {
  "oai-authenticated-user-id": "qa-admin",
  "oai-authenticated-user-email": "qa-admin@test.invalid",
};
const network = () => ({
  "cf-connecting-ip":
    "2001:db8:" +
    crypto
      .randomUUID()
      .replaceAll("-", "")
      .match(/.{4}/g)!
      .slice(0, 6)
      .join(":"),
});
async function post(
  request: APIRequestContext,
  path: string,
  data: any,
  status = 200,
  headers = {},
) {
  if (path.startsWith("auth/") && path !== "auth/logout")
    data = { ...data, location: fixtureLocation() };
  const response = await request.post("/api/" + path, { data, headers });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test("three role logins, member-only signup and no admin or agent registration", async ({
  page,
}) => {
  for (const portal of ["admin", "agent", "member"]) {
    const label = portal[0].toUpperCase() + portal.slice(1);
    await page.goto("/" + portal + "/login");
    await expect(
      page.getByRole("heading", { name: label + " login.", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create account", exact: true }),
    ).toHaveCount(portal === "member" ? 1 : 0);
    await expect(page.getByLabel("Admin invitation code")).toHaveCount(0);
  }
  for (const path of ["/admin/signup", "/agent/signup"])
    expect((await page.request.get(path)).status()).toBe(404);
  await page.goto("/member/signup");
  await expect(
    page.getByRole("heading", { name: "Member signup." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create my login" }),
  ).toBeVisible();
  await page.goto("/login");
  for (const role of ["Admin", "Agent", "Member"])
    await expect(
      page.getByRole("link", { name: role + " login", exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Member signup", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Admin signup|Agent signup/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/portal-member-only-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "test-results/portal-member-only-desktop.png",
    fullPage: true,
  });
});

test("admin and agent signup APIs and historical invitations cannot grant privileges", async ({
  page,
  request,
  browser,
}) => {
  const adminHeaders = await connectedAuth(request, rawAdminHeaders);
  await browserConnected(page, adminHeaders);
  await page.route(baseURL + "/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...adminHeaders },
    }),
  );
  await page.goto("/admin/dashboard");
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Administrator access", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create admin invitation" }),
  ).toHaveCount(0);
  await post(
    request,
    "admin-invitations",
    { email: "disabled@test.invalid" },
    410,
    adminHeaders,
  );
  const admin = await (
    await request.get("/api/state", { headers: adminHeaders })
  ).json();
  expect(admin.adminInvitations).toBeUndefined();
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((n: any) => n.parent === m.id),
  );
  const guest = await browser.newContext({
    baseURL,
    ...browserLocation,
    extraHTTPHeaders: network(),
  });
  try {
    await completeEntry(guest.request);
    const email = "member-only-" + crypto.randomUUID() + "@test.invalid";
    const password = "Member-" + crypto.randomUUID();
    for (const portal of ["admin", "agent"])
      await post(
        guest.request,
        "auth/signup",
        {
          portal,
          email,
          password,
          name: "Member Only QA",
          invite: "a".repeat(64),
        },
        403,
      );
    await post(guest.request, "auth/signup", {
      email,
      password,
      name: "Member Only QA",
      role: "admin",
      signup_portal: "admin",
      invite: "a".repeat(64),
    });
    await post(guest.request, "register", {
      name: "Member Only QA",
      city: "QA city",
      ref: sponsor.ref,
      banks: QUICK_BANKS,
      role: "admin",
      portal: "admin",
      owned: true,
    });
    const member = await (await guest.request.get("/api/state")).json();
    expect(member.me.role).toBe("user");
    expect(member.identity.signupPortal).toBe("member");
    await post(
      guest.request,
      "admin-invitations",
      { email: "blocked@test.invalid" },
      403,
    );
    await post(guest.request, "auth/logout", {});
    await post(
      guest.request,
      "auth/login",
      { email, password, portal: "admin" },
      403,
    );
    await post(
      guest.request,
      "auth/login",
      { email, password, portal: "agent" },
      403,
    );
  } finally {
    await guest.close();
  }
});

test("member checklist and both direct approvals unlock agent access on the same ID", async ({
  request,
  browser,
}) => {
  test.setTimeout(150000);
  const adminHeaders = await connectedAuth(request, rawAdminHeaders);
  const contexts: BrowserContext[] = [];
  const admin = await (
    await request.get("/api/state", { headers: adminHeaders })
  ).json();
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((c: any) => c.parent === m.id),
  );
  const create = async (ref: string, portal = "member") => {
    const ctx = await browser.newContext({
      ...browserLocation,
      baseURL,
      extraHTTPHeaders: network(),
    });
    await completeEntry(ctx.request);
    contexts.push(ctx);
    const email = `${portal}-${crypto.randomUUID()}@test.invalid`,
      password = "Role-" + crypto.randomUUID();
    await post(ctx.request, "auth/signup", {
      name: "Agent QA",
      email,
      password,
      portal,
    });
    await post(ctx.request, "register", {
      name: "Agent QA",
      city: "QA city",
      ref,
      banks: QUICK_BANKS,
      role: "admin",
      portal: "admin",
      owned: true,
    });
    return {
      ctx,
      email,
      password,
      state: await (await ctx.request.get("/api/state")).json(),
    };
  };
  const complete = async (ctx: BrowserContext) => {
    let state = await (await ctx.request.get("/api/state")).json();
    const profile = {
      firm: "QA Merchant",
      gst: "27ABCDE1234F1Z5",
      contacts: [
        { label: "One", last4: "1234" },
        { label: "Two", last4: "5678" },
      ],
      ownership: true,
      consent: true,
      accounts: Array.from({ length: 7 }, (_, i) => ({
        id: crypto.randomUUID(),
        bank: QUICK_BANKS[i % 5],
        type: i < 5 ? "Current" : "Savings",
        last4: String(3100 + i),
        holder: "QA Merchant",
        contact: i % 2,
        requestedLimit: i < 5 ? 5000000 : 0,
        approvedLimit: 0,
        status: "Pending",
        owned: true,
      })),
    };
    await post(ctx.request, "profile", {
      profile,
      revision: state.me.revision,
    });
    for (const kind of [
      ...DOCUMENT_KINDS,
      ...profile.accounts.map((a) => a.id),
    ]) {
      const account = profile.accounts.find((a) => a.id === kind),
        video = kind === "Video KYC";
      const uploaded = await ctx.request.post("/api/documents", {
        multipart: {
          kind: account ? "Bank account proof" : kind,
          ...(account ? { accountId: account.id } : {}),
          file: {
            name: video ? "qa.mp4" : "qa.pdf",
            mimeType: video ? "video/mp4" : "application/pdf",
            buffer: video
              ? Buffer.from([
                  0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0,
                  0,
                ])
              : Buffer.from("%PDF-1.4\n%%EOF"),
          },
        },
      });
      expect(uploaded.status(), await uploaded.text()).toBe(200);
    }
    state = await (await ctx.request.get("/api/state")).json();
    await post(ctx.request, "submit-profile", { revision: state.me.revision });
    state = await (await ctx.request.get("/api/state")).json();
    await post(
      request,
      "review-profile",
      {
        member: state.me.id,
        revision: state.me.revision,
        decision: "approve",
        note: "QA reviewed",
        limits: Object.fromEntries(
          profile.accounts
            .filter((a) => a.type === "Current")
            .map((a) => [a.id, 5000000]),
        ),
      },
      200,
      adminHeaders,
    );
  };
  try {
    const applicant = await create(sponsor.ref);
    expect(applicant.state.me.role).toBe("user");
    expect(applicant.state.identity.signupPortal).toBe("member");
    await post(
      applicant.ctx.request,
      "admin-invitations",
      { email: "blocked@test.invalid" },
      403,
    );
    const page = await applicant.ctx.newPage();
    await page.goto("/member/dashboard");
    await expect(
      page.getByRole("heading", {
        name: "Your path to Syndicate Agent.",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Agent eligibility", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Mandatory member tasks" }),
    ).toBeVisible();
    await expect(
      page.getByText("Five business current account references", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Two registered SIM / contact references", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Two savings account references", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Video KYC", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Agent eligibility progress" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await page.screenshot({
      path: "test-results/member-agent-path-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page
          .locator(".live-sidebar")
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("button", { name: "Agent eligibility", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".live-sidebar")
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/member-agent-path-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await post(applicant.ctx.request, "auth/logout", {});
    await post(
      applicant.ctx.request,
      "auth/login",
      { email: applicant.email, password: applicant.password, portal: "agent" },
      403,
    );
    expect((await applicant.ctx.request.get("/api/state")).status()).toBe(401);
    await post(applicant.ctx.request, "auth/login", {
      email: applicant.email,
      password: applicant.password,
      portal: "member",
    });
    const left = await create(applicant.state.me.ref),
      right = await create(applicant.state.me.ref);
    await complete(applicant.ctx);
    await complete(left.ctx);
    expect(
      (await (await applicant.ctx.request.get("/api/state")).json()).me.role,
    ).toBe("user");
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(
      page.getByText("2 / 3 verification seals approved", { exact: true }),
    ).toBeVisible();
    expect(
      Number(
        await page
          .getByRole("progressbar", { name: "Agent eligibility progress" })
          .getAttribute("aria-valuenow"),
      ),
    ).toBeLessThan(100);
    await complete(right.ctx);
    expect(
      (await (await applicant.ctx.request.get("/api/state")).json()).me.role,
    ).toBe("agent");
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page).toHaveURL(baseURL + "/agent/dashboard");
    await expect(
      page.getByRole("heading", { name: "Your agent access is unlocked." }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Agent eligibility progress" }),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(
      (await (await applicant.ctx.request.get("/api/state")).json()).me.id,
    ).toBe(applicant.state.me.id);
    await post(applicant.ctx.request, "auth/logout", {});
    await post(applicant.ctx.request, "auth/login", {
      email: applicant.email,
      password: applicant.password,
      portal: "member",
    });
    await page.goto("/agent/login");
    await expect(page).toHaveURL(baseURL + "/agent/dashboard");
    await expect(page.locator(".brand small")).toHaveText("AGENT PANEL");
    await expect(
      page.getByRole("button", { name: "Members & documents", exact: true }),
    ).toHaveCount(0);
    await post(
      applicant.ctx.request,
      "auth/login",
      { email: applicant.email, password: applicant.password, portal: "admin" },
      403,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
