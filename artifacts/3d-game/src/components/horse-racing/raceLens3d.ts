import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/** One scene render supplies contact occlusion, long-lens focus and film response. */
export function raceLens(renderer: THREE.WebGLRenderer, phone: boolean) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    defines: { AO_SAMPLES: 0 },
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      nearClip: { value: 0.12 },
      farClip: { value: 1400 },
      focus: { value: 20 },
      aperture: { value: 0.009 },
      aspect: { value: 16 / 9 },
      projectionInverse: { value: new THREE.Matrix4() },
      projectionScale: { value: 1 },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `
      #include <common>
      #include <packing>
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform float nearClip, farClip, focus, aperture, aspect;
      uniform mat4 projectionInverse;
      uniform float projectionScale;
      varying vec2 vUv;
      float depthAt(vec2 uv) {
        return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, nearClip, farClip);
      }
      vec3 positionAt(vec2 uv) {
        vec4 p = projectionInverse * vec4(uv * 2. - 1., texture2D(tDepth, uv).x * 2. - 1., 1.);
        return p.xyz / p.w;
      }
      void main() {
        float depth = depthAt(vUv);
        // Keep the entire horse sharp; blur only scenery beyond the subject.
        float radius = aperture * smoothstep(focus + 4., focus + 40., depth);
        vec3 color = texture2D(tColor, vUv).rgb;
        float weight = 1.;
        if (radius > .0001) for (int i = 0; i < 12; i++) {
          float angle = float(i) * 2.399963;
          float ring = sqrt((float(i) + .5) / 12.);
          vec2 offset = vec2(cos(angle) / aspect, sin(angle)) * radius * ring;
          vec2 uv = clamp(vUv + offset, vec2(.001), vec2(.999));
          // Reject foreground samples to avoid halos around ears and reins.
          float sampleWeight = smoothstep(focus + 2., focus + 4., depthAt(uv));
          color += texture2D(tColor, uv).rgb * sampleWeight;
          weight += sampleWeight;
        }
        color /= weight;
        #if AO_SAMPLES > 0
          vec3 center = positionAt(vUv);
          vec3 normal = normalize(cross(dFdx(center), dFdy(center)));
          if (normal.z < 0.) normal *= -1.;
          float occlusion = 0.;
          float sampleRadius = min(.06, .95 * projectionScale / max(depth, 1.));
          if (depth < 100. && radius < .001) {
            for (int i = 0; i < AO_SAMPLES; i++) {
              float angle = float(i) * 2.399963;
              float ring = sqrt((float(i) + .5) / float(AO_SAMPLES));
              vec2 uv = clamp(vUv + vec2(cos(angle) / aspect, sin(angle)) * sampleRadius * ring, .001, .999);
              vec3 delta = positionAt(uv) - center;
              float distanceToSample = length(delta);
              float horizon = max(0., dot(normal, delta / max(distanceToSample, .001)) - .12);
              occlusion += horizon * (1. - smoothstep(.15, 1.6, distanceToSample));
            }
          }
          color *= 1. - min(.30, occlusion * 1.15 / float(AO_SAMPLES));
        #endif
        // Very light lens falloff; no blur or oversaturated filter on the horse.
        vec2 lensPosition = vUv * 2. - 1.;
        color *= 1. - .075 * pow(dot(lensPosition, lensPosition) * .5, 1.5);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new FullScreenQuad(material);
  const size = new THREE.Vector2();
  return {
    render(
      scene: THREE.Scene,
      camera: THREE.PerspectiveCamera,
      focus: number,
      closeup = false,
      enabled = true,
    ) {
      // Broadcast shots need neither background blur nor a second full-screen
      // HDR pass. Keep the same ACES response in the renderer's direct output.
      if (!closeup || !enabled) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y)
        target.setSize(size.x, size.y);
      material.uniforms.focus.value = focus;
      material.uniforms.aspect.value = camera.aspect;
      material.uniforms.nearClip.value = camera.near;
      material.uniforms.farClip.value = camera.far;
      material.uniforms.aperture.value = closeup ? (phone ? 0.004 : 0.006) : 0;
      material.uniforms.projectionInverse.value.copy(
        camera.projectionMatrixInverse,
      );
      material.uniforms.projectionScale.value =
        camera.projectionMatrix.elements[5] * 0.5;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
    dispose() {
      target.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
