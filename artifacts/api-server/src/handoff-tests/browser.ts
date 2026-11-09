import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function browserChecks(base: string) {
  const shots = resolve("../../tmp/handoff-browser");
  await mkdir(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const guest = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
      const lobby = await guest.newPage();
      const errors: string[] = [];
      lobby.on("pageerror", e => errors.push(e.message));
      for (const route of ["/", "/b2c"]) {
        await lobby.goto(base + route);
        const banner = lobby.locator(route === "/" ? '.photo-banners-slide[aria-hidden="false"]' : '.b2c-handoff-hero');
        await expect(banner).toBeVisible();
        await expect(banner.locator("img").first()).toHaveJSProperty("complete", true);
        expect(await banner.locator("img").first().evaluate((img: {naturalWidth:number}) => img.naturalWidth)).toBeGreaterThan(1000);
        expect(await lobby.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")).toBe(true);
        await lobby.screenshot({path: resolve(shots, `lobby-${route === "/" ? "lunar" : "b2c"}-${width}.png`), fullPage: false});
        if (route === "/b2c") {
          await lobby.getByRole("button", {name:"Explore new games", exact:true}).click();
          for (const code of ["roulette-american", "roulette-mini", "fun-target"]) {
            const tile = lobby.locator(`[data-game-id="${code}"]`).filter({visible:true}).first();
            await expect(tile).toBeEnabled();
            await tile.scrollIntoViewIfNeeded();
            await expect(tile.locator("img")).toHaveJSProperty("complete", true);
            expect(await tile.locator("img").evaluate((img:{naturalWidth:number}) => img.naturalWidth)).toBeGreaterThan(1000);
          }
          await lobby.locator('[data-game-id="roulette-mini"]').filter({visible:true}).first().click();
          await expect(lobby.getByRole("dialog")).toBeVisible();
        } else {
          const launch = lobby.getByRole("link", {name:"Play American Roulette from New tables. New classics.", exact:true}).filter({visible:true}).first();
          await expect(launch).toHaveAttribute("href", "/roulette-american");
        }
      }
      expect(errors).toEqual([]);
      await guest.close();
    }
    const admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "x-actor": "admin" },
    });
    const page = await admin.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/admin/game-control");
    await expect(
      page.getByRole("heading", { name: "Game Control", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^fun-target/ }).click();
    await page
      .getByLabel("Result mode", { exact: true })
      .selectOption("collect");
    await page.getByLabel("Winning digit total return").fill("9.5");
    await page
      .getByRole("button", { name: "Save game settings", exact: true })
      .click();
    await expect(
      page.getByText("Game Control saved", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^fun-target/ }).click();
    await expect(page.getByLabel("Result mode", { exact: true })).toHaveValue(
      "collect",
    );
    await expect(page.getByLabel("Winning digit total return")).toHaveValue(
      "9.5",
    );
    await page.screenshot({
      path: resolve(shots, "admin-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(shots, "admin-mobile.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await admin.close();
    for (const size of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const player = await browser.newContext({
          viewport: size,
          extraHTTPHeaders: { "x-actor": "player" },
        }),
        game = await player.newPage();
      const failures: string[] = [];
      game.on("pageerror", (e) => failures.push(e.message));
      for (const code of [
        "roulette-american",
        "roulette-mini",
        "fun-target",
      ]) {
        await game.goto(base + "/" + code);
        await game.waitForTimeout(1800);
        await expect(
          game.getByTestId(
            code === "fun-target"
                ? "cabinet"
                : "button-sound",
          ),
        ).toBeVisible();
        if (code === "fun-target" && size.width === 1440) {
          await game.getByTestId("bet-spot-5").click();
          const placed = game.waitForResponse(
            (r) =>
              r.url().endsWith("/api/fun-target/place") &&
              r.request().method() === "POST",
          );
          await game.getByTestId("btn-place").click();
          expect((await placed).status()).toBe(200);
        }
        await expect(game.locator("body")).not.toContainText(
          "Something went wrong",
        );
        await expect(game.locator("body")).not.toContainText(
          "Cannot read properties",
        );
        await expect(game.locator("body")).not.toContainText("Loading game");
        expect(await game.locator("body").innerText()).not.toMatch(
          /Could not load|Unable to load/,
        );
        expect(
          await game.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth + 2",
          ),
        ).toBe(true);
        await game.screenshot({
          path: resolve(shots, `${code}-${size.width}.png`),
          fullPage: true,
        });
      }
      await game.goto(base + "/b2c");
      for (const retired of ["rummy-royale", "speed-auto-roulette"]) {
        await expect(game.locator(`[data-game-id="${retired}"]`)).toHaveCount(0);
      }
      for (const retained of ["lunar", "roulette-american", "roulette-mini", "fun-target", "rummy", "roulette", "andar-bahar", "lucky-7"]) {
        await expect(game.locator(`[data-game-id="${retained}"]`).first()).toBeAttached();
      }
      // The original /rummy game was already branded "Rummy Royale" before
      // the kit. Identify the withdrawn game by its code, not that old title.
      await expect(game.locator('[data-game-id="rummy"]').first()).toBeAttached();
      expect(failures).toEqual([]);
      await player.close();
    }
  } finally {
    await browser.close();
  }
}
