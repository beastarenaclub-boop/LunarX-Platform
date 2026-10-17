import { AutoBetStatus, useSelectionBet } from "../../../3d-game/src/components/table/AutoBet";
import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '../hooks/use-auth';
import { useWallet } from '../hooks/use-wallet';
import { useRacingConfig, useRacingBet } from '../hooks/use-racing';
import { useRaceStore } from '../store/raceStore';
import { useToast } from '@/hooks/use-toast';
import { initAudio } from '../utils/audio';

interface HorseRow {
  id: number;
  name: string;
  color: string;
  multiplier: number;
}

interface StateRow {
  id: string;
  name: string;
  racecourse: string;
  theme: string;
  horses: HorseRow[];
}

export default function Derby() {
  const { user, logout } = useAuth();
  const { data: wallet } = useWallet();
  const { data: config, isLoading } = useRacingConfig();
  const { mutate: placeBet, isPending: isBetting } = useRacingBet();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const {
    setMode, setPhase, setCountdown,
    setSelectedHorseId, setSelectedStateId, setBetResult,
    stakeInput, setStakeInput,
  } = useRaceStore();

  const states: StateRow[] = config?.states ?? [];
  const [activeStateId, setActiveStateId] = useState<string | null>(null);
  const [slip, setSlip] = useState<{ stateId: string; horse: HorseRow } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeState =
    states.find((s) => s.id === activeStateId) ?? states[0] ?? null;

  const rupeesBalance = wallet?.balance
    ? (parseInt(wallet.balance) / 100).toFixed(2)
    : '0.00';

  const potentialProfit =
    slip && stakeInput
      ? ((parseFloat(stakeInput) || 0) * slip.horse.multiplier - (parseFloat(stakeInput) || 0)).toFixed(2)
      : '0.00';

  const openSlip = (stateId: string, horse: HorseRow) => {
    initAudio();
    if (!user) {
      setLocation('/login');
      return;
    }
    setSlip({ stateId, horse });
    autoSubmit.select(true);
  };

  const confirmBet = () => {
    if (!slip) return;
    const rupees = parseFloat(stakeInput);
    if (isNaN(rupees) || rupees <= 0) {
      toast({ description: 'Enter a valid stake!', variant: 'destructive' });
      return;
    }
    const paise = Math.floor(rupees * 100).toString();
    placeBet(
      { stakeAmount: paise, horseId: slip.horse.id, stateId: slip.stateId },
      {
        onSuccess: (data) => {
          // Hand off to the 3D race watch: store the settled result and play
          // the countdown → race → finish sequence there.
          setMode('bet');
          setSelectedStateId(slip.stateId);
          setSelectedHorseId(slip.horse.id);
          setBetResult(data);
          setPhase('countdown');
          setCountdown(3);
          setSlip(null);
          setLocation('/race?from=derby');
        },
        onError: (err: any) => {
          if (err.message?.includes('Not logged in') || err.status === 401) {
            setLocation('/login');
          } else {
            toast({ description: err.message, variant: 'destructive' });
          }
        },
      },
    );
  };

  const autoSubmit = useSelectionBet({ enabled: !!user && !!slip && !isBetting, submit: confirmBet });
  const selectStake = (value: string) => {
    setStakeInput(value);
    initAudio();
    if (Number(value) > 0) autoSubmit.select(); else autoSubmit.cancel();
  };

  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  return (
    <div className="game-page w-full h-[100dvh] overflow-hidden flex flex-col bg-[#f0f0f0] text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
      {/* ===== Top black header ===== */}
      <header className="bg-black text-white flex items-center justify-between gap-2 px-2 sm:px-4 min-h-14 shrink-0">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <button
            className="lg:hidden min-h-11 min-w-11 text-white/80 text-xl"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="flex items-baseline select-none">
            <span className="text-lg sm:text-3xl font-black italic tracking-tight text-white">Wild</span>
            <span className="text-lg sm:text-3xl font-black italic tracking-tight bg-gradient-to-b from-yellow-300 to-yellow-500 text-transparent bg-clip-text ml-1">BOOK</span>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-5 text-xs sm:text-sm">
          <span className="hidden md:inline font-bold cursor-default">Rules</span>
          <div className="text-right leading-tight">
            <div className="font-bold">Balance: <span className="font-mono">₹{rupeesBalance}</span></div>
            <div className="text-white/70 text-xs">Exp: 0</div>
          </div>
          {user ? (
            <button
              onClick={() => logout.mutate()}
              aria-label="Log out"
              className="min-h-11 min-w-11 max-w-32 truncate font-bold border border-white/30 rounded px-2 sm:px-3 py-1 hover:bg-white/10"
            >
              <span className="sm:hidden">⏻</span><span className="hidden sm:inline">{user.displayName || user.email?.split('@')[0]} ▾</span>
            </button>
          ) : (
            <Link href="/login" className="font-bold border border-white/30 rounded px-3 py-1 hover:bg-white/10">
              Login
            </Link>
          )}
        </div>
      </header>

      {/* ===== Nav bar ===== */}
      <nav className="bg-[#222] text-white flex items-center gap-0 px-2 h-9 shrink-0 text-[13px] font-bold uppercase overflow-x-auto whitespace-nowrap">
        <span className="px-3 py-1.5 bg-[#444]">Home</span>
        <span className="px-3 py-1.5 text-yellow-400">Horse Racing</span>
        <Link href="/race" className="px-3 py-1.5 hover:bg-[#444]">Jockey Ride</Link>
        <Link href="/ride" className="px-3 py-1.5 hover:bg-[#444]">Free Ride</Link>
        <a href="/" className="px-3 py-1.5 text-red-500 hover:bg-[#444]">🚀 Crash</a>
      </nav>

      {/* ===== Ticker strip ===== */}
      <div className="bg-[#333] flex gap-1 px-1 py-1 shrink-0 overflow-x-auto">
        {states.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStateId(s.id)}
            className={`px-4 py-1.5 text-[12px] font-bold whitespace-nowrap border ${
              activeState?.id === s.id
                ? 'bg-[#5b7fa6] text-white border-[#5b7fa6]'
                : 'bg-[#4a4a4a] text-white/70 border-[#555] hover:text-white'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="relative flex flex-1 min-h-0">
        {sidebarOpen && <button aria-label="Close racing menu" onClick={() => setSidebarOpen(false)} className="absolute inset-0 z-10 bg-black/40 lg:hidden" />}
        {/* ===== Left sidebar ===== */}
        <aside className={`${sidebarOpen ? 'block' : 'hidden'} absolute inset-y-0 left-0 z-20 lg:static lg:block w-56 shrink-0 bg-white border-r border-gray-300 overflow-y-auto text-[13px]`}>
          <div className="bg-[#2c3e50] text-white px-3 py-2 font-bold flex justify-between items-center">
            Racing Sports <span>▴</span>
          </div>
          {states.map((s) => (
            <button
              key={s.id}
              onClick={() => { setActiveStateId(s.id); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-100 ${
                activeState?.id === s.id ? 'bg-blue-50 font-bold text-[#2c3e50]' : 'text-gray-700'
              }`}
            >
              {s.name} Racing
            </button>
          ))}
          <div className="bg-[#2c3e50] text-white px-3 py-2 font-bold flex justify-between items-center mt-2">
            Others <span>▴</span>
          </div>
          <Link href="/race" className="block px-3 py-2 border-b border-gray-100 hover:bg-gray-100 text-gray-700">Jockey Ride (Free)</Link>
          <Link href="/ride" className="block px-3 py-2 border-b border-gray-100 hover:bg-gray-100 text-gray-700">Free Ride World</Link>
          <div className="bg-[#2c3e50] text-white px-3 py-2 font-bold flex justify-between items-center mt-2">
            All Sports <span>▴</span>
          </div>
          <a href="/" className="block px-3 py-2 border-b border-gray-100 hover:bg-gray-100 text-gray-700">Lunar Casino</a>
        </aside>

        {/* ===== Main odds table ===== */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-white">
          {isLoading && (
            <div className="p-8 text-center text-gray-500">Loading markets…</div>
          )}

          {activeState && (
            <>
              {/* Market header */}
              <div className="bg-[#2c3e50] text-white px-3 py-2 flex flex-wrap gap-1 justify-between items-center sticky top-0 z-10">
                <div className="font-bold text-[14px]">
                  {activeState.name} Derby — {activeState.racecourse}
                </div>
                <div className="text-[12px] text-white/70">{dateStr} · Win Market</div>
              </div>

              {/* Column headers */}
              <div className="flex items-center bg-[#e9e9e9] border-b border-gray-300 text-[12px] font-bold text-gray-600">
                <div className="flex-1 px-4 py-1.5">Runner</div>
                <div className="w-16 sm:w-24 shrink-0 text-center py-1.5 bg-[#72bbef]/30">Back</div>
                <div className="w-14 sm:w-24 shrink-0 text-center py-1.5 bg-[#faa9ba]/30">Lay</div>
              </div>

              {/* Horse rows */}
              {activeState.horses.map((h, i) => (
                <div
                  key={h.id}
                  className={`flex items-center border-b border-gray-200 ${i % 2 ? 'bg-gray-50' : 'bg-white'}`}
                >
                  <div className="flex-1 px-2 sm:px-4 py-2 flex items-center gap-1 sm:gap-3 min-w-0">
                    <span className="text-gray-400 font-mono text-[12px] w-4">{h.id}</span>
                    <span
                      className="w-4 h-4 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: h.color }}
                    />
                    <span className="font-bold text-[13px] truncate">{h.name}</span>
                    <span className="text-green-600 text-[11px] ml-1">●</span>
                  </div>
                  <button
                    onClick={() => openSlip(activeState.id, h)}
                    className="w-16 sm:w-24 min-h-12 shrink-0 self-stretch bg-[#72bbef] hover:bg-[#4faae8] active:bg-[#3d9fe0] text-center font-bold text-[14px] transition-colors"
                    data-testid={`back-${activeState.id}-${h.id}`}
                  >
                    {h.multiplier.toFixed(2)}
                    <div className="text-[10px] font-normal text-black/60">WIN</div>
                  </button>
                  <div className="w-14 sm:w-24 shrink-0 self-stretch bg-[#faa9ba] text-center font-bold text-[14px] text-black/30 flex items-center justify-center">
                    –
                  </div>
                </div>
              ))}

              <div className="px-4 py-3 text-[11px] text-gray-400">
                Provably fair: har race ka server seed hash bet se pehle commit hota hai.
                Result turant settle hota hai · Min ₹1
              </div>
            </>
          )}
        </main>

        {/* ===== Bet slip (right panel / overlay) ===== */}
        {slip && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={() => !isBetting && setSlip(null)}>
            <div
              className="bg-white w-full md:w-96 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain md:rounded shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#2c3e50] text-white px-4 py-2 font-bold flex justify-between">
                Bet Slip
                <button aria-label="Close bet slip" onClick={() => !isBetting && setSlip(null)} className="min-h-11 min-w-11 text-white/70 hover:text-white">✕</button>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-1">
                  <span className="w-4 h-4 rounded-full border border-black/20" style={{ backgroundColor: slip.horse.color }} />
                  <span className="font-bold">{slip.horse.name}</span>
                  <span className="ml-auto bg-[#72bbef] px-2 py-0.5 rounded font-bold text-[13px]">
                    {slip.horse.multiplier.toFixed(2)}
                  </span>
                </div>
                <div className="text-[12px] text-gray-500 mb-4">
                  {states.find((s) => s.id === slip.stateId)?.name} Derby · Win Market
                </div>

                <label className="text-[12px] font-bold text-gray-600">Stake (₹)</label>
                <input
                  type="number"
                  min="1"
                  value={stakeInput}
                  onChange={(e) => selectStake(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 font-mono mt-1 mb-2 focus:border-[#2c3e50] focus:outline-none"
                  data-testid="stake-input"
                />
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {[10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((v) => (
                    <button
                      key={v}
                      onClick={() => selectStake(v.toString())}
                      aria-label={`${v} rupee chip`}
                      data-game-coin
                      aria-pressed={stakeInput === v.toString()}
                      className="min-h-11 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[12px] font-mono border border-gray-200"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[13px] bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-4">
                  <span className="text-gray-500">Profit</span>
                  <span className="font-bold text-green-600 font-mono">₹{potentialProfit}</span>
                </div>
                <AutoBetStatus seconds={autoSubmit.seconds} busy={isBetting} onCancel={autoSubmit.cancel} className="horse-auto-bet" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
