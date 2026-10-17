import media from "@/assets/teenpatti/riya-hd-media.json" with { type: "json" };

/** Layout coordinates are independent of the native 1920 x 1080 media. */
export const FILM_WORLD = { width: 864, height: 486 } as const;
export const TURN_ORDER = [0, 5, 1, 4, 2, 3] as const;

/** Native 24 fps cues, relative to the 5.5-second waiting segment.
 * Riya turns the outer, middle, then inner pair. Film supplies blank paper;
 * card ranks and outcomes always come from the server. */
export const DEALER_FILM = {
  sceneOffset: 5.5,
  idleEnd: 130 / 24,
  actionStart: 0,
  actionEnd: 212 / 24,
  actionDuration: 212 / 24,
  lifts: [27, 81, 144, 144, 81, 27].map((frame) => frame / 24),
  lands: [61, 108, 194, 194, 108, 61].map((frame) => frame / 24),
  // Wait for both fingers to clear each pair before projecting flat ink.
  printAfter: [72, 117, 201, 201, 117, 72].map((frame) => frame / 24),
};

/** Photographed corners: top-left, top-right, bottom-right, bottom-left.
 * Only ink is projected; the film retains the physical paper and shadows. */
export const PAPER_QUADS = media.worldFaceQuads;
export const BACK_PAPER_QUADS = media.worldBackQuads;

export const CARD_CUES = DEALER_FILM.lifts
  .flatMap((at, index) => [
    { at, index, kind: "lift" as const },
    { at: DEALER_FILM.lands[index], index, kind: "land" as const },
  ])
  .sort((a, b) => a.at - b.at);
