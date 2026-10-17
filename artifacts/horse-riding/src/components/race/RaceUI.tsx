import { AutoBetStatus, useSelectionBet } from "../../../../3d-game/src/components/table/AutoBet";
import { useEffect, useRef } from 'react';
import { useRaceStore } from '../../store/raceStore';
import { useAuth } from '../../hooks/use-auth';
import { useWallet } from '../../hooks/use-wallet';
import { useRacingConfig, useRacingBet } from '../../hooks/use-racing';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { initAudio, playChime } from '../../utils/audio';

export function RaceUI() {
  const { user, logout } = useAuth();
  const { data: wallet } = useWallet();
  const { data: config } = useRacingConfig();
  const { mutate: placeBet, isPending: isBetting } = useRacingBet();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const {
    mode, setMode,
    phase, setPhase,
    countdown, setCountdown,
    selectedHorseId, setSelectedHorseId,
    selectedStateId,
    stakeInput, setStakeInput,
    betResult, setBetResult,
    practiceResult,
    reset
  } = useRaceStore();

  const handleStartPractice = () => {
    initAudio();
    if (!selectedHorseId) {
      toast({ description: 'Select a horse first, partner!', variant: 'destructive' });
      return;
    }
    startCountdown();
  };

  const handlePlaceBet = () => {
    initAudio();
    if (!selectedHorseId) {
      toast({ description: 'Select a horse first, partner!', variant: 'destructive' });
      return;
    }
    const rupees = parseFloat(stakeInput);
    if (isNaN(rupees) || rupees <= 0) {
      toast({ description: 'Enter a valid stake!', variant: 'destructive' });
      return;
    }

    const paise = Math.floor(rupees * 100).toString();
    
    placeBet({ stakeAmount: paise, horseId: selectedHorseId, stateId: selectedStateId }, {
      onSuccess: (data) => {
        setBetResult(data);
        startCountdown();
      },
      onError: (err: any) => {
        if (err.message.includes('Not logged in') || err.status === 401) {
          setLocation('/login');
        } else {
          toast({ description: err.message, variant: 'destructive' });
        }
      }
    });
  };

  const autoSubmit = useSelectionBet({ enabled: !!user && mode === "bet" && phase === "idle" && !!selectedHorseId && !isBetting, scope: `${mode}:${phase}:${selectedStateId}`, submit: handlePlaceBet });
  const selectStake = (value: string) => {
    setStakeInput(value);
    initAudio();
    if (Number(value) > 0) autoSubmit.select(); else autoSubmit.cancel();
  };

  const startCountdown = () => {
    setPhase('countdown');
    setCountdown(3);
  };

  // Drive the countdown from phase state (not a local timer), so a bet
  // placed on the Derby page — which sets phase before navigating here —
  // ticks down correctly too.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const interval = setInterval(() => {
      const { countdown: c, setCountdown: setC, setPhase: setP } =
        useRaceStore.getState();
      if (c > 1) {
        setC(c - 1);
      } else {
        setP('racing');
        playChime();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const rupeesBalance = wallet?.balance ? (parseInt(wallet.balance) / 100).toFixed(2) : '0.00';
  const stateHorses =
    config?.states?.find((s: any) => s.id === selectedStateId)?.horses ??
    config?.horses;
  const selectedHorse = stateHorses?.find((h: any) => h.id === selectedHorseId);
  const potentialPayout = selectedHorse && stakeInput ? (parseFloat(stakeInput) * selectedHorse.multiplier).toFixed(2) : '0.00';

  return (
    <div className="absolute inset-0 z-40 pointer-events-none p-2 sm:p-4 md:p-6 flex flex-col gap-3 justify-between">
      {/* Top Header */}
      <div className="flex shrink-0 justify-between gap-2 items-start pointer-events-auto">
        <Link href="/" className="hud-panel px-3 sm:px-6 min-h-11 py-3 rounded-full text-xs sm:text-base text-[#ffcc88] font-bold uppercase tracking-wider hover:bg-white/10 transition-colors">
          &larr; Derby Home
        </Link>

        {user ? (
          <div className="hud-panel min-w-0 px-3 sm:px-6 py-2 sm:py-3 rounded-2xl sm:rounded-full flex gap-3 sm:gap-6 items-center">
            <div className="flex flex-col">
              <span className="text-white/60 text-xs uppercase tracking-widest font-bold">Wallet</span>
              <span className="text-[#88ff88] font-mono font-bold text-sm sm:text-lg break-all">₹{rupeesBalance}</span>
            </div>
            <div className="hidden sm:block w-[1px] h-[24px] bg-white/20"></div>
            <div className="hidden sm:flex max-w-32 flex-col text-right overflow-hidden">
              <span className="text-[#ffcc88] text-sm font-bold">{user.displayName || user.email?.split('@')[0]}</span>
              <button onClick={() => logout.mutate()} className="text-white/60 text-xs hover:text-white uppercase tracking-wider underline-offset-2 hover:underline">
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <Link href="/login" className="hud-panel px-6 py-3 rounded-full text-[#ffaa55] font-bold uppercase tracking-wider hover:bg-white/10 transition-colors">
            Sign In to Bet
          </Link>
        )}
      </div>

      {/* Countdown Overlay */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-[12rem] font-black western-title text-white animate-pulse drop-shadow-[0_0_30px_rgba(255,100,50,0.8)]">
            {countdown}
          </div>
        </div>
      )}

      {/* Finish Results Overlay */}
      {phase === 'finished' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto p-3">
          <div role="dialog" aria-label="Horse Racing result" data-testid="horse-racing-result" className="hud-panel p-4 rounded-2xl max-w-[390px] w-full max-h-full overflow-y-auto overscroll-contain text-center border-2 border-[#8b3d20]">
            <p className="text-xs font-bold uppercase tracking-widest text-[#ffcc88] mb-2">Wild Trails · Horse Racing</p>
            <h2 className="text-3xl sm:text-5xl font-black western-title text-[#ffcc88] mb-4">
              Finish!
            </h2>
            
            {mode === 'bet' && betResult && (
              <div className="mb-4">
                {betResult.didWin ? (
                  <div>
                    <div className="text-3xl text-[#88ff88] font-black uppercase tracking-widest mb-2">You Won!</div>
                    <div className="text-3xl sm:text-4xl text-white font-mono break-words">₹{(parseInt(betResult.payoutAmount) / 100).toFixed(2)}</div>
                    <p className="text-xs text-white/70 mt-2">Returned to your shared wallet</p>
                  </div>
                ) : (
                  <div className="text-2xl text-[#ff5555] font-bold uppercase tracking-widest">
                    Tough Luck, Partner
                  </div>
                )}
              </div>
            )}

            {mode === 'practice' && practiceResult && (
              <div className="mb-8">
                {practiceResult.didWin ? (
                  <div className="text-3xl text-[#ffcc88] font-black uppercase tracking-widest">
                    Grand Champion!
                  </div>
                ) : (
                  <div className="text-2xl text-white/80 font-bold uppercase tracking-widest">
                    Finished {practiceResult.position}
                    {practiceResult.position === 2 && 'nd'}
                    {practiceResult.position === 3 && 'rd'}
                    {practiceResult.position > 3 && 'th'}
                  </div>
                )}
              </div>
            )}

            <button data-game-bet
              onClick={reset}
              className="px-8 py-4 bg-[#8b3d20] hover:bg-[#aa4b28] text-white font-bold rounded shadow-[0_0_15px_rgba(255,100,50,0.5)] transition-all uppercase tracking-widest"
            >
              Race Again
            </button>
          </div>
        </div>
      )}

      {/* Betting / Practice Panel (Bottom) */}
      {phase === 'idle' && (
        <div className="pointer-events-auto min-h-0 flex justify-center sm:mb-4 overflow-y-auto overscroll-contain">
          <div className="hud-panel w-full h-fit max-w-4xl p-3 sm:p-6 rounded-xl flex flex-col">
            
            {/* Tabs */}
            <div className="grid grid-cols-2 gap-2 mb-3 sm:mb-6 border-b border-white/10 pb-3 sm:pb-4">
              <button 
                onClick={() => setMode('bet')}
                className={`min-h-11 px-2 sm:px-6 py-2 rounded text-xs sm:text-base font-bold uppercase tracking-wider transition-all ${mode === 'bet' ? 'bg-[#8b3d20] text-white shadow-[0_0_10px_rgba(255,100,50,0.3)]' : 'text-[#bba088] hover:bg-white/5'}`}
              >
                Bet & Watch
              </button>
              <button 
                onClick={() => setMode('practice')}
                className={`min-h-11 px-2 sm:px-6 py-2 rounded text-xs sm:text-base font-bold uppercase tracking-wider transition-all ${mode === 'practice' ? 'bg-[#2d4052] text-white shadow-[0_0_10px_rgba(100,150,255,0.3)]' : 'text-[#bba088] hover:bg-white/5'}`}
              >
                Jockey Ride
              </button>
            </div>

            <div className="flex flex-col md:flex-row gap-4 md:gap-8">
              {/* Horse Selection Grid */}
              <div className="min-w-0 flex-1 grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                {stateHorses?.map((horse: any) => (
                  <button
                    key={horse.id}
                    onClick={() => { setSelectedHorseId(horse.id); if (mode === 'bet' && user && !isBetting) autoSubmit.select(true); }}
                    className={`min-w-0 p-2 sm:p-3 rounded border text-left transition-all ${selectedHorseId === horse.id ? 'border-[#ffaa55] bg-[#8b3d20]/30 shadow-[0_0_10px_rgba(255,170,85,0.2)]' : 'border-white/10 hover:border-white/30 bg-black/40'}`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-4 h-4 rounded-full border border-white/30 shadow-inner" style={{ backgroundColor: horse.color }} />
                      <span className="font-bold text-white uppercase text-sm truncate">{horse.name}</span>
                    </div>
                    {mode === 'bet' && (
                      <div className="text-right text-[#ffcc88] font-mono text-sm font-bold">
                        {horse.multiplier.toFixed(2)}x
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Action Panel */}
              <div className="w-full md:w-80 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-8">
                {mode === 'bet' ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-[#ddaa77] text-xs uppercase tracking-widest font-bold">Stake (₹)</label>
                      <input 
                        type="number"
                        min="1"
                        value={stakeInput}
                        onChange={(e) => selectStake(e.target.value)}
                        className="w-full bg-black/50 border border-white/20 rounded px-4 py-2 text-white font-mono focus:border-[#ffaa55] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {[10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map(val => (
                        <button 
                          key={val}
                          onClick={() => selectStake(val.toString())}
                          aria-label={`${val} rupee chip`}
                          data-game-coin
                          aria-pressed={stakeInput === val.toString()}
                          className="min-h-11 py-1 bg-white/5 hover:bg-white/15 rounded text-white/80 text-xs font-mono border border-white/10"
                        >
                          {val >= 1000 ? `${val / 1000}k` : val}
                        </button>
                      ))}
                    </div>
                    
                    <div className="bg-black/40 p-3 rounded border border-white/5 flex justify-between items-center mt-2">
                      <span className="text-[#bba088] text-sm uppercase">To Win</span>
                      <span className="text-[#88ff88] font-mono font-bold">₹{potentialPayout}</span>
                    </div>

                    {!user ? (
                      <Link href="/login" className="mt-auto px-6 py-4 bg-[#8b3d20] hover:bg-[#aa4b28] text-white text-center font-bold rounded uppercase tracking-widest">
                        Sign in to Bet
                      </Link>
                    ) : (
                      <AutoBetStatus seconds={autoSubmit.seconds} busy={isBetting} onCancel={autoSubmit.cancel} />
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex-1 flex flex-col justify-center gap-4 text-center text-[#bba088]">
                      <div className="bg-[#2d4052]/30 border border-[#2d4052] p-4 rounded text-sm">
                        <span className="text-white font-bold uppercase block mb-1">Practice Race</span>
                        No money involved. Race against 5 AI horses to test your speed.
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-black/30 p-2 rounded">
                          <span className="text-white font-bold">W / Shift</span><br/>Gallop
                        </div>
                        <div className="bg-black/30 p-2 rounded">
                          <span className="text-white font-bold">S</span><br/>Slow
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={handleStartPractice}
                      disabled={!selectedHorseId}
                      className="mt-auto px-6 py-4 bg-[#2d4052] hover:bg-[#3e566e] text-white font-bold rounded shadow-[0_0_15px_rgba(100,150,255,0.5)] transition-all uppercase tracking-widest disabled:opacity-50 disabled:shadow-none"
                    >
                      Mount & Race
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Jockey HUD (Stamina) */}
      {phase === 'racing' && mode === 'practice' && (
         <div className="absolute bottom-6 right-6 w-64 hud-panel p-4 rounded-lg pointer-events-auto">
            <div className="uppercase tracking-widest text-[#ffcc88] font-bold text-sm mb-2">
              Horse Stamina
            </div>
            {/* The actual stamina bar will be linked to a local store or ref in RaceScene, 
                but for simplicity we might just overlay it here if we use a shared store. 
                Actually, let's let RaceScene render an overlay for Jockey stamina to keep state tight. */}
         </div>
      )}
    </div>
  );
}
