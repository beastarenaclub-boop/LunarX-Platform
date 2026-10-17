import {
  connectedAuth,
  fixtureLocation,
  browserLocation,
} from "./location-fixture";
import { test, expect, completeEntry } from "./entry-fixture";

// Each loopback QA run has its own edge-IP fixture, so previous runs cannot exhaust its login quota.
const fixtureHeaders = {
  "cf-connecting-ip":
    "2001:db8:" +
    crypto
      .randomUUID()
      .replaceAll("-", "")
      .match(/.{4}/g)!
      .slice(0, 6)
      .join(":"),
};
test.use({ extraHTTPHeaders: fixtureHeaders });

test("real email login, member signup, logout, password recovery and session invalidation", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  const adminHeaders = await connectedAuth(request, {
    "oai-authenticated-user-id": "qa-admin",
    "oai-authenticated-user-email": "qa-admin@test.invalid",
  });
  const admin = await (
    await request.get("/api/state", { headers: adminHeaders })
  ).json();
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((n: any) => n.parent === m.id),
  );
  const email = `member-${Date.now()}@test.invalid`,
    password = `Qa-${crypto.randomUUID()}`;
  await page.goto("/signup?ref=" + sponsor.ref);
  await expect(
    page.getByRole("button", { name: "Create my login" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Admin Oversee, review & approve" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Your name", { exact: true })
    .fill("Password QA Member");
  // Clicking the active signup tab must preserve fields and the referral URL.
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByLabel("I agree to share my location to access this portal.")
    .check();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(
    "Password QA Member",
  );
  await page.getByRole("button", { name: "Create my login" }).click();
  const recovery = page.getByLabel("Your recovery code", { exact: true });
  await expect(recovery).toBeVisible();
  const code = await recovery.inputValue();
  expect(code).toHaveLength(64);
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "syndicate_session",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  await page.getByLabel("I have saved my recovery code privately.").check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await page.getByLabel("City", { exact: true }).fill("QA city");
  await expect(page.getByLabel("Referrer ID", { exact: true })).toHaveValue(
    sponsor.ref,
  );
  await page.getByLabel("Referrer ID", { exact: true }).fill("SYN-NOTFOUND");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("Referral ID not found.");
  await page.getByLabel("Referrer ID", { exact: true }).fill(sponsor.ref);
  await page.getByLabel("Current bank preference 1").selectOption("YES Bank");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Password." }),
  ).toBeVisible();
  const member = await (await page.request.get("/api/state")).json();
  expect(member.me.role).toBe("user");
  expect(member.identity.passwordLogin).toBe(true);
  expect(JSON.stringify(member)).not.toContain("password_hash");
  expect(JSON.stringify(member)).not.toContain("recovery_hash");
  expect(member.me.profile.bankPreferences[0]).toBe("YES Bank");
  await expect(page).toHaveURL("http://127.0.0.1:5201/member/dashboard");
  await page.goto("/signup?ref=" + sponsor.ref);
  await expect(
    page.getByRole("heading", { name: "Create another member account." }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/state")).json()).me.id).toBe(
    member.me.id,
  );
  await page.getByRole("link", { name: "Return to my dashboard" }).click();
  const forbidden = await page.request.post("/api/workspace", {
    data: { company: "Hijack", business: "No", license: "No" },
  });
  expect(forbidden.status()).toBe(403);
  await page.getByRole("button", { name: "Portal guide", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your portal guide" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in to portal" }),
  ).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(401);
  await page.getByLabel("Email address").fill(email.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByLabel("I agree to share my location to access this portal.")
    .check();
  await page.getByRole("button", { name: "Sign in to portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Password." }),
  ).toBeVisible();
  // A second browser can sign in; recovering the password invalidates both old sessions.
  const second = await browser.newContext({
    ...browserLocation,
    baseURL: "http://127.0.0.1:5201",
    extraHTTPHeaders: fixtureHeaders,
  });
  await completeEntry(second.request);
  try {
    expect(
      (
        await second.request.post("/api/auth/login", {
          data: { location: fixtureLocation(), email, password },
        })
      ).status(),
    ).toBe(200);
    const newPassword = `Updated-${crypto.randomUUID()}`;
    const reset = await request.post("/api/auth/recover", {
      data: {
        location: fixtureLocation(),
        email,
        recoveryCode: code,
        password: newPassword,
      },
    });
    expect(reset.status(), await reset.text()).toBe(200);
    const resetBody = await reset.json();
    expect(resetBody.recoveryCode).not.toBe(code);
    expect((await page.request.get("/api/state")).status()).toBe(401);
    expect((await second.request.get("/api/state")).status()).toBe(401);
    expect(
      (
        await second.request.post("/api/auth/recover", {
          data: {
            location: fixtureLocation(),
            email,
            recoveryCode: code,
            password,
          },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await second.request.post("/api/auth/login", {
          data: { location: fixtureLocation(), email, password },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await second.request.post("/api/auth/login", {
          data: { location: fixtureLocation(), email, password: newPassword },
        })
      ).status(),
    ).toBe(200);
    expect((await (await second.request.get("/api/state")).json()).me.id).toBe(
      member.me.id,
    );
    const changed = await second.request.post("/api/auth/change-password", {
      data: {
        location: fixtureLocation(),
        currentPassword: newPassword,
        password: `Final-${crypto.randomUUID()}`,
      },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    expect((await request.get("/api/state")).status()).toBe(401);
  } finally {
    await second.close();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in to portal" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/password-login-mobile.png",
    animations: "disabled",
  });
});

test("email login rejects cross-origin writes, fake preview identity and repeated guesses", async ({
  request,
}) => {
  const email = `locked-${Date.now()}@test.invalid`;
  expect(
    (
      await request.post("/api/auth/login", {
        headers: { Origin: "https://unrelated.invalid" },
        data: { location: fixtureLocation(), email, password: "anything" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("http://127.0.0.1:5198/api/state", {
        headers: { Cookie: "__sites_local_auth=1" },
      })
    ).status(),
  ).toBe(401);
  for (let i = 0; i < 12; i++)
    expect(
      (
        await request.post("/api/auth/login", {
          data: { location: fixtureLocation(), email, password: "wrong" },
        })
      ).status(),
    ).toBe(401);
  expect(
    (
      await request.post("/api/auth/login", {
        data: { location: fixtureLocation(), email, password: "wrong" },
      })
    ).status(),
  ).toBe(429);
});
