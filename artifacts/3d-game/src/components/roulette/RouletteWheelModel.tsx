import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import modelUrl from "@/assets/roulette-model/roulette-wheel-v2.glb?url";
import insideBaseUrl from "@/assets/roulette-model/inside-basecolor.webp?url";
import insideNormalUrl from "@/assets/roulette-model/inside-normal.webp?url";
import outsideBaseUrl from "@/assets/roulette-model/outside-basecolor.webp?url";
import outsideNormalUrl from "@/assets/roulette-model/outside-normal.webp?url";
import turretBaseUrl from "@/assets/roulette-model/turret-basecolor.webp?url";
import turretNormalUrl from "@/assets/roulette-model/turret-normal.webp?url";
import {
  ROULETTE_MODEL_ZERO_OFFSET_DEG,
  rouletteModelRotorDegrees,
  roulettePocketAtWheelRotation,
} from "./wheelData";

/**
 * The supplied wheel's "inside" mesh is the pocket rotor. The outer bowl and
 * turret remain stationary while this group turns around the model's Y axis.
 */
export interface RouletteWheelModelHandle {
  setMotion: (wheelDeg: number, ballDeg: number, ballDrop: number,
    ballPresentation?: { visible: boolean; flight: number }) => void;
}

interface Props {
  onFailure: () => void;
  onReady?: () => void;
}

const textureUrls: Record<string, { base: string; normal: string }> = {
  inside: { base: insideBaseUrl, normal: insideNormalUrl },
  outside: { base: outsideBaseUrl, normal: outsideNormalUrl },
  turret: { base: turretBaseUrl, normal: turretNormalUrl },
};

function renderScene(
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>,
  sceneRef: MutableRefObject<THREE.Scene | null>,
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>,
) {
  const renderer = rendererRef.current;
  const scene = sceneRef.current;
  const camera = cameraRef.current;
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) disposeMaterial(material);
  });
  root.removeFromParent();
  root.clear();
}

