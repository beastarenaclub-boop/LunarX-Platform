import type { Page } from "@playwright/test";
import { initialTable } from "../../src/game/rummy/engine";
export async function mockGames(page: Page, options: { sound?: boolean } = {}) {
  await page.addInitScript((sound) =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ musicOnByDefaultMigrated: true, settings: { onboarded: true, sound, music: false } }),
    ),
    options.sound ?? false,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Isolate layout assertions from both live rounds and Vite hot reloads.
  await page.routeWebSocket("**/*", (ws) => ws.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const now = Date.now();
    const config = {
      enabled: true,
      houseEdge: 0.15,
      maxMultiplier: 1000,
      minStakePaise: "1000",
      maxStakePaise: "50000000",
      bettingWindowMs: 120000,
      revealDurationMs: 5000,
      settleDurationMs: 5000,
      maxBetsPerRound: 10,
      minTarget: 2,
      maxTarget: 98,
      payouts: {
        under: 2.04,
        exactly: 5.1,
        over: 2.04,
        playerA: 1.95,
        playerB: 1.95,
        tie: 8,
        pairPlus: {
          pair: 2,
          color: 5,
          sequence: 7,
          pureSequence: 31,
          trail: 36,
        },
      },
    };
    let json: unknown = {};
    if (p === "/api/auth/me")
      json = {
        id: "viewport-test",
        email: "viewport@example.test",
        displayName: "Viewport",
        role: "player",
      };
    else if(p.startsWith("/api/crash/")) json = {id:"crash-layout", gameCode:p.split("/")[3],phase:"betting",now,startsAt:now+120000,bettingMs:120000,multiplier:1,nextRoundAt:null,crashPoint:null,serverSeed:null,serverSeedHash:"layout",clientSeed:"layout",nonce:0,version:3,bets:[]};
    else if (p.startsWith("/api/wingo/"))
      json = {
        serverTime: now, player: { id: "viewport-test", balance: 1000000 },
        round: { period: "202610030001", duration: 30, start: now, ends: now + 120000, commitment: "test" },
        history: [{ period: "202610030000", number: 7, ends: now - 1000, commitment: "test", secret: "test" }],
        bets: [], summary: { played: 0, won: 0, profit: 0 }, pending: 0, lockSeconds: 5, minStake: 100, maxStake: 1000000,
      };
    else if (p.startsWith("/api/dragon-tiger/"))
      json = {
        serverNow: now,
        mode: "wallet",
        online: 1,
        round: {
          id: 1,
          phase: "betting",
          closesAt: now + 120000,
          revealsAt: now + 125000,
          endsAt: now + 130000,
        },
        player: { balance: 10000, net: 0, wins: 0, played: 0, rank: null },
        myBet: null,
        lastResult: null,
        leaderboard: [],
        history: [],
      };
    else if (p.startsWith("/api/rummy/"))
      json = {
        table: { ...initialTable(), balance: 10000 },
        auto: null,
        autoPlay: false,
        notice: "",
        version: 0,
        deadline: 0,
        serverNow: now,
      };
    else if (p.includes("/config")) json = config;
    else if (p.endsWith("/round"))
      json = {
        roundId: "viewport-round",
        gameCode: p.split("/")[2],
        phase: "betting",
        now,
        bettingEndsAt: now + 120000,
        revealEndsAt: now + 125000,
        settleEndsAt: now + 130000,
        config,
        serverSeedHash: "test",
        clientSeed: "test",
        nonce: 1,
        outcome: null,
        serverSeed: null,
        totalStake: "0",
        playerCount: 0,
        liveBets: [],
        myBets: [],
        recent: [],
      };
    else if (p.includes("/wallet/"))
      json = { balance: "1000000", currency: "INR", scope: "lunar" };
    else if (/recent|registry|banners/.test(p)) json = [];
    else if (/active$/.test(p)) json = null;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  });
}
