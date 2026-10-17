import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import athleteUrl from "./assets/athlete.glb?url";
import grassUrl from "./assets/grass-color.jpg";
import normalUrl from "./assets/grass-normal.jpg";
import daylightUrl from "./assets/daylight.hdr?url";
import crowdUrl from "./assets/crowd.png";
import footballPlayerUrl from "./assets/football-player.glb?url";
import footballCrowdUrl from "./assets/football-fans.png";

export interface BroadcastAssets {
  athlete: GLTF | null;
  grass: THREE.Texture;
  normal: THREE.Texture;
  daylight: THREE.DataTexture;
  crowd: THREE.Texture;
  dispose: () => void;
}

// Bundled URLs work in both the standalone and authenticated app. Nothing is
// fetched from an external asset host during a round.
export async function loadBroadcastAssets(
  withAthlete: boolean,
  football = false,
): Promise<BroadcastAssets> {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled([
    withAthlete
      ? new GLTFLoader().loadAsync(football ? footballPlayerUrl : athleteUrl)
      : Promise.resolve(null),
    loader.loadAsync(grassUrl),
    loader.loadAsync(normalUrl),
    new RGBELoader().loadAsync(daylightUrl),
    loader.loadAsync(football ? footballCrowdUrl : crowdUrl),
  ] as const);
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  for (const r of results)
    if (r.status === "fulfilled" && r.value) {
      if (r.value instanceof THREE.Texture) textures.add(r.value);
      else
        r.value.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          geometries.add(o.geometry);
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            materials.add(m);
            for (const v of Object.values(m))
              if (v instanceof THREE.Texture) textures.add(v);
          }
        });
    }
  const dispose = () => {
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
    geometries.forEach((g) => g.dispose());
  };
  const failure = results.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") {
    dispose();
    throw failure.reason;
  }
  const [athlete, grass, normal, daylight, crowd] = results.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  ) as [
    GLTF | null,
    THREE.Texture,
    THREE.Texture,
    THREE.DataTexture,
    THREE.Texture,
  ];
  for (const t of [grass, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(24, 18);
  }
  grass.colorSpace = crowd.colorSpace = THREE.SRGBColorSpace;
  daylight.mapping = THREE.EquirectangularReflectionMapping;
  return { athlete, grass, normal, daylight, crowd, dispose };
}
