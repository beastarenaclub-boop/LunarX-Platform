import { test, expect } from "@playwright/test";
import { entryDestination } from "../src/live/entry-destination";
import { cameraFixture, removeVisitor } from "./visitor-fixture";

test.afterEach(async ({ page, request }) => {
  await removeVisitor(page.request);
  await removeVisitor(request);
});

test("server rejects forged grants, direct authentication and skipped game stages", async ({
  request,
}) => {
  for (const action of ["login", "signup", "recover"]) {
    const response = await request.post("/api/auth/" + action, {
      headers: { Cookie: "syndicate_entry=" + "a".repeat(64) },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toContain("Complete the triangle");
  }
  expect(
    (
      await request.post("/api/entry/start", {
        headers: { Origin: "https://another.invalid" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await request.post("/api/entry/unlock", { data: {} })).status()).toBe(
    403,
  );
  expect((await request.post("/api/entry/start", { data: {} })).status()).toBe(
    200,
  );
  for (const action of ["arrive", "search", "pickup", "unlock"]) {
    expect(
      (
        await request.post("/api/entry/" + action, { data: { spot: 0 } })
      ).status(),
    ).toBe(403);
  }
  expect(
    (
      await request.post("/api/entry/puzzle", { data: { angles: [0, 1, 0] } })
    ).status(),
  ).toBe(403);
  // No camera receipt or visitor cookie is needed to play the game.
  const puzzle = await request.post("/api/entry/puzzle", {
    data: { angles: [0, 0, 0] },
  });
  expect(puzzle.status()).toBe(200);
  expect((await request.post("/api/entry/arrive", { data: {} })).status()).toBe(
    403,
  );
  const { walkAfter } = await puzzle.json();
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, walkAfter - Date.now()) + 50),
  );
  expect((await request.post("/api/entry/arrive", { data: {} })).status()).toBe(
    200,
  );
  expect((await request.post("/api/entry/pickup", { data: {} })).status()).toBe(
    403,
  );
  for (let spot = 0; spot < 3; spot++) {
    const result = await request.post("/api/entry/search", { data: { spot } });
    expect(result.status()).toBe(200);
    if ((await result.json()).found) break;
  }
  expect((await request.post("/api/entry/unlock", { data: {} })).status()).toBe(
    403,
  );
  expect((await request.post("/api/entry/pickup", { data: {} })).status()).toBe(
    200,
  );
  expect((await request.get("/login", { maxRedirects: 0 })).status()).toBe(307);
  expect((await request.post("/api/entry/unlock", { data: {} })).status()).toBe(
    200,
  );
  expect((await request.get("/login", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get("/api/state")).status()).toBe(401);
  // Entry does not bypass the existing mandatory location requirement.
  expect((await request.post("/api/auth/login", { data: {} })).status()).toBe(
    428,
  );
  await removeVisitor(request);
  expect((await request.get("/login", { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.post("/api/auth/login", { data: {} })).status()).toBe(
    428,
  );
  await request.post("/api/entry/start", { data: {} });
  expect(
    (await request.get("/member/login", { maxRedirects: 0 })).status(),
  ).toBe(307);
});

test("referral destination survives the game and a failed step can be retried", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await cameraFixture(page);
  await page.goto("/member/signup?ref=SYN-KEPT");
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    "/member/signup?ref=SYN-KEPT",
  );
  await page.route("**/api/entry/puzzle", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Connection interrupted. Please retry." }),
    });
    await page.unroute("**/api/entry/puzzle");
  });
  for (const [part, turns] of [
    ["upper", 2],
    ["left", 1],
    ["right", 2],
  ] as const) {
    for (let n = 0; n < turns; n++)
      await page
        .getByRole("button", { name: `Rotate ${part} triangle fragment` })
        .click();
  }
  await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  expect((await page.request.get("/login", { maxRedirects: 0 })).status()).toBe(
    307,
  );
  await page.getByRole("button", { name: "Retry step" }).click();
  await expect(
    page.getByRole("heading", { name: "Every lock has a secret." }),
  ).toBeVisible();
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
  await expect(page).toHaveURL(/\/member\/signup\?ref=SYN-KEPT$/);
  await expect(
    page.getByRole("heading", { name: "Member signup." }),
  ).toBeVisible();
});

test("entry return links stay on valid local portal routes", () => {
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "/login/../../elsewhere",
    "/unknown/login",
    "/\\evil.invalid",
    "/api/state",
  ])
    expect(entryDestination(value)).toBe("/login");
  expect(entryDestination("/member/signup?ref=kept")).toBe(
    "/member/signup?ref=kept",
  );
});
