import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { palmAt, type DealerRelease } from "./dicePlan";
import { DEALER_HEIGHT, DEALER_TOP, DEALER_IDLE_TOP, type DealerPlayback } from "./dealerMotion";

/** Preserve the extended hand above the felt, with the dice drawn in front. */
export default function DealerHand({ videoRef, idleRef, playbackRef, release }: {
  videoRef?: RefObject<HTMLVideoElement | null>;
  idleRef?: RefObject<HTMLVideoElement | null>;
  playbackRef?: RefObject<DealerPlayback>;
  release?: DealerRelease;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const size = useThree(s => s.size);
  const video = videoRef?.current;
  const idle = idleRef?.current;
  const material = useMemo(() => {
    if (!video) return null;
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.NoColorSpace;
    const neutral = idle ? new THREE.VideoTexture(idle) : texture;
    neutral.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        footage: { value: texture }, aspect: { value: 1 }, videoAspect: { value: 16 / 9 },
        neutral: { value: neutral }, height: { value: DEALER_HEIGHT }, top: { value: DEALER_TOP },
        palm: { value: new THREE.Vector2(0.46, 0.84) }, leftY: { value: .82 },
      },
      vertexShader: `varying vec2 screenUv;
        void main() { screenUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D footage;
        uniform float aspect; uniform float videoAspect; uniform vec2 palm; uniform float height; uniform float top; uniform float leftY;
        varying vec2 screenUv;
        void main() {
          vec2 p = vec2(.5 + (screenUv.x - .5) * aspect / (height * videoAspect), (1. - screenUv.y - top) / height);
          vec2 d = (p - palm) / vec2(.068, .115);
          vec2 left = (p - vec2(.55, leftY)) / vec2(.095, .12);
          float alpha = max(1. - smoothstep(.83, 1., length(d)), 1. - smoothstep(.83, 1., length(left)));
          if (alpha < .01 || p.y < 0. || p.y > 1.) discard;
          vec3 c = texture2D(footage, vec2(p.x, 1. - p.y)).rgb;
          // Skin and sleeves stay in front of the felt; the filmed green
          // tabletop is excluded, so it cannot form a patch around the hand.
          float skin = smoothstep(.012, .06, c.r - c.g) * smoothstep(.025, .08, c.r - c.b) * smoothstep(.12, .25, c.r);
          float sleeve = smoothstep(.18, .38, min(c.r, min(c.g, c.b)));
          gl_FragColor = vec4(c, alpha * max(skin, sleeve));
        }`,
    });
    return { mat, texture, neutral };
  }, [video, idle]);
  useEffect(() => () => {
    material?.texture.dispose();
    if (material?.neutral !== material?.texture) material?.neutral.dispose();
    material?.mat.dispose();
  }, [material]);
  useFrame(() => {
    if (!mesh.current || !material || !video || !release?.hand) return;
    const frame = playbackRef?.current;
    const rolling = frame?.mode === "roll";
    // Raised greeting/clapping hands are in the main video above the felt.
    // Do not leave the idle take's resting hands floating below them.
    mesh.current.visible = rolling ? !!frame.frameReady : frame?.mode === "idle" && !!idle;
    const palm = rolling ? palmAt(release, frame.mediaMs) : { x: .465, y: .90 };
    material.mat.uniforms.footage.value = rolling ? material.texture : material.neutral;
    material.mat.uniforms.palm.value.set(palm.x, palm.y - 0.055);
    material.mat.uniforms.top.value = DEALER_TOP + (rolling ? 0 : DEALER_IDLE_TOP * DEALER_HEIGHT);
    material.mat.uniforms.leftY.value = rolling ? .82 : .88;
    material.mat.uniforms.aspect.value = size.width / size.height;
    material.mat.uniforms.videoAspect.value = release.videoAspect;
  });
  if (!material || !release?.hand) return null;
  return <mesh ref={mesh} material={material.mat} frustumCulled={false} renderOrder={1} visible={false}>
    <planeGeometry args={[2, 2]} />
  </mesh>;
}
