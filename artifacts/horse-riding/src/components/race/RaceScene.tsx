import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sky, Environment, KeyboardControls, useKeyboardControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useRaceStore } from '../../store/raceStore';
import { useRacingConfig } from '../../hooks/use-racing';
import { SeededRandom } from '../../utils/seededRandom';
import { playHoofbeat } from '../../utils/audio';

// --- Constants ---
const TRACK_LENGTH = 500;
const LANE_WIDTH = 2;
const BASE_SPEED = 45;

// --- Subcomponents ---

function Grandstand() {
  // Simple wooden grandstand
  return (
    <group position={[12, 0, -TRACK_LENGTH]}>
      {/* Base/Steps */}
      {[0, 1, 2, 3, 4].map((step) => (
        <mesh key={step} position={[0, step * 0.8 + 0.4, step * 1.5]} castShadow receiveShadow>
          <boxGeometry args={[30, 0.8, 1.5]} />
          <meshStandardMaterial color="#5c3a21" roughness={0.9} />
        </mesh>
      ))}
      {/* Roof */}
      <mesh position={[0, 8, 4]} rotation={[-0.2, 0, 0]} castShadow>
        <boxGeometry args={[32, 0.5, 8]} />
        <meshStandardMaterial color="#4a2511" roughness={0.9} />
      </mesh>
      {/* Pillars */}
      {[-14, -7, 0, 7, 14].map((x) => (
        <mesh key={x} position={[x, 4, 7]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 8]} />
          <meshStandardMaterial color="#3a1c0d" />
        </mesh>
      ))}
    </group>
  );
}

