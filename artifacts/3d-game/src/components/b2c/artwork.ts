const media = `${import.meta.env.BASE_URL}media/b2c/`;

export const B2C_BANNERS = [
  {
    src: `${media}crash-games-banner.png`,
    alt: "Crash Games — JetX and Fury Flight",
    position: "center 40%",
  },
  {
    src: `${media}casino-banner.png`,
    alt: "Live Casino — Teenpatti, Roulette and Baccarat",
    position: "center 40%",
  },
  {
    src: `${media}instant-games-banner.png`,
    alt: "Instant Games — Mines, Plinko and Dice",
    position: "center 20%",
  },
];

const atlases = {
  casino: {
    src: `${media}casino-atlas.png`,
    width: 1672,
    height: 941,
    rows: [0, 236, 470, 700, 941],
  },
  instant: {
    src: `${media}instant-atlas.png`,
    width: 1672,
    height: 941,
    rows: [0, 235, 470, 697, 941],
  },
  sports: {
    src: `${media}sports-atlas.png`,
    width: 2048,
    height: 768,
    rows: [0, 350, 768],
  },
};

// Presentation only: the shared catalog continues to own names, routes and availability.
const positions: Record<string, [keyof typeof atlases, number]> = {
  "teen-patti-live": ["casino", 8],
  "teen-patti": ["casino", 1],
  roulette: ["casino", 2],
  baccarat: ["casino", 3],
  "andar-bahar": ["casino", 4],
  "lucky-7": ["casino", 5],
  "dragon-tiger": ["casino", 6],
  blackjack: ["casino", 7],
  "lucky-7-live": ["casino", 9],
  "andar-bahar-live": ["casino", 10],
  "crazy-time": ["casino", 11],
  "wheel-2-live": ["casino", 12],
  "dragon-tiger-one-day": ["casino", 13],
  rummy: ["casino", 14],
  "7up7down": ["casino", 15],
  jetx: ["instant", 0],
  fury: ["instant", 1],
  "chicken-road": ["instant", 2],
  "chicken-road-2": ["instant", 3],
  "chicken-road-pirate": ["instant", 4],
  "pirate-jackpot-mines": ["instant", 5],
  "duck-duel": ["instant", 6],
  "tower-rush": ["instant", 7],
  "jackpot-fishing": ["instant", 8],
  mines: ["instant", 9],
  "coin-flip": ["instant", 10],
  plinko: ["instant", 11],
  wingo: ["instant", 12],
  "forex-trading": ["instant", 13],
  dice: ["instant", 14],
  "vegetable-bowl": ["instant", 15],
  "virtual-football": ["sports", 0],
  "virtual-cricket": ["sports", 1],
  "virtual-basketball": ["sports", 2],
  "virtual-tennis": ["sports", 3],
  "virtual-formula": ["sports", 4],
  "wild-trails": ["sports", 5],
  "bike-racing": ["sports", 6],
  "prize-lotto": ["sports", 7],
};

export function b2cArtwork(id: string) {
  const position = positions[id];
  if (!position) return null;
  const [key, cell] = position;
  const atlas = atlases[key];
  const row = Math.floor(cell / 4);
  const width = atlas.width / 4;
  return {
    ...atlas,
    viewBox: `${(cell % 4) * width} ${atlas.rows[row]} ${width} ${atlas.rows[row + 1] - atlas.rows[row]}`,
  };
}

export const B2C_AVATAR = `${media}player-avatar.png`;
export const B2C_LOTTERY = `${media}lottery.png`;

export const B2C_GAME_ORDER = [
  "teen-patti-live",
  "teen-patti",
  "rummy",
  "blackjack",
  "lucky-7-live",
  "roulette",
  "lucky-7",
  "baccarat",
  "andar-bahar-live",
  "dragon-tiger",
  "dragon-tiger-one-day",
  "crazy-time",
  "wheel-2-live",
  "7up7down",
  "andar-bahar",
  "prize-lotto",
  "virtual-cricket",
  "virtual-football",
  "virtual-basketball",
  "virtual-tennis",
  "virtual-formula",
  "wild-trails",
  "bike-racing",
  "lottery",
  "jetx",
  "fury",
  "chicken-road",
  "chicken-road-2",
  "chicken-road-pirate",
  "pirate-jackpot-mines",
  "duck-duel",
  "tower-rush",
  "jackpot-fishing",
  "mines",
  "coin-flip",
  "plinko",
  "wingo",
  "forex-trading",
  "dice",
  "vegetable-bowl",
];
