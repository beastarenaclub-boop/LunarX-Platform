import { browserConnected } from "./location-fixture";
import { connectedAuth, browserLocation } from "./location-fixture";
import { test, expect } from "@playwright/test";
import { QUICK_BANKS } from "../src/live/banks";

test("real left/right referrals show their sponsor and joining ID without exposing the upline profile", async ({
  request,
  page,
  browser,
}) => {
  const headers = (identity: string) =>
    connectedAuth(request, {
      "oai-authenticated-user-id": identity,
      "oai-authenticated-user-email": identity + "@test.invalid",
    });
  const get = async (identity: string) => {
    const r = await request.get("/api/state", {
      headers: await headers(identity),
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const admin = await get("qa-admin");
  const leaf = admin.members.find(
    (m: any) => !admin.members.some((c: any) => c.parent === m.id),
  );
  const tag = crypto.randomUUID().slice(0, 8);
  const register = async (identity: string, ref: string) => {
    const r = await request.post("/api/register", {
      headers: await headers(identity),
      data: { name: identity, city: "QA city", banks: QUICK_BANKS, ref },
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await get(identity)).me;
  };
  const sponsor = await register("sponsor-" + tag, leaf.ref);
  const left = await register("left-" + tag, sponsor.ref);
  const right = await register("right-" + tag, sponsor.ref);
  const deep = await register("deep-" + tag, left.ref);
  const leftState = await get(left.name);
  expect(leftState.me.sponsor).toEqual({
    id: sponsor.id,
    name: sponsor.name,
    ref: sponsor.ref,
  });
  expect(leftState.me.position).toBe("left");
  expect(leftState.members.some((m: any) => m.id === sponsor.id)).toBe(false);
  expect(leftState.members.find((m: any) => m.id === deep.id).sponsor.ref).toBe(
    left.ref,
  );
  expect(Object.keys(leftState.me.sponsor).sort()).toEqual([
    "id",
    "name",
    "ref",
  ]);
  expect(leftState.members.some((m: any) => m.id === right.id)).toBe(false);
  expect((await get(right.name)).me.position).toBe("right");
  expect((await get(deep.name)).me.sponsor.ref).toBe(left.ref);
  await browserConnected(page, await headers("qa-admin"));
  await page.route("http://127.0.0.1:5201/**", async (r) =>
    r.continue({
      headers: { ...r.request().headers(), ...(await headers("qa-admin")) },
    }),
  );
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Binary network", exact: true })
    .click();
  await page.getByLabel("Explore branch").selectOption(sponsor.id);
  const leftNode = page
    .locator(".tree-node")
    .filter({ has: page.getByText(left.name, { exact: true }) });
  const rightNode = page
    .locator(".tree-node")
    .filter({ has: page.getByText(right.name, { exact: true }) });
  await expect(leftNode).toContainText("Left of " + sponsor.name);
  await expect(rightNode).toContainText("Right of " + sponsor.name);
  await expect(leftNode).toContainText("Joined via: " + sponsor.ref);
  await expect(rightNode).toContainText("Own ID: " + right.ref);
  await expect(
    page
      .locator(".tree-node")
      .filter({ has: page.getByText(deep.name, { exact: true }) }),
  ).toContainText("Joined via: " + left.ref);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: right.ref, exact: true }) });
  await expect(
    row.getByRole("cell", { name: sponsor.ref, exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("cell", { name: "Right", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/binary-referrals-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Members & documents", exact: true })
    .click();
  await page.getByLabel("Search members").fill(right.ref);
  const directoryRow = page
    .getByRole("row")
    .filter({ has: page.getByText(right.ref, { exact: true }) });
  await expect(directoryRow).toContainText(sponsor.name);
  await expect(directoryRow).toContainText(sponsor.ref);
  await expect(directoryRow).toContainText("Right position");
  await directoryRow
    .getByRole("button", { name: `View complete profile for ${right.name}` })
    .click();
  await expect(
    page.getByLabel(`Referral placement for ${right.name}`),
  ).toContainText(sponsor.ref);
  const memberPage = await browser.newPage(browserLocation);
  try {
    await browserConnected(memberPage, await headers(left.name));
    await memberPage.route("http://127.0.0.1:5201/**", async (r) =>
      r.continue({
        headers: { ...r.request().headers(), ...(await headers(left.name)) },
      }),
    );
    await memberPage.goto("http://127.0.0.1:5201/login");
    await expect(
      memberPage.getByLabel(`Referral placement for ${left.name}`),
    ).toContainText(sponsor.name);
    await memberPage
      .getByRole("button", { name: "Binary network", exact: true })
      .click();
    await expect(memberPage.locator(".root-node")).toContainText(
      "Left of " + sponsor.name,
    );
    await expect(memberPage.locator(".root-node")).toContainText(
      "Joined via: " + sponsor.ref,
    );
    await memberPage.locator(".root-node").click();
    await expect(
      memberPage
        .getByRole("dialog")
        .getByLabel(`Referral placement for ${left.name}`),
    ).toContainText("Left position under sponsor");
    await memberPage.getByRole("button", { name: "Close dialog" }).click();
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage
      .locator(".network-tree")
      .evaluate((el) =>
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY),
      );
    await expect(memberPage.locator(".root-node")).toBeInViewport();
    expect(
      await memberPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await memberPage.screenshot({
      path: "test-results/binary-referrals-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await memberPage.close();
  }
});
