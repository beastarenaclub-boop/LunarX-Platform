import { test, expect, type Page } from "@playwright/test";
import {
  connectedAuth,
  browserConnected,
  fixtureLocation,
} from "./location-fixture";
import {
  VISITOR_CONSENT,
  VISITOR_CONSENT_VERSION,
} from "../src/live/visitor-types";

import {
  cameraFixture,
  openCamera,
  capture,
  removeVisitor,
} from "./visitor-fixture";

test.afterEach(async ({ page }) => {
  await removeVisitor(page.request);
});

test("consented camera preview saves private visitor records; admin review and both delete flows work", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  const admin = await connectedAuth(request, {
    "oai-authenticated-user-id": "qa-admin",
    "oai-authenticated-user-email": "qa-admin@test.invalid",
  });
  await cameraFixture(page);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/visitors/check-in"))
      writes.push(r.url());
  });
  await page.goto("/");
  expect(await page.evaluate(() => window.visitorCameraTest.calls)).toBe(0);
  await openCamera(page);
  await expect(
    page.getByRole("button", { name: "Enable camera & location" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.visitorCameraTest.calls)).toBe(0);
  const name = "Camera QA " + crypto.randomUUID().slice(0, 8);
  await page.getByLabel("Name (optional)").fill(name);
  await capture(page);
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save visitor check-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Check-in saved" }),
  ).toBeVisible();
  const receipt = (await (await page.request.get("/api/visitors/mine")).json())
    .saved;
  expect(receipt.id).toBeTruthy();
  const list = await (
    await request.get("/api/visitors", { headers: admin })
  ).json();
  const row = list.records.find((r: any) => r.id === receipt.id);
  expect(row.name).toBe(name);
  expect(row.object_key).toBeUndefined();
  expect(row.session_hash).toBeUndefined();
  expect(row.consent_version).toBe(VISITOR_CONSENT_VERSION);
  expect(JSON.parse(row.location)).toMatchObject({
    latitude: 26.91,
    longitude: 75.79,
    source: "Browser-reported location",
  });
  expect(row.ip).toBeTruthy();
  expect(row.user_agent).toContain("Chrome");
  const photo = `/api/visitors/${receipt.id}/photo`;
  expect((await page.request.get(photo)).status()).toBe(401);
  const adminPhoto = await request.get(photo, { headers: admin });
  expect(adminPhoto.status()).toBe(200);
  expect(adminPhoto.headers()["content-type"]).toBe("image/jpeg");
  expect(adminPhoto.headers()["cache-control"]).toContain("no-store");
  const snapshot = await (
    await request.get("/api/state", { headers: admin })
  ).json();
  const member = snapshot.members.find(
    (m: any) => m.role !== "admin" && /^qa-[abcd]-/.test(m.name),
  );
  expect(member).toBeTruthy();
  const memberHeaders = await connectedAuth(request, {
    "oai-authenticated-user-id": member.name,
    "oai-authenticated-user-email": member.email,
  });
  expect(
    (await request.get("/api/visitors", { headers: memberHeaders })).status(),
  ).toBe(403);
  expect((await request.get(photo, { headers: memberHeaders })).status()).toBe(
    403,
  );
  const adminContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5201",
    viewport: { width: 1440, height: 1050 },
  });
  try {
    const adminPage = await adminContext.newPage();
    await browserConnected(adminPage, admin);
    await adminPage.route("http://127.0.0.1:5201/**", (route) =>
      route.continue({
        headers: { ...route.request().headers(), ...admin },
      }),
    );
    await adminPage.goto("/admin/dashboard");
    await adminPage
      .getByRole("button", { name: "Visitor check-ins", exact: true })
      .click();
    const visitorRow = adminPage.getByRole("row").filter({ hasText: name });
    await visitorRow
      .getByRole("button", { name: "View photo & details" })
      .click();
    await expect(
      adminPage.getByAltText(`Consented visitor photo: ${name}`),
    ).toBeVisible();
    await expect
      .poll(() =>
        adminPage
          .getByAltText(`Consented visitor photo: ${name}`)
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(320);
    await adminPage.screenshot({
      path: "test-results/visitor-admin-review.png",
      fullPage: true,
    });
    await adminPage.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Delete my check-in" }).click();
    await expect(
      page.getByRole("heading", { name: "Check-in saved" }),
    ).toHaveCount(0);
    expect((await request.get(photo, { headers: admin })).status()).toBe(404);
    await capture(page);
    await page.getByRole("button", { name: "Save visitor check-in" }).click();
    await expect(
      page.getByRole("heading", { name: "Check-in saved" }),
    ).toBeVisible();
    const second = (await (await page.request.get("/api/visitors/mine")).json())
      .saved;
    await adminPage.getByRole("button", { name: "Refresh visitors" }).click();
    await adminPage
      .getByRole("button", { name: `Delete visitor ${second.id}`, exact: true })
      .click();
    await adminPage
      .getByRole("button", { name: "Delete photo & record", exact: true })
      .click();
    await expect(
      adminPage.getByRole("button", {
        name: `Delete visitor ${second.id}`,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(`/api/visitors/${second.id}/photo`, {
          headers: admin,
        })
      ).status(),
    ).toBe(404);
  } finally {
    await removeVisitor(adminContext.request);
    await adminContext.close();
  }
});

