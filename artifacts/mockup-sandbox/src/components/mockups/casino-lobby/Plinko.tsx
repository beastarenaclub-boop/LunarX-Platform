import React, { useState } from "react";
import { Settings, Volume2, Maximize, HelpCircle, Trophy, TrendingUp, History, Minus, Plus, Zap, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const PlinkoBoard = ({ rows, risk }: { rows: number; risk: string }) => {
  // A quick visual representation of a plinko board
  const numPegs = rows;
  const boardHeight = 400;
  const boardWidth = 600;
  const pegRadius = 4;
  
  const pegs = [];
  for (let r = 2; r < numPegs + 2; r++) {
    const y = (r / (numPegs + 1)) * (boardHeight - 40);
    for (let c = 0; c <= r; c++) {
      const rowWidth = (r / numPegs) * (boardWidth - 100);
      const startX = (boardWidth - rowWidth) / 2;
      const x = startX + (c / r) * rowWidth;
      pegs.push({ x, y, r, c });
    }
  }

  // Multipliers based on risk and rows
  const multipliers = risk === 'High' 
    ? [110, 41, 10, 5, 3, 1.5, 1, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
    : risk === 'Medium'
    ? [43, 13, 4, 2, 1.5, 1, 0.7, 0.5, 0.7, 1, 1.5, 2, 4, 13, 43]
    : [16, 9, 3, 1.5, 1.1, 1, 0.8, 0.5, 0.8, 1, 1.1, 1.5, 3, 9, 16];

  const displayMultipliers = multipliers.slice(0, rows + 1);
  const midIndex = Math.floor(displayMultipliers.length / 2);

  // Fake ball position
  const ballRow = Math.floor(rows / 2);
  const ballCol = Math.floor(ballRow / 2) + 1;
  const ballY = (ballRow / (numPegs + 1)) * (boardHeight - 40) - 15;
  const rowWidth = (ballRow / numPegs) * (boardWidth - 100);
  const startX = (boardWidth - rowWidth) / 2;
  const ballX = startX + (ballCol / ballRow) * rowWidth + 10;

  return (
    <div className="relative w-full h-[500px] flex flex-col items-center justify-end overflow-hidden pt-12">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-32 bg-magenta-500/5 rounded-full blur-[80px] pointer-events-none" />
      
      <svg width={boardWidth} height={boardHeight} viewBox={`0 0 ${boardWidth} ${boardHeight}`} className="drop-shadow-lg z-10">
        {pegs.map((peg, i) => (
          <circle key={i} cx={peg.x} cy={peg.y} r={pegRadius} className="fill-[#2a1b42] stroke-[#4f3575] stroke-[1px]" />
        ))}
        
        {/* The Ball */}
        <g transform={`translate(${ballX}, ${ballY})`}>
          <circle cx="0" cy="0" r="8" className="fill-[#eaff00] drop-shadow-[0_0_12px_rgba(234,255,0,0.8)]" />
          <ellipse cx="-2" cy="-2" rx="3" ry="2" className="fill-white/60 rotate-45" />
          {/* Motion blur trail */}
          <path d="M 0 -15 Q -5 -8 0 0 Q 5 -8 0 -15" className="fill-[#eaff00]/40 drop-shadow-[0_0_8px_rgba(234,255,0,0.5)]" />
        </g>
      </svg>

      <div className="flex w-full max-w-[600px] justify-between items-end gap-1 px-4 pb-2 z-20">
        {displayMultipliers.map((mult, i) => {
          const isCenter = i === midIndex;
          const isEdge = i === 0 || i === displayMultipliers.length - 1;
          const color = isEdge ? 'bg-rose-500 text-rose-50 border-rose-400' 
            : mult < 1 ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
            : isCenter ? 'bg-emerald-500 text-emerald-50 border-emerald-400' 
            : 'bg-amber-500 text-amber-50 border-amber-400';
          
          const glow = isEdge ? 'shadow-[0_0_15px_rgba(244,63,94,0.4)]'
            : isCenter ? 'shadow-[0_0_15px_rgba(16,185,129,0.4)]'
            : '';

          return (
            <div key={i} className={`flex-1 flex items-center justify-center rounded-sm border-b-[3px] text-xs font-bold h-8 transition-transform hover:-translate-y-1 cursor-pointer ${color} ${glow}`}>
              {mult}x
            </div>
          )
        })}
      </div>
    </div>
  );
};

export function Plinko() {
  const [betAmount, setBetAmount] = useState<number>(100);
  const [risk, setRisk] = useState<string>("Medium");
  const [rows, setRows] = useState<number>(12);

  return (
    <div className="min-h-screen w-full bg-[#0a0612] text-white overflow-x-hidden font-sans selection:bg-cyan-500/30">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Chakra Petch', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        
        .neon-border {
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.2), inset 0 0 10px rgba(0, 240, 255, 0.1);
          border: 1px solid rgba(0, 240, 255, 0.3);
        }
        
        .neon-border-green {
          box-shadow: 0 0 15px rgba(57, 255, 20, 0.3), inset 0 0 10px rgba(57, 255, 20, 0.1);
          border: 1px solid rgba(57, 255, 20, 0.5);
        }
        
        .glass-panel {
          background: rgba(20, 15, 35, 0.6);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
      `}} />

      {/* Top Navbar */}
      <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="font-display font-bold text-xl tracking-wider text-white">
              LUNAR<span className="text-cyan-400">CASINO</span>
            </span>
            <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">Plinko</span>
          </div>
          <Badge variant="outline" className="bg-[#1a112c] border-cyan-500/30 text-cyan-400 font-display hidden sm:flex gap-1.5 ml-4">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            1,402 Playing
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-[#130d22] border border-white/10 rounded-full pl-4 pr-1 py-1">
            <div className="flex flex-col items-end">
              <span className="text-xs text-zinc-400">Balance</span>
              <span className="font-display font-bold text-[#eaff00]">₹42,850.50</span>
            </div>
            <Button size="icon" className="h-8 w-8 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white hover:bg-white/5">
              <Volume2 className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white hover:bg-white/5">
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="max-w-[1400px] mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Game Area (Span 9) */}
        <div className="lg:col-span-9 flex flex-col gap-6">
          
          {/* Game Window */}
          <div className="glass-panel rounded-2xl overflow-hidden flex flex-col neon-border relative group">
            {/* Header info inside game */}
            <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20 pointer-events-none">
              <Badge variant="secondary" className="bg-black/40 text-zinc-300 backdrop-blur-md border-white/10">
                <HelpCircle className="w-3 h-3 mr-1" /> How to play
              </Badge>
              <div className="flex gap-2 pointer-events-auto">
                <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full bg-black/40 text-zinc-300 hover:bg-white/10 backdrop-blur-md">
                  <History className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full bg-black/40 text-zinc-300 hover:bg-white/10 backdrop-blur-md">
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Canvas Area */}
            <div className="bg-gradient-to-b from-[#110a1f] to-[#0a0612] w-full min-h-[450px] flex items-center justify-center p-4">
               <PlinkoBoard rows={rows} risk={risk} />
            </div>

            {/* Bottom Control Bar */}
            <div className="bg-[#140e22] border-t border-white/5 p-4 lg:p-6 flex flex-col md:flex-row gap-6 justify-between items-center relative z-20">
              
              {/* Bet Amount */}
              <div className="flex flex-col gap-2 w-full md:w-[280px]">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-zinc-400">Bet Amount</label>
                  <span className="text-xs text-zinc-500 font-display">₹10 - ₹100k</span>
                </div>
                <div className="flex bg-[#0a0612] border border-white/10 rounded-lg overflow-hidden p-1">
                  <div className="flex-1 flex items-center px-3 gap-2">
                    <span className="text-zinc-500">₹</span>
                    <input 
                      type="number" 
                      value={betAmount}
                      onChange={(e) => setBetAmount(Number(e.target.value))}
                      className="bg-transparent border-none outline-none w-full text-white font-display font-bold text-lg"
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 h-10 bg-white/5 hover:bg-white/10 text-xs font-bold text-zinc-300 rounded-md">½</Button>
                    <Button variant="ghost" className="px-2 h-10 bg-white/5 hover:bg-white/10 text-xs font-bold text-zinc-300 rounded-md">2x</Button>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap md:flex-nowrap gap-4 flex-1 w-full justify-center md:justify-end items-end">
                <div className="flex flex-col gap-2 min-w-[120px]">
                  <label className="text-sm font-medium text-zinc-400">Risk</label>
                  <Tabs value={risk} onValueChange={setRisk} className="w-full">
                    <TabsList className="w-full bg-[#0a0612] border border-white/10 h-12 rounded-lg p-1">
                      <TabsTrigger value="Low" className="flex-1 text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-md">Low</TabsTrigger>
                      <TabsTrigger value="Medium" className="flex-1 text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 rounded-md">Med</TabsTrigger>
                      <TabsTrigger value="High" className="flex-1 text-xs data-[state=active]:bg-rose-500/20 data-[state=active]:text-rose-400 rounded-md">High</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="flex flex-col gap-2 min-w-[120px]">
                  <label className="text-sm font-medium text-zinc-400">Rows</label>
                  <Tabs value={rows.toString()} onValueChange={(v) => setRows(Number(v))} className="w-full">
                    <TabsList className="w-full bg-[#0a0612] border border-white/10 h-12 rounded-lg p-1">
                      <TabsTrigger value="8" className="flex-1 text-xs data-[state=active]:bg-white/10 rounded-md">8</TabsTrigger>
                      <TabsTrigger value="12" className="flex-1 text-xs data-[state=active]:bg-white/10 rounded-md">12</TabsTrigger>
                      <TabsTrigger value="16" className="flex-1 text-xs data-[state=active]:bg-white/10 rounded-md">16</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <Button className="h-12 px-8 bg-[#39ff14] hover:bg-[#32e011] text-black font-display font-bold text-lg uppercase tracking-wider rounded-lg neon-border-green w-full md:w-auto mt-4 md:mt-0 transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(57,255,20,0.3)]">
                  Bet <Zap className="w-4 h-4 ml-2 fill-black" />
                </Button>
              </div>

            </div>
          </div>
          
          {/* Ticker Row */}
          <div className="w-full overflow-hidden bg-gradient-to-r from-transparent via-cyan-900/10 to-transparent py-2 border-y border-white/5 flex gap-4 items-center">
            <Badge variant="outline" className="shrink-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/20 rounded-sm font-display whitespace-nowrap">
              <Trophy className="w-3 h-3 mr-1" /> Top Wins
            </Badge>
            <div className="flex gap-6 animate-[pulse_4s_ease-in-out_infinite] opacity-80 overflow-x-auto no-scrollbar whitespace-nowrap pb-1">
              <span className="text-sm text-zinc-400"><span className="text-white font-medium">raj_k***</span> won <span className="text-[#39ff14] font-display font-bold">₹12,450</span> on 110x</span>
              <span className="text-sm text-zinc-400"><span className="text-white font-medium">vikram7</span> won <span className="text-[#39ff14] font-display font-bold">₹4,200</span> on 41x</span>
              <span className="text-sm text-zinc-400"><span className="text-white font-medium">anita_p</span> won <span className="text-[#39ff14] font-display font-bold">₹18,900</span> on 110x</span>
              <span className="text-sm text-zinc-400"><span className="text-white font-medium">gamer99</span> won <span className="text-[#39ff14] font-display font-bold">₹2,100</span> on 10x</span>
              <span className="text-sm text-zinc-400"><span className="text-white font-medium">priya_w</span> won <span className="text-[#39ff14] font-display font-bold">₹8,450</span> on 41x</span>
            </div>
          </div>

        </div>

        {/* Right Side: Sidebar (Span 3) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Recent Multipliers */}
          <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-display font-bold text-white text-sm tracking-wide flex items-center gap-2">
                <History className="w-4 h-4 text-cyan-400" /> Recent Hits
              </h3>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {[110, 0.5, 1.5, 5, 0.5, 3, 1, 0.5, 41, 1.5, 1, 0.5, 10, 1.5, 0.5, 3].map((m, i) => {
                const color = m >= 10 ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' 
                  : m >= 3 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : m >= 1.5 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
                
                return (
                  <div key={i} className={`flex items-center justify-center py-1.5 rounded border text-xs font-display font-bold ${color}`}>
                    {m}x
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live Bets Feed */}
          <div className="glass-panel rounded-xl flex flex-col overflow-hidden flex-1 min-h-[300px]">
            <div className="p-3 border-b border-white/5 flex gap-2">
              <Badge className="bg-white/10 hover:bg-white/20 text-white rounded-sm font-normal">All Bets</Badge>
              <Badge variant="outline" className="border-transparent text-zinc-500 hover:text-zinc-300 rounded-sm font-normal">My Bets</Badge>
              <Badge variant="outline" className="border-transparent text-zinc-500 hover:text-zinc-300 rounded-sm font-normal">High Rollers</Badge>
            </div>
            
            <div className="flex flex-col p-2 gap-1 overflow-y-auto custom-scrollbar">
              {[
                { user: 'rohit_92', bet: 500, mult: 10, time: '1s' },
                { user: 'kabir_c', bet: 2000, mult: 0.5, time: '4s' },
                { user: 'sneha_1', bet: 100, mult: 41, time: '12s' },
                { user: 'arjun_v', bet: 5000, mult: 1.5, time: '15s' },
                { user: 'dev_gamer', bet: 250, mult: 3, time: '22s' },
                { user: 'nisha_m', bet: 1000, mult: 0.5, time: '28s' },
                { user: 'rahul_k', bet: 100, mult: 1, time: '35s' },
              ].map((bet, i) => {
                const isWin = bet.mult > 1;
                const payout = bet.bet * bet.mult;
                return (
                  <div key={i} className="flex justify-between items-center p-2 rounded hover:bg-white/5 transition-colors text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-zinc-300 text-xs">{bet.user}</span>
                      <span className="text-zinc-500 text-[10px]">{bet.time} ago</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-display text-zinc-400 text-xs">₹{bet.bet}</span>
                      <span className={`font-display text-xs w-8 text-center rounded bg-black/40 py-0.5 ${isWin ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {bet.mult}x
                      </span>
                      <span className={`font-display font-bold text-xs min-w-[50px] text-right ${isWin ? 'text-[#39ff14]' : 'text-zinc-600'}`}>
                        {isWin ? `+₹${payout}` : `-₹${bet.bet}`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
        </div>
      </main>

    </div>
  );
}
