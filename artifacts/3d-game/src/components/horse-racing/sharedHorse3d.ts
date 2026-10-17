import * as THREE from "three";

const ROOT = "/assets/horse-racing/realistic/shared-horse/";
// Source proportions give a ~1.7 m withers height and ~3 m mounted height.
export const HORSE_WIDTH = 4.25;
export const HORSE_HEIGHT = HORSE_WIDTH * 0.75;
type Manifest = {
  columns: number;
  rows: number;
  count: number;
  fps: number;
  noseAnchors: number[];
  ground: number;
  idleNose: number;
  idleGround: number;
};

/** The supplied asset is a keyed side-profile film, not a skeletal model. */
export async function loadSharedHorse() {
  const loaded: THREE.Texture[] = [];
  try {
    const manifestResponse = await fetch(ROOT + "manifest.json");
    if (!manifestResponse.ok) throw Error("Shared horse manifest unavailable");
    const manifest = (await manifestResponse.json()) as Manifest;
    if (
      !Number.isInteger(manifest.count) ||
      manifest.count < 2 ||
      manifest.noseAnchors.length !== manifest.count ||
      manifest.columns * manifest.rows < manifest.count
    )
      throw Error("Invalid shared horse atlas");
    // Sequential loads make partial failure/disposal predictable.
    for (const name of ["gallop-v1.webp", "idle-v1.webp"]) {
      const texture = await new THREE.TextureLoader().loadAsync(ROOT + name);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      loaded.push(texture);
    }
    return {
      manifest,
      motion: loaded[0],
      idle: loaded[1],
      dispose() {
        loaded.forEach((texture) => texture.dispose());
      },
    };
  } catch (error) {
    loaded.forEach((texture) => texture.dispose());
    throw error;
  }
}
export type SharedHorsePack = Awaited<ReturnType<typeof loadSharedHorse>>;

export function sharedHorse(pack: SharedHorsePack, color: string) {
  const geometry = new THREE.PlaneGeometry(HORSE_WIDTH, HORSE_HEIGHT);
  const uniforms = {
    film: { value: pack.idle },
    size: { value: new THREE.Vector2(HORSE_WIDTH, HORSE_HEIGHT) },
    tile: { value: new THREE.Vector4(0, 0, 1, 1) },
    anchor: {
      value: new THREE.Vector2(
        pack.manifest.idleNose,
        pack.manifest.idleGround,
      ),
    },
    runnerColor: { value: new THREE.Color(color) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    // A cutout participates in normal depth tests: rails and runners occlude it.
    // Alpha coverage softens hair on MSAA displays without transparent sorting.
    alphaToCoverage: true,
    toneMapped: false,
    vertexShader: `
      uniform vec4 tile;
      uniform vec2 anchor;
      uniform vec2 size;
      varying vec2 filmUv;
      varying vec2 localUv;
      void main() {
        localUv = uv;
        filmUv = tile.xy + uv * tile.zw;
        vec3 point = position;
        point.x += (.5 - anchor.x) * size.x;
        point.y += (anchor.y - .5) * size.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.);
      }`,
    fragmentShader: `
      uniform sampler2D film;
      uniform vec3 runnerColor;
      varying vec2 filmUv;
      varying vec2 localUv;
      void main() {
        vec4 pixel = texture2D(film, filmUv);
        if (pixel.a < .42) discard;
        // Recolour only the purple saddle pad; keep the supplied horse/rider.
        float purple = smoothstep(.025,.085,pixel.b-pixel.g)
          * smoothstep(.006,.035,pixel.r-pixel.g)
          * step(.34,localUv.x) * (1.-step(.63,localUv.x))
          * step(.30,localUv.y) * (1.-step(.66,localUv.y));
        float detail = clamp(dot(pixel.rgb,vec3(.2126,.7152,.0722))/.16,.3,1.6);
        pixel.rgb = mix(pixel.rgb,runnerColor*detail,purple*.9);
        gl_FragColor = pixel;
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = "Higgsfield shared side-profile horse";
  const groundCenter = new THREE.Vector3();
  const corner = new THREE.Vector3();
  let frame = 0;
  return {
    mesh,
    groundCenter,
    get frame() {
      return frame;
    },
    update(
      position: { x: number; z: number; heading: number },
      seconds: number,
      running: boolean,
      phase: number,
      stride: number,
    ) {
      const m = pack.manifest;
      frame = running
        ? Math.floor(Math.max(0, seconds) * m.fps * stride + phase * m.count) %
          m.count
        : 0;
      uniforms.film.value = running ? pack.motion : pack.idle;
      if (running) {
        uniforms.tile.value.set(
          (frame % m.columns) / m.columns,
          1 - (Math.floor(frame / m.columns) + 1) / m.rows,
          1 / m.columns,
          1 / m.rows,
        );
      } else uniforms.tile.value.set(0, 0, 1, 1);
      uniforms.anchor.value.set(
        running ? m.noseAnchors[frame] : m.idleNose,
        running ? m.ground : m.idleGround,
      );
      mesh.position.set(position.x, 0.03, position.z);
      // The muzzle and body point along the actual tangent of the racecourse.
      // Never swivel the photograph toward the viewer like a billboard.
      mesh.rotation.y = position.heading - Math.PI / 2;
      mesh.updateMatrixWorld(true);
      groundCenter
        .set((0.52 - uniforms.anchor.value.x) * HORSE_WIDTH, 0, 0)
        .applyMatrix4(mesh.matrixWorld);
    },
    screenBounds(camera: THREE.Camera) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < 4; i++) {
        corner
          .set(
            ((i & 1) - uniforms.anchor.value.x) * HORSE_WIDTH,
            ((i >> 1) + uniforms.anchor.value.y - 1) * HORSE_HEIGHT,
            0,
          )
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);
        const x = (corner.x + 1) * 640,
          y = (1 - corner.y) * 360;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return [minX, minY, maxX - minX, maxY - minY];
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