test("denied camera and closing a preview never save a photo; late camera responses are stopped", async ({
  page,
}) => {
  await cameraFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    window.visitorCameraTest.deny = true;
  });
  await openCamera(page);
  await page.getByRole("checkbox", { name: VISITOR_CONSENT }).check();
  await page.getByRole("button", { name: "Enable camera & location" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera permission was denied",
  );
  expect(
    (await (await page.request.get("/api/visitors/mine")).json()).saved,
  ).toBeNull();
  await page.evaluate(() => {
    window.visitorCameraTest.deny = false;
  });
  await page.getByRole("button", { name: "Enable camera & location" }).click();
  await expect(
    page.getByRole("button", { name: "Capture photo", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(
    await page.evaluate(() =>
      window.visitorCameraTest.tracks.every(
        (track) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await openCamera(page);
  await page.evaluate(() => {
    window.visitorCameraTest.late = true;
  });
  await page.getByRole("checkbox", { name: VISITOR_CONSENT }).check();
  await page.getByRole("button", { name: "Enable camera & location" }).click();
  await expect
    .poll(() => page.evaluate(() => !!window.visitorCameraTest.release))
    .toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => window.visitorCameraTest.release!());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.visitorCameraTest.tracks.every(
          (track) => track.readyState === "ended",
        ),
      ),
    )
    .toBe(true);
  expect(
    (await (await page.request.get("/api/visitors/mine")).json()).saved,
  ).toBeNull();
});

test("public upload rejects missing consent, forged sessions, stale location and invalid photos", async ({
  request,
}) => {
  expect(
    (await request.post("/api/visitors/start", { data: {} })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/visitors/start", {
        headers: { Origin: "https://other.invalid" },
        data: { consent: true, version: VISITOR_CONSENT_VERSION },
      })
    ).status(),
  ).toBe(403);
  const forged = await request.post("/api/visitors/check-in", {
    headers: { Cookie: "syndicate_visitor=" + "f".repeat(64) },
    multipart: { consent: "true" },
  });
  expect(forged.status(), await forged.text()).toBe(403);
  expect(
    (
      await request.post("/api/visitors/start", {
        data: { consent: true, version: VISITOR_CONSENT_VERSION },
      })
    ).status(),
  ).toBe(200);
  const base = {
    version: VISITOR_CONSENT_VERSION,
    location: JSON.stringify(fixtureLocation()),
    photo: {
      name: "fake.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not a photo"),
    },
  };
  expect(
    (
      await request.post("/api/visitors/check-in", { multipart: base })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/visitors/check-in", {
        multipart: { ...base, consent: "true" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/visitors/check-in", {
        multipart: {
          ...base,
          consent: "true",
          location: JSON.stringify({
            ...fixtureLocation(),
            capturedAt: Date.now() - 180000,
          }),
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/visitors/check-in", {
        multipart: {
          ...base,
          consent: "true",
          photo: {
            name: "large.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.alloc(800 * 1024),
          },
        },
      })
    ).status(),
  ).toBe(413);
  expect(
    (await (await request.get("/api/visitors/mine")).json()).saved,
  ).toBeNull();
});
