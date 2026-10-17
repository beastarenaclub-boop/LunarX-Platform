import { test, expect } from "@playwright/test";
import {
  parseStadiumCampaigns,
  activeStadiumCampaign,
} from "../src/components/horse-racing/stadiumAdvertising";
import { setup } from "./horse-live-fixture";

const ROOT = "/assets/horse-racing/advertising/";
test("bundled default campaigns load from the actual public configuration", async ({
  page,
}) => {
  const fixture = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute("data-advertising-images", "4", {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute(
    "data-advertising-campaigns",
    /demo-trackside/,
  );
  expect(fixture.posts).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
});
test("advertising validates artwork and respects venue, enablement and schedule boundaries", () => {
  const good = {
    id: "sponsor",
    slot: "trackside",
    imageUrl: ROOT + "trackside-partner-v1.svg",
    venues: ["royal"],
    startsAt: "2030-01-01T00:00:00Z",
    endsAt: "2030-02-01T00:00:00Z",
  };
  const campaigns = parseStadiumCampaigns({
    version: 1,
    campaigns: [
      good,
      { ...good, id: "script", imageUrl: "javascript:alert(1)" },
      { ...good, id: "bad-date", startsAt: "invalid" },
      { ...good, id: "reverse", endsAt: "2029-01-01T00:00:00Z" },
      { ...good, id: "unknown-venue", venues: ["unknown"] },
      {
        ...good,
        id: "protocol-relative",
        imageUrl: "//example.test/image.png",
      },
      good,
    ],
  });
  expect(campaigns).toHaveLength(1);
  const start = Date.parse(good.startsAt),
    end = Date.parse(good.endsAt);
  expect(
    activeStadiumCampaign(campaigns, "trackside", "royal", start - 1),
  ).toBeUndefined();
  expect(
    activeStadiumCampaign(campaigns, "trackside", "royal", start)?.id,
  ).toBe("sponsor");
  expect(
    activeStadiumCampaign(campaigns, "trackside", "night", start),
  ).toBeUndefined();
  expect(
    activeStadiumCampaign(campaigns, "trackside", "royal", end),
  ).toBeUndefined();
  campaigns[0].enabled = false;
  expect(
    activeStadiumCampaign(campaigns, "trackside", "royal", start),
  ).toBeUndefined();
  expect(parseStadiumCampaigns({ version: 2, campaigns: [good] })).toEqual([]);
});

test("stadium loads artwork, replaces sponsor campaigns without rebuilding and survives bad images", async ({
  page,
}) => {
  test.setTimeout(120000);
  const slots = ["trackside", "infield", "grandstand", "finish"];
  let campaigns = slots.map((slot) => ({
    id: "demo-" + slot,
    slot,
    enabled: true,
    imageUrl: ROOT + slot + "-partner-v1.svg",
  }));
  await page.route("**/advertising/campaigns.json", (route) =>
    route.fulfill({ json: { version: 1, campaigns } }),
  );
  await page.route("**/advertising/broken.png", (route) =>
    route.fulfill({ contentType: "image/png", body: "invalid image" }),
  );
  const fixture = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute(
    "data-advertising-revision",
    "stadium-hoardings-v2",
    { timeout: 30000 },
  );
  await expect(canvas).toHaveAttribute("data-advertising-boards", "8");
  await expect(canvas).toHaveAttribute("data-advertising-ground-ads", "0");
  await expect(canvas).toHaveAttribute("data-advertising-images", "4", {
    timeout: 20000,
  });
  await page
    .getByRole("button", { name: "Grandstand camera", exact: true })
    .click();
  await canvas.screenshot({
    path: "test-results/horse-advertising-overview.png",
  });

  campaigns[0] = {
    ...campaigns[0],
    id: "replacement-sponsor",
    imageUrl: ROOT + "finish-partner-v1.svg",
  };
  await page.clock.fastForward(61000);
  await expect(canvas).toHaveAttribute(
    "data-advertising-campaigns",
    /replacement-sponsor/,
  );
  await expect(canvas).toHaveAttribute("data-advertising-images", "4");
  campaigns[0] = {
    ...campaigns[0],
    id: "broken-sponsor",
    imageUrl: ROOT + "broken.png",
  };
  await page.clock.fastForward(61000);
  await expect(canvas).toHaveAttribute(
    "data-advertising-campaigns",
    /broken-sponsor/,
  );
  await expect(canvas).toHaveAttribute("data-advertising-images", "3");
  await expect(canvas).toHaveAttribute("data-renderer", "webgl-3d");
  campaigns[0] = { ...campaigns[0], enabled: false };
  await page.clock.fastForward(61000);
  await expect(canvas).not.toHaveAttribute(
    "data-advertising-campaigns",
    /broken-sponsor/,
  );
  await page
    .getByRole("combobox", { name: "Race location" })
    .selectOption("night");
  await expect(canvas).toHaveAttribute("data-venue", "night");
  await expect(canvas).toHaveAttribute("data-advertising-images", "3");
  expect(fixture.posts).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
});

test("mobile race renders hoardings even when the campaign configuration is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/advertising/campaigns.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  const fixture = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute("data-advertising-status", "fallback", {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute("data-advertising-boards", "8");
  await expect(canvas).toHaveAttribute("data-advertising-ground-ads", "0");
  await expect(canvas).toHaveAttribute("data-renderer", "webgl-3d");
  await fixture.start();
  await expect(canvas).toHaveAttribute("data-pose", "galloping");
  expect(fixture.posts).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
});
