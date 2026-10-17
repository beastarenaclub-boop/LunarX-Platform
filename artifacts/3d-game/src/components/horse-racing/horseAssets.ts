import {
  RACING_HORSES,
  RACING_VENUES,
} from "@workspace/api-zod/horse-racing-game";

const ROOT = "/assets/horse-racing/";
export const CHARACTER_ROOT = ROOT + "realistic/shared-horse/";
type Atlas = {
  width: number;
  height: number;
  columns: number;
  count: number;
  fps: number;
  noseAnchors: number[];
  ground: number;
};
type CharacterManifest = {
  id: number;
  idle: { width: number; height: number; nose: number; ground: number };
  desktop: Atlas;
  mobile: Atlas;
};
export type HorseCharacter = CharacterManifest & {
  still: HTMLImageElement;
  motion: HTMLImageElement;
  atlas: Atlas;
};
export type HorseAssetPack = {
  tracks: Record<string, HTMLImageElement>;
  horses: HorseCharacter[];
};
let loading: Promise<HorseAssetPack> | null = null;
const picture = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
export async function loadHorsePack() {
  if (loading) return loading;
  loading = (async () => {
    // The same photographic horse remains visible in compatibility mode.
    // One decoded image pair is shared by the entire field.
    const [backgrounds, manifest, still, motion] = await Promise.all([
      Promise.all(
        RACING_VENUES.map(
          async (v) =>
            [
              v.id,
              await picture(
                ROOT + (v.id === "royal" ? "track.jpg" : `track-${v.id}.jpg`),
              ),
            ] as const,
        ),
      ),
      fetch(CHARACTER_ROOT + "manifest.json").then((r) => {
        if (!r.ok) throw Error("Characters unavailable");
        return r.json() as Promise<
          Atlas & { idleNose: number; idleGround: number }
        >;
      }),
      picture(CHARACTER_ROOT + "idle-v1.webp"),
      picture(CHARACTER_ROOT + "gallop-v1.webp"),
    ]);
    const horses = RACING_HORSES.map((h) => ({
      id: h.id,
      idle: {
        width: manifest.width,
        height: manifest.height,
        nose: manifest.idleNose,
        ground: manifest.idleGround,
      },
      desktop: manifest,
      mobile: manifest,
      atlas: manifest,
      still,
      motion,
    }));
    if (horses.length !== 8) throw Error("The field is incomplete");
    return { tracks: Object.fromEntries(backgrounds), horses };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
