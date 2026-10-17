import { create } from 'zustand';

export type RaceMode = 'bet' | 'practice';
export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

interface RaceState {
  mode: RaceMode;
  phase: RacePhase;
  countdown: number;
  betResult: any | null;
  practiceResult: { didWin: boolean; position: number; reward?: string } | null;
  selectedHorseId: number | null;
  selectedStateId: string;
  stakeInput: string;
  setMode: (mode: RaceMode) => void;
  setPhase: (phase: RacePhase) => void;
  setCountdown: (count: number) => void;
  setBetResult: (res: any) => void;
  setPracticeResult: (res: any) => void;
  setSelectedHorseId: (id: number | null) => void;
  setSelectedStateId: (id: string) => void;
  setStakeInput: (val: string) => void;
  reset: () => void;
}

export const useRaceStore = create<RaceState>((set) => ({
  mode: 'bet',
  phase: 'idle',
  countdown: 0,
  betResult: null,
  practiceResult: null,
  selectedHorseId: null,
  selectedStateId: 'maharashtra',
  stakeInput: '10',
  setMode: (mode) => set({ mode }),
  setPhase: (phase) => set({ phase }),
  setCountdown: (countdown) => set({ countdown }),
  setBetResult: (betResult) => set({ betResult }),
  setPracticeResult: (practiceResult) => set({ practiceResult }),
  setSelectedHorseId: (selectedHorseId) => set({ selectedHorseId }),
  setSelectedStateId: (selectedStateId) => set({ selectedStateId }),
  setStakeInput: (stakeInput) => set({ stakeInput }),
  reset: () => set({ phase: 'idle', countdown: 0, betResult: null, practiceResult: null }),
}));
