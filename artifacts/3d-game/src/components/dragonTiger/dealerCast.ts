import poster from "@/assets/dragon-tiger/zara-studio-poster.jpg";
import idle from "@/assets/dragon-tiger/zara-hd-idle.mp4";
import invite from "@/assets/dragon-tiger/zara-hd-invite.mp4";
import dragon from "@/assets/dragon-tiger/zara-hd-dragon.mp4";
import tiger from "@/assets/dragon-tiger/zara-hd-tiger.mp4";
import both from "@/assets/dragon-tiger/zara-hd-both.mp4";

export type HandReaction = "invite" | "dragon" | "tiger" | "tie" | "deal";

/** Original AI dealer; native 1920 × 1080 takes with matching resting poses. */
export const dragonTigerDealer = {
  name: "Zara",
  poster,
  idle,
  takes: { invite, dragon, tiger, tie: both, deal: both },
};
