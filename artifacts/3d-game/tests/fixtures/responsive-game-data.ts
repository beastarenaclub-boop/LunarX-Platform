import type { Page } from "@playwright/test";
import { mockGames } from "./compact-game-data";
import { quotes } from "../../../api-server/src/services/dragonTigerOneDayMath";
import { createForexStore } from "../../../../lib/forex/store.mjs";
import { quoteFixture } from "../../../../lib/forex/tests/quote-fixture.mjs";

export async function mockResponsiveGame(page: Page, game: string) {
  await mockGames(page);
  if (game === "chicken-road") {
    await page.route("**/api/chicken-road/state", route => route.fulfill({ json: { round: null, history: [] } }));
  }
  if (game === "dragon-tiger-one-day") {
    await page.route("**/api/dragon-tiger-one-day/**", route => {
      const now = Date.now();
      return route.fulfill({ json: {
        serverNow: now, balancePaise: "1000000", quoteId: "1:first:v1", quotes: quotes(), slips: [], recent: [], history: [],
        round: { id: 1, phase: "first", phaseEndsAt: now + 120000, firstClosesAt: now + 120000, secondOpensAt: now + 123000, secondClosesAt: now + 138000, revealsAt: now + 141000, endsAt: now + 148000, commitment: "a".repeat(64) },
      } });
    });
  }
  if (game === "forex-trading") {
    const now = Math.floor(Date.now() / 60000) * 60000 + 5000;
    const store = createForexStore(":memory:", { now: () => now });
    const quotes = quoteFixture();
    await page.route("**/api/forex/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/quotes")
      ? quotes : { mode: "wallet", currency: "INR", ...store.state("responsive-player") } }));
    return () => store.close();
  }
  return () => {};
}
