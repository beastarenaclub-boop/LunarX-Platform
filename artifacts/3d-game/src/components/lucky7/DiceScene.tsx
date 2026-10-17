import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { dieGeometry, dieMaterial, contactShadowTexture } from "./diceAppearance";
export { FACE_VALUES } from "./diceAppearance";
import {
  anchorDie,
  buildThrowPlan,
  DIE_SIZE,
  diePose,
  planDealerThrow,
  palmAt,
  gripAt,
  tumbleSpeed01,
  type DiceThrowCue,
  type DealerRelease,
  type ThrowPlan,
} from "./dicePlan";
import type { DiceAudio } from "./diceAudio";
import CasinoFelt from "./CasinoFelt";
import DealerHand from "./DealerHand";
import { DEALER_HEIGHT, DEALER_TOP, TABLE_HEIGHT, type DealerPlayback } from "./dealerMotion";

/**
 * The 3D Lucky 7 dice table.
 *
 * This module is the ONLY place three.js is imported, and it is pulled in as a
 * lazy chunk by `DiceTable`, so the lobby and every other game keep their
 * current bundle. Frame updates are written straight onto the meshes — React
 * never re-renders during a roll.
 */

/* ── Die faces ──────────────────────────────────────────────────────────
   BoxGeometry material order is [+X, −X, +Y, −Y, +Z, −Z]. Opposite faces of a
   real die sum to seven, so 1/6, 2/5 and 3/4 sit across from each other. */


/** Euler rotation that brings a given face value up (+Y). */
const FACE_UP_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, Math.PI / 2],
  2: [0, 0, 0],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
  5: [Math.PI, 0, 0],
  6: [0, 0, -Math.PI / 2],
};

/** Resting orientation that shows `value` face-up, with a per-die yaw. */
export function restQuaternion(value: number, yaw: number): THREE.Quaternion {
  const [x, y, z] = FACE_UP_EULER[value] ?? FACE_UP_EULER[1];
  const face = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const spin = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yaw,
  );
  return spin.multiply(face);
}

interface ThrowProps {
  dice: [number, number];
  /** Local-clock deadline the dice must be at rest by; null = rest now. */
  settleAt: number | null;
  /** Changes once per round; re-anchors the throw. */
  throwKey: string;
  audio?: DiceAudio;
  onSettled?: () => void;
  windupMs?: number;
  onThrowCue?: (cue: DiceThrowCue | null) => void;
  dealerRelease?: DealerRelease;
  releaseVideoMs?: number;
  videoStartMs?: number;
  videoEndMs?: number;
  rollVideoRef?: RefObject<HTMLVideoElement | null>;
  idleVideoRef?: RefObject<HTMLVideoElement | null>;
  playbackRef?: RefObject<DealerPlayback>;
  decodedFrameRef?: RefObject<(() => void) | null>;
  filmScene?: boolean;
  parked?: { x: number; y: number };
  animating?: boolean;
}

