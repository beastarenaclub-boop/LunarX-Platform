import * as T from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

interface StudioFloorOptions {
  /** Exclude the photographic architecture plate, which already contains a floor. */
  exclude?: readonly T.Object3D[];
  strength?: number;
}

/** A physical emerald studio floor with a restrained, blurred lacquer reflection. */
export function createStudioFloor(
  scene: T.Scene,
  { exclude = [], strength = 0.2 }: StudioFloorOptions = {},
) {
  const resolution = window.innerWidth <= 600 ? 384 : 768;
  const geometry = new T.PlaneGeometry(16, 8);
  // The floor's solid surface must extend past ultra-wide camera frustums. The
  // smaller reflection target may fade out, but its rectangle must never expose
  // the photographed floor as triangular seams at either side of the set.
  const baseGeometry = new T.PlaneGeometry(80, 80);
  const baseMaterial = new T.MeshPhysicalMaterial({
    color: "#082a22",
    metalness: 0,
    roughness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.2,
  });
  const base = new T.Mesh(baseGeometry, baseMaterial);
  base.position.set(-1.7, -0.062, 1.2);
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  scene.add(base);
  const floor = new Reflector(geometry, {
    color: "#9bbaaa",
    textureWidth: resolution,
    textureHeight: resolution,
    clipBias: 0.004,
    multisample: 0,
    shader: {
      name: "MegaBallLacquerFloor",
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        texel: { value: new T.Vector2(1 / resolution, 1 / resolution) },
        strength: { value: T.MathUtils.clamp(strength, 0, 0.5) },
      },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vReflectionUv;
        varying vec2 vFloorUv;
        varying vec3 vWorldPosition;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vReflectionUv = textureMatrix * vec4(position, 1.0);
          vFloorUv = uv;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform vec2 texel;
        uniform float strength;
        varying vec4 vReflectionUv;
        varying vec2 vFloorUv;
        varying vec3 vWorldPosition;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec2 projected = vReflectionUv.xy / vReflectionUv.w;
          float valid = step(0.0, projected.x) * step(projected.x, 1.0)
                      * step(0.0, projected.y) * step(projected.y, 1.0);
          vec2 edge = smoothstep(vec2(0.0), vec2(0.13), vFloorUv)
                    * smoothstep(vec2(0.0), vec2(0.13), 1.0 - vFloorUv);
          vec3 view = normalize(cameraPosition - vWorldPosition);
          float grazing = 1.0 - abs(view.y);
          // A broad nine-tap kernel softens the reflection into lacquer sheen.
          vec2 radius = texel * (2.0 + 2.0 * grazing);
          vec3 reflected = texture2D(tDiffuse, projected).rgb * 0.25;
          reflected += texture2D(tDiffuse, projected + vec2(radius.x, 0.0)).rgb * 0.125;
          reflected += texture2D(tDiffuse, projected - vec2(radius.x, 0.0)).rgb * 0.125;
          reflected += texture2D(tDiffuse, projected + vec2(0.0, radius.y)).rgb * 0.125;
          reflected += texture2D(tDiffuse, projected - vec2(0.0, radius.y)).rgb * 0.125;
          reflected += texture2D(tDiffuse, projected + radius).rgb * 0.0625;
          reflected += texture2D(tDiffuse, projected - radius).rgb * 0.0625;
          reflected += texture2D(tDiffuse, projected + vec2(radius.x, -radius.y)).rgb * 0.0625;
          reflected += texture2D(tDiffuse, projected + vec2(-radius.x, radius.y)).rgb * 0.0625;
          // Add the subjects' soft reflection over the lacquered physical floor.
          reflected = max(reflected - vec3(0.008), vec3(0.0));
          float alpha = strength * edge.x * edge.y * valid * mix(0.6, 1.0, grazing);
          gl_FragColor = vec4(reflected * mix(vec3(1.0), color, 0.18), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    },
  });
  floor.name = "Mega Ball reflective floor";
  floor.position.set(-1.7, -0.055, 1.2);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = floor.receiveShadow = false;
  floor.renderOrder = -10;
  const material = floor.material as T.ShaderMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = T.AdditiveBlending;

  const renderReflection = floor.onBeforeRender;
  let previousReflection = -Infinity;
  let disposed = false;
  floor.onBeforeRender = (...args) => {
    const now = performance.now();
    if (disposed || document.hidden || now - previousReflection < 1000 / 12)
      return;
    previousReflection = now;
    const visibility = exclude.map((object) => object.visible);
    exclude.forEach((object) => {
      object.visible = false;
    });
    try {
      renderReflection.apply(floor, args);
    } finally {
      exclude.forEach((object, index) => {
        object.visible = visibility[index];
      });
    }
  };
  scene.add(floor);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(floor);
      scene.remove(base);
      floor.dispose();
      baseMaterial.dispose();
      baseGeometry.dispose();
      geometry.dispose();
    },
  };
}