function FinishLine() {
  return (
    <group position={[0, 0, -TRACK_LENGTH]}>
      {/* Posts */}
      <mesh position={[-8, 4, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[8, 4, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      {/* Banner */}
      <mesh position={[0, 7, 0]} castShadow>
        <boxGeometry args={[16, 1.5, 0.1]} />
        <meshStandardMaterial color="#aa3333" />
      </mesh>
    </group>
  );
}

function Track() {
  const fencePosts = useMemo(() => {
    const posts = [];
    for (let z = 10; z >= -TRACK_LENGTH - 20; z -= 10) {
      posts.push(z);
    }
    return posts;
  }, []);

  return (
    <group>
      {/* Dirt Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, -TRACK_LENGTH/2]} receiveShadow>
        <planeGeometry args={[40, TRACK_LENGTH + 100]} />
        <meshStandardMaterial color="#6a4a32" roughness={1} />
      </mesh>
      
      {/* Grass Surroundings */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, -TRACK_LENGTH/2]} receiveShadow>
        <planeGeometry args={[400, TRACK_LENGTH + 200]} />
        <meshStandardMaterial color="#43523d" roughness={1} />
      </mesh>

      {/* Rail Fences */}
      {fencePosts.map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <mesh position={[-7, 0.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 1.6, 0.1]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[7, 0.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.1, 1.6, 0.1]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          {i < fencePosts.length - 1 && (
            <>
              <mesh position={[-7, 1.2, -5]} castShadow>
                <boxGeometry args={[0.05, 0.2, 10]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
              <mesh position={[7, 1.2, -5]} castShadow>
                <boxGeometry args={[0.05, 0.2, 10]} />
                <meshStandardMaterial color="#ffffff" />
              </mesh>
            </>
          )}
        </group>
      ))}

      <FinishLine />
      <Grandstand />
    </group>
  );
}

interface HorseProps {
  horseId: number;
  lane: number; // 0 to 5
  color: string;
  silkColor: string;
  isPlayer: boolean;
  zRef: React.MutableRefObject<number[]>;
  horseIndex: number;
  // Bet mode AI props
  betTargetTime?: number;
  betWobbleAmp?: number;
  betWobblePhase?: number;
  isBetWinner?: boolean;
  // Jockey mode AI props
  practiceBaseSpeed?: number;
  practiceWobbleAmp?: number;
  practiceWobblePhase?: number;
  // Player stamina state (only used if isPlayer)
  setPlayerStamina?: (v: number) => void;
  playerStamina?: number;
}

function RaceHorseModel({ color, silkColor, speedRef }: { color: string, silkColor: string, speedRef: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null);
  const frontLeftRef = useRef<THREE.Mesh>(null);
  const frontRightRef = useRef<THREE.Mesh>(null);
  const backLeftRef = useRef<THREE.Mesh>(null);
  const backRightRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const neckRef = useRef<THREE.Group>(null);
  
  const distanceTravelled = useRef(0);
  const lastHoof = useRef(0);

  useFrame((state, delta) => {
    const speed = speedRef.current;
    if (speed < 0.1) return;

    distanceTravelled.current += speed * delta;
    const t = distanceTravelled.current;
    
    // Gallop animation
    const freq = 0.5;
    const fl = Math.sin(t * freq) * 0.8;
    const fr = Math.sin(t * freq - 0.5) * 0.8;
    const bl = Math.sin(t * freq - Math.PI) * 0.8;
    const br = Math.sin(t * freq - Math.PI - 0.5) * 0.8;
    const bodyBob = Math.sin(t * freq * 2) * 0.2;
    const neckPitch = Math.sin(t * freq * 2 - 1) * 0.2 + 0.2;

    if (frontLeftRef.current) frontLeftRef.current.rotation.x = fl;
    if (frontRightRef.current) frontRightRef.current.rotation.x = fr;
    if (backLeftRef.current) backLeftRef.current.rotation.x = bl;
    if (backRightRef.current) backRightRef.current.rotation.x = br;
    if (bodyRef.current) bodyRef.current.position.y = 1.2 + bodyBob;
    if (neckRef.current) neckRef.current.rotation.x = neckPitch;

    // Audio hoofbeat
    const phase = (t * freq) % Math.PI;
    if (lastHoof.current > 1.5 && phase <= 1.5) {
      // Scale intensity based on distance from camera if we wanted to, 
      // but simple play works.
      playHoofbeat(0.4);
    }
    lastHoof.current = phase;
  });

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}> {/* Face -Z */}
      <group ref={bodyRef}>
        <mesh castShadow>
          <boxGeometry args={[0.8, 1, 2.2]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        
        {/* Neck/Head */}
        <group ref={neckRef} position={[0, 0.4, 1.0]}>
          <mesh castShadow position={[0, 0.6, 0.4]} rotation={[-0.4, 0, 0]}>
            <boxGeometry args={[0.4, 1.2, 0.5]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, 1.1, 0.8]} rotation={[0.4, 0, 0]}>
            <boxGeometry args={[0.35, 0.4, 0.8]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
        </group>

        {/* Tail */}
        <mesh position={[0, 0.3, -1.1]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.15, 1.0, 0.15]} />
          <meshStandardMaterial color="#111" roughness={0.9} />
        </mesh>

        {/* Legs */}
        <group ref={frontLeftRef} position={[0.3, -0.3, 0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#111" roughness={0.8} />
          </mesh>
        </group>
        <group ref={frontRightRef} position={[-0.3, -0.3, 0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#111" roughness={0.8} />
          </mesh>
        </group>
        <group ref={backLeftRef} position={[0.3, -0.3, -0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#111" roughness={0.8} />
          </mesh>
        </group>
        <group ref={backRightRef} position={[-0.3, -0.3, -0.8]}>
          <mesh castShadow position={[0, -0.6, 0]}>
            <boxGeometry args={[0.2, 1.2, 0.2]} />
            <meshStandardMaterial color="#111" roughness={0.8} />
          </mesh>
        </group>

        {/* Jockey */}
        <group position={[0, 0.8, -0.2]}>
          <mesh castShadow position={[0, 0.5, 0]}>
            <boxGeometry args={[0.6, 0.8, 0.5]} />
            <meshStandardMaterial color={silkColor} roughness={0.9} />
          </mesh>
          {/* Helmet */}
          <mesh castShadow position={[0, 1.1, 0]}>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshStandardMaterial color={silkColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function RaceHorse(props: HorseProps) {
  const groupRef = useRef<THREE.Group>(null);
  const speedRef = useRef(0);
  
  const { phase, mode, setPhase, setPracticeResult } = useRaceStore();
  const [subscribeKeys, getKeys] = useKeyboardControls();
  
  const zPos = useRef(0); // 0 down to -TRACK_LENGTH
  const raceTime = useRef(0);

  // Position based on lane
  const startX = -5 + props.lane * LANE_WIDTH;

  useEffect(() => {
    if (phase === 'idle' || phase === 'countdown') {
      zPos.current = 0;
      speedRef.current = 0;
      raceTime.current = 0;
      if (groupRef.current) {
        groupRef.current.position.set(startX, 0, 0);
      }
      if (props.isPlayer && props.setPlayerStamina) {
        props.setPlayerStamina(100);
      }
    }
  }, [phase, startX, props.isPlayer, props.setPlayerStamina]);

  useFrame((state, delta) => {
    if (phase !== 'racing') return;
    if (zPos.current <= -TRACK_LENGTH) {
      speedRef.current = 0;
      return; // finished
    }

    const dt = Math.min(delta, 0.1);
    raceTime.current += dt;
    let currentSpeed = 0;

    if (mode === 'bet') {
      // Deterministic bet calculation
      // targetTime ensures they finish at exact times. 
      const tTime = props.betTargetTime || 10;
      const progressBase = Math.min(raceTime.current / tTime, 1);
      // add wobble for lead changes
      const wobble = Math.sin(progressBase * Math.PI * (props.betWobblePhase || 2)) * (props.betWobbleAmp || 0);
      const progress = progressBase + wobble;
      
      const nextZ = -Math.max(0, Math.min(progress, 1)) * TRACK_LENGTH;
      currentSpeed = Math.abs(nextZ - zPos.current) / dt;
      zPos.current = nextZ;

    } else if (mode === 'practice') {
      if (props.isPlayer) {
        const keys = getKeys() as any;
        let targetSpeed = keys.forward ? 20 : 0;
        
        // Stamina logic
        if (keys.forward && keys.gallop && (props.playerStamina || 0) > 0) {
          targetSpeed = 65; // very fast
          if (props.setPlayerStamina) props.setPlayerStamina(Math.max(0, (props.playerStamina || 0) - dt * 15));
        } else if (keys.forward) {
          targetSpeed = 40; // trot
          if (props.setPlayerStamina) props.setPlayerStamina(Math.min(100, (props.playerStamina || 0) + dt * 8));
        } else {
          if (props.setPlayerStamina) props.setPlayerStamina(Math.min(100, (props.playerStamina || 0) + dt * 20));
        }
        if (keys.back) targetSpeed = 0;

        // accelerate
        if (speedRef.current < targetSpeed) {
          speedRef.current += 30 * dt;
        } else {
          speedRef.current -= 20 * dt;
        }
        currentSpeed = speedRef.current;
        zPos.current -= currentSpeed * dt;

      } else {
        // Practice AI
        const base = props.practiceBaseSpeed || 50;
        currentSpeed = base + Math.sin(raceTime.current * 0.5 + (props.practiceWobblePhase || 0)) * (props.practiceWobbleAmp || 5);
        zPos.current -= currentSpeed * dt;
      }
    }

    if (zPos.current <= -TRACK_LENGTH) {
      zPos.current = -TRACK_LENGTH;
      
      // Bet mode: the server-declared winner crossing the line ends the race
      // and reveals the (already settled) result panel.
      if (mode === 'bet' && props.isBetWinner && phase === 'racing') {
        setPhase('finished');
      }
      // If we are in practice mode, and a horse crosses, check if it's the player or AI to assign rank.
      // This logic is better handled by a central manager, but we can do a hack here:
      if (mode === 'practice') {
        const finishedCount = props.zRef.current.filter(z => z <= -TRACK_LENGTH).length;
        if (props.isPlayer) {
           setPracticeResult({
             didWin: finishedCount === 0, // 0 others finished before this frame
             position: finishedCount + 1
           });
           setPhase('finished');
        } else if (finishedCount === props.zRef.current.length - 1) {
           // Everyone finished but player hasn't? Or player is last.
           // If player crosses last, they get 6th.
           // handled above.
        }
      }
    }

    speedRef.current = currentSpeed;
    props.zRef.current[props.horseIndex] = zPos.current;

    if (groupRef.current) {
      groupRef.current.position.z = zPos.current;
    }
  });

  return (
    <group ref={groupRef} position={[startX, 0, 0]}>
      <RaceHorseModel color={props.color} silkColor={props.silkColor} speedRef={speedRef} />
    </group>
  );
}

export function RaceScene() {
  const { mode, phase, betResult, selectedHorseId, selectedStateId } = useRaceStore();
  const { data: config } = useRacingConfig();
  // State-aware field: prefer the selected state's horses, fall back to the
  // legacy flat list.
  const horses =
    config?.states?.find((s: any) => s.id === selectedStateId)?.horses ??
    config?.horses;
  
  const horsesZRef = useRef<number[]>([0,0,0,0,0,0]);
  const [playerStamina, setPlayerStamina] = useState(100);

  // Derive deterministic race values when betResult arrives
  const betParams = useMemo(() => {
    if (mode !== 'bet' || !betResult || !horses) return null;
    const { winnerId } = betResult;
    // Deterministic playback seed from the revealed provably-fair transcript.
    const random = new SeededRandom(
      `${betResult.serverSeed ?? ''}:${betResult.clientSeed ?? betResult.roundId ?? 'race'}`,
    );
    
    // We want the winner to finish in 10s.
    // Others finish in 10.5s to 12s.
    return horses.map((h: any) => {
      const isWinner = h.id === winnerId;
      const targetTime = isWinner ? 10 : 10.3 + random.next() * 2;
      return {
        targetTime,
        wobblePhase: random.next() * Math.PI * 2,
        wobbleAmp: 0.05 + random.next() * 0.1,
      };
    });
  }, [betResult, mode, horses]);

  // Derive practice AI values once on mount
  const practiceParams = useMemo(() => {
    return [0,1,2,3,4,5].map(() => ({
      baseSpeed: 45 + Math.random() * 8, // Player max is 65
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleAmp: Math.random() * 10,
    }));
  }, []);

  const JOCKEY_COLORS = ['#cc2222', '#22cc22', '#2222cc', '#cccc22', '#cc22cc', '#22cccc'];

  return (
    <>
      <Canvas 
        shadows 
        camera={{ position: [0, 5, 10], fov: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={['#a35940']} />
        <fogExp2 attach="fog" args={["#a35940", 0.003]} />

        <ambientLight intensity={0.4} color="#ffd1b3" />
        <directionalLight
          castShadow
          position={[-100, 40, -50]}
          intensity={2.5}
          color="#ffaa55"
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={1}
          shadow-camera-far={600}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={300}
          shadow-camera-bottom={-300}
        />

        <Sky sunPosition={[-100, 10, -50]} turbidity={10} rayleigh={3} mieCoefficient={0.005} mieDirectionalG={0.8} />

        <Track />

        {horses?.map((horse: any, index: number) => {
          const isPlayer = mode === 'practice' && horse.id === selectedHorseId;
          return (
            <RaceHorse
              key={horse.id}
              horseIndex={index}
              horseId={horse.id}
              lane={index}
              color={horse.color}
              silkColor={JOCKEY_COLORS[index]}
              isPlayer={isPlayer}
              zRef={horsesZRef}
              betTargetTime={betParams?.[index]?.targetTime}
              isBetWinner={mode === 'bet' && betResult?.winnerId === horse.id}
              betWobbleAmp={betParams?.[index]?.wobbleAmp}
              betWobblePhase={betParams?.[index]?.wobblePhase}
              practiceBaseSpeed={practiceParams[index].baseSpeed}
              practiceWobbleAmp={practiceParams[index].wobbleAmp}
              practiceWobblePhase={practiceParams[index].wobblePhase}
              setPlayerStamina={isPlayer ? setPlayerStamina : undefined}
              playerStamina={isPlayer ? playerStamina : undefined}
            />
          );
        })}

        <CameraController zRef={horsesZRef} />

        <EffectComposer>
          <Bloom luminanceThreshold={1} mipmapBlur intensity={0.5} />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>

      {mode === 'practice' && phase === 'racing' && (
        <div className="absolute bottom-6 right-6 w-64 hud-panel p-4 rounded-lg pointer-events-auto z-50">
          <div className="uppercase tracking-widest text-[#ffcc88] font-bold text-sm mb-2">
            Horse Stamina
          </div>
          <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden border border-white/10">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-green-500 transition-all duration-75"
              style={{ width: `${playerStamina}%` }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function CameraController({ zRef }: { zRef: React.MutableRefObject<number[]> }) {
  const { mode, phase, selectedHorseId } = useRaceStore();
  const { data: config } = useRacingConfig();

  useFrame((state, delta) => {
    let targetX = 0;
    let targetY = 5;
    let targetZ = 10;
    let lookAtX = 0;
    let lookAtZ = 0;

    const zArr = zRef.current;
    
    if (phase === 'idle' || phase === 'countdown') {
      // Look at starting gates
      targetX = 12;
      targetY = 8;
      targetZ = 15;
      lookAtX = 0;
      lookAtZ = -5;
    } else {
      if (mode === 'bet') {
        // Follow the pack (min Z) from the side
        const leaderZ = Math.min(...zArr);
        targetX = 18;
        targetY = 6;
        targetZ = leaderZ + 10;
        lookAtX = 0;
        lookAtZ = leaderZ - 5;

        // If finished, look at finish line
        if (phase === 'finished') {
          targetZ = -TRACK_LENGTH + 20;
          lookAtZ = -TRACK_LENGTH;
        }
      } else {
        // Practice mode: follow player from behind
        const playerIndex = config?.horses?.findIndex((h: any) => h.id === selectedHorseId) ?? 0;
        const playerZ = zArr[playerIndex] || 0;
        const playerX = -5 + playerIndex * LANE_WIDTH;

        targetX = playerX;
        targetY = 4;
        targetZ = playerZ + 8;
        lookAtX = playerX;
        lookAtZ = playerZ - 5;
      }
    }

    state.camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), delta * 4);
    
    // Lerp lookAt
    const currentLookAt = new THREE.Vector3(0,0,0);
    // Create a ref for lookAt to smooth it
    if (!state.camera.userData.lookAt) {
      state.camera.userData.lookAt = new THREE.Vector3(lookAtX, 2, lookAtZ);
    }
    state.camera.userData.lookAt.lerp(new THREE.Vector3(lookAtX, 2, lookAtZ), delta * 5);
    state.camera.lookAt(state.camera.userData.lookAt);
  });

  return null;
}
