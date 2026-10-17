import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getElevation, seededRandom } from '../../utils/noise';
import { useGameStore } from '../../store/gameStore';
import { playChime } from '../../utils/audio';

export function Collectibles() {
  const count = 50;
  const spread = 800;
  
  const { addScore } = useGameStore();
  const instancesRef = useRef<THREE.InstancedMesh>(null);
  
  // Track collected state
  const collected = useRef(new Array(count).fill(false));

  const items = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      let x = (seededRandom(i, 9) - 0.5) * spread;
      let z = (seededRandom(i, 10) - 0.5) * spread;
      
      // Ensure they don't spawn right at 0,0
      if (Math.abs(x) < 20 && Math.abs(z) < 20) {
        x += 50;
        z += 50;
      }

      const y = getElevation(x, z) + 1.5; // Hover above ground
      arr.push(new THREE.Vector3(x, y, z));
    }
    return arr;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    if (!instancesRef.current) return;
    
    const time = state.clock.getElapsedTime();
    const playerPos = state.camera.position.clone();
    // Rough estimate of player position based on camera (camera is behind)
    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(state.camera.quaternion);
    playerPos.add(forward.multiplyScalar(6)); // offset back to horse
    playerPos.y -= 2; // rough horse y

    for (let i = 0; i < count; i++) {
      if (collected.current[i]) {
        // Hide it away
        dummy.position.set(0, -1000, 0);
        dummy.updateMatrix();
        instancesRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const pos = items[i];
      const dist = pos.distanceTo(playerPos);

      if (dist < 3) {
        // Collect
        collected.current[i] = true;
        addScore();
        playChime();
        
        dummy.position.set(0, -1000, 0);
        dummy.updateMatrix();
        instancesRef.current.setMatrixAt(i, dummy.matrix);
      } else {
        // Animate idle
        dummy.position.copy(pos);
        dummy.position.y += Math.sin(time * 2 + i) * 0.3;
        dummy.rotation.y = time + i;
        dummy.scale.setScalar(1.5);
        dummy.updateMatrix();
        instancesRef.current.setMatrixAt(i, dummy.matrix);
      }
    }
    
    instancesRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={instancesRef} args={[undefined, undefined, count]} castShadow>
      <torusGeometry args={[0.3, 0.1, 8, 16]} />
      <meshStandardMaterial 
        color="#ffd700" 
        metalness={0.8} 
        roughness={0.2} 
        emissive="#554400"
      />
    </instancedMesh>
  );
}
