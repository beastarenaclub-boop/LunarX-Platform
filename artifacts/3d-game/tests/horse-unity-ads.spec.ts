import { test, expect } from "@playwright/test";

test("Unity advertising sends fitted pixels, expires artwork, and stops after unmount", async ({
  page,
}) => {
  const now = new Date("2030-01-01T00:00:00Z");
  await page.clock.install({ time: now });
  await page.route("**/unity-ad-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Advertising check</title>",
    }),
  );
  await page.route(
    "**/assets/horse-racing/advertising/campaigns.json",
    (route) =>
      route.fulfill({
        json: {
          version: 1,
          campaigns: [
            {
              id: "test",
              enabled: true,
              slot: "trackside",
              imageUrl: "/unity-sponsor-test.svg",
              venues: ["royal"],
              endsAt: "2030-01-01T00:00:05Z",
            },
          ],
        },
      }),
  );
  await page.route("**/unity-sponsor-test.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100"><rect width="800" height="100" fill="#ccaa66"/><text x="200" y="65" font-size="42">TEST SPONSOR</text></svg>',
    }),
  );
  await page.goto("http://127.0.0.1:5288/unity-ad-test");
  await page.evaluate(async () => {
    const path = "/src/components/horse-racing/unityStadiumAds.ts";
    const { unityStadiumAds } = await import(path);
    (window as any).adFrames = [];
    (window as any).stopAds = unityStadiumAds(
      () => "royal",
      (slot: string, image: string) =>
        (window as any).adFrames.push({ slot, image }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).adFrames.some(
          (a: any) => a.slot === "trackside" && a.image.startsWith("iVBOR"),
        ),
      ),
    )
    .toBe(true);
  await page.clock.fastForward(6000);
  expect(
    await page.evaluate(
      () =>
        (window as any).adFrames
          .filter((a: any) => a.slot === "trackside")
          .at(-1).image,
    ),
  ).toBe("");
  const count = await page.evaluate(() => {
    (window as any).stopAds();
    return (window as any).adFrames.length;
  });
  await page.clock.fastForward(65000);
  expect(await page.evaluate(() => (window as any).adFrames.length)).toBe(
    count,
  );
});
