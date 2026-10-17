import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ErrorBoundary } from "../components/error-boundary";
import {
  RUNNERS,
  progressAt,
  standingsAt,
  trackPoint,
  venueById,
  type CameraMode,
} from "./engine";
import { useTurf } from "./store";
import { buildWorld, disposeWorld, riderModel } from "./world";

const HORSE_URL = `${import.meta.env.BASE_URL}assets/racing/horse.glb`;
function getProgress(id: number) {
  const { plan, result, phase } = useTurf.getState();
  if (plan && phase === "racing")
    return progressAt(plan, id, (Date.now() - plan.startAt) / 1000);
  if (phase === "finished" && result)
    return 1 + 0.012 * (8 - result.order.indexOf(id));
  return 0;
}
function Horses() {
  const gltf = useGLTF(HORSE_URL);
  const venueId = useTurf((s) => s.venueId);
  const root = useMemo(() => {
    const horses = RUNNERS.map((runner) => {
      const group = new THREE.Group(),
        horse = gltf.scene.clone(true);
      horse.scale.setScalar(0.018);
      horse.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          // Preserve authored gallop morphs, with smooth lighting and an individual coat.
          object.geometry = object.geometry.clone();
          object.geometry.computeVertexNormals();
          const colors = object.geometry.getAttribute("color");
          if (colors) {
            for (let i = 0; i < colors.count; i++) {
              const shade = THREE.MathUtils.clamp(
                (colors.getX(i) * 0.2126 +
                  colors.getY(i) * 0.7152 +
                  colors.getZ(i) * 0.0722) /
                  0.32,
                0.12,
                1,
              );
              colors.setXYZ(i, shade, shade, shade);
            }
          }
          object.material = new THREE.MeshStandardMaterial({
            color: runner.coat,
            vertexColors: !!colors,
            roughness: 0.65,
            metalness: 0.04,
          });
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      const rider = riderModel(runner.color, runner.id);
      group.add(horse, rider);
      const mixer = new THREE.AnimationMixer(horse);
      if (gltf.animations[0]) {
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        mixer.setTime(runner.id * 0.08);
      }
      return { group, rider, mixer, id: runner.id };
    });
    const group = new THREE.Group();
    horses.forEach((h) => group.add(h.group));
    return { group, horses };
  }, [gltf]);
  useEffect(
    () => () => {
      root.horses.forEach((h) => h.mixer.stopAllAction());
      disposeWorld(root.group);
    },
    [root],
  );
  useFrame((state, dt) => {
    const s = useTurf.getState(),
      venue = venueById(venueId),
      active = s.phase === "racing";
    root.horses.forEach((h) => {
      const p = trackPoint(getProgress(h.id) * venue.laps, h.id - 1);
      h.group.position.set(p.x, 0.03, p.z);
      h.group.rotation.y = p.heading;
      h.mixer.update(active ? Math.min(dt, 0.08) * 1.55 : 0);
      h.rider.position.y = active
        ? Math.sin(state.clock.elapsedTime * 17 + h.id * 0.7) * 0.095
        : Math.sin(state.clock.elapsedTime * 1.8 + h.id) * 0.015;
      h.rider.rotation.x = active
        ? Math.sin(state.clock.elapsedTime * 17 + h.id * 0.7) * 0.04
        : 0;
    });
  });
  return <primitive object={root.group} />;
}
function Environment() {
  const id = useTurf((s) => s.venueId),
    venue = venueById(id);
  const world = useMemo(() => buildWorld(venue), [venue]);
  useEffect(() => () => disposeWorld(world), [world]);
  return <primitive object={world} />;
}
function Dust() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const object = useMemo(() => new THREE.Object3D(), []);
  useFrame((state) => {
    const { phase, venueId } = useTurf.getState(),
      venue = venueById(venueId);
    if (!ref.current) return;
    ref.current.visible = phase === "racing";
    if (phase !== "racing") return;
    for (let i = 0; i < 96; i++) {
      const id = Math.floor(i / 12) + 1,
        age = (state.clock.elapsedTime * 1.4 + i * 0.27) % 1;
      const p = trackPoint(
        (getProgress(id) - age * 0.014) * venue.laps,
        id - 1,
      );
      object.position.set(
        p.x + Math.sin(i * 12) * age,
        0.2 + age * 0.8,
        p.z + Math.cos(i * 7) * age,
      );
      object.scale.setScalar(0.04 + age * 0.4);
      object.updateMatrix();
      ref.current.setMatrixAt(i, object.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 96]}>
      <sphereGeometry args={[1, 5, 4]} />
      <meshStandardMaterial
        color="#c8b797"
        transparent
        opacity={0.16}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
function StartingGates() {
  const root = useRef<THREE.Group>(null),
    doors = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const s = useTurf.getState();
    if (root.current)
      root.current.visible =
        s.phase === "betting" ||
        s.phase === "countdown" ||
        (s.phase === "racing" && s.elapsed < 2.5);
    doors.current.forEach((door) => {
      if (door)
        door.rotation.y =
          s.phase === "racing" ? -Math.min(Math.PI / 2, s.elapsed * 5) : 0;
    });
  });
  return (
    <group ref={root}>
      {Array.from({ length: 9 }, (_, i) => (
        <group key={i} position={[0, 0, -33.925 - i * 2.15]}>
          {[-2.7, 2.7].map((x) => (
            <mesh key={x} position={[x, 1.9, 0]} castShadow>
              <boxGeometry args={[0.1, 3.8, 0.1]} />
              <meshStandardMaterial
                color="#c3d0c3"
                metalness={0.4}
                roughness={0.5}
              />
            </mesh>
          ))}
          <mesh position={[0, 3.7, 0]} castShadow>
            <boxGeometry args={[5.6, 0.12, 0.12]} />
            <meshStandardMaterial color="#c3d0c3" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 4.1, -42.525]} castShadow>
        <boxGeometry args={[5.8, 0.28, 17.7]} />
        <meshStandardMaterial color="#315c48" />
      </mesh>
      {RUNNERS.map((r) => (
        <group
          key={r.id}
          ref={(el) => {
            doors.current[r.id - 1] = el;
          }}
          position={[2.7, 0, -33.925 - (r.id - 1) * 2.15]}
        >
          {[1.1, 2.25, 3.4].map((y) => (
            <mesh key={y} position={[0, y, -1.025]}>
              <boxGeometry args={[0.09, 0.09, 2.05]} />
              <meshStandardMaterial color="#c3d0c3" />
            </mesh>
          ))}
          <mesh position={[0, 2.25, -2.05]}>
            <boxGeometry args={[0.09, 2.4, 0.09]} />
            <meshStandardMaterial color="#c3d0c3" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
export function effectiveCamera(): CameraMode {
  const s = useTurf.getState();
  if (!s.autoCamera || s.phase !== "racing") return s.camera;
  if (s.plan && s.elapsed > Math.min(...s.plan.times) - 5) return "finish";
  return (
    ["rail", "chase", "drone", "broadcast", "jockey", "rail"] as CameraMode[]
  )[Math.floor(Math.max(0, s.elapsed) / 7) % 6];
}
function Director() {
  const position = useMemo(() => new THREE.Vector3(), []),
    target = useMemo(() => new THREE.Vector3(), []);
  const look = useRef(new THREE.Vector3(5, 1.8, -42));
  const last = useRef("");
  useFrame(({ camera, clock, size }, dt) => {
    const s = useTurf.getState(),
      venue = venueById(s.venueId),
      mode = effectiveCamera();
    const selected =
      s.phase === "racing" && s.autoCamera && s.plan
        ? standingsAt(s.plan, s.elapsed)[0]
        : s.selected;
    const p = trackPoint(getProgress(selected) * venue.laps, selected - 1);
    const dx = Math.sin(p.heading),
      dz = Math.cos(p.heading),
      nx = dz,
      nz = -dx;
    target.set(p.x, 2.1, p.z);
    if (mode === "rail")
      position.set(p.x - nx * 20 - dx * 4, 5.5, p.z - nz * 20 - dz * 4);
    else if (mode === "chase")
      position.set(p.x - dx * 15 + nx * 6, 7.3, p.z - dz * 15 + nz * 6);
    else if (mode === "jockey") {
      position.set(
        p.x + dx * 0.3,
        3.8 +
          Math.sin(clock.elapsedTime * 17) * (s.phase === "racing" ? 0.065 : 0),
        p.z + dz * 0.3,
      );
      target.set(p.x + dx * 25, 2.7, p.z + dz * 25);
    } else if (mode === "drone") {
      if (size.width / size.height < 1.4) {
        position.set(p.x - 12, 65, p.z - 35);
        target.set(p.x, 0, p.z);
      } else {
        position.set(p.x * 0.42 + 20, 115, p.z * 0.42 - 70);
        target.set(p.x * 0.5, 0, p.z * 0.5);
      }
    } else if (mode === "finish") {
      position.set(9, 5.5, -21);
      target.set(p.x * 0.4, 2, -43 + (p.z + 43) * 0.2);
    } else {
      const angle =
        s.phase === "betting" ? Math.sin(clock.elapsedTime * 0.06) * 0.16 : 0;
      position.set(
        p.x - dx * 22 - nx * (24 + angle * 20),
        10,
        p.z - dz * 22 - nz * (24 + angle * 20),
      );
    }
    const key = `${s.venueId}:${mode}`;
    if (last.current !== key) {
      camera.position.copy(position);
      look.current.copy(target);
      last.current = key;
    } else {
      camera.position.lerp(position, 1 - Math.exp(-dt * 5));
      look.current.lerp(target, 1 - Math.exp(-dt * 6));
    }
    camera.lookAt(look.current);
    const cam = camera as THREE.PerspectiveCamera,
      fov = mode === "jockey" ? 78 : mode === "drone" ? 49 : 48;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}
function SceneContent({ onReady }: { onReady: () => void }) {
  const venue = venueById(useTurf((s) => s.venueId)),
    night = venue.theme === "night";
  const quality = useTurf((s) => s.quality);
  useEffect(onReady, [onReady]);
  return (
    <>
      <color attach="background" args={[venue.sky]} />
      <fog attach="fog" args={[venue.sky, 170, 850]} />
      <hemisphereLight
        args={[
          night ? "#8fa9e6" : "#e4f1ff",
          night ? "#263729" : "#6c6947",
          night ? 1.7 : 2.25,
        ]}
      />
      <directionalLight
        position={[-65, 100, -55]}
        color={
          night ? "#d8e5ff" : venue.theme === "desert" ? "#ffdbad" : "#fff1d9"
        }
        intensity={night ? 2.8 : 3.2}
        castShadow={quality === "high"}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={115}
        shadow-camera-bottom={-115}
        shadow-camera-far={330}
        shadow-normalBias={0.1}
      />
      <Environment />
      <Horses />
      <StartingGates />
      <Dust />
      <Director />
    </>
  );
}
function Fallback() {
  return (
    <div className="tc-scene-fallback">
      <span>3D view unavailable</span>
      <p>
        Enable hardware acceleration or try another browser. Race positions and
        betting remain available below.
      </p>
    </div>
  );
}
export default function RacingScene() {
  const [ready, setReady] = useState(false),
    quality = useTurf((s) => s.quality);
  const onReady = useMemo(() => () => setReady(true), []);
  return (
    <ErrorBoundary FallbackComponent={Fallback}>
      {!ready && (
        <div className="tc-scene-loading">
          <span className="tc-spinner" /> Preparing the paddock…
        </div>
      )}
      <Canvas
        shadows={quality === "high"}
        dpr={quality === "high" ? [1, 1.6] : 1}
        camera={{ position: [-25, 14, -74], fov: 48, near: 0.15, far: 1600 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        fallback={<Fallback />}
      >
        <Suspense fallback={null}>
          <SceneContent onReady={onReady} />
        </Suspense>
      </Canvas>
    </ErrorBoundary>
  );
}
