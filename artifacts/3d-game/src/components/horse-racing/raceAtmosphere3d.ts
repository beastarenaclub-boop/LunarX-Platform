import * as THREE from "three";
import type { Venue } from "./race3dMath";

/** A world-space sky: the horizon stays level as the race camera moves. */
export function raceAtmosphere() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color("#598caf") },
      horizon: { value: new THREE.Color("#d2dfdf") },
      sunlight: { value: new THREE.Color("#fff0d4") },
      sunDirection: { value: new THREE.Vector3(-38, 42, -32).normalize() },
      cloudCover: { value: 0.46 },
      night: { value: 0 },
    },
    vertexShader: `varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, sunlight, sunDirection;
      uniform float cloudCover, night;
      varying vec3 direction;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
          mix(hash(cell + vec2(0, 1)), hash(cell + 1.), f.x), f.y);
      }
      float clouds(vec2 p) {
        float n = 0., amplitude = .5;
        for (int i = 0; i < 5; i++) {
          n += noise(p) * amplitude;
          p = mat2(.8, -.6, .6, .8) * p * 2.04 + 17.1;
          amplitude *= .5;
        }
        return n;
      }
      void main() {
        vec3 ray = normalize(direction);
        float height = max(ray.y, 0.);
        vec3 color = mix(horizon, zenith, pow(height, .42));
        float sunAngle = max(dot(ray, sunDirection), 0.);
        color += sunlight * pow(sunAngle, 12.) * .13 * (1. - night);
        color += sunlight * pow(sunAngle, 750.) * .55;
        color += sunlight * smoothstep(.99955, .99985, sunAngle) * 2.;
        if (ray.y > .015 && cloudCover > .01) {
          vec2 p = ray.xz / (ray.y + .18) * 2.4;
          float shape = clouds(p);
          float cloud = smoothstep(1. - cloudCover, 1.15 - cloudCover, shape);
          cloud *= smoothstep(.015, .16, ray.y);
          vec3 cloudColor = mix(horizon * .78, sunlight * .95, smoothstep(.4, .78, shape));
          color = mix(color, cloudColor, cloud * .85);
        }
        if (night > .5) {
          vec2 cell = floor(ray.xz / (abs(ray.y) + .25) * 410.);
          float stars = step(.9988, hash(cell)) * smoothstep(.12, .65, ray.y);
          color += stars * .25;
        }
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), material);
  mesh.name = "race-atmosphere";
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return {
    mesh,
    sunOffset: new THREE.Vector3(-38, 42, -32),
    configure(venue: Venue) {
      const night = venue.theme === "night",
        desert = venue.theme === "desert";
      material.uniforms.zenith.value.set(
        night ? "#09152d" : desert ? "#849fac" : "#548aae",
      );
      material.uniforms.horizon.value.set(
        night ? "#26324a" : desert ? "#e0c8a6" : "#c6d9de",
      );
      material.uniforms.sunlight.value.set(
        night ? "#9eafff" : desert ? "#ffe1ac" : "#fff0d4",
      );
      material.uniforms.cloudCover.value = night
        ? 0
        : desert
          ? 0.12
          : venue.theme === "coast"
            ? 0.4
            : 0.52;
      material.uniforms.night.value = night ? 1 : 0;
      this.sunOffset.set(-38, desert ? 29 : 42, -32);
      material.uniforms.sunDirection.value.copy(this.sunOffset).normalize();
      return material.uniforms.horizon.value;
    },
  };
}