function Dice({ dice, settleAt, throwKey, audio, onSettled, windupMs = 0, onThrowCue,
  dealerRelease, releaseVideoMs = 0, videoStartMs = 0, videoEndMs = 5000, playbackRef, decodedFrameRef, filmScene, parked }: ThrowProps) {
  const meshes = [
    useRef<THREE.Mesh>(null),
    useRef<THREE.Mesh>(null),
  ] as const;
  const material = useMemo(dieMaterial, []);
  const shadowTexture = useMemo(() => filmScene ? contactShadowTexture() : null, [filmScene]);
  const contacts = [useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null),
    useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null)] as const;
  const invalidate = useThree((s) => s.invalidate);
  const { camera, size, gl, scene } = useThree();
  const releaseRef = useRef(dealerRelease);
  releaseRef.current = dealerRelease;
  const screenPoint = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Ray(), []);
  const releasePoint = useMemo(() => new THREE.Vector3(), []);
  const handPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.85), []);
  const filmedHandPlane = useMemo(() => new THREE.Plane(), []);
  const cameraForward = useMemo(() => new THREE.Vector3(), []);
  const cameraPoint = useMemo(() => new THREE.Vector3(), []);
  const heldScaleRef = useRef(DIE_SIZE);
  const heldWidthRef = useRef(.014);
  const yawQuat = useMemo(() => new THREE.Quaternion(), []);
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const rockAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useEffect(() => {
    if (!filmScene || !shadowTexture) return;
    // Prepare even the hidden contact planes while the table loads. Their
    // first shader compilation and texture upload must not interrupt growth.
    gl.compile(scene, camera);
    gl.initTexture(shadowTexture);
  }, [filmScene, shadowTexture, gl, scene, camera]);

  const placeContact = (i: number, mesh: THREE.Mesh, scale: number) => {
    const contact = contacts[i].current;
    if (!contact) return;
    const altitude = Math.max(0, mesh.position.y - scale / 2);
    contact.visible = mesh.visible && !parked && altitude < scale * 1.8;
    contact.position.set(mesh.position.x + altitude * .08, -.003, mesh.position.z + altitude * .06);
    contact.scale.set(scale * (1.35 + altitude * .15), scale * (1.12 + altitude * .15), 1);
    contact.material.opacity = .18 / (1 + altitude * 7);
  };

  const setScreenRay = (release: DealerRelease, x: number, y: number) => {
    const videoWidth = size.height * (filmScene ? 1 : DEALER_HEIGHT) * release.videoAspect;
    const px = filmScene ? x * videoWidth + (size.width - videoWidth) * (release.videoPositionX ?? .5) : size.width / 2 + (x - 0.5) * videoWidth;
    const py = size.height * (filmScene ? y : DEALER_TOP + DEALER_HEIGHT * y);
    screenPoint.set(px / size.width * 2 - 1, 1 - py / size.height * 2, 0.5).unproject(camera);
    ray.origin.copy(camera.position);
    ray.direction.copy(screenPoint).sub(camera.position).normalize();
  };
  const handPosition = (release: DealerRelease, x: number, y: number, height = .85, holding = false) => {
    // A horizontal floor plane can sit behind the camera ray when a palm is
    // raised. Track filmed hands on a camera-facing plane through the release
    // point, then hand over to the table's world-space trajectory on opening.
    handPlane.constant = -height;
    if (filmScene && holding) {
      setScreenRay(release, release.x, release.y);
      ray.intersectPlane(handPlane, releasePoint);
      filmedHandPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(cameraForward), releasePoint);
      setScreenRay(release, x, y);
      ray.intersectPlane(filmedHandPlane, releasePoint);
      const depth = -cameraPoint.copy(releasePoint).applyMatrix4(camera.matrixWorldInverse).z;
      const focalPixels = camera.projectionMatrix.elements[5] * size.height / 2;
      heldScaleRef.current = THREE.MathUtils.clamp(size.height * release.videoAspect * heldWidthRef.current * depth / focalPixels, .16, 1.2);
      return releasePoint;
    }
    setScreenRay(release, x, y);
    ray.intersectPlane(handPlane, releasePoint);
    return releasePoint;
  };

  // Motion state lives in refs: a frame must never re-render the tree.
  const planRef = useRef<ThrowPlan | null>(null);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const filmedRef = useRef(false);
  const mediaMsRef = useRef(videoStartMs);
  const motionMsRef = useRef(videoStartMs);
  const restQuatsRef = useRef<THREE.Quaternion[]>([]);
  const spinQuat = useRef(new THREE.Quaternion());
  const axisVecs = useRef<THREE.Vector3[]>([]);
  const doneRef = useRef(false);
  const nextImpactRef = useRef(0);
  const releasedRef = useRef(false);
  const anchoredRef = useRef<string | null>(null);
  // Time the tab became visible again — impacts that "happened" while hidden
  // are skipped rather than fired in a burst on return.
  const resumedAtRef = useRef(0);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const settledCbRef = useRef(onSettled);
  settledCbRef.current = onSettled;
  const cueCbRef = useRef(onThrowCue);
  cueCbRef.current = onThrowCue;
  const windupRef = useRef(windupMs);
  windupRef.current = windupMs;

  // Anchor a fresh throw whenever the round (or the target faces) change. The
  // duration is measured from the round's own deadline at the moment the
  // scene is ready, so a late chunk load or a late join simply shortens (or
  // skips) the roll instead of overrunning the reveal window.
  useLayoutEffect(() => {
    // Clock-offset corrections during one reveal must not restart the gesture.
    const identity = `${throwKey}:${dice[0]}:${dice[1]}:${settleAt == null ? "rest" : "reveal"}`;
    if (anchoredRef.current === identity) return;
    anchoredRef.current = identity;
    const startedAt = Date.now();
    const remaining = settleAt != null ? settleAt - startedAt : 0;
    const { durationMs, windupMs: lead } = planDealerThrow(remaining, windupRef.current,
      windupRef.current > 0 ? videoEndMs - videoStartMs : undefined, filmScene ? 1.1 : Infinity);
    const plan = buildThrowPlan(throwKey, durationMs);
    if (lead > 0 && releaseRef.current) {
      const release = releaseRef.current;
      const point = handPosition(release, release.x, release.y);
      plan.dice.forEach((die, i) => anchorDie(die, [
        point.x + (i === 0 ? -1 : 1) * DIE_SIZE * 0.49, point.y, point.z,
      ]));
    }
    planRef.current = plan;
    startRef.current = performance.now() + lead;
    endRef.current = startRef.current + durationMs;
    filmedRef.current = lead > 0 && !!releaseRef.current;
    mediaMsRef.current = videoStartMs;
    motionMsRef.current = videoStartMs;
    doneRef.current = durationMs <= 0;
    releasedRef.current = durationMs <= 0;
    nextImpactRef.current = durationMs <= 0 ? plan.impacts.length : 0;
    restQuatsRef.current = [
      restQuaternion(dice[0], plan.dice[0].yaw),
      restQuaternion(dice[1], plan.dice[1].yaw),
    ];
    axisVecs.current = plan.dice.map((d) =>
      new THREE.Vector3(d.axis[0], d.axis[1], d.axis[2]),
    );

    for (let i = 0; i < 2; i++) {
      const mesh = meshes[i].current;
      if (!mesh) continue;
      const pose = diePose(plan.dice[i], durationMs <= 0 ? 1 : 0);
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.scale.setScalar(DIE_SIZE);
      mesh.quaternion.copy(restQuatsRef.current[i]);
      mesh.visible = durationMs <= 0 || lead === 0;
      placeContact(i, mesh, DIE_SIZE);
    }
    cueCbRef.current?.(durationMs > 0 ? {
      roundId: throwKey,
      startedAt,
      releaseAt: startedAt + lead,
      endsAt: startedAt + lead + durationMs,
    } : null);
    gl.domElement.dataset.motion = durationMs <= 0 ? "rest" : lead > 0 ? "hand" : "flight";
    if (durationMs <= 0) settledCbRef.current?.();
    invalidate();
    // `meshes` is a stable tuple of refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throwKey, dice[0], dice[1], settleAt, invalidate]);

  // Filmed hands already contain the dice. Leave the transparent WebGL layer
  // asleep until a decoded frame actually opens the palm, then render the
  // tumble at display rate. A deadline still settles a paused/stalled source.
  useEffect(() => {
    if (!filmScene || !decodedFrameRef) return;
    const wake = () => {
      const frame = playbackRef?.current;
      if (!doneRef.current && frame?.roundId === throwKey && frame.frameReady
        && frame.mediaMs >= releaseVideoMs) invalidate();
    };
    decodedFrameRef.current = wake;
    return () => { if (decodedFrameRef.current === wake) decodedFrameRef.current = null; };
  }, [filmScene, decodedFrameRef, playbackRef, throwKey, releaseVideoMs, invalidate]);

  useEffect(() => {
    if (!filmScene || settleAt == null || doneRef.current) return;
    const timer = window.setTimeout(() => { if (!doneRef.current) invalidate(); },
      Math.max(0, endRef.current - performance.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [filmScene, settleAt, throwKey, invalidate]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        resumedAtRef.current = performance.now();
        invalidate();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [invalidate]);

  // The two dice wait in the filmed side tray until the dealer picks them up.
  useLayoutEffect(() => {
    if (!parked || !dealerRelease) return;
    const point = handPosition(dealerRelease, parked.x, parked.y, DIE_SIZE / 2);
    for (let i = 0; i < 2; i++) {
      const mesh = meshes[i].current;
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.set(point.x + (i ? 1 : -1) * DIE_SIZE * .49, point.y, point.z);
    }
    gl.domElement.dataset.motion = "tray";
    invalidate();
  }, [parked, dealerRelease, size.width, size.height, invalidate]);

  useFrame(() => {
    const plan = planRef.current;
    const source = releaseRef.current;
    // Match the real props inside the hands, then enlarge only after release.
    let dieSize = DIE_SIZE;
    if (filmScene && source?.filmedDice) {
      heldWidthRef.current = source.dieWidth ?? .016;
      handPosition(source, source.x, source.y, .85, true);
      dieSize = heldScaleRef.current;
    }
    const restingSize = filmScene && source?.filmedDice ? Math.max(DIE_SIZE, dieSize * 1.8) : DIE_SIZE;
    // Reproject after TableCamera has pinned the final viewport for this frame.
    if (parked && releaseRef.current) {
      for (const ref of contacts) if (ref.current) ref.current.visible = false;
      const point = handPosition(releaseRef.current, parked.x, parked.y, dieSize / 2);
      for (let i = 0; i < 2; i++) {
        const mesh = meshes[i].current;
        if (!mesh) continue;
        mesh.visible = true;
        mesh.scale.setScalar(dieSize);
        mesh.position.set(point.x + (i ? 1 : -1) * dieSize * .55, point.y, point.z);
      }
      return;
    }
    if (!plan || plan.durationMs <= 0 || doneRef.current || parked) {
      if (filmScene && source?.filmedDice) meshes.forEach((ref, i) => {
        if (ref.current) {
          ref.current.scale.setScalar(restingSize); ref.current.position.y = restingSize / 2;
          placeContact(i, ref.current, restingSize);
        }
      });
      return;
    }
    const now = performance.now();
    const filmed = filmedRef.current;
    const frame = playbackRef?.current;
    const frameReady = frame?.mode === "roll" && frame.roundId === throwKey && frame.frameReady;
    if (frameReady) mediaMsRef.current = Math.max(mediaMsRef.current, frame.mediaMs);
    const mediaMs = mediaMsRef.current;
    // Release still requires the decoded open palm. After that, interpolate
    // within one source frame so 3D motion renders smoothly at display rate
    // instead of stepping at the filmed clip's 24 fps. A stall can advance
    // at most one source frame, never run an independent throw clock.
    if (frameReady) motionMsRef.current = Math.max(motionMsRef.current,
      mediaMs + Math.min(1000 / 24, Math.max(0, now - frame.presentedAt) * frame.rate));
    const atDeadline = now >= endRef.current;
    if (!releasedRef.current) {
      // Wait for the palm in the presented frame. Decoding delays cannot
      // trigger an independent throw while her fingers are still closed.
      const waiting = !atDeadline && (filmed
        ? !frameReady || mediaMs < releaseVideoMs
        : now < startRef.current);
      if (waiting) {
        const release = releaseRef.current;
        if (filmScene && release?.filmedDice) {
          // The filmed cup really encloses the props. Drawing meshes here
          // would put duplicate dice outside the fingers during the shake.
          for (const ref of meshes) if (ref.current) ref.current.visible = false;
          for (const ref of contacts) if (ref.current) ref.current.visible = false;
          return;
        }
        if (filmScene) invalidate();
        if (release?.hand && frameReady && mediaMs >= release.hand[0].ms) {
          const grip = gripAt(release, mediaMs);
          heldWidthRef.current = grip?.size ?? .014;
          const palm = palmAt(release, mediaMs);
          const point = handPosition(release, palm.x, palm.y, .85, true);
          for (let i = 0; i < 2; i++) {
            const mesh = meshes[i].current;
            if (!mesh) continue;
            mesh.visible = true;
            mesh.castShadow = false;
            mesh.scale.setScalar(filmScene ? heldScaleRef.current : DIE_SIZE);
            mesh.position.set(point.x + (i === 0 ? -1 : 1) * (filmScene ? heldScaleRef.current : DIE_SIZE) * 0.49, point.y, point.z);
            // A held die turns with the wrist, without tumbling in mid-grip.
            mesh.quaternion.setFromEuler(new THREE.Euler(.18, i ? -.24 : .2, grip ? -grip.angle * .22 : 0));
          }
        }
        return;
      }
    }
    const fresh = now - resumedAtRef.current > 250;

    if (!releasedRef.current) {
      releasedRef.current = true;
      if (filmed && releaseRef.current) {
        const release = releaseRef.current;
        if (filmScene && release.filmedDice) {
          heldWidthRef.current = release.dieWidth ?? .016;
          handPosition(release, release.x, release.y, .85, true);
        }
        const point = handPosition(release, release.x, release.y);
        plan.dice.forEach((die, i) => {
          anchorDie(die, [point.x + (i === 0 ? -1 : 1) * (filmScene ? heldScaleRef.current : DIE_SIZE) * 0.49, point.y, point.z]);
          axisVecs.current[i].set(...die.axis);
        });
      }
      // Returning from a hidden tab must not replay an old release sound.
      if (fresh && !atDeadline) audioRef.current?.onThrow?.();
      if (!filmed) {
        plan.durationMs = Math.max(1, endRef.current - now);
        startRef.current = now;
      }
      gl.domElement.dataset.videoMs = String(mediaMs);
      gl.domElement.dataset.motion = "drop";
    }
    const t = atDeadline ? 1 : filmed
      ? Math.max(0, Math.min(1, (motionMsRef.current - releaseVideoMs) / (videoEndMs - releaseVideoMs)))
      : Math.min(1, (now - startRef.current) / plan.durationMs);

    for (let i = 0; i < 2; i++) {
      const mesh = meshes[i].current;
      if (!mesh) continue;
      mesh.visible = true;
      mesh.castShadow = !filmScene;
      const pose = diePose(plan.dice[i], t);
      const scale = filmScene && source?.filmedDice
        ? THREE.MathUtils.lerp(dieSize, restingSize, THREE.MathUtils.smoothstep(t, 0, .3))
        : filmScene && filmed ? THREE.MathUtils.lerp(heldScaleRef.current, DIE_SIZE, Math.min(1, t / .18)) : DIE_SIZE;
      mesh.scale.setScalar(scale);
      if (i === 0) {
        const currentScale = scale.toFixed(4), heldScale = dieSize.toFixed(4);
        if (gl.domElement.dataset.dieScale !== currentScale) gl.domElement.dataset.dieScale = currentScale;
        if (gl.domElement.dataset.heldScale !== heldScale) gl.domElement.dataset.heldScale = heldScale;
      }
      spinQuat.current.setFromAxisAngle(axisVecs.current[i], pose.spin);
      mesh.quaternion
        .copy(restQuatsRef.current[i])
        .premultiply(spinQuat.current);
      yawQuat.setFromAxisAngle(upAxis, pose.skidYaw);
      mesh.quaternion.premultiply(yawQuat);
      yawQuat.setFromAxisAngle(rockAxis, pose.rock);
      mesh.quaternion.premultiply(yawQuat);
      // Support the currently rotated rounded cube on the felt. A fixed
      // centre height lets tumbling corners cut through the tabletop.
      const { x, y, z, w } = mesh.quaternion;
      const support = scale * (0.41 * (
        Math.abs(2 * (x * y + z * w))
        + Math.abs(1 - 2 * (x * x + z * z))
        + Math.abs(2 * (y * z - x * w))
      ) + 0.09);
      const contact = Math.min(1, t / plan.dice[i].bounces[0]);
      mesh.position.set(pose.x, pose.y + (support - DIE_SIZE / 2) * contact, pose.z);
      placeContact(i, mesh, scale);
      if (i === 0 && gl.domElement.dataset.motion !== pose.phase) {
        gl.domElement.dataset.videoMs = String(mediaMs);
        gl.domElement.dataset.motion = pose.phase;
      }
    }

    // Impact cues, fired from the motion itself. A gap larger than a couple of
    // frames (hidden tab, stalled main thread) drops the missed hits.
    while (
      nextImpactRef.current < plan.impacts.length &&
      t >= plan.impacts[nextImpactRef.current].t
    ) {
      const hit = plan.impacts[nextImpactRef.current++];
      const lateBy = (t - hit.t) * plan.durationMs;
      if (fresh && lateBy < 160) audioRef.current?.onImpact?.(hit.strength);
    }
    audioRef.current?.onTumble?.(tumbleSpeed01(t));

    if (t >= 1 && !doneRef.current) {
      doneRef.current = true;
      gl.domElement.dataset.motion = "rest";
      audioRef.current?.onSettle?.();
      settledCbRef.current?.();
    }
    if (filmScene && !doneRef.current) invalidate();
  });

  return (
    <>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={meshes[i]}
          geometry={dieGeometry}
          material={material}
          castShadow={!filmScene}
          receiveShadow={!filmScene}
          renderOrder={2}
        />
      ))}
      {filmScene && contacts.map((ref, i) => <mesh key={`contact-${i}`} ref={ref}
        visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[1,1]} />
        <meshBasicMaterial map={shadowTexture} transparent opacity={.18} depthWrite={false} toneMapped={false} />
      </mesh>)}
    </>
  );
}

