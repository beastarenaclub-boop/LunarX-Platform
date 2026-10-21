import oneDay from "@/assets/poker/poker-one-day-v2.jpg";
import twenty from "@/assets/poker/poker-20-20-v2.jpg";
import six from "@/assets/poker/poker-six-players-v2.jpg";
import type { PokerGame } from "@workspace/api-zod/poker";

export const POKER_ART: Record<
  PokerGame,
  { src: string; title: string; subtitle: string; accent: string }
> = {
  "poker-one-day": {
    src: oneDay,
    title: "Poker 1-Day",
    subtitle: "The classic A vs B showdown",
    accent: "#e6c46c",
  },
  "poker-20-20": {
    src: twenty,
    title: "20-20 Poker",
    subtitle: "Two players. Every hand counts.",
    accent: "#ffb170",
  },
  "poker-six-players": {
    src: six,
    title: "Poker 6 Players",
    subtitle: "Six hands. One showdown.",
    accent: "#98c9ff",
  },
};
