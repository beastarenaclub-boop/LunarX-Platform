/** Display-only practice characters. Never real presence, bets, or wallet data. */
export const DEMO_ACTIVITY_LIMIT = 100;
export const DEMO_ACTIVITY_STATES = [
  "Choosing a demo stake",
  "Playing a practice round",
  "Reviewing a demo result",
] as const;

export function resolveDemoActivityGame(
  catalog: readonly { id: string; route: string; registryCode?: string }[],
  location: string,
  fallback?: string,
  launcherGame?: string | null,
) {
  const route = catalog.find((item) => item.route === location);
  if (route) return route.id;
  const raw =
    location === "/wingo"
      ? "wingo"
      : location === "/launcher"
        ? launcherGame
        : fallback;
  const code =
    raw === "rummy-royale" ? "rummy" : raw === "aviator" ? "lunar" : raw;
  return (
    catalog.find((item) => item.id === code)?.id ??
    catalog.find((item) => item.registryCode === code && code)?.id ??
    null
  );
}

export function demoActivitySnapshot(
  gameCodes: readonly string[],
  now: number,
) {
  const games = [...new Set(gameCodes)].sort();
  const players: { id: string; game: string; state: string }[] = [];
  if (!games.length)
    return { players, total: 0, byGame: {} as Record<string, typeof players> };
  // One shared deterministic pool across routes and tabs, not 100 per game.
  const rotation = Math.floor(now / 120000) % games.length;
  const byGame: Record<string, typeof players> = Object.fromEntries(
    games.map((code) => [code, []]),
  );
  for (let i = 0; i < DEMO_ACTIVITY_LIMIT; i++) {
    const player = {
      id: `DEMO ${String(i + 1).padStart(3, "0")}`,
      game: games[(i + rotation) % games.length],
      state:
        DEMO_ACTIVITY_STATES[
          (Math.floor(now / 6000) + i) % DEMO_ACTIVITY_STATES.length
        ],
    };
    players.push(player);
    byGame[player.game].push(player);
  }
  return { players, total: players.length, byGame };
}