/** Retain the lower table's perspective while allowing dice above its rim. */
function TableCamera({ filmScene, tableHeight }: { filmScene?: boolean; tableHeight?: number }) {
  const { camera, size } = useThree();
  const frameCamera = () => {
    const perspective = camera as THREE.PerspectiveCamera;
    const height = filmScene ? tableHeight ?? .44 : TABLE_HEIGHT;
    if (perspective.view?.fullHeight === size.height * height && perspective.aspect === size.width / (size.height * height)) return;
    perspective.lookAt(0, 0.4, 0.05);
    perspective.setViewOffset(size.width, size.height * height, 0, -size.height * (1 - height), size.width, size.height);
    perspective.updateMatrixWorld();
  };
  useLayoutEffect(frameCamera, [camera, size.width, size.height, filmScene, tableHeight]);
  // Canvas can refresh its aspect after React layout effects. Pin the filmed
  // table projection before the dice sample a hand or render their first frame.
  useFrame(frameCamera, -1);
  return null;
}

interface Props extends ThrowProps {
  onContextLost?: () => void;
}

export default function DiceScene({
  dice,
  settleAt,
  throwKey,
  audio,
  onSettled,
  windupMs,
  onThrowCue,
  dealerRelease,
  releaseVideoMs,
  videoStartMs,
  videoEndMs,
  rollVideoRef,
  idleVideoRef,
  playbackRef,
  decodedFrameRef,
  onContextLost,
  filmScene,
  parked,
  animating = true,
}: Props) {
  // Rendering stops entirely while the tab is hidden; the closed-form curve
  // means the first frame back is already in the right place.
  const [frameloop, setFrameloop] = useState<"always" | "never" | "demand">(() =>
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "never"
      : filmScene ? "demand" : "always",
  );
  useEffect(() => {
    const onVisible = () =>
      setFrameloop(document.visibilityState === "hidden" ? "never" : filmScene ? "demand" : "always");
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [filmScene, animating]);

  return (
    <Canvas
      frameloop={frameloop}
      shadows={!filmScene}
      dpr={[1, 1.25]}
      camera={{ position: [0, 3.35, 4.3], fov: 40 }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, camera }) => {
        camera.lookAt(0, 0.4, 0.05);
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost?.();
        });
      }}
      data-testid="dice-canvas"
    >
      <TableCamera filmScene={filmScene} tableHeight={dealerRelease?.tableHeight} />
      {!filmScene && <fogExp2 attach="fog" args={["#08160f", 0.06]} />}

      <ambientLight intensity={0.8} color="#edf4e8" />
      <hemisphereLight args={["#e7eee2", "#08251b", 0.7]} />
      <directionalLight
        castShadow={!filmScene}
        position={[-3.5, 8, 3.4]}
        intensity={2}
        color="#fff6e0"
        shadow-mapSize={[512, 512]}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0012}
        shadow-radius={4}
      />
      {/* Warm rim from the table lamp so the dice read against the felt. */}
      <pointLight position={[-3.4, 2.6, -2.2]} intensity={18} color="#f5c451" distance={12} decay={2} />

      {!filmScene && <>
        <CasinoFelt />
        <DealerHand videoRef={rollVideoRef} idleRef={idleVideoRef} playbackRef={playbackRef} release={dealerRelease} />
      </>}
      <Dice
        dice={dice}
        settleAt={settleAt}
        throwKey={throwKey}
        audio={audio}
        onSettled={onSettled}
        windupMs={windupMs}
        onThrowCue={onThrowCue}
        dealerRelease={dealerRelease}
        releaseVideoMs={releaseVideoMs}
        videoStartMs={videoStartMs}
        videoEndMs={videoEndMs}
        rollVideoRef={rollVideoRef}
        playbackRef={playbackRef}
        decodedFrameRef={decodedFrameRef}
        filmScene={filmScene}
        parked={parked}
      />
    </Canvas>
  );
}
