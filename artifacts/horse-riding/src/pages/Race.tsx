import { KeyboardControls, KeyboardControlsEntry } from '@react-three/drei';
import { useMemo } from 'react';
import { RaceScene } from '../components/race/RaceScene';
import { RaceUI } from '../components/race/RaceUI';

enum Controls {
  forward = 'forward',
  back = 'back',
  gallop = 'gallop'
}

export default function Race() {
  const map = useMemo<KeyboardControlsEntry<Controls>[]>(() => [
    { name: Controls.forward, keys: ['ArrowUp', 'KeyW'] },
    { name: Controls.back, keys: ['ArrowDown', 'KeyS'] },
    { name: Controls.gallop, keys: ['ShiftLeft', 'ShiftRight'] },
  ], []);

  return (
    <div data-game-screen="horse-racing" className="game-page w-full h-[100dvh] bg-black overflow-hidden relative">
      <KeyboardControls map={map}>
        <RaceScene />
        <RaceUI />
      </KeyboardControls>
    </div>
  );
}
