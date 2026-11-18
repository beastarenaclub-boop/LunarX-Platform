import { z } from "zod";
import {
  DEFAULT_CASINO_ORDER,
  DEFAULT_FEATURED_IDS,
  DEFAULT_HOME_ORDER,
  LOBBY_ENTRIES,
} from "./lobby-catalog";

export const LOBBY_SECTIONS = ["home", "crypto", "casino"] as const;
export type LobbySection = (typeof LOBBY_SECTIONS)[number];
const knownIds = new Set(LOBBY_ENTRIES.map((game) => game.id));
const id = z.string().refine((value) => knownIds.has(value), "Unknown game");
const ids = z
  .array(id)
  .max(200)
  .refine(
    (values) => new Set(values).size === values.length,
    "A game can only appear once",
  );
const tag = z
  .string()
  .trim()
  .max(32)
  .min(1)
  .refine((value) => !/[<>\x00-\x1f]/.test(value), "Use plain text for tags");
const presentation = z
  .object({
    label: z
      .string()
      .trim()
      .max(20)
      .refine(
        (value) => !/[<>\x00-\x1f]/.test(value),
        "Use plain text for the badge",
      ),
    tags: z
      .array(tag)
      .max(12)
      .transform((values) => [
        ...new Set(values.map((value) => value.toLowerCase())),
      ]),
  })
  .strict();
export const lobbyLayoutSchema = z
  .object({
    orders: z.object({ home: ids, crypto: ids, casino: ids }).strict(),
    featured: ids,
    games: z
      .record(presentation)
      .refine(
        (values) => Object.keys(values).every((key) => knownIds.has(key)),
        "Unknown game",
      ),
  })
  .strict();
export const saveLobbyLayoutSchema = z
  .object({
    revision: z.number().int().min(0),
    layout: lobbyLayoutSchema,
  })
  .strict();
export type LobbyLayout = z.infer<typeof lobbyLayoutSchema>;
export interface LobbyLayoutResponse {
  revision: number;
  updatedAt: string | null;
  layout: LobbyLayout;
}

export function defaultLobbyLayout(): LobbyLayout {
  const withNewGames = (order: string[]) => [
    ...new Set([...order, ...knownIds]),
  ];
  return {
    orders: {
      home: withNewGames(DEFAULT_HOME_ORDER),
      crypto: withNewGames(DEFAULT_CASINO_ORDER),
      casino: withNewGames(DEFAULT_CASINO_ORDER),
    },
    featured: [...DEFAULT_FEATURED_IDS],
    games: Object.fromEntries(
      LOBBY_ENTRIES.map((game) => [
        game.id,
        { label: game.label ?? "", tags: [...(game.tags ?? [])] },
      ]),
    ),
  };
}

/** Append newly released games without moving the administrator's existing order. */
export function completeLobbyLayout(
  saved?: Partial<LobbyLayout> | null,
): LobbyLayout {
  const defaults = defaultLobbyLayout();
  const order = (section: LobbySection) =>
    [
      ...new Set([
        ...(saved?.orders?.[section] ?? []),
        ...defaults.orders[section],
      ]),
    ].filter((value) => knownIds.has(value));
  return {
    orders: {
      home: order("home"),
      crypto: order("crypto"),
      casino: order("casino"),
    },
    featured: [...new Set(saved?.featured ?? defaults.featured)].filter(
      (value) => knownIds.has(value),
    ),
    games: Object.fromEntries(
      LOBBY_ENTRIES.map((game) => [
        game.id,
        saved?.games?.[game.id] ?? defaults.games[game.id]!,
      ]),
    ),
  };
}

export function applyLobbyLayout<
  T extends { id: string; label?: string; tags?: string[] },
>(games: T[], saved: LobbyLayout | undefined, section: LobbySection): T[] {
  if (!saved) return games;
  const layout = completeLobbyLayout(saved);
  const ranks = new Map(layout.orders[section].map((id, index) => [id, index]));
  return games
    .map((game) => ({ ...game, ...(layout.games[game.id] ?? {}) }))
    .sort(
      (a, b) =>
        (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

export function moveLobbyGame(
  order: string[],
  id: string,
  position: number,
): string[] {
  if (!order.includes(id) || !Number.isInteger(position)) return order;
  const next = order.filter((value) => value !== id);
  next.splice(Math.max(0, Math.min(next.length, position - 1)), 0, id);
  return next;
}
