import { test, expect } from "@playwright/test";

test("front page has no account links and direct account URLs require the game", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /login|signup|sign in/i }),
  ).toHaveCount(0);
  for (const path of [
    "/login",
    "/signup?ref=SYN-TEST",
    ...["admin", "agent", "member"].flatMap((role) =>
      (role === "member"
        ? ["login", "signup", "dashboard"]
        : ["login", "dashboard"]
      ).map((screen) => "/" + role + "/" + screen),
    ),
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe(
      "/?next=" + encodeURIComponent(path),
    );
  }
  await page.goto("/member/signup?ref=referral-to-preserve");
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    "/member/signup?ref=referral-to-preserve",
  );
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rotate upper triangle fragment" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("old preview links return to the entrance and no role demo is available", async ({
  page,
}) => {
  await page.goto("/preview");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(
    page.getByRole("button", { name: "Rotate upper triangle fragment" }),
  ).toBeVisible();
  await page.goto("/demo");
  await expect(
    page.getByRole("button", { name: "Rotate left triangle fragment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Admin Oversee, review & approve" }),
  ).toHaveCount(0);
});
