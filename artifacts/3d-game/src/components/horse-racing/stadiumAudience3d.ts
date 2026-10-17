import * as THREE from "three";

export interface SpectatorSeat {
  x: number;
  y: number;
  z: number;
  shade: number;
}

/** Individual cutout spectators, with independent atlas choices and motion.
 * Geometry carries each person's depth: this is not a row photograph on a wall.
 */
export function stadiumAudience(
  source: THREE.Texture,
  seats: SpectatorSeat[],
  time: { value: number },
  phone: boolean,
  seed: number,
) {
  const sections = new Map<string, SpectatorSeat[]>();
  seats.forEach((seat) => {
    const key = `${Math.floor(seat.x / 48)}:${Math.floor(seat.z / 48)}`;
    const section = sections.get(key) ?? [];
    section.push(seat);
    sections.set(key, section);
  });
  const group = new THREE.Group();
  let index = 0;
  for (const section of sections.values())
    group.add(
      audienceBatch(source, section, time, phone, seed + index++ * 127),
    );
  return group;
}

function audienceBatch(
  source: THREE.Texture,
  seats: SpectatorSeat[],
  time: { value: number },
  phone: boolean,
  seed: number,
) {
  let state = seed;
  const random = () =>
    (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const geometry = new THREE.PlaneGeometry(1, 1, 1, phone ? 1 : 3).translate(
    0,
    0.5,
    0,
  );
  const cells = new Float32Array(seats.length);
  const phases = new Float32Array(seats.length);
  const variants = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];
  const map = source.clone();
  map.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map,
    color: "#edeae2",
    alphaTest: 0.28,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.crowdTime = time;
    shader.vertexShader =
      `attribute float crowdCell; attribute float crowdPhase;
      uniform float crowdTime;\n${shader.vertexShader}`
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
        vMapUv = (vMapUv * .982 + .009 + vec2(mod(crowdCell, 4.), 3. - floor(crowdCell / 4.))) * .25;`,
        )
        .replace(
          "#include <project_vertex>",
          `
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
        vec3 right = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]));
        float width = length(instanceMatrix[0].xyz);
        float height = length(instanceMatrix[1].xyz);
        float sway = (sin(crowdTime * (1.1 + fract(crowdPhase) * .7) + crowdPhase) - sin(crowdPhase)) * .018 * position.y * position.y;
        vec3 world = anchor.xyz + right * (position.x * width + sway) + vec3(0., position.y * height, 0.);
        vec4 mvPosition = viewMatrix * vec4(world, 1.);
        gl_Position = projectionMatrix * mvPosition;`,
        );
  };
  material.customProgramCacheKey = () => "individual-stadium-audience-v1";
  const mesh = new THREE.InstancedMesh(geometry, material, seats.length);
  mesh.name = "stadium-spectators";
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  seats.forEach((seat, index) => {
    const cell = variants[Math.floor(random() * variants.length)];
    cells[index] = cell;
    phases[index] = random() * 70;
    const size = 0.92 + random() * 0.13;
    dummy.position.set(seat.x + (random() - 0.5) * 0.07, seat.y, seat.z);
    dummy.scale.set(1.13 * size, (cell === 15 ? 1.88 : 1.5) * size, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const shade = seat.shade * (0.87 + random() * 0.13);
    mesh.setColorAt(index, color.setRGB(shade, shade * 0.985, shade * 0.97));
  });
  geometry.setAttribute(
    "crowdCell",
    new THREE.InstancedBufferAttribute(cells, 1),
  );
  geometry.setAttribute(
    "crowdPhase",
    new THREE.InstancedBufferAttribute(phases, 1),
  );
  // Camera-facing quads rotate about their vertical centre; this conservative
  // sphere also covers their sway. Off-camera terraces now skip the GPU draw.
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.radius += 0.1;
  return mesh;
}
