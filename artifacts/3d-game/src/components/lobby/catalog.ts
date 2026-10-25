import { INSTANT_COLLECTION, REQUESTED_INSTANT_CODES } from "@workspace/api-zod/instant-collection";
import { CRASH_THEMES } from "@/game/crashThemes";
import chicken from "@/assets/lobby/chicken-road.svg";
import dragonTiger from "@/assets/lobby/dragon-tiger.svg";
import vegetables from "@/assets/lobby/vegetable-bowl.svg";
import colour from "@/assets/lobby/wingo.svg";
import forex from "@/assets/lobby/forex.svg";
import lottery from "@/assets/lobby/lottery.svg";
import prizeLotto from "@/assets/lobby/prize-lotto.svg";
import rummy from "@/assets/lobby/rummy.svg";
import { POKER_ART } from "@/components/poker/artwork";
import crazyTime from "@/assets/crazy-time/studio-v2-lobby.jpg";
import teenPattiLive from "@/assets/teenpatti/naina-betting-poster.jpg";
import { SPORTS } from "../../../../../lib/virtual-sports/catalog.mjs";

export type PrimaryCategory =
  | "crash"
  | "instant"
  | "live"
  | "table"
  | "racing"
  | "lottery";
export type GameFamily =
  | "ludo"
  | "roulette"
  | "poker"
  | "teen-patti"
  | "baccarat"
  | "dragon-tiger"
  | "andar-bahar"
  | "lucky-7"
  | "blackjack"
  | "rummy"
  | "wheel"
  | "chicken-road"
  | "dice-games"
  | "racing-games";
export type Category = "all" | "new" | PrimaryCategory | GameFamily;
export interface LobbyGame {
  id: string;
  name: string;
  route: string;
  provider: string;
  category: PrimaryCategory;
  artwork?: string;
  artworkHasTitle?: boolean;
  artworkFit?: "cover" | "contain";
  accent: string;
  label?: string;
  enabled: boolean;
  registryCode?: string;
  tags?: string[];
}
export interface RegistryEntry {
  gameCode: string;
  title: string;
  route: string;
  enabled: boolean;
}

// Share the storefront's curated trending order across both lobbies.
export const TOP_GAME_IDS = [
  "ludo",
  "roulette",
  "teen-patti-live",
  "lucky-7-live",
  "crazy-time",
  "baccarat",
  "andar-bahar-live",
  "dragon-tiger-one-day",
];

export function isNewGame(game: LobbyGame): boolean {
  return game.enabled && game.label === "NEW";
}

export function compareTopGames(a: LobbyGame, b: LobbyGame): number {
  const rank = (item: LobbyGame) => {
    const index = item.enabled ? TOP_GAME_IDS.indexOf(item.id) : -1;
    return index < 0 ? TOP_GAME_IDS.length : index;
  };
  return Number(isNewGame(b)) - Number(isNewGame(a)) || rank(a) - rank(b);
}

