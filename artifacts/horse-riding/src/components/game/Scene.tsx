import { Canvas } from '@react-three/fiber';
import { Sky, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Terrain } from './Terrain';
import { HorseAndRider } from './HorseAndRider';
import { EnvironmentProps } from './EnvironmentProps';
import { Collectibles } from './Collectibles';

export function GameScene() {
  return (
    <Canvas 
      shadows 
      camera={{ position: [0, 5, 10], fov: 60 }}
      gl={{ antialias: false, powerPreference: "high-performance" }} // false antialias for performance, postprocessing helps
    >
      <color attach="background" args={['#a35940']} />
      <fogExp2 attach="fog" args={["#a35940", 0.004]} />

      {/* Lighting setup for Golden Hour */}
      <ambientLight intensity={0.4} color="#ffd1b3" />
      <directionalLight
        castShadow
        position={[-100, 40, -50]}
        intensity={2.5}
        color="#ffaa55"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.001}
      />
      <hemisphereLight args={['#ffaa55', '#443333', 0.6]} />

      <Sky 
        sunPosition={[-100, 10, -50]} 
        turbidity={10} 
        rayleigh={3} 
        mieCoefficient={0.005} 
        mieDirectionalG={0.8} 
      />

      <Terrain />
      <EnvironmentProps />
      <Collectibles />
      <HorseAndRider />

      <EffectComposer>
        <Bloom luminanceThreshold={1} mipmapBlur intensity={0.5} />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </Canvas>
  );
}
