/**
 * Every asset the two game screens draw or play, in one place.
 *
 * Imported rather than referenced by path so the bundler fingerprints and
 * inlines them: a missing file becomes a build error instead of a blank rect on
 * a cabinet nobody is watching.
 */
import RouleteBg from "@/assets/handoff/roulette/images/RouleteBg.png";
import BetBg from "@/assets/handoff/roulette/images/BetBg.png";
import BetBgMini from "@/assets/handoff/roulette/images/BetBg_mini.png";
import WheelZoomBar from "@/assets/handoff/roulette/images/WheelZoom.png";
import TimerBarFlash from "@/assets/handoff/roulette/images/timer_bar_flash.png";
import Wheel1 from "@/assets/handoff/roulette/images/wheel1.png";
import Wheel1Mini from "@/assets/handoff/roulette/images/wheel1_mini.png";
import Bowl from "@/assets/handoff/roulette/images/wheel_1.png";
import BowlMini from "@/assets/handoff/roulette/images/wheel_1_mini.png";
import Diamond from "@/assets/handoff/roulette/images/diamondNew.png";
import Ball from "@/assets/handoff/roulette/images/coin.png";
import BetChip from "@/assets/handoff/roulette/images/bet_chip.png";
import BetOk0 from "@/assets/handoff/roulette/images/bet_ok_sprite_0.png";
import BetOk1 from "@/assets/handoff/roulette/images/bet_ok_sprite_1.png";
import Cancel0 from "@/assets/handoff/roulette/images/cancel_bet_sprite_0.png";
import Cancel1 from "@/assets/handoff/roulette/images/cancel_bet_sprite_1.png";
import Take0 from "@/assets/handoff/roulette/images/take_sprite_0.png";
import Take1 from "@/assets/handoff/roulette/images/take_sprite_1.png";
import CoinSelected from "@/assets/handoff/roulette/images/coins_sprites/coin_selected.png";
import Coin10 from "@/assets/handoff/roulette/images/coins_sprites/coin_10.png";
import Coin50 from "@/assets/handoff/roulette/images/coins_sprites/coin_50.png";
import Coin100 from "@/assets/handoff/roulette/images/coins_sprites/coin_100.png";
import Coin500 from "@/assets/handoff/roulette/images/coins_sprites/coin_500.png";
import Coin1000 from "@/assets/handoff/roulette/images/coins_sprites/coin_1000.png";
import Coin5000 from "@/assets/handoff/roulette/images/coins_sprites/coin_5000.png";
// Drawn from coin_5000 (digits inpainted off, body recoloured, digits redrawn
// at 4x and downsampled) — scratchpad coin-make.mjs, 2026-10-10. Purple and
// black: the only two colours the cabinet's eight did not already use.
import Coin10000 from "@/assets/handoff/roulette/images/coins_sprites/coin_10000.png";
import Coin20000 from "@/assets/handoff/roulette/images/coins_sprites/coin_20000.png";
import type { ChipValue } from "./layout";

/**
 * The title's 18 frames.
 *
 * The WEBP set, not the PNG one: both are shipped and both animate the same
 * loop, but the webp frames are 512x116 with real alpha while the pngs are
 * 354x80 with a baked background that shows as a box over the backdrop.
 */
const titleModules = import.meta.glob<{ default: string }>(
  "@/assets/handoff/roulette/images/fun_roulette_title/title_*.webp",
  { eager: true },
);

export const TITLE_FRAMES: string[] = Object.keys(titleModules)
  .sort()
  .map((k) => titleModules[k]!.default);

export const IMG = {
  backdrop: RouleteBg,
  chart: { "roulette-american": BetBg, "roulette-mini": BetBgMini },
  ring: { "roulette-american": Wheel1, "roulette-mini": Wheel1Mini },
  bowl: { "roulette-american": Bowl, "roulette-mini": BowlMini },
  diamond: Diamond,
  ball: Ball,
  /** The stake marker on the chart. Art now, not a painted pill. */
  betChip: BetChip,
  wheelZoomBar: WheelZoomBar,
  timerBarFlash: TimerBarFlash,
  betOk: [BetOk0, BetOk1] as const,
  cancel: [Cancel0, Cancel1] as const,
  take: [Take0, Take1] as const,
  coinSelected: CoinSelected,
} as const;

export const COIN: Record<ChipValue, string> = {
  10: Coin10,
  50: Coin50,
  100: Coin100,
  500: Coin500,
  1000: Coin1000,
  5000: Coin5000,
  10000: Coin10000,
  20000: Coin20000,
};

/**
 * Native sprite sizes, needed because a lit frame is drawn OVER the resting one
 * at the ratio of the two, so the lit bar lands exactly on the resting bar and
 * only the glow spills outside it.
 */
export const SPRITE_SIZE = {
  betOk: { rest: { w: 110, h: 43 }, lit: { w: 118, h: 53 } },
  take: { rest: { w: 110, h: 43 }, lit: { w: 118, h: 53 } },
  cancel: { rest: { w: 162, h: 32 }, lit: { w: 172, h: 41 } },
} as const;

/**
 * The hub diamond's sheet: 360 x 380 laid out as 4 columns x 5 rows of 90 x 76.
 * Twenty cells, EIGHTEEN of them used — the last two are blank, and stepping
 * through all twenty gives the sparkle a visible stall twice a second.
 */
export const DIAMOND_SHEET = { cols: 4, rows: 5, frameW: 90, frameH: 76, frames: 18 } as const;