const RouletteWheelModel = forwardRef<RouletteWheelModelHandle, Props>(
  function RouletteWheelModel({ onFailure, onReady }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rotorRef = useRef<THREE.Group | null>(null);
    const ballRef = useRef<THREE.Mesh | null>(null);
    const failureRef = useRef(onFailure);
    failureRef.current = onFailure;
    const readyRef = useRef(onReady);
    readyRef.current = onReady;

    useImperativeHandle(
      ref,
      () => ({
        setMotion(wheelDeg, ballDeg, ballDrop) {
          const rotor = rotorRef.current;
          const modelDegrees = rouletteModelRotorDegrees(wheelDeg);
          if (rotor) {
            rotor.rotation.y = THREE.MathUtils.degToRad(modelDegrees);
          }
          const host = hostRef.current;
          if (host) {
            host.dataset.modelWheelDegrees = String(wheelDeg);
            host.dataset.modelRotorDegrees = String(modelDegrees);
            host.dataset.modelPocketUnderPointer = String(
              roulettePocketAtWheelRotation(wheelDeg),
            );
          }
          const ball = ballRef.current;
          if (ball) {
            const angle = THREE.MathUtils.degToRad(ballDeg);
            const radius = THREE.MathUtils.lerp(0.337, 0.254, ballDrop);
            ball.position.set(
              Math.sin(angle) * radius,
              THREE.MathUtils.lerp(0.204, 0.158, ballDrop),
              -Math.cos(angle) * radius,
            );
          }
          renderScene(rendererRef, sceneRef, cameraRef);
        },
      }),
      [],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      const disposables: Array<{ dispose: () => void }> = [];
      let loadedModelRoot: THREE.Group | null = null;

      try {
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        // The reference wheel is warm and polished rather than purple-lit.
        // Keep the copper rim and wood grain readable on the dark table.
        renderer.toneMappingExposure = 1.35;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.domElement.className = "h-full w-full";
        renderer.domElement.setAttribute("data-testid", "roulette-model-canvas");
        renderer.domElement.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            failureRef.current();
          },
          { once: true },
        );
        host.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const scene = new THREE.Scene();
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
        // A slightly higher, more top-down angle matches the supplied
        // reference while keeping the ball track and turret visible.
        camera.position.set(0, 1.52, 1.38);
        camera.lookAt(0, 0.07, 0);
        cameraRef.current = camera;

        scene.add(new THREE.HemisphereLight(0xffe9bd, 0x24130b, 2.35));
        const key = new THREE.DirectionalLight(0xffd9a8, 4.8);
        key.position.set(-1.6, 2.8, 2.4);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xd97735, 2.35);
        rim.position.set(1.8, 1.35, -1.8);
        scene.add(rim);
        const fill = new THREE.PointLight(0xfff4df, 1.15, 4);
        fill.position.set(0, 1.2, 0.7);
        scene.add(fill);

        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(0.52, 64),
          new THREE.MeshStandardMaterial({
            color: 0x21130d,
            roughness: 0.72,
            metalness: 0.1,
            transparent: true,
            opacity: 0.92,
          }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.008;
        scene.add(floor);
        disposables.push(floor.geometry, floor.material);

        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.015, 18, 12),
          new THREE.MeshStandardMaterial({
            color: 0xf8fafc,
            metalness: 0.72,
            roughness: 0.2,
          }),
        );
        ball.position.set(0, 0.204, -0.337);
        ball.castShadow = false;
        ballRef.current = ball;
        scene.add(ball);
        disposables.push(ball.geometry, ball.material);

        // Premium centre stone: the reference wheel has a distinctive jewel
        // on top of the turret, so keep it present in the real 3D renderer
        // rather than relying only on the flat fallback styling.
        const diamond = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.064, 1),
          new THREE.MeshPhysicalMaterial({
            color: 0xdff7ff,
            emissive: 0x3b82f6,
            emissiveIntensity: 0.18,
            metalness: 0.12,
            roughness: 0.08,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
            transparent: true,
            opacity: 0.96,
          }),
        );
        diamond.position.set(0, 0.33, 0);
        diamond.scale.set(1, 1.28, 1);
        diamond.rotation.set(0.18, 0.35, 0.12);
        diamond.castShadow = false;
        scene.add(diamond);
        disposables.push(diamond.geometry, diamond.material);

        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderScene(rendererRef, sceneRef, cameraRef);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const manager = new THREE.LoadingManager();
        manager.onError = () => {
          if (!disposed) failureRef.current();
        };
        const textureLoader = new THREE.TextureLoader(manager);
        const materials = new Map<string, THREE.MeshStandardMaterial>();
        for (const [name, urls] of Object.entries(textureUrls)) {
          const map = textureLoader.load(urls.base);
          map.colorSpace = THREE.SRGBColorSpace;
          map.flipY = false;
          map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          const normalMap = textureLoader.load(urls.normal);
          normalMap.flipY = false;
          const material = new THREE.MeshStandardMaterial({
            map,
            normalMap,
            metalness: name === "inside" ? 0.42 : 0.58,
            roughness: name === "inside" ? 0.4 : 0.32,
          });
          materials.set(name, material);
          disposables.push(map, normalMap, material);
        }

        new GLTFLoader().load(
          modelUrl,
          (gltf) => {
            if (disposed) {
              disposeObject(gltf.scene);
              return;
            }
            const rotor = new THREE.Group();
            rotor.rotation.y = THREE.MathUtils.degToRad(
              ROULETTE_MODEL_ZERO_OFFSET_DEG,
            );
            rotorRef.current = rotor;
            const modelRoot = new THREE.Group();
            loadedModelRoot = modelRoot;

            gltf.scene.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const originalMaterials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              const materialName = originalMaterials[0]?.name;
              const replacement = materials.get(materialName);
              if (replacement) {
                object.material = replacement;
                for (const material of originalMaterials) {
                  if (material !== replacement) disposeMaterial(material);
                }
              }
              object.geometry.computeBoundingSphere();
              if (materialName === "inside") {
                object.removeFromParent();
                rotor.add(object);
              }
            });
            modelRoot.add(gltf.scene, rotor);
            scene.add(modelRoot);
            readyRef.current?.();
            renderScene(rendererRef, sceneRef, cameraRef);
          },
          undefined,
          () => {
            if (!disposed) failureRef.current();
          },
        );
      } catch {
        failureRef.current();
      }

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        rotorRef.current = null;
        ballRef.current = null;
        if (loadedModelRoot) {
          disposeObject(loadedModelRoot);
          loadedModelRoot = null;
        }
        for (const item of disposables) item.dispose();
        const renderer = rendererRef.current;
        rendererRef.current = null;
        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        }
        sceneRef.current = null;
        cameraRef.current = null;
      };
    }, []);

    return (
      <div
        ref={hostRef}
        className="absolute inset-0 overflow-hidden rounded-full"
        aria-hidden="true"
        data-testid="roulette-model"
        data-model-zero-offset={ROULETTE_MODEL_ZERO_OFFSET_DEG}
      />
    );
  },
);

export default RouletteWheelModel;
