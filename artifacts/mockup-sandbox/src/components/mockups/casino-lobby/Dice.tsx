import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, Settings, History, Volume2, Trophy, Zap, ChevronDown } from "lucide-react";

export function Dice() {
  const [betAmount, setBetAmount] = useState<string>("100.00");
  const [rollTarget, setRollTarget] = useState<number>(50);
  const [rollType, setRollType] = useState<"over" | "under">("over");
  const [balance, setBalance] = useState<number>(24592.50);
  const [isRolling, setIsRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(67.42);
  const [history, setHistory] = useState([
    { id: 1, roll: 12.45, win: false },
    { id: 2, roll: 89.12, win: true },
    { id: 3, roll: 54.33, win: true },
    { id: 4, roll: 21.99, win: false },
    { id: 5, roll: 99.01, win: true },
    { id: 6, roll: 45.67, win: false },
    { id: 7, roll: 76.22, win: true },
    { id: 8, roll: 33.11, win: false },
    { id: 9, roll: 67.42, win: true },
  ]);

  const multiplier = rollType === "over" ? 99 / (100 - rollTarget) : 99 / rollTarget;
  const winChance = rollType === "over" ? 100 - rollTarget : rollTarget;
  const profit = (Number(betAmount) || 0) * multiplier - (Number(betAmount) || 0);

  const handleRoll = () => {
    if (isRolling || !betAmount) return;
    const bet = Number(betAmount);
    if (bet > balance) return;
    
    setIsRolling(true);
    setBalance(prev => prev - bet);
    
    setTimeout(() => {
      const result = Number((Math.random() * 100).toFixed(2));
      const isWin = rollType === "over" ? result > rollTarget : result < rollTarget;
      
      setLastRoll(result);
      setHistory(prev => [...prev.slice(-11), { id: Date.now(), roll: result, win: isWin }]);
      
      if (isWin) {
        setBalance(prev => prev + bet * multiplier);
      }
      setIsRolling(false);
    }, 600);
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0612] text-white overflow-hidden font-sans selection:bg-[#00ff88] selection:text-black">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        
        .font-display { font-family: 'Outfit', sans-serif; }
        .font-mono { font-family: 'Space Mono', monospace; }
        
        .neon-shadow-green { box-shadow: 0 0 20px rgba(0, 255, 136, 0.2); }
        .neon-text-green { text-shadow: 0 0 10px rgba(0, 255, 136, 0.5); }
        .neon-shadow-magenta { box-shadow: 0 0 20px rgba(255, 0, 255, 0.2); }
        .neon-border-green { border-color: rgba(0, 255, 136, 0.5); }
        
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

        .slider-track {
          background: linear-gradient(90deg, #ff0055 0%, #00ff88 100%);
        }
      `}} />

      {/* Top Bar */}
      <div className="h-16 border-b border-white/5 bg-[#0f0a1c]/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-8 z-50 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00ff88] to-[#00aa55] flex items-center justify-center font-display font-black text-black">
            L
          </div>
          <span className="font-display font-bold text-xl tracking-tight hidden sm:block">LUNAR</span>
        </div>
        
        <div className="flex items-center justify-center space-x-2 bg-[#160f29] border border-white/10 rounded-full py-1.5 px-4">
          <Wallet className="w-4 h-4 text-[#00ff88]" />
          <span className="font-mono font-bold text-[#00ff88] text-sm lg:text-base">
            ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-white/10 ml-2">
            <span className="text-white font-bold text-lg leading-none">+</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/5"><Volume2 className="w-5 h-5" /></Button>
          <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/5"><Settings className="w-5 h-5" /></Button>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left/Top Sidebar - Controls */}
        <div className="lg:col-span-3 lg:col-start-1 lg:row-start-1 bg-[#120b22] border border-white/5 rounded-2xl p-4 flex flex-col gap-6 shadow-2xl">
          <Tabs defaultValue="manual" className="w-full">
            <TabsList className="grid grid-cols-2 bg-[#0a0612] border border-white/5 p-1 rounded-xl mb-4">
              <TabsTrigger value="manual" className="rounded-lg data-[state=active]:bg-[#241744] data-[state=active]:text-white font-display font-medium">Manual</TabsTrigger>
              <TabsTrigger value="auto" className="rounded-lg data-[state=active]:bg-[#241744] data-[state=active]:text-white font-display font-medium">Auto</TabsTrigger>
            </TabsList>
            
            <TabsContent value="manual" className="space-y-5">
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/60 font-display">Bet Amount</span>
                  <span className="text-white/40 font-mono">₹</span>
                </div>
                <div className="relative flex items-center bg-[#0a0612] border border-white/10 rounded-xl focus-within:border-[#00ff88]/50 transition-colors">
                  <Input 
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    className="bg-transparent border-none text-white font-mono text-lg h-12 w-full focus-visible:ring-0 px-4"
                  />
                  <div className="flex px-2 space-x-1">
                    <Button onClick={() => setBetAmount(prev => (Number(prev)/2).toFixed(2))} variant="ghost" className="h-8 px-2 text-xs font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-md">½</Button>
                    <Button onClick={() => setBetAmount(prev => (Number(prev)*2).toFixed(2))} variant="ghost" className="h-8 px-2 text-xs font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-md">2x</Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <span className="text-white/60 font-display text-sm">Condition</span>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    onClick={() => setRollType("over")}
                    className={`h-12 rounded-xl font-display font-bold border ${rollType === "over" ? "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50" : "bg-[#0a0612] text-white/60 border-white/10 hover:bg-white/5"}`}
                  >
                    Roll Over
                  </Button>
                  <Button 
                    onClick={() => setRollType("under")}
                    className={`h-12 rounded-xl font-display font-bold border ${rollType === "under" ? "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/50" : "bg-[#0a0612] text-white/60 border-white/10 hover:bg-white/5"}`}
                  >
                    Roll Under
                  </Button>
                </div>
              </div>

              <Button 
                onClick={handleRoll}
                disabled={isRolling || !betAmount || Number(betAmount) <= 0 || Number(betAmount) > balance}
                className="w-full h-16 rounded-xl bg-[#00ff88] hover:bg-[#00dd77] text-black font-display font-black text-xl uppercase tracking-wider neon-shadow-green transition-all disabled:opacity-50 disabled:bg-gray-500 disabled:text-gray-300 active:scale-95"
              >
                {isRolling ? "Rolling..." : "Bet"}
              </Button>
            </TabsContent>
            
            <TabsContent value="auto" className="space-y-4">
              <div className="p-4 rounded-xl border border-white/5 bg-[#0a0612] text-center text-white/40 font-display text-sm">
                Auto betting mode allows you to run repeated bets based on specific conditions.
                <br/><br/>
                Configure amounts, stop limits, and roll conditions.
              </div>
              <Button disabled className="w-full h-14 rounded-xl bg-white/5 text-white/40 font-display font-bold">
                Start Auto Bet
              </Button>
            </TabsContent>
          </Tabs>

        </div>

        {/* Main Game Area */}
        <div className="lg:col-span-9 lg:col-start-4 lg:row-start-1 flex flex-col gap-6">
          
          {/* History Strip */}
          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-2">
            <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-white/5 border border-white/10 text-white/40">
              <History className="w-4 h-4" />
            </div>
            {history.map((h, i) => (
              <div 
                key={h.id} 
                className={`flex-shrink-0 flex items-center justify-center px-3 py-1.5 rounded-full font-mono text-sm font-bold border backdrop-blur-sm transition-all hover:scale-105 cursor-pointer ${
                  h.win 
                    ? "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/30" 
                    : "bg-[#ff0055]/10 text-[#ff0055] border-[#ff0055]/30"
                }`}
              >
                {h.roll.toFixed(2)}
              </div>
            ))}
          </div>

          {/* Game Canvas */}
          <div className="flex-1 bg-[#120b22] border border-white/5 rounded-3xl p-6 lg:p-12 relative overflow-hidden shadow-2xl min-h-[400px] flex flex-col">
            {/* Background Glows */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#00ff88]/5 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#7000ff]/10 rounded-full blur-[100px] pointer-events-none" />
            
            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-auto relative z-10">
              <div className="bg-[#0a0612]/80 backdrop-blur-md border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center">
                <span className="text-white/40 font-display text-xs uppercase tracking-wider mb-1">Multiplier</span>
                <span className="font-mono text-xl font-bold text-white">x{multiplier.toFixed(4)}</span>
              </div>
              <div className="bg-[#0a0612]/80 backdrop-blur-md border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center">
                <span className="text-white/40 font-display text-xs uppercase tracking-wider mb-1">Roll {rollType}</span>
                <span className="font-mono text-xl font-bold text-white">{rollTarget.toFixed(2)}</span>
              </div>
              <div className="bg-[#0a0612]/80 backdrop-blur-md border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center">
                <span className="text-white/40 font-display text-xs uppercase tracking-wider mb-1">Win Chance</span>
                <span className="font-mono text-xl font-bold text-[#00cccc]">{winChance.toFixed(2)}%</span>
              </div>
              <div className="bg-[#0a0612]/80 backdrop-blur-md border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center">
                <span className="text-white/40 font-display text-xs uppercase tracking-wider mb-1">Profit on Win</span>
                <span className="font-mono text-xl font-bold text-[#00ff88]">₹{profit.toFixed(2)}</span>
              </div>
            </div>

            {/* Slider Area */}
            <div className="relative mt-24 mb-16 px-4">
              
              {/* Last Roll Indicator */}
              {lastRoll !== null && (
                <div 
                  className="absolute top-0 -translate-y-full -translate-x-1/2 flex flex-col items-center transition-all duration-700 ease-out z-20 pointer-events-none"
                  style={{ left: `calc(${lastRoll}% + 1rem)` }}
                >
                  <div className={`font-mono text-5xl lg:text-7xl font-black mb-2 ${
                    (rollType === "over" && lastRoll > rollTarget) || (rollType === "under" && lastRoll < rollTarget)
                      ? "text-[#00ff88] neon-text-green" 
                      : "text-[#ff0055]"
                  }`}>
                    {lastRoll.toFixed(2)}
                  </div>
                  <ChevronDown className={`w-8 h-8 ${
                    (rollType === "over" && lastRoll > rollTarget) || (rollType === "under" && lastRoll < rollTarget)
                      ? "text-[#00ff88]" 
                      : "text-[#ff0055]"
                  }`} />
                </div>
              )}

              {/* The Slider Track */}
              <div className="relative h-4 w-full bg-[#1a1130] rounded-full overflow-hidden border border-white/10">
                <div 
                  className="absolute top-0 bottom-0 pointer-events-none transition-all duration-200"
                  style={{
                    left: rollType === "over" ? `${rollTarget}%` : "0%",
                    right: rollType === "over" ? "0%" : `${100 - rollTarget}%`,
                    background: "linear-gradient(90deg, #00ff88 0%, #00ccaa 100%)",
                    opacity: 0.3
                  }}
                />
                <div 
                  className="absolute top-0 bottom-0 pointer-events-none transition-all duration-200"
                  style={{
                    left: rollType === "under" ? `${rollTarget}%` : "0%",
                    right: rollType === "under" ? "0%" : `${100 - rollTarget}%`,
                    background: "linear-gradient(90deg, #ff0055 0%, #cc0044 100%)",
                    opacity: 0.3
                  }}
                />
                
                {/* Visual markers 0, 25, 50, 75, 100 */}
                {[0, 25, 50, 75, 100].map(mark => (
                  <div key={mark} className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: `${mark}%` }} />
                ))}
              </div>

              {/* Native Range Input overlaid for pure functionality */}
              <input
                type="range"
                min="2"
                max="98"
                step="1"
                value={rollTarget}
                onChange={(e) => setRollTarget(Number(e.target.value))}
                className="absolute top-0 left-0 w-full h-4 opacity-0 cursor-pointer z-30"
              />

              {/* Custom Handle Visual */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-12 bg-white rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.5)] border-2 border-black flex items-center justify-center pointer-events-none z-10 transition-all duration-100"
                style={{ left: `calc(${rollTarget}% + 1rem)` }}
              >
                <div className="w-1 h-6 bg-gray-300 rounded-full" />
              </div>

              <div className="flex justify-between mt-4 text-white/40 font-mono text-sm">
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            </div>

          </div>

          {/* Footer Stats / Winners */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#120b22] border border-white/5 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#00ff88]/10 text-[#00ff88] flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-white/40 text-xs font-display">Live Players</p>
                  <p className="text-white font-mono font-bold">1,248</p>
                </div>
              </div>
              <div className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
            </div>

            <div className="bg-[#120b22] border border-white/5 rounded-xl p-4 flex items-center gap-3 md:col-span-2 overflow-hidden">
               <div className="w-10 h-10 rounded-full bg-[#ff0055]/10 text-[#ff0055] flex items-center justify-center flex-shrink-0">
                  <Trophy className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <p className="text-white/40 text-xs font-display">Recent Big Win</p>
                  <p className="text-white font-display text-sm truncate">
                    <span className="text-[#00cccc] font-bold">rahul_k</span> won <span className="text-[#00ff88] font-mono font-bold">₹14,500</span> with a 4.5x multiplier
                  </p>
                </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
