import { test, expect } from "@playwright/test";

test("one physical ball per call: 20 draws and one Mega Ball match numbers and cards", async ({
  page,
}, info) => {
  test.setTimeout(200000);
  await page.addInitScript(() => {
    const windowWithCalls = window as typeof window & {
      machineCalls: { n: number; displayed: number; round: string }[];
      machineExits: { n: number; round: string }[];
      inventoryErrors: string[];
      showStages: { stage: string; round: string }[];
    };
    windowWithCalls.machineCalls = [];
    windowWithCalls.machineExits = [];
    windowWithCalls.inventoryErrors = [];
    windowWithCalls.showStages = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        cancel: () => {},
        speak: (utterance: SpeechSynthesisUtterance) => {
          if (!/^(Mega ball, )?\d+$/.test(utterance.text)) return;
          windowWithCalls.machineCalls.push({
            n: Number(utterance.text.match(/\d+/)?.[0]),
            displayed: Number(
              document.querySelector(".mb-current-ball strong")?.textContent,
            ),
            round: document.querySelector(".mb-round-id")?.textContent ?? "",
          });
        },
      },
    });
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        const canvas = m.target as HTMLCanvasElement;
        if (
          m.attributeName === "data-show-stage" &&
          canvas.matches?.(".mb-machine-canvas")
        ) {
          windowWithCalls.showStages.push({
            stage: canvas.dataset.showStage!,
            round: document.querySelector(".mb-round-id")?.textContent ?? "",
          });
          continue;
        }
        if (
          m.attributeName !== "data-chute-numbers" ||
          !canvas.matches?.(".mb-machine-canvas")
        )
          continue;
        const read = (key: string) =>
          (canvas.dataset[key] ?? "").split(",").filter(Boolean).map(Number);
        const bowl = read("bowlNumbers"),
          chute = read("chuteNumbers"),
          rack = read("rackNumbers");
        const all = [...bowl, ...chute, ...rack];
        if (all.length !== 51 || new Set(all).size !== 51 || chute.length > 1)
          windowWithCalls.inventoryErrors.push(
            JSON.stringify({ bowl, chute, rack }),
          );
        if (chute.length)
          windowWithCalls.machineExits.push({
            n: chute[0],
            round: document.querySelector(".mb-round-id")?.textContent ?? "",
          });
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-chute-numbers", "data-show-stage"],
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mega-ball");
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  // Wait for a fresh purchasing window; never start listening halfway through a draw.
  await expect
    .poll(
      () =>
        page
          .locator(".mb-countdown strong")
          .textContent()
          .then(Number)
          .catch(() => 0),
      { timeout: 90000 },
    )
    .toBeGreaterThan(12);
  const round = await page.locator(".mb-round-id").innerText();
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.getByRole("button", { name: "Add 1 card", exact: true }).click();
  await page.getByRole("button", { name: "BUY 1 CARD", exact: true }).click();
  await expect(page.locator(".mb-card")).toHaveCount(1);
  await expect(page.locator(".mb-mega-small")).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId("mega-ball-result")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (round) =>
          (window as any).machineCalls.filter((c: any) => c.round === round)
            .length,
        round,
      ),
    )
    .toBe(21);
  await expect
    .poll(() =>
      page.evaluate(
        (round) =>
          (window as any).machineExits.filter((c: any) => c.round === round)
            .length,
        round,
      ),
    )
    .toBe(21);
  const captured = await page.evaluate(
    (round) => ({
      calls: (window as any).machineCalls.filter((c: any) => c.round === round),
      exits: (window as any).machineExits.filter((c: any) => c.round === round),
      errors: (window as any).inventoryErrors,
      drawn: Array.from(
        document.querySelectorAll(".mb-drawn-balls .mb-small-ball"),
        (el) => Number(el.firstChild?.textContent),
      ),
    }),
    round,
  );
  expect(captured.errors).toEqual([]);
  expect(captured.calls.map((c: any) => c.n)).toEqual(captured.drawn);
  expect(captured.exits.map((c: any) => c.n)).toEqual(captured.drawn);
  expect(captured.calls.every((c: any) => c.n === c.displayed)).toBe(true);
  expect(new Set(captured.drawn).size).toBe(21);
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-bowl-numbers",
    /.+/,
  );
  const marked = await page
    .locator(".mb-card-grid .is-marked")
    .allTextContents();
  const card = (
    await page.locator(".mb-card-grid > span").allTextContents()
  ).map(Number);
  expect(marked.map(Number)).toEqual(
    card.filter((n) => captured.drawn.includes(n)),
  );
  await page.screenshot({
    path: info.outputPath("synchronized-mega-ball.png"),
  });
  await expect(page.getByTestId("mega-ball-result")).toBeVisible({
    timeout: 10000,
  });
  const completed = await page
    .locator(".mb-machine-canvas")
    .evaluate((canvas: HTMLCanvasElement) => ({ ...canvas.dataset }));
  expect(completed.rackNumbers?.split(",")).toHaveLength(21);
  expect(completed.chuteNumbers).toBe("");
  expect(completed.reelState).toBe("selected");
  expect(completed.resultVisible).toBe("true");
  const stages = await page.evaluate(
    (round) =>
      (window as any).showStages
        .filter((s: any) => s.round === round)
        .map((s: any) => s.stage),
    round,
  );
  expect([...new Set(stages)]).toEqual(
    expect.arrayContaining([
      "mixing",
      "drawing",
      "draw-complete",
      "multiplier-opening",
      "multiplier-spinning",
      "multiplier-selected",
      "mega-draw",
      "result",
    ]),
  );
  await page.screenshot({ path: info.outputPath("completed-show-result.png") });
});
