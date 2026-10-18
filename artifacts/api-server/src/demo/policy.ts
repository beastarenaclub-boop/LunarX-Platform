// Closed allowlist: a demo request must never reach real money/account routes.
export const DEMO_GAME_ROOTS = new Set([
  "instant", "virtual-sports", "mines", "chicken-road", "plinko", "dice",
  "horse-racing", "bike-racing", "roulette", "baccarat", "teen-patti",
  "teen-patti-live", "blackjack", "andar-bahar", "lucky-7", "lucky-7-live",
  "wheel-2-live", "7up7down", "crazy-time", "dragon-tiger",
  "dragon-tiger-one-day", "rummy", "vegetable-bowl", "wingo", "forex",
  "lottery", "prize-lotto", "crash", "lunar", "bets",
]);

export function demoRouteAllowed(method: string, path: string) {
  if (/^\/api\/prize-lotto\/tickets\/[^/]+\/claim\/?$/i.test(path)) return false;
  const match = /^\/api\/([^/]+)(?:\/|$)/.exec(path);
  if (!match || !["GET", "POST"].includes(method)) return false;
  if (DEMO_GAME_ROOTS.has(match[1])) return true;
  if (method !== "GET") return false;
  if (/^\/api\/wallet\/(balance|balances|transactions)$/.test(path)) return true;
  return /^\/api\/game\/(registry|config\/[^/]+\/public|rounds(?:\/[^/]+\/verify)?)$/.test(path);
}
