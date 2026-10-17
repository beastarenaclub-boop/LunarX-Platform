import { create } from 'zustand';

export type SpeedMode = 'idle' | 'walk' | 'trot' | 'gallop';

interface GameState {
  gameState: 'title' | 'playing';
  score: number;
  stamina: number;
  maxStamina: number;
  speedMode: SpeedMode;
  heading: number;
  soundEnabled: boolean;
  setGameState: (state: 'title' | 'playing') => void;
  addScore: () => void;
  setStamina: (val: number) => void;
  setSpeedMode: (mode: SpeedMode) => void;
  setHeading: (val: number) => void;
  toggleSound: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  gameState: 'title',
  score: 0,
  stamina: 100,
  maxStamina: 100,
  speedMode: 'idle',
  heading: 0,
  soundEnabled: true,
  setGameState: (state) => set({ gameState: state }),
  addScore: () => set((state) => ({ score: state.score + 1 })),
  setStamina: (val) => set({ stamina: val }),
  setSpeedMode: (mode) => set({ speedMode: mode }),
  setHeading: (val) => set({ heading: val }),
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
}));