const posters = import.meta.glob("../../assets/lobby/game-*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const poster = (id: string) => posters[`../../assets/lobby/game-${id}.jpg`];
const game = (
  id: string,
  name: string,
  category: LobbyGame["category"],
  accent: string,
  extra: Partial<LobbyGame> = {},
): LobbyGame => ({
  id,
  name,
  category,
  accent,
  route: `/${id}`,
  provider: "Lunar Originals",
  artwork: poster(id),
  enabled: true,
  ...extra,
});
const crash = (id: string) => {
  const theme = CRASH_THEMES[id];
  return game(id, theme.name, "crash", theme.accent, {
    route: theme.route,
    provider:
      theme.provider === "Originals" ? "Lunar Originals" : theme.provider,
  });
};

// One catalog for every view. Only implemented player routes belong here.
// The top section and remaining section partition this list, never repeat it.
export const LOBBY_GAMES: LobbyGame[] = [
  ...SPORTS.map(s => game(`virtual-${s.id}`, s.name, "racing", s.color, { route: `/virtual-sports/${s.id}`, artwork: `${import.meta.env.BASE_URL}media/virtual-sports/${s.id}.jpg`, provider: "Arena Virtual Sports", label: "NEW" })),
  ...INSTANT_COLLECTION.map(g => game(g.code, g.name, "instant", g.accent, { artwork: import.meta.env.BASE_URL + 'media/instant/' + g.code + '.svg', label: "INSTANT" })),
  crash("jetx"),
  game("chicken-road", "Chicken Road", "instant", "#c2e748", {
    artwork: chicken,
    artworkHasTitle: true,
    label: "NEW",
  }),
  crash("fury"),
  game("prize-lotto", "Prize Lotto", "lottery", "#d3bc65", {
    artwork: prizeLotto,
    artworkHasTitle: true,
    label: "NEW",
  }),
  game("mines", "Mines", "instant", "#86efac"),
  game("plinko", "Plinko", "instant", "#f9a8d4"),
  game("lottery", "Irland Lotto", "lottery", "#facc15", {
    artwork: lottery,
    artworkHasTitle: true,
  }),
  game("rummy", "Rummy Royale", "table", "#e3c175", {
    artwork: rummy,
    artworkHasTitle: true,
  }),
  game("ludo", "Ludo Live", "table", "#ffe08a", {
    artwork: `${import.meta.env.BASE_URL}media/ludo/lobby-casino-v2.jpg`,
    artworkHasTitle: true,
    artworkFit: "cover",
    label: "NEW",
    tags: ["ludo", "board game", "multiplayer", "2 players", "4 players", "computer"],
  }),
  game("poker-one-day", "Poker 1-Day", "table", "#f3ce41", { artwork: POKER_ART["poker-one-day"].src, artworkHasTitle: true, label: "NEW", tags: ["poker", "1 day", "holdem"] }),
  game("poker-20-20", "20-20 Poker", "table", "#84c5ee", { artwork: POKER_ART["poker-20-20"].src, artworkHasTitle: true, label: "NEW", tags: ["poker", "20-20", "holdem"] }),
  game("poker-six-players", "Poker 6 Players", "table", "#00b48a", { artwork: POKER_ART["poker-six-players"].src, artworkHasTitle: true, label: "NEW", tags: ["poker", "6 players", "holdem"] }),
  game("lucky-7", "Lucky 7", "table", "#f9d364"),
  game("wheel-2-live", "Wheel 2.0 Live", "live", "#d683ff", { artwork: `${import.meta.env.BASE_URL}media/wheel20-live/studio-poster-v1.jpg`, label: "NEW", tags: ["wheel", "wheel 2.0", "live"] }),
  game("lucky-7-live", "Lucky 7 Live", "live", "#e5c88e", {
    artwork: `${import.meta.env.BASE_URL}media/lucky7-live/dealer-natural-poster-v3.jpg`,
    label: "NEW",
  }),
  game("andar-bahar-live", "Andar Bahar Live", "live", "#dcc38b", {
    artwork: `${import.meta.env.BASE_URL}media/andar-bahar-live/poster-v1.jpg`,
    registryCode: "andar-bahar",
    label: "NEW",
  }),
  game("wingo", "Lunar Colour Trading", "instant", "#c4b5fd", {
    route: "/lunar-colour-trading",
    artwork: colour,
    artworkHasTitle: true,
  }),
  game("teen-patti-joker", "Teenpatti Joker 20-20", "table", "#e879df", {
    artwork: `${import.meta.env.BASE_URL}media/teenpatti-joker/lobby-title-v1.webp`,
    artworkHasTitle: true,
    artworkFit: "contain",
    label: "NEW",
    tags: ["teenpatti", "teen patti", "joker", "20-20", "cards"],
  }),
  game("teen-patti-live", "Teen Patti Live", "live", "#ffc67d", {
    artwork: teenPattiLive,
    label: "LIVE",
  }),
  game("crazy-time", "Crazy Time", "live", "#f0abfc", {
    artwork: crazyTime,
    label: "LIVE",
  }),
  game("wild-trails", "Horse Racing", "racing", "#edcf9e", {
    route: "/horse-racing",
    registryCode: "horse-racing",
  }),
  game("bike-racing", "Bike Racing", "racing", "#93c5fd", {
    artwork: `${import.meta.env.BASE_URL}assets/bike-racing/photo/reference-bike.png`,
  }),
  game("forex-trading", "Forex Trading", "instant", "#f4d694", {
    artwork: forex,
    artworkHasTitle: true,
  }),
  game("dragon-tiger-one-day", "One Day Dragon Tiger", "live", "#fde68a", {
    artwork: `${import.meta.env.BASE_URL}media/dragon-tiger-one-day/dealer-studio.jpg`,
    label: "LIVE",
  }),
  game("dragon-tiger", "Dragon Tiger", "table", "#fb923c", {
    artwork: dragonTiger,
    artworkHasTitle: true,
  }),
  game("roulette", "Roulette", "table", "#fca5a5"),
  game("blackjack", "Blackjack", "table", "#fde68a"),
  game("baccarat", "Baccarat VIP", "live", "#e5c88e", {
    artwork: `${import.meta.env.BASE_URL}media/baccarat/clean-table.png`,
    label: "LIVE",
  }),
  game("teen-patti", "Teen Patti 20/20", "table", "#fdba74"),
  game("andar-bahar", "Andar Bahar", "table", "#fda4af"),
  game("dice", "Dice", "instant", "#a5b4fc"),
  game("vegetable-bowl", "Vegetable Bowl", "instant", "#bef264", {
    artwork: vegetables,
    artworkHasTitle: true,
  }),
];

for (const game of LOBBY_GAMES) {
  if (game.category === "instant" || game.category === "crash") game.tags = [...new Set([...(game.tags ?? []), "instant"])];
  if (REQUESTED_INSTANT_CODES.includes(game.id)) game.label = "INSTANT";
  if (game.label === "NEW") game.tags = [...new Set([...(game.tags ?? []), "new"])];
}
LOBBY_GAMES.sort((a, b) => {
  const rank = (id: string) => { const i = REQUESTED_INSTANT_CODES.indexOf(id); return i < 0 ? 100 : i; };
  return rank(a.id) - rank(b.id);
});
const canonicalRoute = (route: string) => {
  const path = route.split(/[?#]/)[0].replace(/\/+$/, "");
  return (
    (
      {
        "/wingo": "/lunar-colour-trading",
        "/horse-riding": "/horse-racing",
      } as Record<string, string>
    )[path] ?? path
  );
};

export function resolveCatalog(registry?: RegistryEntry[]): LobbyGame[] {
  const byCode = new Map(
    (registry ?? []).map((entry) => [entry.gameCode, entry]),
  );
  const ids = new Set<string>();
  const routes = new Set<string>();
  return LOBBY_GAMES.flatMap((item) => {
    const route = canonicalRoute(item.route);
    if (ids.has(item.id) || routes.has(route)) return [];
    ids.add(item.id);
    routes.add(route);
    const entry = byCode.get(item.registryCode ?? item.id);
    // Keep the implemented SPA route; registry aliases may point to legacy apps.
    return [{ ...item, route, enabled: entry?.enabled ?? item.enabled }];
  }).sort(compareTopGames);
}
