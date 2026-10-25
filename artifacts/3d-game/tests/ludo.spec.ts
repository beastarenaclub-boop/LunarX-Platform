import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { LudoTable } from "@workspace/api-zod/ludo";
const base = "http://127.0.0.1:5398";
async function player(
  browser: Browser,
  name: string,
  viewport = { width: 1440, height: 1000 },
  screen: "home" | "online" = "online",
) {
  const context = await browser.newContext({
    baseURL: base,
    viewport,
    isMobile: viewport.width < 1024,
    hasTouch: viewport.width < 1024,
  });
  const login = await context.request.post("/api/test/ludo/login", {
    data: { name },
  });
  expect(login.ok()).toBeTruthy();
  const { id } = await login.json();
  const page = await context.newPage();
  await page.goto("/ludo");
  await expect(
    page.getByRole("button", { name: "Online multiplayer", exact: true }),
  ).toBeVisible();
  if (screen === "home") return { context, page, id };
  await page
    .getByRole("button", { name: "Online multiplayer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Find a match" }),
  ).toBeEnabled();
  return { context, page, id };
}
const state = async (context: BrowserContext) =>
  (await (await context.request.get("/api/ludo/state")).json()) as LudoTable;
async function readyRoll(
  context: BrowserContext,
  page: Page,
  id: string,
  seat: number,
  face: number,
  tokens?: number[],
  opponentTokens?: number[],
) {
  const response = await context.request.post("/api/test/ludo/roll-ready", {
    data: { id, seat, face, tokens, opponentTokens },
  });
  expect(response.ok()).toBeTruthy();
  const { version } = await response.json();
  await page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api/ludo/state") &&
      r.ok() &&
      (await r.json()).match?.version >= version,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function watchToken(page: Page, seat = 0, token = 0) {
  await page.evaluate(
    ({ seat, token }) => {
      const target = document.querySelector(
        `[data-seat="${seat}"][data-token="${token}"]`,
      )!;
      const samples: {
        position: number;
        moving: boolean;
        rollDisabled: boolean;
        opponent: number | null;
      }[] = [];
      (window as any).__tokenSamples = samples;
      (window as any).__tokenObserver?.disconnect();
      const record = () =>
        samples.push({
          position: Number(target.getAttribute("data-position")),
          moving: target.classList.contains("ld-token-moving"),
          rollDisabled: (
            document.querySelector(
              '[aria-label="Roll dice"]',
            ) as HTMLButtonElement
          ).disabled,
          opponent: Number(
            document
              .querySelector('[data-seat="1"][data-token="0"]')
              ?.getAttribute("data-position"),
          ),
        });
      const observer = new MutationObserver(record);
      observer.observe(target, {
        attributes: true,
        attributeFilter: ["data-position"],
      });
      (window as any).__tokenObserver = observer;
    },
    { seat, token },
  );
}
const tokenPositions = (page: Page) =>
  page.evaluate(
    () =>
      (window as any).__tokenSamples.map(
        (s: { position: number }) => s.position,
      ) as number[],
  );

test("single outside token automatically walks every square after rolls 1–5, on both boards", async ({
  browser,
}) => {
  const a = await player(browser, "Auto Walker", { width: 390, height: 844 });
  const b = await player(browser, "Watching Walker");
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    const requests: { type: string; token?: number }[] = [];
    a.page.on("request", (r) => {
      if (r.url().endsWith("/action")) requests.push(r.postDataJSON());
    });
    for (const face of [1, 2, 3, 4, 5]) {
      // Progress 4 crosses a board corner, so a direct diagonal jump cannot pass.
      await readyRoll(a.context, a.page, id, 0, face, [4, -1, -1, -1]);
      await expect(
        b.page.locator('[data-seat="0"][data-token="0"]'),
      ).toHaveAttribute("data-position", "4");
      await watchToken(a.page);
      await watchToken(b.page);
      const before = requests.length;
      await a.page
        .getByRole("button", { name: "Roll dice", exact: true })
        .click();
      await expect(
        a.page.locator(".ld-player[data-you] .ld-die"),
      ).toHaveAttribute("data-phase", "rolling");
      expect(
        requests.slice(before).filter((r) => r.type === "move"),
      ).toHaveLength(0);
      const path = Array.from({ length: face }, (_, i) => 5 + i);
      await expect.poll(() => tokenPositions(a.page)).toEqual(path);
      await expect.poll(() => tokenPositions(b.page)).toEqual(path);
      const samples = await a.page.evaluate(
        () => (window as any).__tokenSamples,
      );
      expect(
        samples.every((s: any) => s.moving && s.rollDisabled),
      ).toBeTruthy();
      await expect(a.page.locator(".ld-board")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const moves = requests.slice(before).filter((r) => r.type === "move");
      expect(moves).toHaveLength(1);
      expect(moves[0].token).toBe(0);
      expect((await state(a.context)).match!.state.players[0]!.tokens).toEqual([
        4 + face,
        -1,
        -1,
        -1,
      ]);
    }
    await a.page.reload();
    await expect(
      a.page.locator('[data-seat="0"][data-token="0"]'),
    ).toHaveAttribute("data-position", "9");
    await expect(a.page.locator(".ld-token-moving")).toHaveCount(0);
    await a.page.screenshot({
      path: "tmp/ludo-token-checks/mobile-after-move.png",
    });
    await finish(a.context, a.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("six and multiple outside tokens stay manual; blocked home rolls never auto move", async ({
  browser,
}) => {
  const a = await player(browser, "Manual Choices");
  const b = await player(browser, "Manual Opponent");
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    const moves: unknown[] = [];
    a.page.on("request", (r) => {
      if (r.url().endsWith("/action") && r.postDataJSON().type === "move")
        moves.push(r.postDataJSON());
    });
    for (const [face, tokens, chosen] of [
      [6, [4, -1, -1, -1], 0],
      [3, [4, 12, -1, -1], 0],
      [2, [55, 4, -1, -1], 1],
    ] as const) {
      await readyRoll(a.context, a.page, id, 0, face, [...tokens]);
      await a.page
        .getByRole("button", { name: "Roll dice", exact: true })
        .click();
      await expect(
        a.page.locator(".ld-player[data-you] .ld-die"),
      ).toHaveAttribute("data-phase", "idle");
      const before = moves.length;
      // Longer than dice landing + auto-move delay: these cases must await a choice.
      await a.page.waitForTimeout(1200);
      expect(moves).toHaveLength(before);
      expect((await state(a.context)).match!.state.players[0]!.tokens).toEqual([
        ...tokens,
      ]);
      await a.page
        .getByRole("button", { name: `Move ${chosen + 1}`, exact: true })
        .click();
      await expect(a.page.locator(".ld-board")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(a.page.locator(".ld-board")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    await readyRoll(a.context, a.page, id, 0, 2, [55, -1, -1, -1]);
    const before = moves.length;
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(
      a.page.locator(".ld-player[data-you] .ld-die"),
    ).toHaveAttribute("data-phase", "idle");
    await a.page.waitForTimeout(1200);
    expect(moves).toHaveLength(before);
    expect((await state(a.context)).match!.state.players[0]!.tokens[0]).toBe(
      55,
    );
    await finish(a.context, a.page);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("automatic capture lands before sending the opponent home and lost responses retry the same move", async ({
  browser,
}) => {
  const a = await player(browser, "Capture Walker", {
    width: 390,
    height: 844,
  });
  const b = await player(browser, "Capture Opponent");
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    // Red 9 and yellow 35 share an unsafe square.
    await readyRoll(
      a.context,
      a.page,
      id,
      0,
      5,
      [4, -1, -1, -1],
      [35, -1, -1, -1],
    );
    await watchToken(a.page);
    const requests: { requestId: string; type: string }[] = [];
    let dropped = false;
    await a.page.route("**/api/ludo/*/action", async (route) => {
      const body = route.request().postDataJSON();
      if (body.type === "move") {
        requests.push(body);
        if (!dropped) {
          dropped = true;
          await route.fetch(); // Commit first, lose only the response.
          await route.fulfill({
            status: 503,
            json: { error: "Lost response" },
          });
          return;
        }
      }
      await route.continue();
    });
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect.poll(() => tokenPositions(a.page)).toEqual([5, 6, 7, 8, 9]);
    const samples = await a.page.evaluate(() => (window as any).__tokenSamples);
    expect(
      samples.every((s: any) => s.moving && s.opponent === 35),
    ).toBeTruthy();
    await expect(
      a.page.locator('[data-seat="1"][data-token="0"]'),
    ).toHaveAttribute("data-position", "-1");
    await expect(
      a.page.getByRole("button", { name: "Retry last action", exact: true }),
    ).toBeVisible();
    await a.page.waitForTimeout(2800); // A state poll must not issue a second move.
    expect(requests).toHaveLength(1);
    await a.page
      .getByRole("button", { name: "Retry last action", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Retry last action", exact: true }),
    ).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toBe(requests[1].requestId);
    expect((await state(a.context)).match!.state.players[0]!.tokens[0]).toBe(9);
    expect(await tokenPositions(a.page)).toEqual([5, 6, 7, 8, 9]);
    await a.page.emulateMedia({ reducedMotion: "reduce" });
    await readyRoll(a.context, a.page, id, 0, 3, [48, -1, -1, -1]);
    await watchToken(a.page);
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(
      a.page.locator('[data-seat="0"][data-token="0"]'),
    ).toHaveAttribute("data-position", "51");
    expect(await tokenPositions(a.page)).toEqual([51]);
    await finish(a.context, a.page);
  } finally {
    await a.page.unrouteAll({ behavior: "ignoreErrors" });
    await a.context.close();
    await b.context.close();
  }
});

test("Computer tokens and exact home rolls walk square by square in a four-player game", async ({
  browser,
}) => {
  const a = await player(
    browser,
    "Home Walker",
    { width: 390, height: 844 },
    "home",
  );
  try {
    await a.page
      .getByRole("button", { name: "Play against Computer", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "4 players Classic battle" })
      .click();
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    await readyRoll(a.context, a.page, id, 1, 5, [4, -1, -1, -1]);
    await watchToken(a.page, 1);
    await a.context.request.post("/api/test/ludo/advance", { data: { id } });
    await expect.poll(() => tokenPositions(a.page)).toEqual([5, 6, 7, 8, 9]);
    await expect(a.page.locator(".ld-board")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await readyRoll(a.context, a.page, id, 0, 5, [51, 56, 56, 56]);
    await watchToken(a.page);
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(() => tokenPositions(a.page))
      .toEqual([52, 53, 54, 55, 56]);
    await expect(
      a.page
        .getByRole("dialog")
        .getByRole("heading", { name: "You take the crown!" }),
    ).toBeVisible();
    await expect(a.page.getByRole("dialog")).toContainText("₹36");
    await a.page
      .getByRole("button", { name: "View board", exact: true })
      .click();
    await expect(a.page.locator('[data-seat="0"].ld-token-home')).toHaveCount(
      4,
    );
    await expect(
      a.page.locator('[data-seat="0"][data-token="0"]'),
    ).toHaveAttribute("data-position", "56");
    expect((await state(a.context)).balancePaise).toBe("102600");
  } finally {
    await a.context.close();
  }
});

test("match chat delivers free text and ₹5 emojis live, survives a lost reply and denies outsiders", async ({
  browser,
}) => {
  const a = await player(browser, "Chat A", { width: 390, height: 844 });
  const b = await player(browser, "Chat B", { width: 390, height: 844 });
  const outsider = await player(browser, "Outsider");
  const chatEvents: string[] = [];
  b.page.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => chatEvents.push(String(frame.payload))),
  );
  await b.page.reload();
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const start = await state(a.context),
      id = start.match!.id;
    expect(start.match!.endsAt! - start.match!.startedAt!).toBe(600000);
    expect(start.match!.deadline - start.serverNow).toBeLessThanOrEqual(10000);
    expect(
      (await outsider.context.request.get(`/api/ludo/${id}/chat`)).status(),
    ).toBe(403);
    const denied = await outsider.page.evaluate(
      (userId) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://${location.host}/ws`);
          ws.onopen = () =>
            ws.send(
              JSON.stringify({ op: "subscribe", topic: `ludo-chat:${userId}` }),
            );
          ws.onmessage = ({ data }) => {
            const m = JSON.parse(data);
            if (m.op === "denied") {
              ws.close();
              resolve(m.reason);
            }
          };
        }),
      a.id,
    );
    expect(denied).toBe("forbidden");
    await a.page
      .getByRole("button", { name: "Open match emojis · Chat B", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Paid emojis", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    expect((await state(a.context)).balancePaise).toBe(start.balancePaise);
    await a.page
      .getByRole("button", { name: "Paid emojis", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "Match chat", exact: true })
      .click();
    await a.page
      .getByRole("textbox", { name: "Chat message" })
      .fill("Good luck, table! <b>hello</b>");
    await a.page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(b.page.getByRole("log")).toContainText(
      "Good luck, table! <b>hello</b>",
    );
    await expect
      .poll(() =>
        chatEvents.some(
          (event) =>
            event.includes(`ludo-chat:${b.id}`) &&
            event.includes('"op":"event"'),
        ),
      )
      .toBeTruthy();
    expect((await state(a.context)).balancePaise).toBe("99000");
    const requests: any[] = [];
    let dropped = false;
    await b.page.route("**/api/ludo/*/chat", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      requests.push(route.request().postDataJSON());
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.fulfill({
          status: 503,
          json: { error: "Lost message response" },
        });
      } else await route.continue();
    });
    await b.page.getByRole("button", { name: "Paid emojis" }).click();
    await expect(b.page.getByLabel("Paid emoji shop")).toContainText("₹5 each");
    await b.page
      .getByRole("button", { name: "Send Fire for ₹5", exact: true })
      .click();
    await expect(a.page.getByRole("log")).toContainText("🔥");
    await expect(
      b.page.getByRole("button", {
        name: "Retry message · no duplicate charge",
      }),
    ).toBeVisible();
    expect((await state(b.context)).balancePaise).toBe("98500");
    await b.page
      .getByRole("button", { name: "Retry message · no duplicate charge" })
      .click();
    await expect(
      b.page.getByRole("button", {
        name: "Retry message · no duplicate charge",
      }),
    ).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toBe(requests[1].requestId);
    expect((await state(b.context)).balancePaise).toBe("98500");
    await b.page.screenshot({ path: "tmp/ludo-social-checks/chat-emojis.png" });
    await b.page.reload();
    await b.page
      .getByRole("button", { name: "Match chat", exact: true })
      .click();
    await expect(b.page.locator(".ld-chat-emoji")).toHaveCount(1);
    await b.page.setViewportSize({ width: 844, height: 390 });
    const modal = await b.page.getByRole("dialog").boundingBox();
    expect(modal!.y).toBeGreaterThanOrEqual(0);
    expect(modal!.y + modal!.height).toBeLessThanOrEqual(390);
  } finally {
    await b.page.unrouteAll({ behavior: "ignoreErrors" });
    await a.context.close();
    await b.context.close();
    await outsider.context.close();
  }
});

test("ten-minute tie shows both winners, split payouts and visible home tokens", async ({
  browser,
}) => {
  const a = await player(browser, "Tie A", { width: 390, height: 844 });
  const b = await player(browser, "Tie B");
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    await a.context.request.post("/api/test/ludo/time-limit", {
      data: {
        id,
        tokens: [
          [56, 55, 55, 55],
          [56, -1, -1, -1],
        ],
      },
    });
    for (const p of [a, b]) {
      await expect(p.page.getByRole("dialog")).toContainText(
        "You share the prize!",
      );
      await expect(
        p.page.getByRole("dialog").locator(".ld-result-prize"),
      ).toHaveText("₹9");
      await expect(
        p.page.getByRole("dialog").locator(".ld-result-winner"),
      ).toHaveCount(2);
      expect((await state(p.context)).balancePaise).toBe("99900");
    }
    await a.page.screenshot({ path: "tmp/ludo-social-checks/tied-winner.png" });
    await a.page
      .getByRole("button", { name: "View board", exact: true })
      .click();
    await expect(a.page.locator(".ld-token-home")).toHaveCount(2);
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeDisabled();
    await a.page.screenshot({
      path: "tmp/ludo-social-checks/finished-tokens.png",
    });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("sixth missed dice roll removes the player and displays the forfeited entry", async ({
  browser,
}) => {
  const a = await player(browser, "Inactive Player", {
    width: 320,
    height: 740,
  });
  const b = await player(browser, "Still playing");
  try {
    for (const p of [a, b]) {
      await p.page
        .getByRole("button", { name: "4 players Classic battle" })
        .click();
      await p.page.getByRole("button", { name: "Find a match" }).click();
      await expect(p.page.locator(".ld-search-screen")).toBeVisible();
    }
    const id = (await state(a.context)).match!.id;
    await a.context.request.post("/api/test/ludo/advance", { data: { id } });
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    await a.page
      .getByRole("button", { name: "Match chat", exact: true })
      .click();
    await expect(a.page.getByRole("dialog")).toContainText("Match chat");
    await a.context.request.post("/api/test/ludo/inactive", {
      data: { id, seat: 0 },
    });
    await expect(a.page.getByRole("dialog")).toContainText(
      "Removed for inactivity",
    );
    await expect(a.page.getByRole("dialog")).toContainText(
      "entry was forfeited",
    );
    await expect(a.page.getByRole("dialog")).toHaveCount(1);
    expect((await state(b.context)).match!.status).toBe("playing");
    expect((await state(a.context)).balancePaise).toBe("99000");
    await a.page
      .getByRole("button", { name: "View board", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Play again" }),
    ).toBeVisible();
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("all six server results animate for both players, retain their value and sound can be muted", async ({
  browser,
}) => {
  const a = await player(browser, "Dice Player", { width: 390, height: 844 }),
    b = await player(browser, "Other Player", { width: 390, height: 844 });
  try {
    // Measure actual Web Audio samples at the output, rather than a sound callback.
    await a.page.addInitScript(() => {
      const probe = { peak: 0, contexts: [] as AudioContext[] };
      (window as any).__ludoAudioProbe = probe;
      const original = AudioNode.prototype.connect;
      (AudioNode.prototype as any).connect = function (...args: any[]) {
        if (args[0] instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 512;
          original.call(this, analyser);
          original.call(analyser, args[0]);
          probe.contexts.push(this.context);
          const buffer = new Float32Array(512);
          setInterval(() => {
            analyser.getFloatTimeDomainData(buffer);
            for (const n of buffer)
              probe.peak = Math.max(probe.peak, Math.abs(n));
          }, 10);
          return args[0];
        }
        return original.apply(this, args as any);
      };
    });
    await a.page.reload();
    await a.page
      .getByRole("button", { name: "Find a match", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "Find a match", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    const own = a.page.locator(".ld-player[data-you] .ld-die"),
      opponent = b.page.locator(".ld-player:not([data-you]) .ld-die");
    for (const face of [1, 2, 3, 4, 5, 6]) {
      await readyRoll(a.context, a.page, id, 0, face);
      await expect(
        a.page.getByRole("button", { name: "Roll dice", exact: true }),
      ).toBeEnabled();
      const before = (await state(a.context)).match!.state.rollNonce;
      await a.page.evaluate(() => {
        (window as any).__ludoAudioProbe.peak = 0;
      });
      await a.page
        .getByRole("button", { name: "Roll dice", exact: true })
        .click();
      await expect(own).toHaveAttribute("data-phase", "rolling");
      await expect(opponent).toHaveAttribute("data-phase", "rolling");
      await expect(
        a.page.getByRole("button", { name: "Move 1", exact: true }),
      ).toHaveCount(0);
      const motion = await own
        .locator(".ld-die-cube")
        .evaluate(async (element) => {
          const first = getComputedStyle(element).transform;
          await new Promise((r) => setTimeout(r, 80));
          return {
            first,
            second: getComputedStyle(element).transform,
            animations: element.getAnimations().length,
          };
        });
      expect(motion.first).not.toBe(motion.second);
      expect(motion.animations).toBeGreaterThan(0);
      if (face === 6)
        await a.page.screenshot({
          path: "tmp/ludo-dice-checks/rolling.png",
          fullPage: true,
        });
      await expect(own).toHaveAttribute("data-phase", "idle");
      await expect(own).toHaveAttribute("data-value", String(face));
      const facing = await own.evaluate((die, result) => {
        const cube = die.querySelector(".ld-die-cube")!;
        const face = die.querySelector(`.ld-die-face-${result}`)!;
        const world = new DOMMatrix(getComputedStyle(cube).transform).multiply(
          new DOMMatrix(getComputedStyle(face).transform),
        );
        return new DOMPoint(0, 0, 1, 0).matrixTransform(world).z;
      }, face);
      expect(facing).toBeGreaterThan(0.99);
      await expect(opponent).toHaveAttribute("data-value", String(face));
      expect((await state(a.context)).match!.state.rollNonce).toBe(before + 1);
      expect(
        await a.page.evaluate(() => (window as any).__ludoAudioProbe.peak),
      ).toBeGreaterThan(0.005);
    }
    await a.page.screenshot({
      path: "tmp/ludo-dice-checks/landed-six.png",
      fullPage: true,
    });
    await a.page
      .getByRole("button", { name: "Mute sound", exact: true })
      .click();
    await readyRoll(a.context, b.page, id, 1, 2);
    await expect(
      b.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    await a.page.evaluate(() => {
      (window as any).__ludoAudioProbe.peak = 0;
    });
    await b.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(
      a.page.locator(".ld-player:not([data-you]) .ld-die"),
    ).toHaveAttribute("data-value", "2");
    await expect(own).toHaveAttribute("data-value", "6");
    expect(
      await a.page.evaluate(() => (window as any).__ludoAudioProbe.peak),
    ).toBeLessThan(0.00001);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("two-player dice starts from its resting face, keeps spinning through a delayed reply and never overlaps the other die", async ({
  browser,
}) => {
  const a = await player(browser, "Smooth Dice A", { width: 392, height: 850 });
  const b = await player(browser, "Smooth Dice B", { width: 392, height: 850 });
  let release = () => {};
  try {
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const id = (await state(a.context)).match!.id;
    const own = a.page.locator(".ld-player[data-you] .ld-die");
    const observed = b.page.locator(".ld-player:not([data-you]) .ld-die");
    const visibleDice = (page: Page) => page.locator(".ld-die:visible");
    await readyRoll(a.context, a.page, id, 0, 1, [0, 4, -1, -1]);
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(own).toHaveAttribute("data-value", "1");
    await expect(observed).toHaveAttribute("data-value", "1");
    await readyRoll(a.context, a.page, id, 0, 6, [0, 4, -1, -1]);
    const resting = await own
      .locator(".ld-die-cube")
      .evaluate((el) =>
        Array.from(
          new DOMMatrix(getComputedStyle(el).transform).toFloat64Array(),
        ),
      );
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await a.page.route("**/api/ludo/*/action", async (route) => {
      if (route.request().postDataJSON().type === "roll") await pending;
      await route.continue();
    });
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(own).toHaveAttribute("data-phase", "rolling");
    const motion = await own.locator(".ld-die-cube").evaluate(async (el) => {
      const animation = el.getAnimations()[0];
      const first = (animation.effect as KeyframeEffect).getKeyframes()[0]
        .transform as string;
      const times: number[] = [];
      const transforms = new Set<string>();
      const end = performance.now() + 1100;
      while (performance.now() < end) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        times.push(Number(animation.currentTime));
        transforms.add(getComputedStyle(el).transform);
      }
      return {
        from: Array.from(new DOMMatrix(first).toFloat64Array()),
        continuous: times.every((time, i) => i === 0 || time >= times[i - 1]),
        frames: transforms.size,
        running: animation.playState,
        time: Number(animation.currentTime),
        sameAnimation: el.getAnimations()[0] === animation,
      };
    });
    expect(motion.from).toEqual(resting);
    expect(motion.continuous).toBe(true);
    expect(motion.frames).toBeGreaterThan(20);
    expect(motion.running).toBe("running");
    expect(motion.time).toBeGreaterThan(1000);
    expect(motion.sameAnimation).toBe(true);
    await expect(visibleDice(a.page)).toHaveCount(1);
    await expect(visibleDice(b.page)).toHaveCount(1);
    release();
    await expect(own).toHaveAttribute("data-value", "6");
    await expect(observed).toHaveAttribute("data-value", "6");
    await expect(visibleDice(b.page)).toHaveCount(1);
    // A non-six with every token inside changes turns immediately on the server.
    // The previous player's die must stay alone in the tray until it finishes.
    await readyRoll(b.context, b.page, id, 1, 2, [-1, -1, -1, -1]);
    await b.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(
      a.page.locator(".ld-player:not([data-you]) .ld-die"),
    ).toHaveAttribute("data-phase", "rolling");
    await expect(visibleDice(a.page)).toHaveCount(1);
    await expect(visibleDice(b.page)).toHaveCount(1);
    await expect(
      b.page.locator(".ld-player[data-you] .ld-die"),
    ).toHaveAttribute("data-value", "2");
    await expect(
      a.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    await expect(visibleDice(a.page)).toHaveCount(1);
    await expect(visibleDice(b.page)).toHaveCount(1);
    await b.page.setViewportSize({ width: 844, height: 390 });
    await expect(visibleDice(b.page)).toHaveCount(2);
    await finish(a.context, a.page);
  } finally {
    release();
    await a.context.close();
    await b.context.close();
  }
});

test("failed dice requests stop cleanly, retry once and respect reduced motion", async ({
  browser,
}) => {
  const p = await player(
    browser,
    "Retry Dice",
    { width: 320, height: 740 },
    "home",
  );
  try {
    await p.page
      .getByRole("button", { name: "Play against Computer", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Find a match", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeEnabled();
    const initial = await state(p.context);
    await readyRoll(p.context, p.page, initial.match!.id, 0, 6);
    await p.page.route("**/api/ludo/*/action", (route) =>
      route.fulfill({ status: 503, json: { error: "Temporary test outage" } }),
    );
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect(
      p.page.getByRole("button", { name: "Retry last action", exact: true }),
    ).toBeVisible();
    const retryBox = await p.page
      .getByRole("button", { name: "Retry last action", exact: true })
      .boundingBox();
    expect(retryBox!.y).toBeGreaterThanOrEqual(0);
    expect(retryBox!.y + retryBox!.height).toBeLessThanOrEqual(
      p.page.viewportSize()!.height,
    );
    await expect(
      p.page.locator(".ld-player[data-you] .ld-die"),
    ).toHaveAttribute("data-phase", "idle");
    expect((await state(p.context)).match!.state.rollNonce).toBe(0);
    await p.page.unroute("**/api/ludo/*/action");
    await p.page.emulateMedia({ reducedMotion: "reduce" });
    await p.page
      .getByRole("button", { name: "Retry last action", exact: true })
      .click();
    await expect(
      p.page.locator(".ld-player[data-you] .ld-die"),
    ).toHaveAttribute("data-value", "6");
    expect((await state(p.context)).match!.state.rollNonce).toBe(1);
    expect(
      await p.page
        .locator(".ld-die-cube")
        .first()
        .evaluate((el) => el.getAnimations().length),
    ).toBe(0);
    for (const name of ["Mute sound", "Enable music"]) {
      const control = p.page.getByRole("button", { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await expect(
      p.page.getByRole("button", { name: "Move 1", exact: true }),
    ).toBeEnabled();
  } finally {
    await p.context.close();
  }
});

for (const capacity of [2, 4] as const)
  test(`Computer menu starts ${capacity} seats immediately, resumes and settles through the wallet`, async ({
    browser,
  }) => {
    const p = await player(
      browser,
      "Computer Mode Player",
      { width: 390, height: 844 },
      "home",
    );
    try {
      await p.page
        .getByRole("button", { name: "Play against Computer", exact: true })
        .click();
      await expect(
        p.page.getByText("PLAY AGAINST COMPUTER", { exact: true }),
      ).toBeVisible();
      if (capacity === 4)
        await p.page
          .getByRole("button", { name: "4 players Classic battle" })
          .click();
      await p.page.getByRole("button", { name: "Find a match" }).click();
      await expect(
        p.page.getByRole("heading", { name: "Your turn", exact: true }),
      ).toBeVisible();
      await expect(p.page.locator(".ld-search-screen")).toHaveCount(0);
      const before = await state(p.context);
      expect(before.match!.capacity).toBe(capacity);
      expect(
        before.match!.state.players.filter((x) => x?.kind === "computer"),
      ).toHaveLength(capacity - 1);
      expect(before.balancePaise).toBe("99000");
      await p.page.reload();
      await expect(p.page.locator(".ld-match-id")).toContainText(
        before.match!.id.slice(0, 8).toUpperCase(),
      );
      expect((await state(p.context)).balancePaise).toBe("99000");
      await finish(p.context, p.page);
      expect((await state(p.context)).balancePaise).toBe(
        String(99000 + capacity * 900),
      );
    } finally {
      await p.context.close();
    }
  });
async function finish(
  context: BrowserContext,
  page: Page,
  seat = 0,
  _color?: string,
) {
  const t = await state(context);
  await context.request.post("/api/test/ludo/winning-move", {
    data: { id: t.match!.id, seat },
  });
  // Only the fourth token remains outside; its exact home roll now moves automatically.
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "You take the crown!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View board", exact: true }).click();
}
test("two accounts play the same real board, receive private WS events and resume after refresh", async ({
  browser,
}) => {
  const a = await player(browser, "Aarav"),
    b = await player(browser, "Meera");
  const events: string[] = [];
  a.page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => events.push(String(f.payload))),
  );
  await a.page.reload();
  try {
    await a.page
      .getByRole("button", { name: "green tokens", exact: true })
      .click();
    await b.page
      .getByRole("button", { name: "red tokens", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Find a match" }).click();
    await expect(a.page.locator(".ld-search-screen")).toBeVisible();
    await expect(a.page.locator(".ld-versus-seat")).toHaveCount(2);
    await expect(a.page.getByRole("group", { name: "Ludo board" })).toHaveCount(
      0,
    );
    await a.page.screenshot({
      path: "tmp/ludo-start-checks/search-two.png",
      fullPage: true,
    });
    await b.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Your turn", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("heading", { name: "Aarav's turn" }),
    ).toBeVisible();
    const [one, two] = await Promise.all([state(a.context), state(b.context)]);
    expect(one.match!.id).toBe(two.match!.id);
    expect(one.match!.you).toBe(0);
    expect(two.match!.you).toBe(1);
    expect(one.balancePaise).toBe("99000");
    expect(one.match!.state.players.map((p) => p?.color)).toEqual([
      "red",
      "yellow",
    ]);
    await expect(a.page.locator(".ld-seat-green[data-you]")).toBeVisible();
    await expect(b.page.locator(".ld-seat-red[data-you]")).toBeVisible();
    await a.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(async () => (await state(b.context)).match!.state.rollNonce)
      .toBe(1);
    await a.page.reload();
    await expect(a.page.locator(".ld-match-id")).toContainText(
      one.match!.id.slice(0, 8).toUpperCase(),
    );
    expect((await state(a.context)).balancePaise).toBe("99000");
    await expect(a.page.locator(".ld-seat-green[data-you]")).toBeVisible();
    await expect
      .poll(() =>
        events.some(
          (e) => e.includes(`ludo:${a.id}`) && e.includes('"op":"event"'),
        ),
      )
      .toBeTruthy();
    const denied = await a.page.evaluate(
      (other) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://${location.host}/ws`);
          ws.onopen = () =>
            ws.send(
              JSON.stringify({ op: "subscribe", topic: `ludo:${other}` }),
            );
          ws.onmessage = ({ data }) => {
            const m = JSON.parse(data);
            if (m.op === "denied") {
              ws.close();
              resolve(m.reason);
            }
          };
        }),
      b.id,
    );
    expect(denied).toBe("forbidden");
    await finish(a.context, a.page, 0, "green");
    await expect(
      b.page.getByRole("dialog").getByRole("heading", { name: "Aarav wins!" }),
    ).toBeVisible();
    expect((await state(a.context)).balancePaise).toBe("100800");
    if (await a.page.evaluate(() => document.fullscreenEnabled)) {
      await a.page
        .getByRole("button", { name: "Fullscreen", exact: true })
        .click();
      await expect(
        a.page.getByRole("button", { name: "Exit fullscreen" }),
      ).toBeVisible();
      await a.page.getByRole("button", { name: "How to play" }).click();
      await expect(a.page.getByRole("dialog")).toBeVisible();
      await a.page.getByRole("button", { name: "Close", exact: true }).click();
      await a.page.getByRole("button", { name: "Exit fullscreen" }).click();
    }
    await a.page.screenshot({
      path: "tmp/ludo-ui-checks/desktop-result.png",
      fullPage: true,
    });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
test("four separate accounts join one table with four human seats", async ({
  browser,
}) => {
  const players = [];
  for (const name of [
    "Red Player",
    "Green Player",
    "Yellow Player",
    "Blue Player",
  ])
    players.push(await player(browser, name));
  try {
    for (const p of players) {
      await p.page
        .getByRole("button", { name: "4 players Classic battle" })
        .click();
      await p.page.getByRole("button", { name: "Find a match" }).click();
      // The compact phone frame hides the optional match ID during matchmaking.
      await expect(
        p.page.locator(".ld-search-screen, .ld-board"),
      ).toBeVisible();
      if (p === players[0]) {
        await expect(p.page.locator(".ld-versus-seat")).toHaveCount(4);
        await p.page.screenshot({
          path: "tmp/ludo-start-checks/search-four.png",
          fullPage: true,
        });
      }
    }
    const t = await state(players[0].context);
    expect(t.match!.capacity).toBe(4);
    expect(
      t.match!.state.players.every((p) => p?.kind === "human"),
    ).toBeTruthy();
    expect(t.match!.prizePaise).toBe("3600");
    for (const p of players) {
      expect((await state(p.context)).match!.id).toBe(t.match!.id);
      await expect(p.page.locator(".ld-player")).toHaveCount(4);
    }
    await players[0].page.screenshot({
      path: "tmp/ludo-ui-checks/four-players.png",
      fullPage: true,
    });
    await players[3].page
      .getByRole("button", { name: "Leave match", exact: true })
      .click();
    await players[3].page
      .getByRole("button", { name: "Forfeit & leave" })
      .click();
    await expect(
      players[3].page.getByRole("heading", { name: "You left the match" }),
    ).toBeVisible();
    expect((await state(players[0].context)).match!.status).toBe("playing");
    await players[3].page
      .getByRole("button", { name: "View board", exact: true })
      .click();
    await players[3].page.getByRole("button", { name: "Play again" }).click();
    await expect(
      players[3].page.getByRole("button", { name: "Find a match" }),
    ).toBeEnabled();
    await finish(players[0].context, players[0].page);
    expect((await state(players[0].context)).balancePaise).toBe("102600");
  } finally {
    for (const p of players) await p.context.close();
  }
});
test("empty 4-player table fills with three labelled computers after the real countdown", async ({
  browser,
}) => {
  const p = await player(browser, "Solo Player", { width: 390, height: 844 });
  try {
    await p.page
      .getByRole("button", { name: "4 players Classic battle" })
      .click();
    await p.page.getByRole("button", { name: "Find a match" }).click();
    const searchBack = p.page.getByRole("button", {
      name: "Cancel search and refund entry",
    });
    await expect(searchBack).toBeVisible();
    const searchBackBox = await searchBack.boundingBox();
    const viewportBox = await p.page
      .locator('[data-game-viewport="ludo"]')
      .boundingBox();
    expect(searchBackBox!.y).toBeGreaterThanOrEqual(viewportBox!.y);
    await expect(
      p.page.getByRole("heading", { name: "Your turn", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const t = await state(p.context);
    expect(
      t.match!.state.players.filter((x) => x?.kind === "computer"),
    ).toHaveLength(3);
    await expect(
      p.page.locator(".ld-player").filter({ hasText: "Computer" }),
    ).toHaveCount(3);
    const roll = p.page.getByRole("button", { name: "Roll dice", exact: true });
    const rollBox = await roll.boundingBox();
    expect(rollBox!.y + rollBox!.height).toBeLessThanOrEqual(844);
    await roll.click();
    await expect
      .poll(async () => (await state(p.context)).match!.state.rollNonce)
      .toBeGreaterThan(0);
    await p.page.screenshot({
      path: "tmp/ludo-ui-checks/mobile-match.png",
      fullPage: true,
    });
    await p.context.setOffline(true);
    await expect(p.page.locator(".ld-mobile-match-info strong")).toHaveText(
      "Reconnecting…",
      { timeout: 15000 },
    );
    await p.context.setOffline(false);
    await expect(p.page.locator(".ld-mobile-match-info strong")).toHaveText(
      "LUDO LIVE",
    );
    expect((await state(p.context)).match!.id).toBe(t.match!.id);
    let conflict = true;
    await p.page.route("**/api/ludo/*/action", async (route) => {
      if (route.request().postDataJSON()?.type === "leave" && conflict) {
        conflict = false;
        await route.fulfill({
          status: 409,
          json: {
            error: "The board changed. Please try again on the updated board.",
          },
        });
      } else await route.continue();
    });
    await p.page
      .getByRole("button", { name: "Leave match", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Forfeit & leave" }).click();
    await expect
      .poll(async () => (await state(p.context)).match!.status)
      .toBe("finished");
    expect((await state(p.context)).balancePaise).toBe("99000");
    expect(conflict).toBe(false);
  } finally {
    await p.context.setOffline(false);
    await p.context.close();
  }
});
test("lost join response can be retried without double debit; cancellation refunds once", async ({
  browser,
}) => {
  const p = await player(browser, "Retry Player");
  try {
    await p.page.route(
      "**/api/ludo/join",
      async (route) => {
        await route.fetch();
        await route.abort("failed");
      },
      { times: 1 },
    );
    await p.page.getByRole("button", { name: "Find a match" }).click();
    await expect(
      p.page.getByRole("button", { name: "Retry last action" }),
    ).toBeVisible();
    await p.page.getByRole("button", { name: "Retry last action" }).click();
    await expect(
      p.page.getByRole("button", { name: "Cancel & refund entry" }),
    ).toBeEnabled();
    expect((await state(p.context)).balancePaise).toBe("99000");
    await p.page.getByRole("button", { name: "Cancel & refund entry" }).click();
    await expect(
      p.page.getByRole("heading", { name: "Entry refunded" }),
    ).toBeVisible();
    expect((await state(p.context)).balancePaise).toBe("100000");
  } finally {
    await p.context.close();
  }
});
for (const capacity of [2, 4] as const)
  test(`${capacity}-player mobile match keeps dice and legal moves reachable through rotation`, async ({
    browser,
  }) => {
    const p = await player(
      browser,
      "Mobile touch player",
      { width: 320, height: 526 },
      "home",
    );
    const errors: string[] = [];
    p.page.on("pageerror", (e) => errors.push(e.message));
    try {
      await p.page
        .getByRole("button", { name: "Play against Computer", exact: true })
        .click();
      if (capacity === 4)
        await p.page
          .getByRole("button", { name: "4 players Classic battle" })
          .click();
      await p.page
        .getByRole("button", { name: "Find a match", exact: true })
        .click();
      await expect(p.page.locator(".ld-board")).toBeVisible();
      const id = (await state(p.context)).match!.id;
      await readyRoll(p.context, p.page, id, 0, 6);
      const roll = p.page.getByRole("button", {
        name: "Roll dice",
        exact: true,
      });
      await roll.click();
      await expect(
        p.page.getByRole("button", { name: "Move 4", exact: true }),
      ).toBeEnabled();
      for (const viewport of [
        { width: 320, height: 512 },
        { width: 320, height: 526 },
        { width: 360, height: 598 },
        { width: 390, height: 802 },
        { width: 430, height: 890 },
        { width: 844, height: 340 },
        { width: 568, height: 270 },
        { width: 640, height: 230 },
        { width: 844, height: 250 },
        { width: 390, height: 802 },
      ]) {
        await p.page.setViewportSize(viewport);
        await expect
          .poll(async () =>
            p.page
              .locator(".ld-arena")
              .evaluate((e) => e.getBoundingClientRect().bottom),
          )
          .toBeLessThanOrEqual(viewport.height);
        const board = await p.page.locator(".ld-board-wrap").boundingBox();
        expect(Math.abs(board!.width - board!.height)).toBeLessThan(1);
        expect(board!.width).toBeGreaterThanOrEqual(168);
        expect(board!.y).toBeGreaterThanOrEqual(0);
        expect(board!.y + board!.height).toBeLessThanOrEqual(viewport.height);
        if (viewport.width >= 390 && viewport.width < viewport.height) {
          const cards = await p.page
            .locator(".ld-player")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getBoundingClientRect().toJSON()),
            );
          expect(cards).toHaveLength(capacity);
          for (const card of cards) {
            expect(card.width).toBeGreaterThanOrEqual(100);
            expect(card.x).toBeGreaterThanOrEqual(0);
            expect(card.right).toBeLessThanOrEqual(viewport.width);
          }
          if (capacity === 2) {
            expect(cards.every((c) => c.top >= board!.y + board!.height)).toBe(
              true,
            );
            expect(cards[0].right).toBeLessThanOrEqual(cards[1].left);
          } else {
            expect(
              cards.slice(0, 2).every((c) => c.bottom <= board!.y + 1),
            ).toBe(true);
            expect(
              cards
                .slice(2)
                .every((c) => c.top >= board!.y + board!.height - 1),
            ).toBe(true);
          }
        }
        for (const control of [
          roll,
          p.page.getByRole("button", { name: "Move 4", exact: true }),
          p.page.getByRole("button", { name: "Mute sound", exact: true }),
          p.page.getByRole("button", { name: "Game settings", exact: true }),
        ]) {
          const box = await control.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
          expect(
            await control.evaluate((e) => {
              const r = e.getBoundingClientRect();
              return e.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
          ).toBe(true);
        }
        expect(
          await p.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await p.page.screenshot({
          path: `tmp/ludo-mobile-checks/fixture-${capacity}-${viewport.width}x${viewport.height}.png`,
        });
      }
      expect((await state(p.context)).match!.id).toBe(id);
      await p.page.getByRole("button", { name: "Move 4", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await state(p.context)).match!.state.players[0]!.tokens[3],
        )
        .toBe(0);
      await p.page
        .getByRole("button", { name: "Leave match", exact: true })
        .click();
      await expect(
        p.page.getByRole("button", { name: "Forfeit & leave" }),
      ).toBeVisible();
      expect((await state(p.context)).match!.status).toBe("playing");
      await p.page.getByRole("button", { name: "Forfeit & leave" }).click();
      await expect
        .poll(async () => (await state(p.context)).match!.status)
        .toBe("finished");
      expect(errors).toEqual([]);
    } finally {
      await p.context.close();
    }
  });

for (const capacity of [2, 4] as const)
  test(`${capacity}-player menus and matchmaking survive short landscape and portrait rotation`, async ({
    browser,
  }) => {
    const p = await player(
      browser,
      "Rotation player",
      { width: 390, height: 802 },
      "home",
    );
    const views = [
      { width: 568, height: 270 },
      { width: 640, height: 230 },
      { width: 844, height: 340 },
      { width: 390, height: 802 },
    ];
    const visibleControl = async (name: string) => {
      const button = p.page.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await button.click({ trial: true });
    };
    const rotate = async (viewport: { width: number; height: number }) => {
      await p.page.setViewportSize(viewport);
      await expect
        .poll(() =>
          p.page
            .locator('[data-game-viewport="ludo"]')
            .evaluate((e) => e.getBoundingClientRect().bottom),
        )
        .toBeLessThanOrEqual(viewport.height);
      expect(
        await p.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    };
    try {
      for (const viewport of views) {
        await rotate(viewport);
        await visibleControl("Online multiplayer");
        await visibleControl("Play against Computer");
        await visibleControl("Game settings");
      }
      await p.page
        .getByRole("button", { name: "Online multiplayer", exact: true })
        .click();
      for (const viewport of views) {
        await rotate(viewport);
        await visibleControl("blue tokens");
        await visibleControl("4 players Classic battle");
        await visibleControl("Find a match");
      }
      if (capacity === 4)
        await p.page
          .getByRole("button", { name: "4 players Classic battle" })
          .click();
      await p.page
        .getByRole("button", { name: "Find a match", exact: true })
        .click();
      await expect(p.page.locator(".ld-search-screen")).toBeVisible();
      for (const viewport of views) {
        await rotate(viewport);
        await visibleControl("Cancel & refund entry");
        await visibleControl("Mute sound");
        const seats = await p.page.locator(".ld-versus-grid").boundingBox();
        expect(seats!.y + seats!.height).toBeLessThanOrEqual(viewport.height);
      }
      await p.page
        .getByRole("button", { name: "Cancel & refund entry", exact: true })
        .click();
      await expect(
        p.page.getByRole("heading", { name: "Entry refunded" }),
      ).toBeVisible();
      expect((await state(p.context)).balancePaise).toBe("100000");
    } finally {
      await p.context.close();
    }
  });

test("desktop and fullscreen use the phone layout through menus and live play", async ({
  browser,
}) => {
  const p = await player(
    browser,
    "Desktop phone player",
    { width: 1440, height: 900 },
    "home",
  );
  const frame = p.page.locator('[data-game-viewport="ludo"]');
  const centeredPhone = async () => {
    await expect
      .poll(() =>
        frame.evaluate((e) => Math.round(e.getBoundingClientRect().width)),
      )
      .toBe(440);
    const box = (await frame.boundingBox())!;
    expect(
      Math.abs(box.x - (p.page.viewportSize()!.width - box.width) / 2),
    ).toBeLessThan(1);
    expect(await frame.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
  };
  try {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 600 },
    ]) {
      await p.page.setViewportSize(viewport);
      await centeredPhone();
      await expect(p.page.locator(".ld-home-content")).toHaveCSS(
        "flex-direction",
        "column",
      );
      await expect(
        p.page.getByRole("button", { name: "Online multiplayer", exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
    await p.page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => frame.evaluate((e) => e.clientHeight)).toBe(900);
    await p.page.screenshot({ path: "tmp/ludo-desktop-phone-home.png" });
    await p.page
      .getByRole("button", { name: "Online multiplayer", exact: true })
      .click();
    await expect(p.page.locator(".ld-room-card")).toHaveCSS("display", "block");
    await p.page
      .getByRole("button", { name: "4 players Classic battle" })
      .click();
    await p.page.getByRole("button", { name: "Find a match" }).click();
    await expect(p.page.locator(".ld-search-screen")).toBeVisible();
    await centeredPhone();
    await expect(
      p.page.getByRole("button", {
        name: "Cancel & refund entry",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    await p.page
      .getByRole("button", { name: "Cancel & refund entry", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Play against Computer", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Find a match" }).click();
    await expect(p.page.locator(".ld-board")).toBeVisible();
    const matchId = (await state(p.context)).match!.id;
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 600 },
    ]) {
      await p.page.setViewportSize(viewport);
      await centeredPhone();
      await expect(p.page.locator(".ld-mobile-match-header")).toBeVisible();
      await expect(p.page.locator(".ld-in-match > .ld-header")).toBeHidden();
      await expect(p.page.locator(".ld-board-layout")).toHaveCSS(
        "flex-direction",
        "column",
      );
      const board = (await p.page.locator(".ld-board-wrap").boundingBox())!;
      expect(Math.abs(board.width - board.height)).toBeLessThan(1);
      const dock = (await p.page.locator(".ld-action-dock").boundingBox())!;
      expect(dock.y).toBeGreaterThanOrEqual(board.y + board.height);
      await expect(
        p.page.getByRole("button", { name: "Roll dice", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      expect((await state(p.context)).match!.id).toBe(matchId);
    }
    await p.page.screenshot({ path: "tmp/ludo-desktop-phone-match.png" });
    await p.page
      .getByRole("button", { name: "Game settings", exact: true })
      .click();
    await p.page
      .getByRole("button", { name: "Fullscreen", exact: true })
      .click();
    await expect
      .poll(() => p.page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await centeredPhone();
    await p.page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    await p.page.getByRole("button", { name: "Close", exact: true }).click();
    await p.page
      .getByRole("button", { name: "Roll dice", exact: true })
      .click();
    await expect
      .poll(async () => (await state(p.context)).match!.state.rollNonce)
      .toBeGreaterThan(0);
  } finally {
    await p.context.close();
  }
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`lobby, controls and rules fit ${viewport.width}x${viewport.height}`, async ({
    browser,
  }) => {
    const p = await player(browser, "Mobile Player", viewport, "home");
    const errors: string[] = [];
    p.page.on("pageerror", (e) => errors.push(e.message));
    try {
      for (const name of ["Online multiplayer", "Play against Computer"]) {
        const tile = p.page.getByRole("button", { name, exact: true });
        const box = await tile.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await p.page.screenshot({
        path: `tmp/ludo-start-checks/home-${viewport.width}.png`,
        fullPage: true,
      });
      await p.page
        .getByRole("button", { name: "Game settings", exact: true })
        .click();
      await p.page.getByRole("button", { name: "Sound", exact: true }).click();
      await expect(
        p.page.getByRole("button", { name: "Sound", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await p.page.getByRole("button", { name: "Music", exact: true }).click();
      await expect(
        p.page.getByRole("button", { name: "Music", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      await p.page.reload();
      await p.page
        .getByRole("button", { name: "Game settings", exact: true })
        .click();
      await expect(
        p.page.getByRole("button", { name: "Sound", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        p.page.getByRole("button", { name: "Music", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await p.page.getByRole("button", { name: "Music", exact: true }).click();
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      await p.page
        .getByRole("button", { name: "Online multiplayer", exact: true })
        .click();
      expect(
        await p.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      const button = p.page.getByRole("button", { name: "Find a match" });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThan(150);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await p.page.getByRole("button", { name: "Higher entry fee" }).click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹90");
      await p.page
        .getByRole("button", { name: "4 players Classic battle" })
        .click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹180");
      await p.page.getByRole("button", { name: "Lower entry fee" }).click();
      await expect(p.page.locator(".ld-prize b")).toHaveText("₹36");
      await p.page
        .getByRole("button", { name: "Game rules", exact: true })
        .click();
      await expect(p.page.getByRole("dialog")).toContainText("10%");
      await expect(p.page.getByRole("dialog")).toContainText("platform funds");
      expect(errors).toEqual([]);
      await p.page.getByRole("button", { name: "Close", exact: true }).click();
      if (viewport.width === 320) {
        await p.page.route("**/api/ludo/state", async (route) => {
          const response = await route.fetch();
          const json = await response.json();
          await route.fulfill({
            response,
            json: { ...json, balancePaise: "1000000000000" },
          });
        });
        await p.page.reload();
        await expect(p.page.locator(".ld-wallet b")).toContainText(
          "10,00,00,00,000",
        );
        const rules = p.page.getByRole("button", {
          name: "Game rules",
          exact: true,
        });
        const headerBox = await rules.boundingBox();
        expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(320);
        await rules.click();
        await expect(p.page.getByRole("dialog")).toBeVisible();
        await p.page
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await p.page.screenshot({
        path: `tmp/ludo-ui-checks/preview-${viewport.width}.png`,
        fullPage: true,
      });
    } finally {
      await p.context.close();
    }
  });
