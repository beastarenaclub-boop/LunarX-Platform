import * as THREE from "three";

type Runner = {
  root: THREE.Group;
  id: number;
  hoofPositions: () => THREE.Vector3[];
};

/** Hoof-contact emissions stay in world space after the horse leaves them. */
export function hoofSpray3d(phone: boolean) {
  const root = new THREE.Group();
  const perHorse = phone ? 24 : 40,
    total = perHorse * 8;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const radial = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  radial.addColorStop(0, "rgba(255,255,255,.65)");
  radial.addColorStop(0.4, "rgba(255,255,255,.32)");
  radial.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    color: "#a68d72",
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const dust = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    material,
    total,
  );
  const clods = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: "#725033", roughness: 1 }),
    total,
  );
  dust.frustumCulled = clods.frustumCulled = false;
  root.add(dust, clods);
  const dummy = new THREE.Object3D();
  const fade = new Float32Array(total);
  dust.geometry.setAttribute(
    "particleFade",
    new THREE.InstancedBufferAttribute(fade, 1),
  );
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `attribute float particleFade; varying float vFade;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFade=particleFade;",
      );
    shader.fragmentShader =
      `varying float vFade;\n${shader.fragmentShader}`.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a*=vFade;",
      );
  };
  material.customProgramCacheKey = () => "hoof-contact-dust-v2";
  const particles = Array.from({ length: total }, (_, i) => ({
    born: -100,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    seed: (((Math.sin(i * 127.1 + 3.1) * 43758.5453) % 1) + 1) % 1,
  }));
  const next = new Uint16Array(8);
  const lastContact = new Float64Array(32).fill(-100);
  const lastHeight = new Float32Array(32).fill(10);
  let previousTime = -100;
  const reset = () => {
    particles.forEach((p) => (p.born = -100));
    lastContact.fill(-100);
    lastHeight.fill(10);
  };
  return {
    root,
    configure(turf: boolean) {
      material.color.set(turf ? "#767b50" : "#a68d72");
      material.opacity = turf ? 0.14 : 0.32;
      clods.material.color.set(turf ? "#4c5130" : "#725033");
      reset();
    },
    update(
      time: number,
      horses: Runner[],
      camera: THREE.Camera,
      active: boolean,
      focus: number | null,
    ) {
      root.visible = active;
      if (!active) {
        reset();
        previousTime = time;
        return;
      }
      if (time < previousTime || time - previousTime > 1) reset();
      previousTime = time;
      for (const h of horses) {
        if (!h.root.visible || (focus && h.id !== focus)) continue;
        const points = h.hoofPositions(),
          hi = h.id - 1;
        points.forEach((point, leg) => {
          const slot = hi * 4 + leg;
          // Only a descending contact makes a kick-up; airborne hooves cannot
          // produce dust. A short debounce handles grazing/stationary contact.
          if (
            point.y < 0.2 &&
            lastHeight[slot] >= 0.2 &&
            time - lastContact[slot] > 0.12
          ) {
            lastContact[slot] = time;
            for (let j = 0; j < (phone ? 4 : 7); j++) {
              const p = particles[hi * perHorse + (next[hi]++ % perHorse)];
              const angle = h.root.rotation.y + Math.PI + (p.seed - 0.5) * 1.5;
              const speed = 1.1 + p.seed * 3.1;
              p.born = time;
              p.x = point.x;
              p.z = point.z;
              p.vx = Math.sin(angle) * speed;
              p.vz = Math.cos(angle) * speed;
            }
          }
          lastHeight[slot] = point.y;
        });
      }
      for (let index = 0; index < total; index++) {
        const p = particles[index],
          h = horses[Math.floor(index / perHorse)];
        const seconds = time - p.born,
          life = 0.65 + p.seed * 0.28,
          age = seconds / life;
        const visible =
          age >= 0 && age < 1 && h.root.visible && (!focus || h.id === focus);
        dummy.position.set(
          p.x + p.vx * seconds * 0.55,
          0.07 + Math.max(0, seconds) * 0.4,
          p.z + p.vz * seconds * 0.55,
        );
        dummy.quaternion.copy(camera.quaternion);
        dummy.scale.setScalar(visible ? 0.12 + age * 1.35 : 0);
        dummy.updateMatrix();
        dust.setMatrixAt(index, dummy.matrix);
        fade[index] = visible
          ? Math.sin(Math.min(1, age * 3) * Math.PI * 0.5) * (1 - age)
          : 0;
        dummy.position.set(
          p.x + p.vx * seconds,
          Math.max(
            0.014,
            0.05 + seconds * (1.5 + p.seed * 1.4) - 4.9 * seconds * seconds,
          ),
          p.z + p.vz * seconds,
        );
        dummy.rotation.set(index + seconds * 6, index * 0.3, seconds * 8);
        dummy.scale.setScalar(
          visible ? (0.018 + p.seed * 0.03) * (1 - age * 0.6) : 0,
        );
        dummy.updateMatrix();
        clods.setMatrixAt(index, dummy.matrix);
      }
      dust.instanceMatrix.needsUpdate = clods.instanceMatrix.needsUpdate = true;
      dust.geometry.attributes.particleFade.needsUpdate = true;
    },
  };
}
