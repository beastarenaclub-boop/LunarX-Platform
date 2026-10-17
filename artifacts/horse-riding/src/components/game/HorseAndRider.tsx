import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { getElevation } from '../../utils/noise';
import { useGameStore } from '../../store/gameStore';
import { playHoofbeat } from '../../utils/audio';

// Constants
const SPEED_WALK = 6;
const SPEED_TROT = 12;
const SPEED_GALLOP = 24;
const ACCELERATION = 20;
const DECELERATION = 15;
const TURN_SPEED = 2.5;

export function HorseAndRider() {
  const groupRef = useRef<THREE.Group>(null);
  const horseBodyRef = useRef<THREE.Mesh>(null);
  const horseNeckRef = useRef<THREE.Group>(null);
  const frontLeftRef = useRef<THREE.Mesh>(null);
  const frontRightRef = useRef<THREE.Mesh>(null);
  const backLeftRef = useRef<THREE.Mesh>(null);
  const backRightRef = useRef<THREE.Mesh>(null);
  const riderRef = useRef<THREE.Group>(null);

  const [subscribeKeys, getKeys] = useKeyboardControls();
  
  const { gameState, setSpeedMode, setHeading, stamina, setStamina } = useGameStore();

  // Physics state
  const velocity = useRef(new THREE.Vector3());
  const position = useRef(new THREE.Vector3(0, 0, 0));
  const heading = useRef(0);
  const currentSpeed = useRef(0);
  const distanceTravelled = useRef(0);
  
  // Jump state
  const yVelocity = useRef(0);
  const isGrounded = useRef(true);

  // Audio state
  const lastHoofbeatPhase = useRef(0);

  // Initialize position
  useEffect(() => {
    position.current.y = getElevation(0, 0);
    if (groupRef.current) {
      groupRef.current.position.copy(position.current);
    }
  }, []);

  useFrame((state, delta) => {
    if (gameState !== 'playing' || !groupRef.current) return;

    const keys = getKeys();
    const dt = Math.min(delta, 0.1);

    // Input processing
    let targetSpeed = 0;
    
    if (keys.forward) {
      targetSpeed = SPEED_WALK;
      if (keys.gallop && stamina > 0) {
        targetSpeed = SPEED_GALLOP;
      } else if (keys.gallop) { // out of stamina, drop to trot
        targetSpeed = SPEED_TROT;
      } else if (currentSpeed.current > SPEED_WALK * 0.8) {
        // Double tap or just hold logic? Let's keep it simple: 
        // W = Trot, Shift+W = Gallop, S = slow down
        // Actually, W = walk. Let's make W = Trot by default, Shift = Gallop.
        targetSpeed = SPEED_TROT;
      }
    }
    
    if (keys.back) {
      targetSpeed = -SPEED_WALK * 0.5; // reverse slowly
    }

    // Stamina drain/regen
    if (currentSpeed.current > SPEED_TROT) {
      setStamina(Math.max(0, stamina - dt * 10)); // drain
    } else {
      setStamina(Math.min(100, stamina + dt * 5)); // regen
    }

    // Speed interpolation
    if (currentSpeed.current < targetSpeed) {
      currentSpeed.current += ACCELERATION * dt;
      if (currentSpeed.current > targetSpeed) currentSpeed.current = targetSpeed;
    } else if (currentSpeed.current > targetSpeed) {
      currentSpeed.current -= DECELERATION * dt;
      if (currentSpeed.current < targetSpeed) currentSpeed.current = targetSpeed;
    }

    // Update store speed mode (throttled visually via speed thresholds)
    let newMode: any = 'idle';
    if (Math.abs(currentSpeed.current) > 0.1) newMode = 'walk';
    if (Math.abs(currentSpeed.current) > SPEED_WALK + 1) newMode = 'trot';
    if (currentSpeed.current > SPEED_TROT + 1) newMode = 'gallop';
    setSpeedMode(newMode);

    // Turning (turn rate scales down slightly at high speeds)
    if (keys.left) heading.current += TURN_SPEED * dt * (1 - currentSpeed.current/SPEED_GALLOP * 0.5);
    if (keys.right) heading.current -= TURN_SPEED * dt * (1 - currentSpeed.current/SPEED_GALLOP * 0.5);
    
    // Normalize heading for store compass
    const normalizedHeading = (heading.current % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    setHeading(normalizedHeading);

    groupRef.current.rotation.y = heading.current;

    // Movement
    const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading.current);
    position.current.x += dir.x * currentSpeed.current * dt;
    position.current.z += dir.z * currentSpeed.current * dt;

    // Terrain height sampling
    const terrainY = getElevation(position.current.x, position.current.z);

    // Jumping
    if (keys.jump && isGrounded.current) {
      yVelocity.current = 15;
      isGrounded.current = false;
    }

    if (!isGrounded.current) {
      yVelocity.current -= 40 * dt; // gravity
      position.current.y += yVelocity.current * dt;
      
      if (position.current.y <= terrainY) {
        position.current.y = terrainY;
        yVelocity.current = 0;
        isGrounded.current = true;
      }
    } else {
      // Smoothly stick to ground
      position.current.y += (terrainY - position.current.y) * 15 * dt;
    }

    groupRef.current.position.copy(position.current);

    // Animation
    distanceTravelled.current += currentSpeed.current * dt;
    const t = distanceTravelled.current;
    
    // Procedural gaits
    let fl = 0, fr = 0, bl = 0, br = 0;
    let bodyBob = 0;
    let neckPitch = 0;

    if (Math.abs(currentSpeed.current) > 0.1) {
      if (newMode === 'gallop') {
        const freq = 0.5;
        fl = Math.sin(t * freq) * 0.8;
        fr = Math.sin(t * freq - 0.5) * 0.8;
        bl = Math.sin(t * freq - Math.PI) * 0.8;
        br = Math.sin(t * freq - Math.PI - 0.5) * 0.8;
        bodyBob = Math.sin(t * freq * 2) * 0.2;
        neckPitch = Math.sin(t * freq * 2 - 1) * 0.2 + 0.2; // stretched out
      } else if (newMode === 'trot') {
        const freq = 0.8;
        fl = Math.sin(t * freq) * 0.6;
        fr = Math.sin(t * freq + Math.PI) * 0.6;
        bl = Math.sin(t * freq + Math.PI) * 0.6;
        br = Math.sin(t * freq) * 0.6;
        bodyBob = Math.abs(Math.sin(t * freq)) * 0.15;
        neckPitch = 0.3; // head up
      } else { // walk
        const freq = 1.0;
        fl = Math.sin(t * freq) * 0.4;
        fr = Math.sin(t * freq + Math.PI) * 0.4;
        bl = Math.sin(t * freq + Math.PI/2) * 0.4;
        br = Math.sin(t * freq - Math.PI/2) * 0.4;
        bodyBob = Math.abs(Math.sin(t * freq * 2)) * 0.05;
        neckPitch = 0.1; // relaxed
      }
    }

    // Apply rotations
    if (frontLeftRef.current) frontLeftRef.current.rotation.x = fl;
    if (frontRightRef.current) frontRightRef.current.rotation.x = fr;
    if (backLeftRef.current) backLeftRef.current.rotation.x = bl;
    if (backRightRef.current) backRightRef.current.rotation.x = br;
    
    if (horseBodyRef.current) {
      horseBodyRef.current.position.y = 1.2 + bodyBob;
      // Tilt body on hills (pitch and roll)
      const forwardY = getElevation(position.current.x + dir.x, position.current.z + dir.z);
      const pitchTarget = Math.atan2(terrainY - forwardY, 1);
      horseBodyRef.current.rotation.x += (pitchTarget - horseBodyRef.current.rotation.x) * 5 * dt;
    }
    
    if (horseNeckRef.current) {
      horseNeckRef.current.rotation.x = neckPitch;
    }

    if (riderRef.current) {
      riderRef.current.position.y = 0.8 + bodyBob * 1.5; // rider bounces slightly more
      riderRef.current.rotation.x = -bodyBob * 0.5 - (currentSpeed.current > SPEED_TROT ? 0.2 : 0); // lean forward
    }

    // Audio hoofbeats
    if (isGrounded.current && Math.abs(currentSpeed.current) > 1) {
      const beatFreq = newMode === 'gallop' ? 0.5 : (newMode === 'trot' ? 0.8 : 1.0);
      const phase = (t * beatFreq) % Math.PI;
      // trigger sound when legs hit ground (roughly at phase minima/maxima)
      if (lastHoofbeatPhase.current > 1.5 && phase <= 1.5) {
        playHoofbeat(Math.abs(currentSpeed.current) / SPEED_GALLOP);
      }
      lastHoofbeatPhase.current = phase;
    }

    // Camera Follow
    const cameraTarget = position.current.clone();
    cameraTarget.y += 2; // look slightly above horse
    
    const fovWiden = (currentSpeed.current / SPEED_GALLOP) * 10;
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.fov += (60 + fovWiden - cam.fov) * dt * 2;
    cam.updateProjectionMatrix();

    // Camera offset behind and above
    const camOffset = new THREE.Vector3(0, 3 + bodyBob * 0.5, -6).applyAxisAngle(new THREE.Vector3(0,1,0), heading.current);
    const desiredCamPos = position.current.clone().add(camOffset);
    
    // Prevent camera dipping below terrain
    const camTerrainY = getElevation(desiredCamPos.x, desiredCamPos.z);
    if (desiredCamPos.y < camTerrainY + 0.5) {
      desiredCamPos.y = camTerrainY + 0.5;
    }

    // Smooth lerp camera
    state.camera.position.lerp(desiredCamPos, dt * 5);
    state.camera.lookAt(cameraTarget);
  });

  return (
    <group ref={groupRef}>
      <group ref={horseBodyRef}>
        {/* Horse Body */}
        <mesh castShadow position={[0, 0, 0]}>
          <boxGeometry args={[0.8, 1, 2.2]} />
          <meshStandardMaterial color="#2c1a0e" roughness={0.8} />
        </mesh>
        
        {/* Neck & Head */}
        <group ref={horseNeckRef} position={[0, 0.4, 1.0]}>
          <mesh castShadow position={[0, 0.6, 0.4]} rotation={[-0.4, 0, 0]}>
            <boxGeometry args={[0.4, 1.2, 0.5]} />
            <meshStandardMaterial color="#2c1a0e" roughness={0.8} />
          </mesh>
          {/* Head */}
          <mesh castShadow position={[0, 1.1, 0.8]} rotation={[0.4, 0, 0]}>
            <boxGeometry args={[0.35, 0.4, 0.8]} />
            <meshStandardMaterial color="#2c1a0e" roughness={0.8} />
          </mesh>
          {/* Mane */}
          <mesh position={[0, 0.8, 0.1]} rotation={[-0.4, 0, 0]}>
            <boxGeometry args={[0.1, 1.0, 0.6]} />
            <meshStandardMaterial color="#111" roughness={0.9} />
          </mesh>
        </group>

        {/* Tail */}
        <mesh position={[0, 0.3, -1.1]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.15, 1.0, 0.15]} />
          <meshStandardMaterial color="#111" roughness={0.9} />
        </mesh>

        {/* Legs (pivot at top, so offset geometry) */}
        <group ref={frontLeftRef} position={[0.3, -0.3, 0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#1c1008" roughness={0.8} />
          </mesh>
        </group>
        <group ref={frontRightRef} position={[-0.3, -0.3, 0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#1c1008" roughness={0.8} />
          </mesh>
        </group>
        <group ref={backLeftRef} position={[0.3, -0.3, -0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#1c1008" roughness={0.8} />
          </mesh>
        </group>
        <group ref={backRightRef} position={[-0.3, -0.3, -0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#1c1008" roughness={0.8} />
          </mesh>
        </group>

        {/* Rider */}
        <group ref={riderRef} position={[0, 0.8, -0.2]}>
          {/* Torso / Poncho */}
          <mesh castShadow position={[0, 0.5, 0]}>
            <boxGeometry args={[0.7, 0.9, 0.5]} />
            <meshStandardMaterial color="#6e5041" roughness={0.9} /> {/* Brown poncho */}
          </mesh>
          {/* Legs (straddling) */}
          <mesh castShadow position={[0.45, -0.1, 0]} rotation={[0, 0, 0.2]}>
            <boxGeometry args={[0.25, 0.8, 0.3]} />
            <meshStandardMaterial color="#2d4052" roughness={0.9} /> {/* Blue jeans */}
          </mesh>
          <mesh castShadow position={[-0.45, -0.1, 0]} rotation={[0, 0, -0.2]}>
            <boxGeometry args={[0.25, 0.8, 0.3]} />
            <meshStandardMaterial color="#2d4052" roughness={0.9} />
          </mesh>
          {/* Head */}
          <mesh castShadow position={[0, 1.1, 0]}>
            <boxGeometry args={[0.35, 0.35, 0.35]} />
            <meshStandardMaterial color="#e0a98b" roughness={0.6} /> {/* Skin */}
          </mesh>
          {/* Hat Brim */}
          <mesh castShadow position={[0, 1.25, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.05, 16]} />
            <meshStandardMaterial color="#4a3525" roughness={0.9} />
          </mesh>
          {/* Hat Crown */}
          <mesh castShadow position={[0, 1.35, 0]}>
            <cylinderGeometry args={[0.25, 0.25, 0.2, 12]} />
            <meshStandardMaterial color="#4a3525" roughness={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
