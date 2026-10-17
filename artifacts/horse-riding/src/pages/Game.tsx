import { KeyboardControls, KeyboardControlsEntry } from '@react-three/drei';
import { useMemo } from 'react';
import { GameScene } from '../components/game/Scene';
import { UI } from '../components/game/UI';

enum Controls {
  forward = 'forward',
  back = 'back',
  left = 'left',
  right = 'right',
  jump = 'jump',
  gallop = 'gallop'
}

export default function Game() {
  const map = useMemo<KeyboardControlsEntry<Controls>[]>(() => [
    { name: Controls.forward, keys: ['ArrowUp', 'KeyW'] },
    { name: Controls.back, keys: ['ArrowDown', 'KeyS'] },
    { name: Controls.left, keys: ['ArrowLeft', 'KeyA'] },
    { name: Controls.right, keys: ['ArrowRight', 'KeyD'] },
    { name: Controls.jump, keys: ['Space'] },
    { name: Controls.gallop, keys: ['ShiftLeft', 'ShiftRight'] },
  ], []);

  return (
    <div className="game-page w-full h-[100dvh] bg-black overflow-hidden relative">
      <KeyboardControls map={map}>
        <GameScene />
        <UI />
      </KeyboardControls>
    </div>
  );
}
