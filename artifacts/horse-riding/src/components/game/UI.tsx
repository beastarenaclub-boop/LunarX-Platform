import { useGameStore } from '../../store/gameStore';
import { initAudio, setMasterMute } from '../../utils/audio';

export function UI() {
  const { gameState, setGameState, score, stamina, maxStamina, speedMode, heading, soundEnabled, toggleSound } = useGameStore();

  const handleStart = () => {
    initAudio();
    setGameState('playing');
  };

  const handleToggleSound = () => {
    const newState = !soundEnabled;
    toggleSound();
    setMasterMute(!newState);
  };

  // Convert heading (radians) to compass letters
  const compassLetters = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // heading 0 is facing +Z, which is technically South in ThreeJS standard, but let's map:
  // 0 = N, PI/2 = W, PI = S, 3PI/2 = E for display purposes.
  // Actually heading goes positive when turning left (A key).
  const normalizedDegree = ((heading * 180) / Math.PI) % 360;
  const compassIndex = Math.round(normalizedDegree / 45) % 8;
  const currentHeadingText = compassLetters[compassIndex];

  if (gameState === 'title') {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center title-screen-bg text-primary-foreground p-8">
        <div className="game-ui-overlay absolute inset-0" />
        
        <h1 className="text-6xl md:text-8xl font-black uppercase mb-4 western-title tracking-widest text-[#ffcc88]">
          Wild Trails
        </h1>
        <p className="text-lg md:text-xl text-[#ddaa77] mb-12 tracking-wide font-serif italic">
          Ride into the golden horizon.
        </p>

        <button 
          onClick={handleStart}
          className="px-12 py-4 bg-[#8b3d20] hover:bg-[#aa4b28] text-white text-2xl font-bold rounded shadow-[0_0_15px_rgba(255,100,50,0.5)] transition-all hover:scale-105 uppercase tracking-widest"
        >
          Ride
        </button>

        <div className="mt-16 grid grid-cols-2 gap-x-12 gap-y-4 text-sm md:text-base text-[#bba088] bg-black/40 p-6 rounded border border-white/10 backdrop-blur-sm">
          <div className="text-right font-bold text-white/80">W / Arrow Up</div>
          <div>Move Forward</div>
          <div className="text-right font-bold text-white/80">S / Arrow Down</div>
          <div>Slow / Stop</div>
          <div className="text-right font-bold text-white/80">A / D</div>
          <div>Turn Left / Right</div>
          <div className="text-right font-bold text-white/80">Shift</div>
          <div>Gallop</div>
          <div className="text-right font-bold text-white/80">Space</div>
          <div>Jump</div>
        </div>

        <div className="mt-12">
          <a href="/race" className="px-8 py-3 border-2 border-[#8b3d20] text-[#ffcc88] hover:bg-[#8b3d20] transition-colors font-bold uppercase tracking-widest rounded shadow-lg">
            Visit Race Track
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">
      {/* Top Bar: Compass & Score */}
      <div className="flex justify-between items-start">
        <div className="hud-panel px-6 py-3 rounded-full flex items-center gap-4 border-t border-white/20">
          <span className="text-[#ffcc88] font-bold text-xl drop-shadow-md">
            {currentHeadingText}
          </span>
          <div className="w-[2px] h-[20px] bg-white/20"></div>
          <div className="text-[#ddaa77] flex gap-2 items-center font-mono">
            <span>Score</span>
            <span className="text-white text-xl font-bold">{score}</span>
          </div>
        </div>

        <button 
          onClick={handleToggleSound}
          className="hud-panel p-3 rounded-full pointer-events-auto hover:bg-white/10 transition-colors"
          title="Toggle Sound"
        >
          {soundEnabled ? '🔊' : '🔈'}
        </button>
      </div>

      {/* Bottom Bar: State & Stamina */}
      <div className="flex justify-between items-end">
        <div className="hud-panel p-4 rounded-lg flex flex-col gap-2 min-w-[200px]">
          <div className="uppercase tracking-widest text-[#ffcc88] font-bold text-sm">
            State
          </div>
          <div className="text-2xl font-black text-white uppercase tracking-wider drop-shadow-md">
            {speedMode}
          </div>
        </div>

        <div className="hud-panel p-4 rounded-lg flex flex-col gap-2 min-w-[250px] items-end">
          <div className="uppercase tracking-widest text-[#ffcc88] font-bold text-sm">
            Stamina
          </div>
          <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden border border-white/10">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-green-500 transition-all duration-300 ease-out"
              style={{ width: `${(stamina / maxStamina) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
