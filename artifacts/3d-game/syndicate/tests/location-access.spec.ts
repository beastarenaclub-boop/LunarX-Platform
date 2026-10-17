import { test, expect, completeEntry } from "./entry-fixture";
import {
  connectedAuth,
  fixtureLocation,
  browserLocation,
} from "./location-fixture";
import { QUICK_BANKS } from "../src/live/banks";

const adminHeaders = {
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

test("all role logins stop before credentials are sent when location is denied", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5201",
    permissions: [],
  });
  await completeEntry(context.request);
  try {
    await context.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) =>
        error?.({ code: 1, message: "Denied" } as GeolocationPositionError);
    });
    const page = await context.newPage();
    let sent = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/auth/login")) sent++;
    });
    for (const role of ["admin", "agent", "member"]) {
      await page.goto(`/${role}/login`);
      await page.getByLabel("Email address").fill("location-qa@test.invalid");
      await page
        .getByLabel("Password", { exact: true })
        .fill("Location-QA-password");
      await expect(
        page.getByText("Location required", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("I agree to share my location to access this portal.")
        .check();
      await page.getByRole("button", { name: "Sign in to portal" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Location permission was denied",
      );
      expect(
        (await context.cookies()).some((c) => c.name === "syndicate_session"),
      ).toBe(false);
    }
    expect(sent).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/location-denied-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("unavailable and timed-out location can be retried without logging in", async ({
  page,
}) => {
  for (const [code, message] of [
    [2, "could not be obtained"],
    [3, "timed out"],
  ] as const) {
    await page.goto("/member/login");
    await page.evaluate((code) => {
      navigator.geolocation.getCurrentPosition = (_success, error) =>
        error?.({ code, message: "QA" } as GeolocationPositionError);
    }, code);
    await page.getByLabel("Email address").fill("location-qa@test.invalid");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Location-QA-password");
    await page
      .getByLabel("I agree to share my location to access this portal.")
      .check();
    await page.getByRole("button", { name: "Sign in to portal" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(
      page.getByRole("button", { name: "Sign in to portal" }),
    ).toBeEnabled();
    expect((await page.request.get("/api/state")).status()).toBe(401);
  }
});

test("backend rejects missing, stale and invalid positions; successful login records location and revocation signs out", async ({
  browser,
  request,
}) => {
  const headers = await connectedAuth(request, adminHeaders);
  const admin = await (await request.get("/api/state", { headers })).json();
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((c: any) => c.parent === m.id),
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5201",
    ...browserLocation,
    extraHTTPHeaders: network(),
  });
  await completeEntry(context.request);
  const email = `location-${crypto.randomUUID()}@test.invalid`,
    password = "Geo-" + crypto.randomUUID();
  try {
    for (const location of [
      undefined,
      { ...fixtureLocation(), consent: false },
      { ...fixtureLocation(), latitude: 95 },
      { ...fixtureLocation(), accuracy: -1 },
      { ...fixtureLocation(), longitude: "75.78" },
      { ...fixtureLocation(), capturedAt: Date.now() - 180000 },
      { ...fixtureLocation(), capturedAt: Date.now() + 90000 },
    ]) {
      const response = await context.request.post("/api/auth/signup", {
        data: { name: "Location QA", email, password, location },
      });
      expect(response.status(), await response.text()).toBe(428);
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    const signup = await context.request.post("/api/auth/signup", {
      data: {
        name: "Location QA",
        email,
        password,
        location: fixtureLocation(),
      },
    });
    expect(signup.status(), await signup.text()).toBe(200);
    const recoveryCode = (await signup.json()).recoveryCode;
    const registered = await context.request.post("/api/register", {
      data: {
        name: "Location QA",
        city: "QA city",
        ref: sponsor.ref,
        banks: QUICK_BANKS,
      },
    });
    expect(registered.status()).toBe(200);
    const changed = await context.request.post("/api/auth/change-password", {
      data: { currentPassword: password, password: "Blocked-" + password },
    });
    expect(changed.status()).toBe(428);
    await context.request.post("/api/auth/logout", { data: {} });
    for (const action of ["login", "recover"]) {
      const response = await context.request.post("/api/auth/" + action, {
        data: { email, password, recoveryCode },
      });
      expect(response.status()).toBe(428);
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    const page = await context.newPage();
    await page.goto("/member/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByLabel("I agree to share my location to access this portal.")
      .check();
    await page.getByRole("button", { name: "Sign in to portal" }).click();
    await expect(page).toHaveURL(/\/member\/dashboard$/);
    const state = await (await context.request.get("/api/state")).json();
    const entry = state.audit.find((a: any) => a.action === "Login location");
    expect(JSON.parse(entry.location)).toMatchObject({
      latitude: 26.91,
      longitude: 75.79,
      accuracy: 80,
      source: "Browser-reported location",
    });
    const adminState = await (
      await request.get("/api/state", { headers })
    ).json();
    expect(adminState.audit.some((a: any) => a.id === entry.id)).toBe(true);
    await context.clearPermissions();
    await expect(
      page.getByRole("button", { name: "Sign in to portal" }),
    ).toBeVisible();
    expect((await context.request.get("/api/state")).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test("connected sign-in also requires a location grant bound to the identity", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5201",
    ...browserLocation,
    extraHTTPHeaders: adminHeaders,
  });
  await completeEntry(context.request);
  try {
    expect((await context.request.get("/api/state")).status()).toBe(428);
    expect(
      (
        await context.request.post("/api/workspace", {
          data: { company: "Blocked" },
        })
      ).status(),
    ).toBe(428);
    const page = await context.newPage();
    await page.goto("/admin/login");
    await expect(
      page.getByRole("heading", { name: "Location access required." }),
    ).toBeVisible();
    await page
      .getByLabel("I agree to share my location to access this portal.")
      .check();
    await page
      .getByRole("button", { name: "Allow location and continue" })
      .click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    expect(
      (
        await context.request.get("/api/state", {
          headers: {
            "oai-authenticated-user-id": "another-connected-identity",
          },
        })
      ).status(),
    ).toBe(428);
    await context.request.post("/api/auth/logout", { data: {} });
    expect((await context.request.get("/api/state")).status()).toBe(428);
  } finally {
    await context.close();
  }
});
