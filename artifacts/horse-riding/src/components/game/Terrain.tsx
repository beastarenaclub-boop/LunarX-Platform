import { useMemo } from 'react';
import * as THREE from 'three';
import { getElevation } from '../../utils/noise';

export function Terrain() {
  const size = 3000;
  const segments = 250;

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getElevation(x, z);
      pos.setY(i, y);
    }
    
    // Slight perturbation to normals for rocky feel
    geo.computeVertexNormals();
    
    // Add vertex colors for fake AO/dirt
    const colors = new Float32Array(pos.count * 3);
    const colorDirt = new THREE.Color('#946B45');
    const colorSand = new THREE.Color('#C9A071');
    const colorGrass = new THREE.Color('#786E45');
    
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const tempColor = new THREE.Color();
      
      if (y < 5) {
        tempColor.lerpColors(colorDirt, colorSand, Math.random() * 0.5 + 0.5);
      } else if (y < 20) {
        tempColor.lerpColors(colorSand, colorGrass, (y - 5) / 15);
        // Add random patches
        if (Math.random() > 0.8) tempColor.lerp(colorDirt, 0.5);
      } else {
        tempColor.lerpColors(colorGrass, colorDirt, (y - 20) / 40);
      }
      
      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }
    
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial 
        vertexColors
        roughness={0.9}
        metalness={0.0}
        flatShading={true}
      />
    </mesh>
  );
}
