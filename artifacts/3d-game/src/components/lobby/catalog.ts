import { LOBBY_ENTRIES } from "@workspace/api-zod/lobby-catalog";
import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
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
import { HANDOFF_ART } from "./handoff-artwork";
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
  | "mega-ball"
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
  "ice-fish",
  "lunar",
  "roulette-american",
  "roulette-mini",
  "fun-target",
  "mega-ball",
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
const entries = new Map(LOBBY_ENTRIES.map((entry) => [entry.id, entry]));
const game = (
  id: string,
  accent: string,
  artwork: Partial<LobbyGame> = {},
): LobbyGame => {
  const entry = entries.get(id);
  if (!entry) throw new Error(`Missing lobby metadata for ${id}`);
  return {
    ...entry,
    accent,
    artwork: HANDOFF_ART[id] ?? poster(id),
    ...artwork,
  };
};
const crash = (id: string) => game(id, CRASH_THEMES[id].accent);

// One catalog for every view. Only implemented player routes belong here.
// The top section and remaining section partition this list, never repeat it.
export const LOBBY_GAMES: LobbyGame[] = [
  { ...crash("lunar"), artworkHasTitle: true, artworkFit: "contain" },
  game("roulette-american", "#d9b96d", {
    artworkHasTitle: true,
    artworkFit: "contain",
  }),
  game("roulette-mini", "#64cabc", {
    artworkHasTitle: true,
    artworkFit: "contain",
  }),
  game("fun-target", "#ff8b43", {
    artworkHasTitle: true,
    artworkFit: "contain",
  }),
  game("mega-ball", "#e4ca74", {
    artwork: `${import.meta.env.BASE_URL}media/mega-ball/banner.jpg`,
    artworkHasTitle: true,
  }),
  game("ice-fish", "#71dbff", {
    artwork: `${import.meta.env.BASE_URL}media/ice-fish/banner-v1.webp`,
    artworkHasTitle: true,
  }),
  ...SPORTS.map((s) =>
    game(`virtual-${s.id}`, s.color, {
      artwork: `${import.meta.env.BASE_URL}media/virtual-sports/${s.id}.jpg`,
    }),
  ),
  ...INSTANT_COLLECTION.map((g) =>
    game(g.code, g.accent, {
      artwork: import.meta.env.BASE_URL + "media/instant/" + g.code + ".svg",
    }),
  ),
  crash("jetx"),
  game("chicken-road", "#c2e748", {
    artwork: chicken,
    artworkHasTitle: true,
  }),
  crash("fury"),
  game("prize-lotto", "#d3bc65", {
    artwork: prizeLotto,
    artworkHasTitle: true,
  }),
  game("mines", "#86efac"),
  game("plinko", "#f9a8d4"),
  game("lottery", "#facc15", {
    artwork: lottery,
    artworkHasTitle: true,
  }),
  game("rummy", "#e3c175", {
    artwork: rummy,
    artworkHasTitle: true,
  }),
  game("ludo", "#ffe08a", {
    artwork: `${import.meta.env.BASE_URL}media/ludo/lobby-casino-v2.jpg`,
    artworkHasTitle: true,
    artworkFit: "cover",
  }),
  game("poker-one-day", "#f3ce41", {
    artwork: POKER_ART["poker-one-day"].src,
    artworkHasTitle: true,
  }),
  game("poker-20-20", "#84c5ee", {
    artwork: POKER_ART["poker-20-20"].src,
    artworkHasTitle: true,
  }),
  game("poker-six-players", "#00b48a", {
    artwork: POKER_ART["poker-six-players"].src,
    artworkHasTitle: true,
  }),
  game("lucky-7", "#f9d364"),
  game("wheel-2-live", "#d683ff", {
    artwork: `${import.meta.env.BASE_URL}media/wheel20-live/studio-poster-v1.jpg`,
  }),
  game("lucky-7-live", "#e5c88e", {
    artwork: `${import.meta.env.BASE_URL}media/lucky7-live/dealer-natural-poster-v3.jpg`,
  }),
  game("andar-bahar-live", "#dcc38b", {
    artwork: `${import.meta.env.BASE_URL}media/andar-bahar-live/poster-v1.jpg`,
  }),
  game("wingo", "#c4b5fd", {
    artwork: colour,
    artworkHasTitle: true,
  }),
  game("teen-patti-joker", "#e879df", {
    artwork: `${import.meta.env.BASE_URL}media/teenpatti-joker/lobby-title-v1.webp`,
    artworkHasTitle: true,
    artworkFit: "contain",
  }),
  game("teen-patti-live", "#ffc67d", {
    artwork: teenPattiLive,
  }),
  game("crazy-time", "#f0abfc", {
    artwork: crazyTime,
  }),
  game("wild-trails", "#edcf9e", {}),
  game("bike-racing", "#93c5fd", {
    artwork: `${import.meta.env.BASE_URL}assets/bike-racing/photo/reference-bike.png`,
  }),
  game("forex-trading", "#f4d694", {
    artwork: forex,
    artworkHasTitle: true,
  }),
  game("dragon-tiger-one-day", "#fde68a", {
    artwork: `${import.meta.env.BASE_URL}media/dragon-tiger-one-day/dealer-studio.jpg`,
  }),
  game("dragon-tiger", "#fb923c", {
    artwork: dragonTiger,
    artworkHasTitle: true,
  }),
  game("roulette", "#fca5a5"),
  game("blackjack", "#fde68a"),
  game("baccarat", "#e5c88e", {
    artwork: `${import.meta.env.BASE_URL}media/baccarat/clean-table.png`,
  }),
  game("teen-patti", "#fdba74"),
  game("andar-bahar", "#fda4af"),
  game("dice", "#a5b4fc"),
  game("vegetable-bowl", "#bef264", {
    artwork: vegetables,
    artworkHasTitle: true,
  }),
];

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
  return [...LOBBY_GAMES]
    .sort(
      (a, b) =>
        LOBBY_ENTRIES.findIndex((entry) => entry.id === a.id) -
        LOBBY_ENTRIES.findIndex((entry) => entry.id === b.id),
    )
    .flatMap((item) => {
      const route = canonicalRoute(item.route);
      if (ids.has(item.id) || routes.has(route)) return [];
      ids.add(item.id);
      routes.add(route);
      const entry = byCode.get(item.registryCode ?? item.id);
      // Keep the implemented SPA route; registry aliases may point to legacy apps.
      return [{ ...item, route, enabled: entry?.enabled ?? item.enabled }];
    })
    .sort(compareTopGames);
}
