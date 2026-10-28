import {
  Bird, CircleDot, Club, Crown, Dice5, Flag, Grid2X2,
  Plane, Play, Rocket, Sparkles, Spade, Ticket, Trophy, type LucideIcon,
} from "lucide-react";
import { isNewGame, type Category, type GameFamily, type LobbyGame } from "./catalog";

export interface LobbyCategory {
  id: Category;
  name: string;
  icon: LucideIcon;
}

const NEW_GAMES_CATEGORY: LobbyCategory = { id: "new", name: "New Games", icon: Sparkles };

const PRIMARY_CATEGORIES: LobbyCategory[] = [
  { id: "all", name: "All Games", icon: Grid2X2 },
  { id: "mega-ball", name: "Mega Ball", icon: CircleDot },
  NEW_GAMES_CATEGORY,
  { id: "instant", name: "Instant Games", icon: Rocket },
  { id: "crash", name: "Crash Games", icon: Plane },
  { id: "live", name: "Live Casino", icon: Play },
  { id: "table", name: "Table Games", icon: Club },
  { id: "racing", name: "Virtual Sports", icon: Flag },
  { id: "lottery", name: "Lottery", icon: Ticket },
];

// Explicit membership includes differently named variants and keeps unrelated
// games out of a family. Existing casino shortcuts remain available.
const GAME_FAMILIES: (LobbyCategory & {
  id: GameFamily;
  gameIds: string[];
  minimumGames: number;
})[] = [
  { id: "mega-ball", name: "Mega Ball", icon: CircleDot, gameIds: ["mega-ball"], minimumGames: 1 },
  { id: "ludo", name: "Ludo", icon: Dice5, gameIds: ["ludo"], minimumGames: 1 },
  { id: "roulette", name: "Roulette", icon: CircleDot, gameIds: ["roulette"], minimumGames: 1 },
  { id: "poker", name: "Poker", icon: Spade, gameIds: ["poker-one-day", "poker-20-20", "poker-six-players"], minimumGames: 3 },
  { id: "teen-patti", name: "Teen Patti", icon: Spade, gameIds: ["teen-patti", "teen-patti-live", "teen-patti-joker"], minimumGames: 1 },
  { id: "baccarat", name: "Baccarat", icon: Club, gameIds: ["baccarat"], minimumGames: 1 },
  { id: "dragon-tiger", name: "Dragon Tiger", icon: Crown, gameIds: ["dragon-tiger", "dragon-tiger-one-day"], minimumGames: 1 },
  { id: "andar-bahar", name: "Andar Bahar", icon: Club, gameIds: ["andar-bahar", "andar-bahar-live"], minimumGames: 1 },
  { id: "lucky-7", name: "Lucky 7", icon: Dice5, gameIds: ["lucky-7", "lucky-7-live"], minimumGames: 1 },
  { id: "blackjack", name: "Blackjack", icon: Spade, gameIds: ["blackjack"], minimumGames: 1 },
  { id: "rummy", name: "Rummy", icon: Spade, gameIds: ["rummy"], minimumGames: 1 },
  { id: "wheel", name: "Wheel", icon: CircleDot, gameIds: ["wheel-2-live"], minimumGames: 1 },
  { id: "chicken-road", name: "Chicken Road", icon: Bird, gameIds: ["chicken-road", "chicken-road-pirate"], minimumGames: 2 },
  { id: "dice-games", name: "Dice Games", icon: Dice5, gameIds: ["dice", "7up7down", "lucky-7"], minimumGames: 3 },
  { id: "racing-games", name: "Racing", icon: Trophy, gameIds: ["wild-trails", "bike-racing", "virtual-formula"], minimumGames: 3 },
];

export function matchesGameCategory(game: LobbyGame, category: Category): boolean {
  if (category === "new") return isNewGame(game);
  if (category === "all" || game.category === category) return true;
  if (category === "instant" && game.tags?.includes("instant")) return true;
  return GAME_FAMILIES.find((family) => family.id === category)?.gameIds.includes(game.id) ?? false;
}

function familyCount(games: LobbyGame[], family: typeof GAME_FAMILIES[number]) {
  return games.filter((game) => family.gameIds.includes(game.id)).length;
}

/** Add a dedicated category when at least three implemented games share it. */
export function getLobbyCategories(games: LobbyGame[]): LobbyCategory[] {
  return [
    ...PRIMARY_CATEGORIES,
    ...GAME_FAMILIES.filter((family) => familyCount(games, family) >= 3),
  ];
}

export function getCasinoCategories(games: LobbyGame[]): LobbyCategory[] {
  return [
    { id: "all", name: "All Casino", icon: Grid2X2 },
    NEW_GAMES_CATEGORY,
    ...GAME_FAMILIES.filter((family) => familyCount(games, family) >= family.minimumGames),
    ...PRIMARY_CATEGORIES.filter(({ id }) => ["racing", "lottery", "instant"].includes(id)),
  ];
}
