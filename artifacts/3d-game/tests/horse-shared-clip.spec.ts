import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

for (const mobile of [false, true]) {
  test(`animated 3D horses keep the entire race pack correctly oriented on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const shaderErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /THREE|WebGL|shader|GL_INVALID/i.test(message.text())
      )
        shaderErrors.push(message.text());
    });
    const requested: string[] = [];
    page.on("request", (request) =>
      requested.push(new URL(request.url()).pathname),
    );
    await page.addInitScript(() =>
      localStorage.setItem("horse-racing:camera:v2", "headon"),
    );
    const f = await setup(page, { pauseClock: true });
    const canvas = page.getByTestId("horse-race-canvas");
    await expect(
      page.getByRole("button", { name: "Realistic camera", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () => {
          await page.clock.runFor(100);
          return canvas.getAttribute("data-character-presentation");
        },
        { timeout: 30000 },
      )
      .toBe("skinned-3d");
    await expect(canvas).toHaveAttribute(
      "data-character-presentation",
      "skinned-3d",
    );
    await expect(canvas).toHaveAttribute("data-pose", "standing");
    await expect(
      page.getByRole("button", { name: "Front camera", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("group", { name: "Follow a runner" }),
    ).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-camera-mode", "headon");
    await f.start();
    await f.advanceTo(f.race.startedAt + 4500);
    await page.clock.runFor(900);
    const frames = await canvas.getAttribute("data-animation-frames");
    expect(new Set(frames!.split(",")).size).toBeGreaterThan(1);
    await page.clock.runFor(180);
    expect(await canvas.getAttribute("data-animation-frames")).not.toBe(frames);
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    expect(Number(await canvas.getAttribute("data-triangles"))).toBeLessThan(
      500000,
    );
    await canvas.screenshot({
      path: `test-results/horse-shared-${mobile ? "mobile" : "desktop"}.png`,
    });
    // Every camera preserves the animated characters and live round.
    const roundId = f.race.id;
    for (const [label, mode] of [
      ["Broadcast", "broadcast"],
      ["Grandstand", "grandstand"],
      ["Close-up", "closeup"],
      ["Auto", "auto"],
      ["Rail-side", "rail"],
    ]) {
      await page
        .getByRole("button", { name: label + " camera", exact: true })
        .click();
      await page.clock.runFor(800);
      await expect(canvas).toHaveAttribute("data-camera-mode", mode);
      await expect(canvas).toHaveAttribute(
        "data-visible-runners",
        "1,2,3,4,5,6,7,8",
      );
      await expect(canvas).toHaveAttribute(
        "data-horse-orientation",
        "track-tangent",
      );
      expect(
        Number(await canvas.getAttribute("data-heading-error")),
      ).toBeLessThan(1e-8);
      await expect(canvas).toHaveAttribute(
        "data-character-presentation",
        "skinned-3d",
      );
      await expect(canvas).toHaveAttribute("data-race-id", roundId);
      if (label === "Close-up") {
        const bounds = JSON.parse(
          (await canvas.getAttribute("data-runner-bounds"))!,
        ) as number[][];
        expect(bounds).toHaveLength(8);
        expect(
          bounds.every(
            ([, x, y, w, h]) =>
              x >= 0 && y >= 0 && x + w <= 1280 && y + h <= 720,
          ),
        ).toBe(true);
      }
      if (label === "Broadcast" || label === "Close-up")
        await canvas.screenshot({
          path:
            "test-results/horse-always-" +
            mode +
            "-" +
            (mobile ? "mobile" : "desktop") +
            ".png",
        });
    }
    expect(
      requested.filter((url) =>
        /(?:thoroughbred.*\.glb|jockey.*\.glb|characters-v3\/)/.test(url),
      ).length,
    ).toBeGreaterThan(0);
    const winner = f.race.plan.order[0];
    await f.advanceTo(
      f.race.startedAt +
        f.race.plan.runners[winner - 1].finishTime * 1000 +
        100,
    );
    await expect(canvas).toHaveAttribute("data-camera", "winner");
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    await expect(canvas).toHaveAttribute(
      "data-character-presentation",
      "skinned-3d",
    );
    await expect(page.getByTestId("horse-winner-shot")).toBeVisible();
    await canvas.screenshot({
      path: `test-results/horse-shared-winner-${mobile ? "mobile" : "desktop"}.png`,
    });
    await f.next();
    await expect(canvas).toHaveAttribute("data-pose", "standing");
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    expect(f.posts).toHaveLength(0);
    expect(f.errors).toEqual([]);
    expect(shaderErrors).toEqual([]);
  });
}
