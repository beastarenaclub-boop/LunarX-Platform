import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getElevation, seededRandom } from '../../utils/noise';

export function EnvironmentProps() {
  const SPREAD = 1000;
  
  const cloudsRef = useRef<THREE.InstancedMesh>(null);

  useFrame((state, delta) => {
    if (cloudsRef.current) {
      cloudsRef.current.position.x += 2 * delta; // Drifting wind
    }
  });
  
  // Cacti
  const cactiCount = 800;
  const cactiMatrices = useMemo(() => {
    const matrices = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < cactiCount; i++) {
      const x = (seededRandom(i, 1) - 0.5) * SPREAD;
      const z = (seededRandom(i, 2) - 0.5) * SPREAD;
      const y = getElevation(x, z);
      
      const scale = 0.5 + seededRandom(i, 3) * 1.5;
      const rotY = seededRandom(i, 4) * Math.PI * 2;
      
      matrix.makeRotationY(rotY);
      matrix.setPosition(x, y + scale, z); // pivot center roughly
      matrix.scale(new THREE.Vector3(scale, scale, scale));
      matrices.push(matrix.clone());
    }
    return matrices;
  }, []);

  // Rocks
  const rocksCount = 1500;
  const rocksMatrices = useMemo(() => {
    const matrices = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < rocksCount; i++) {
      const x = (seededRandom(i + 1000, 1) - 0.5) * SPREAD;
      const z = (seededRandom(i + 1000, 2) - 0.5) * SPREAD;
      const y = getElevation(x, z);
      
      const scaleX = 0.5 + seededRandom(i, 5) * 2;
      const scaleY = 0.2 + seededRandom(i, 6) * 1;
      const scaleZ = 0.5 + seededRandom(i, 7) * 2;
      const rotY = seededRandom(i, 8) * Math.PI * 2;
      
      matrix.makeRotationY(rotY);
      matrix.setPosition(x, y + scaleY/2 - 0.2, z);
      matrix.scale(new THREE.Vector3(scaleX, scaleY, scaleZ));
      matrices.push(matrix.clone());
    }
    return matrices;
  }, []);

  // Dead Trees
  const treesCount = 300;
  const treesMatrices = useMemo(() => {
    const matrices = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < treesCount; i++) {
      const x = (seededRandom(i + 2000, 1) - 0.5) * SPREAD;
      const z = (seededRandom(i + 2000, 2) - 0.5) * SPREAD;
      const y = getElevation(x, z);
      
      const scale = 1 + seededRandom(i, 3) * 2;
      const rotY = seededRandom(i, 4) * Math.PI * 2;
      const rotX = (seededRandom(i, 5) - 0.5) * 0.4;
      const rotZ = (seededRandom(i, 6) - 0.5) * 0.4;
      
      const euler = new THREE.Euler(rotX, rotY, rotZ);
      matrix.makeRotationFromEuler(euler);
      matrix.setPosition(x, y + scale * 2, z);
      matrix.scale(new THREE.Vector3(scale * 0.3, scale * 4, scale * 0.3));
      matrices.push(matrix.clone());
    }
    return matrices;
  }, []);

  // Mesas / Horizons
  const mesaCount = 15;
  const mesaMatrices = useMemo(() => {
    const matrices = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < mesaCount; i++) {
      // Place them far away
      const angle = seededRandom(i, 1) * Math.PI * 2;
      const distance = 800 + seededRandom(i, 2) * 500;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const y = getElevation(x, z);
      
      const scaleX = 50 + seededRandom(i, 3) * 100;
      const scaleY = 40 + seededRandom(i, 4) * 80;
      const scaleZ = 50 + seededRandom(i, 5) * 100;
      const rotY = seededRandom(i, 6) * Math.PI * 2;
      
      matrix.makeRotationY(rotY);
      matrix.setPosition(x, y + scaleY/2 - 10, z);
      matrix.scale(new THREE.Vector3(scaleX, scaleY, scaleZ));
      matrices.push(matrix.clone());
    }
    return matrices;
  }, []);

  // Clouds
  const cloudCount = 40;
  const cloudMatrices = useMemo(() => {
    const matrices = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < cloudCount; i++) {
      const x = (seededRandom(i + 3000, 1) - 0.5) * 3000;
      const z = (seededRandom(i + 3000, 2) - 0.5) * 3000;
      const y = 200 + seededRandom(i + 3000, 3) * 100; // High in sky
      
      const scaleX = 50 + seededRandom(i, 4) * 100;
      const scaleY = 10 + seededRandom(i, 5) * 20;
      const scaleZ = 50 + seededRandom(i, 6) * 100;
      const rotY = seededRandom(i, 7) * Math.PI * 2;
      
      matrix.makeRotationY(rotY);
      matrix.setPosition(x, y, z);
      matrix.scale(new THREE.Vector3(scaleX, scaleY, scaleZ));
      matrices.push(matrix.clone());
    }
    return matrices;
  }, []);

  return (
    <>
      {/* Cacti */}
      <instancedMesh args={[undefined, undefined, cactiCount]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.3, 2, 8]} />
        <meshStandardMaterial color="#4a6344" roughness={0.9} />
        {cactiMatrices.map((matrix, i) => (
          <primitive key={`cactus-${i}`} object={new THREE.Object3D()} attachArray="matrixAt" attachObject={matrix} />
        ))}
      </instancedMesh>
      
      {/* Rocks */}
      <instancedMesh args={[undefined, undefined, rocksCount]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#7a6552" roughness={0.9} flatShading />
        {rocksMatrices.map((matrix, i) => (
          <primitive key={`rock-${i}`} object={new THREE.Object3D()} attachArray="matrixAt" attachObject={matrix} />
        ))}
      </instancedMesh>

      {/* Dead Trees */}
      <instancedMesh args={[undefined, undefined, treesCount]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.8, 1, 6]} />
        <meshStandardMaterial color="#54453a" roughness={1.0} flatShading />
        {treesMatrices.map((matrix, i) => (
          <primitive key={`tree-${i}`} object={new THREE.Object3D()} attachArray="matrixAt" attachObject={matrix} />
        ))}
      </instancedMesh>

      {/* Mesas (Large background rocks) */}
      <instancedMesh args={[undefined, undefined, mesaCount]} receiveShadow>
        <cylinderGeometry args={[0.7, 1, 1, 8]} />
        <meshStandardMaterial color="#8a5a3a" roughness={1.0} flatShading />
        {mesaMatrices.map((matrix, i) => (
          <primitive key={`mesa-${i}`} object={new THREE.Object3D()} attachArray="matrixAt" attachObject={matrix} />
        ))}
      </instancedMesh>

      {/* Clouds */}
      <instancedMesh ref={cloudsRef} args={[undefined, undefined, cloudCount]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffccaa" transparent opacity={0.6} fog={true} />
        {cloudMatrices.map((matrix, i) => (
          <primitive key={`cloud-${i}`} object={new THREE.Object3D()} attachArray="matrixAt" attachObject={matrix} />
        ))}
      </instancedMesh>
    </>
  );
}
