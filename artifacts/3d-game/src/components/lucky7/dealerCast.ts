import scene from "@/assets/lucky7/cast/naina-bar-natural-idle-2k.mp4";
import fallbackScene from "@/assets/lucky7/cast/naina-bar-natural-idle-720p.webm";
import actionScene from "@/assets/lucky7/cast/naina-bar-natural-action-2k.mp4";
import actionFallback from "@/assets/lucky7/cast/naina-bar-natural-action-720p.webm";
import poster from "@/assets/lucky7/cast/naina-bar-natural-poster.jpg";
import type { DealerLoopFilm } from "./dealerFilm";
import { DICE_LAND_MS, DICE_RELEASE_MS } from "./tableDiceMotion";
import { mobileGameMedia } from "@/lib/mediaProfile";

/** Adjacent parts of one native 2K take: action, then a six-second waiting loop. */
export const lucky7Dealer: DealerLoopFilm = {
  id: "naina", name: "Naina", scene, mobileScene: mobileGameMedia("luckyIdle"), fallbackScene, poster,
  quality: "2K", mobileQuality: "720p", fallbackQuality: "720p",
  action: { scene: actionScene, mobileScene: mobileGameMedia("luckyAction"), fallbackScene: actionFallback,
    quality: "2K", mobileQuality: "720p", fallbackQuality: "720p",
    releaseMs: DICE_RELEASE_MS, landMs: DICE_LAND_MS },
  width: 2560, height: 1440,
};
