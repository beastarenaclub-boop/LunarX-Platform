import { test, expect } from "@playwright/test";
import { cameraFixture, solveTriangle } from "./visitor-fixture";
import { VISITOR_CONSENT } from "../src/live/visitor-types";

test("entry reaches login without requesting a camera or creating a visitor record", async ({
  page,
}) => {
  await cameraFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const visitorRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/visitors/"))
      visitorRequests.push(request.url());
  });
  await page.goto("/");
  await page.evaluate(() => {
    window.visitorCameraTest.deny = true;
  });
  await solveTriangle(page);
  await expect(
    page.getByRole("heading", { name: "Every lock has a secret." }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Visitor camera check-in" }),
  ).toHaveCount(0);
  for (const spot of ["lantern alcove", "cracked stone", "stone pedestal"]) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/entry/search")),
      page.getByRole("button", { name: `Search ${spot}`, exact: true }).click(),
    ]);
    if ((await response.json()).found) break;
  }
  await page.getByRole("button", { name: "Pick up the hidden key" }).click();
  await page
    .getByRole("button", { name: "Unlock the gate with the key" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Choose your panel." }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.visitorCameraTest.calls)).toBe(0);
  expect(visitorRequests).toEqual([]);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "syndicate_visitor",
    ),
  ).toBe(false);
});

test("optional camera denial can be dismissed and never blocks the gate", async ({
  page,
}) => {
  await cameraFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open visitor camera check-in" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Visitor camera check-in" });
  await expect(dialog).toContainText("Photo check-in is optional");
  expect(await page.evaluate(() => window.visitorCameraTest.calls)).toBe(0);
  await page.getByRole("checkbox", { name: VISITOR_CONSENT }).check();
  await page.evaluate(() => {
    window.visitorCameraTest.deny = true;
  });
  await page.getByRole("button", { name: "Enable camera & location" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera permission was denied",
  );
  await expect(
    page.getByRole("img", { name: "Eye check-in complete" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue without camera check-in" })
    .click();
  await expect(dialog).toHaveCount(0);
  await solveTriangle(page);
  await expect(
    page.getByRole("heading", { name: "Every lock has a secret." }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/visitors/mine")).json()).saved,
  ).toBeNull();
});
