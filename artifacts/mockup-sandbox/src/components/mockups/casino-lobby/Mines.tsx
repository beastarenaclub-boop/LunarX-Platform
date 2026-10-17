import React, { useState, useEffect } from "react";
import { ChevronLeft, Info, Settings, Volume2, Wallet, Zap, Trophy, ShieldAlert, History, Flame, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const MINE_GRID_SIZE = 5;
const TOTAL_TILES = MINE_GRID_SIZE * MINE_GRID_SIZE;

// Sample board state: some revealed safe (gems), some unrevealed, one revealed mine
const INITIAL_BOARD_STATE = Array.from({ length: TOTAL_TILES }, (_, i) => {
  if (i === 12) return "mine"; // Center is a mine
  if ([2, 6, 8, 14, 18].includes(i)) return "gem";
  return "hidden";
});

const HISTORY_DATA = [
  { id: 1, user: "rohit_92", amount: "₹4,210", multiplier: "2.45x", type: "win" },
  { id: 2, user: "virat_fan", amount: "₹1,050", multiplier: "1.80x", type: "win" },
  { id: 3, user: "msd_cool", amount: "₹500", multiplier: "0.00x", type: "loss" },
  { id: 4, user: "sky_high", amount: "₹8,900", multiplier: "5.20x", type: "win" },
  { id: 5, user: "boomrah", amount: "₹2,100", multiplier: "3.10x", type: "win" },
  { id: 6, user: "pant_33", amount: "₹300", multiplier: "0.00x", type: "loss" },
  { id: 7, user: "jaddu_magic", amount: "₹15,400", multiplier: "10.5x", type: "win" },
  { id: 8, user: "shami_york", amount: "₹1,200", multiplier: "1.50x", type: "win" },
];

export function Mines() {
  const [betAmount, setBetAmount] = useState("500");
  const [minesCount, setMinesCount] = useState(3);
  const [boardState, setBoardState] = useState(INITIAL_BOARD_STATE);

  return (
    <div className="min-h-screen w-full bg-[#0a0612] text-white overflow-hidden flex flex-col font-sans selection:bg-[#00ff88] selection:text-black">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        
        .font-display {
          font-family: 'Chakra Petch', sans-serif;
        }

        .neon-glow {
          box-shadow: 0 0 15px rgba(0, 255, 136, 0.4), inset 0 0 10px rgba(0, 255, 136, 0.2);
        }

        .neon-text {
          text-shadow: 0 0 10px rgba(0, 255, 136, 0.6);
        }

        .neon-border {
          border: 1px solid rgba(0, 255, 136, 0.5);
        }

        .mine-glow {
          box-shadow: 0 0 20px rgba(255, 0, 85, 0.6), inset 0 0 15px rgba(255, 0, 85, 0.4);
          animation: pulse-mine 1.5s infinite alternate;
        }

        .mine-text-glow {
          text-shadow: 0 0 10px rgba(255, 0, 85, 0.8);
        }

        @keyframes pulse-mine {
          0% { box-shadow: 0 0 15px rgba(255, 0, 85, 0.5), inset 0 0 10px rgba(255, 0, 85, 0.3); }
          100% { box-shadow: 0 0 30px rgba(255, 0, 85, 0.8), inset 0 0 20px rgba(255, 0, 85, 0.6); }
        }

        .gem-glow {
          box-shadow: 0 0 20px rgba(0, 221, 255, 0.5), inset 0 0 15px rgba(0, 221, 255, 0.3);
        }

        .glass-panel {
          background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.05);
        }

        .cyber-grid {
          background-image: 
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 30px 30px;
        }
      `}} />

      {/* Top Navigation */}
      <header className="h-16 flex items-center justify-between px-4 lg:px-8 border-b border-white/5 bg-[#0a0612]/80 backdrop-blur-md z-10 sticky top-0 relative">
        <div className="absolute inset-0 border-b border-[#00ff88]/20 shadow-[0_4px_20px_rgba(0,255,136,0.05)] pointer-events-none"></div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00ff88] to-[#00aa55] flex items-center justify-center font-display font-bold text-[#0a0612] shadow-[0_0_10px_rgba(0,255,136,0.3)]">
              M
            </div>
            <span className="font-display font-bold text-xl tracking-wider text-white hidden sm:block">MINES</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm">
            <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse"></span>
            <span className="text-gray-300">4,291 Playing</span>
          </div>
          
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-white/5 to-white/10 border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
            <Wallet className="w-4 h-4 text-[#00ff88]" />
            <span className="font-display font-semibold text-[#00ff88] neon-text">₹ 12,450.00</span>
            <Button size="sm" className="h-7 px-3 bg-[#00ff88] hover:bg-[#00ff88]/80 text-black font-semibold ml-2 shadow-[0_0_10px_rgba(0,255,136,0.3)] transition-all">
              Deposit
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        <div className="absolute inset-0 cyber-grid opacity-30 pointer-events-none"></div>
        
        {/* Left Side: Game Board */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 lg:p-8 relative z-10 min-h-[500px]">
          
          {/* Game Status / Multiplier */}
          <div className="mb-8 text-center flex flex-col items-center">
            <Badge variant="outline" className="bg-[#ff0055]/10 text-[#ff0055] border-[#ff0055]/30 px-3 py-1 mb-3 font-display tracking-widest">
              <Flame className="w-3 h-3 mr-1 inline" /> BUSTED
            </Badge>
            <div className="text-5xl lg:text-7xl font-display font-bold text-white tracking-tighter mine-text-glow">
              1.45<span className="text-2xl lg:text-4xl text-[#ff0055]">x</span>
            </div>
            <div className="text-gray-400 mt-2 font-medium">Safe picks: <span className="text-white">5</span> / {25 - minesCount}</div>
          </div>

          {/* 5x5 Grid */}
          <div className="grid grid-cols-5 gap-2 sm:gap-3 lg:gap-4 max-w-[500px] w-full aspect-square p-4 sm:p-6 rounded-2xl glass-panel relative">
            {/* Subtle glow behind board */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#00ff88]/5 to-transparent rounded-2xl pointer-events-none blur-xl"></div>
            
            {boardState.map((state, i) => (
              <button
                key={i}
                className={`
                  relative w-full h-full rounded-xl transition-all duration-300 transform
                  ${state === 'hidden' ? 'bg-gradient-to-br from-[#1a1525] to-[#120e1a] border-b-4 border-r-4 border-[#2a2438] hover:translate-y-1 hover:border-b-2 hover:border-r-2 active:border-b-0 active:border-r-0 active:translate-y-2 cursor-pointer shadow-lg' : ''}
                  ${state === 'gem' ? 'bg-[#0a1a20] border border-[#00ddff]/30 gem-glow' : ''}
                  ${state === 'mine' ? 'bg-[#2a0a15] border border-[#ff0055]/50 mine-glow z-10 scale-105' : ''}
                `}
                disabled={state !== 'hidden'}
              >
                {state === 'gem' && (
                  <div className="absolute inset-0 flex items-center justify-center animate-in zoom-in duration-300">
                    <div className="w-1/2 h-1/2 rotate-45 bg-gradient-to-br from-[#00ddff] to-[#0088ff] shadow-[0_0_15px_#00ddff] rounded-sm"></div>
                  </div>
                )}
                {state === 'mine' && (
                  <div className="absolute inset-0 flex items-center justify-center animate-in zoom-in duration-300">
                    <ShieldAlert className="w-1/2 h-1/2 text-[#ff0055] drop-shadow-[0_0_10px_rgba(255,0,85,0.8)]" />
                  </div>
                )}
                {state === 'hidden' && (
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent rounded-xl pointer-events-none"></div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right Side / Bottom: Controls & History */}
        <div className="w-full lg:w-[400px] xl:w-[450px] flex flex-col border-l border-white/5 glass-panel z-10">
          
          {/* Controls Panel */}
          <div className="p-6 flex-1 flex flex-col gap-6">
            
            {/* Bet Amount */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Bet Amount</label>
                <span className="text-xs text-gray-500 font-display">₹ 10 - ₹ 100K</span>
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display font-bold">₹</div>
                <Input 
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  className="pl-8 pr-24 h-14 bg-black/40 border-white/10 text-xl font-display font-bold focus-visible:ring-[#00ff88]/50 focus-visible:border-[#00ff88]"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-10 px-2 text-gray-400 hover:text-white hover:bg-white/10 rounded font-display" onClick={() => setBetAmount(String(Number(betAmount) / 2))}>1/2</Button>
                  <Button variant="ghost" size="sm" className="h-10 px-2 text-gray-400 hover:text-white hover:bg-white/10 rounded font-display" onClick={() => setBetAmount(String(Number(betAmount) * 2))}>x2</Button>
                </div>
              </div>
            </div>

            {/* Mines Count */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Mines Count</label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 5, 10, 24].map((count) => (
                  <button
                    key={count}
                    onClick={() => setMinesCount(count)}
                    className={`
                      h-12 rounded-lg font-display font-bold text-lg transition-all
                      ${minesCount === count 
                        ? 'bg-[#00ff88]/20 border border-[#00ff88] text-[#00ff88] neon-glow' 
                        : 'bg-black/40 border border-white/5 text-gray-400 hover:bg-white/5'}
                    `}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Button */}
            <Button className="w-full h-16 text-xl font-display font-bold mt-4 bg-gradient-to-r from-[#00ff88] to-[#00cc66] hover:from-[#00ff88] hover:to-[#00aa55] text-black shadow-[0_0_20px_rgba(0,255,136,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]">
              BET
            </Button>
            
            <div className="grid grid-cols-2 gap-4 mt-2">
              <Button variant="outline" className="h-12 bg-black/40 border-white/5 text-gray-300 hover:bg-white/5 hover:text-white">
                <Settings className="w-4 h-4 mr-2" /> Auto Play
              </Button>
              <Button variant="outline" className="h-12 bg-black/40 border-white/5 text-gray-300 hover:bg-white/5 hover:text-white">
                <Info className="w-4 h-4 mr-2" /> Provably Fair
              </Button>
            </div>

          </div>

          {/* History Panel */}
          <div className="flex-1 min-h-[300px] border-t border-white/5 flex flex-col">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-display font-semibold flex items-center gap-2 text-gray-300">
                <History className="w-4 h-4" /> RECENT PLAYS
              </h3>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20 text-xs">Top Wins</Badge>
                <Badge variant="outline" className="bg-white/5 text-gray-400 border-white/10 text-xs hover:bg-white/10 cursor-pointer">All</Badge>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {HISTORY_DATA.map((item, i) => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-black/40 flex items-center justify-center border border-white/5 group-hover:border-white/20 transition-colors">
                      <TrendingUp className={`w-4 h-4 ${item.type === 'win' ? 'text-[#00ff88]' : 'text-gray-600'}`} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-200">{item.user}</div>
                      <div className="text-xs text-gray-500 font-display">{item.amount}</div>
                    </div>
                  </div>
                  <div className={`font-display font-bold ${item.type === 'win' ? 'text-[#00ff88]' : 'text-gray-500'}`}>
                    {item.multiplier}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
