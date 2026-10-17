import { expect, type Page } from "@playwright/test";
import {
  RACING_BIKES,
  racingVenue,
  type RacingBetReceipt,
  type RacingLiveRound,
} from "@workspace/api-zod/bike-racing-game";

function makeBikePlan() {
  const order = [3, 1, 6, 4, 2, 5];
  return { order, duration: 20, runners: RACING_BIKES.map(b => ({ id: b.id,
    lane: b.id - 1, finishTime: 18 + order.indexOf(b.id) * .28,
    points: [0, .13, .28, .49, .71, .89, 1],
  })) };
}
export async function setup(
  page: Page,
  options: {
    reject?: boolean;
    lostResponse?: boolean;
    holdBetting?: boolean;
    scene?: boolean;
  } = {},
) {
  await page.clock.install();
  // Wallet scenarios exercise the supported timing fallback; the visual case
  // separately loads the real assets with an extended initial betting window.
  if (!options.scene) await page.route("**/assets/bike-racing/models/rider.glb", r => r.abort());
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    ),
  );
  await page.routeWebSocket("**/ws", (ws) => ws.onMessage(() => {}));
  let balance = 1000000n,
    lost = false,
    origin = 0,
    serverNow = Date.now();
  let race: RacingLiveRound & { plan: ReturnType<typeof makeBikePlan> };
  const posts: any[] = [],
    errors: string[] = [],
    slips: RacingBetReceipt[] = [];
  const config = {
    enabled: true,
    minStakePaise: "100",
    maxStakePaise: "50000000",
    bikes: RACING_BIKES.map((h) => ({
      id: h.id,
      multiplier: 5.82,
    })),
  };
  const rounds = new Map<string, typeof race>();
  function current(venueId: string, now: number) {
    const duration = 20000;
    const cycle = 20000 + duration + 5000;
    const slot = options.holdBetting ? 0 : Math.floor((now - origin) / cycle);
    const id = `live-${venueId}-${slot}`;
    let round = rounds.get(id);
    if (!round) {
      const bettingOpensAt = origin + slot * cycle;
      const startedAt =
        bettingOpensAt + (options.holdBetting ? 3600000 : 20000);
      round = {
        id,
        venueId,
        bettingOpensAt,
        startedAt,
        endsAt: startedAt + duration,
        nextRoundAt: startedAt + duration + 5000,
        phase: "betting",
        plan: makeBikePlan(),
        winnerId: null,
        serverSeedHash: "test-commitment",
        config,
      };
      rounds.set(id, round);
    }
    round.phase =
      now < round.startedAt
        ? "betting"
        : now < round.endsAt
          ? "racing"
          : "results";
    round.winnerId = round.phase === "results" ? round.plan.order[0] : null;
    return round;
  }
  function settle(now: number) {
    for (const bet of slips)
      if (bet.status === "placed" && now >= bet.endsAt) {
        const round = rounds.get(bet.roundId)!;
        bet.status = "finished";
        bet.winnerId = round.plan.order[0];
        const win = bet.bets.find((b) => b.bikeId === bet.winnerId);
        bet.payoutAmount = win
          ? (
              (BigInt(win.amountPaise) *
                BigInt(
                  Math.round(config.bikes[bet.winnerId - 1].multiplier * 100),
                )) /
              100n
            ).toString()
          : "0";
        balance += BigInt(bet.payoutAmount);
      }
  }
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/bike-racing/game/live") {
      try {
        serverNow = await page.evaluate(() => Date.now());
      } catch {
        await route.abort("aborted").catch(() => {});
        return;
      }
      if (!origin) origin = serverNow;
    }
    const now = serverNow;
    settle(now);
    let body: unknown = {};
    if (path === "/api/auth/me")
      body = {
        id: "bike-browser-test",
        displayName: "Racer",
        email: "racer@example.test",
        role: "player",
      };
    else if (path === "/api/game/registry") body = [];
    else if (path.includes("/wallet/"))
      body = { balance: balance.toString(), currency: "INR", scope: "lunar" };
    else if (path === "/api/bike-racing/game/config") body = config;
    else if (path === "/api/bike-racing/game/live") {
      const input =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
      race = current(
        input?.venueId ?? url.searchParams.get("venueId") ?? "apex",
        now,
      );
      let acceptedBet: RacingBetReceipt | undefined;
      if (input) {
        posts.push(input);
        if (options.reject)
          return route.fulfill({
            status: 400,
            json: { detail: "Insufficient wallet balance." },
          });
        acceptedBet = slips.find((b) => b.requestId === input.requestId);
        if (!acceptedBet) {
          if (input.roundId !== race.id || race.phase !== "betting")
            return route.fulfill({
              status: 409,
              json: { detail: "Betting is closed for this round." },
            });
          if (slips.some((b) => b.roundId === race.id))
            return route.fulfill({
              status: 409,
              json: { detail: "Your bet is already accepted." },
            });
          const stake = input.bets.reduce(
            (sum: bigint, b: any) => sum + BigInt(b.amountPaise),
            0n,
          );
          balance -= stake;
          acceptedBet = {
            id: `bet-${slips.length}`,
            roundId: race.id,
            requestId: input.requestId,
            venueId: race.venueId,
            startedAt: race.startedAt,
            endsAt: race.endsAt,
            status: "placed",
            bets: input.bets,
            totalStake: stake.toString(),
            payoutAmount: "0",
            winnerId: null,
          };
          slips.unshift(acceptedBet);
        }
        if (options.lostResponse && !lost) {
          lost = true;
          return route.abort("connectionreset");
        }
      }
      body = {
        serverNow: now,
        balance: balance.toString(),
        race: { ...race, plan: race.phase === "betting" ? null : race.plan },
        myBet: slips.find((b) => b.roundId === race.id) ?? null,
        history: slips.filter((b) => b.status === "finished"),
        acceptedBet,
      };
    } else if (path.includes("/config/"))
      body = { enabled: true, houseEdge: 0.03, maxMultiplier: 1000 };
    return route.fulfill({ json: body });
  });
  await page.goto(
    process.env.BIKE_GAME_URL ?? "http://127.0.0.1:5174/bike-racing",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByTestId("bike-6")).toBeEnabled({ timeout: 30000 });
  async function advanceTo(target: number) {
    const now = await page.evaluate(() => Date.now());
    await page.clock.fastForward(Math.max(1, target - now));
    await page.clock.runFor(1100);
  }
  return {
    posts,
    errors,
    get race() {
      return race;
    },
    async freshWindow() {
      options.holdBetting = false;
      origin = await page.evaluate(() => Date.now());
      rounds.clear();
      await page.clock.runFor(1200);
    },
    async start() {
      await advanceTo(race.startedAt + 100);
      await expect(page.locator('[data-phase="racing"]')).toBeVisible();
    },
    async finish() {
      await advanceTo(race.endsAt + 100);
      await expect(page.getByTestId("bike-result")).toBeVisible();
    },
    async next() {
      await advanceTo(race.nextRoundAt + 100);
      await expect(page.locator('[data-phase="betting"]')).toBeVisible();
    },
    advanceTo,
  };
}
