import { useEffect, useState } from "react";

export const HARVEST_WORLDS = [
  {
    id: "farm",
    name: "Sunny Farm",
    sky: ["#bceaff", "#f8efbd"],
    hills: ["#b4d987", "#82bd65", "#4b9567"],
    ground: ["#dcb579", "#a8734b"],
    night: false,
  },
  {
    id: "beach",
    name: "Sunset Beach",
    sky: ["#f3afbb", "#ffe4a7"],
    hills: ["#bea2c9", "#65c6cd", "#439ba8"],
    ground: ["#f7dc9f", "#ceaa75"],
    night: false,
  },
  {
    id: "night",
    name: "Moonlight Garden",
    sky: ["#202954", "#6e68a2"],
    hills: ["#6b6a9f", "#456681", "#315a70"],
    ground: ["#698794", "#435c74"],
    night: true,
  },
  {
    id: "snow",
    name: "Snowy Valley",
    sky: ["#bed5fb", "#f2eafc"],
    hills: ["#c2c6e5", "#d8e8f3", "#aec9d8"],
    ground: ["#eef8fc", "#b6d4e8"],
    night: false,
  },
  {
    id: "desert",
    name: "Desert Oasis",
    sky: ["#b5e4e9", "#ffe4b8"],
    hills: ["#e9bc86", "#e7ac73", "#cb8a61"],
    ground: ["#f2cd94", "#cb986b"],
    night: false,
  },
] as const;
export type HarvestWorld = (typeof HARVEST_WORLDS)[number];
export function roundHash(value: string) {
  let hash = 2166136261;
  for (const letter of value)
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return hash >>> 0;
}
type WorldSelection = { roundId: string; index: number };
const storageKey = "vegetable-world-v1";
function savedWorld(): WorldSelection | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      saved &&
      typeof saved.roundId === "string" &&
      Number.isInteger(saved.index) &&
      saved.index >= 0 &&
      saved.index < HARVEST_WORLDS.length
    )
      return saved;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return null;
}
export function nextWorld(
  roundId: string,
  previous: WorldSelection | null,
): WorldSelection {
  if (previous?.roundId === roundId) return previous;
  const hash = roundHash(roundId);
  return {
    roundId,
    index: previous
      ? (previous.index + 1 + (hash % (HARVEST_WORLDS.length - 1))) %
        HARVEST_WORLDS.length
      : hash % HARVEST_WORLDS.length,
  };
}
export function useHarvestWorld(roundId: string | null) {
  const [selection, setSelection] = useState(savedWorld);
  useEffect(() => {
    if (roundId) setSelection((previous) => nextWorld(roundId, previous));
  }, [roundId]);
  useEffect(() => {
    if (selection)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(selection));
      } catch {
        /* Optional preference. */
      }
  }, [selection]);
  return HARVEST_WORLDS[selection?.index ?? 0];
}
