import React, { useState, useEffect } from 'react';
import { 
  Trophy, Flame, Clock, Play, Zap, 
  Gamepad2, Search, Bell, Menu, Plus, 
  User, Wallet, Rocket, Home, Ticket,
  ChevronRight, CircleDollarSign
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

// --- Types & Data ---

interface Game {
  id: string;
  name: string;
  provider: string;
  image: string;
  players: number;
  badge?: {
    text: string;
    color: string;
  };
}

const CATEGORIES = [
  { id: 'all', name: 'All Games', icon: Home },
  { id: 'crash', name: 'Crash', icon: Rocket },
  { id: 'instant', name: 'Instant', icon: Zap },
  { id: 'slots', name: 'Slots', icon: Gamepad2 },
  { id: 'live', name: 'Live Casino', icon: Play },
  { id: 'table', name: 'Table', icon: CircleDollarSign },
];

const HOT_GAMES: Game[] = [
  { id: 'g1', name: 'Lunar Crash', provider: 'Originals', image: 'bg-gradient-to-br from-indigo-900 to-purple-900', players: 12453, badge: { text: 'HOT', color: 'bg-red-500' } },
  { id: 'g2', name: 'Mines', provider: 'Originals', image: 'bg-gradient-to-br from-emerald-900 to-teal-900', players: 8392 },
  { id: 'g3', name: 'Plinko', provider: 'Originals', image: 'bg-gradient-to-br from-pink-900 to-rose-900', players: 5211, badge: { text: 'NEW', color: 'bg-green-500' } },
  { id: 'g4', name: 'JetX', provider: 'SmartSoft', image: 'bg-gradient-to-br from-yellow-900 to-orange-900', players: 14233 },
];

const ALL_GAMES: Game[] = [
  ...HOT_GAMES,
  { id: 'g5', name: 'Dice', provider: 'Originals', image: 'bg-gradient-to-br from-slate-800 to-zinc-900', players: 3102 },
  { id: 'g6', name: 'Lucky Jet', provider: 'GamingCorp', image: 'bg-gradient-to-br from-purple-800 to-indigo-900', players: 9821, badge: { text: 'TRENDING', color: 'bg-orange-500' } },
  { id: 'g7', name: 'Crash 2X', provider: 'TurboGames', image: 'bg-gradient-to-br from-blue-900 to-cyan-900', players: 4120 },
  { id: 'g8', name: 'Dragon Tower', provider: 'Originals', image: 'bg-gradient-to-br from-red-900 to-orange-900', players: 2341 },
  { id: 'g9', name: 'Keno', provider: 'Originals', image: 'bg-gradient-to-br from-green-800 to-emerald-900', players: 1102 },
  { id: 'g10', name: 'Wheel', provider: 'Originals', image: 'bg-gradient-to-br from-violet-900 to-fuchsia-900', players: 1832 },
  { id: 'g11', name: 'Limbo', provider: 'Originals', image: 'bg-gradient-to-br from-sky-900 to-blue-900', players: 2190 },
  { id: 'g12', name: 'Tower', provider: 'Originals', image: 'bg-gradient-to-br from-amber-900 to-orange-900', players: 843 },
  { id: 'g13', name: 'Roulette', provider: 'Originals', image: 'bg-gradient-to-br from-red-800 to-rose-900', players: 3421 },
  { id: 'g14', name: 'Blackjack', provider: 'Live Dealer', image: 'bg-gradient-to-br from-zinc-800 to-neutral-900', players: 5122 },
  { id: 'g15', name: 'Baccarat', provider: 'Live Dealer', image: 'bg-gradient-to-br from-emerald-800 to-green-900', players: 4321 },
  { id: 'g16', name: 'Teen Patti', provider: 'Live Dealer', image: 'bg-gradient-to-br from-orange-800 to-amber-900', players: 12102, badge: { text: 'INDIA', color: 'bg-emerald-500' } },
  { id: 'g17', name: 'Andar Bahar', provider: 'Live Dealer', image: 'bg-gradient-to-br from-red-700 to-red-900', players: 9832, badge: { text: 'HOT', color: 'bg-red-500' } },
  { id: 'g18', name: 'Crazy Time', provider: 'Evolution', image: 'bg-gradient-to-br from-fuchsia-800 to-purple-900', players: 18432 },
];

const WINNERS = [
  { user: 'rohit_92', amount: 4210, game: 'Mines' },
  { user: 'vikas.k', amount: 15500, game: 'Lunar Crash' },
  { user: 'priya_m', amount: 840, game: 'Plinko' },
  { user: 'gamer_boy', amount: 21000, game: 'Crazy Time' },
  { user: 'amit_p', amount: 3200, game: 'Teen Patti' },
  { user: 'raj_77', amount: 980, game: 'Dice' },
];

// --- Components ---

function TopBar() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 bg-[#0a0612]/90 backdrop-blur-md border-b border-white/5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-10 w-10 shrink-0">
          <Menu className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-[#00ff88] to-[#00ffee] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,255,136,0.3)]">
            <Rocket className="w-5 h-5 text-black" />
          </div>
          <span className="font-black text-xl tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            LUNAR
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-end mr-2">
          <span className="text-xs text-white/50 font-medium">Balance</span>
          <span className="text-sm font-bold text-[#00ff88]">₹ 14,250.00</span>
        </div>
        <Button size="icon" variant="ghost" className="text-white/70 hover:text-white relative w-10 h-10 rounded-full bg-white/5">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-[#ff0055] rounded-full shadow-[0_0_8px_rgba(255,0,85,0.8)]" />
        </Button>
        <Button className="bg-gradient-to-r from-[#00ff88] to-[#00ffee] text-black font-bold border-0 hover:opacity-90 shadow-[0_0_15px_rgba(0,255,136,0.2)]">
          <Plus className="w-4 h-4 mr-1" />
          Deposit
        </Button>
      </div>
    </div>
  );
}

function HeroBanner() {
  return (
    <div className="px-4 py-4">
      <div className="relative w-full h-[200px] sm:h-[240px] rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-950 via-purple-900 to-black border border-white/10 group cursor-pointer">
        {/* Abstract background elements */}
        <div className="absolute top-[-50%] left-[-20%] w-[150%] h-[150%] bg-[radial-gradient(ellipse_at_center,rgba(0,255,136,0.15)_0%,transparent_50%)] animate-[pulse_4s_ease-in-out_infinite]" />
        <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(255,0,255,0.15)_0%,transparent_50%)]" />
        
        {/* Content */}
        <div className="absolute inset-0 p-6 flex flex-col justify-between z-10">
          <div>
            <Badge className="bg-[#ff0055] text-white border-0 font-bold mb-2 uppercase tracking-wider">Live Now</Badge>
            <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight uppercase italic drop-shadow-lg">
              Lunar <span className="text-[#00ff88]">Crash</span>
            </h2>
            <p className="text-white/70 text-sm mt-1 max-w-[200px] sm:max-w-xs font-medium">Catch the multiplier before it drops!</p>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-end gap-2">
              <span className="text-4xl sm:text-5xl font-black text-[#00ff88] drop-shadow-[0_0_10px_rgba(0,255,136,0.5)]">
                2.45x
              </span>
              <span className="text-white/50 text-sm mb-1 animate-pulse">Flying...</span>
            </div>
            
            <Button className="rounded-full bg-white text-black hover:bg-gray-200 font-bold px-6 py-5 shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-transform group-hover:scale-105">
              Play Now
            </Button>
          </div>
        </div>

        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
      </div>
    </div>
  );
}

function WinnersTicker() {
  return (
    <div className="w-full bg-[#130b24] border-y border-white/5 py-2 overflow-hidden flex items-center">
      <div className="px-4 flex items-center gap-2 border-r border-white/10 shrink-0">
        <Trophy className="w-4 h-4 text-[#ffcc00]" />
        <span className="text-xs font-bold text-white/80 uppercase">Live Wins</span>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="flex animate-[ticker_30s_linear_infinite] whitespace-nowrap min-w-max hover:[animation-play-state:paused]">
          {[...WINNERS, ...WINNERS, ...WINNERS].map((win, i) => (
            <div key={i} className="flex items-center gap-2 mx-6 text-sm">
              <span className="text-white/60 font-medium">{win.user}</span>
              <span className="text-white/40">in</span>
              <span className="text-white font-semibold">{win.game}</span>
              <span className="text-[#00ff88] font-bold ml-1 flex items-center">
                <Badge variant="outline" className="bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20 text-[10px] px-1.5 py-0 h-5">
                  ₹ {win.amount.toLocaleString('en-IN')}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryTabs() {
  return (
    <ScrollArea className="w-full whitespace-nowrap border-b border-white/5 bg-[#0a0612]/80 backdrop-blur sticky top-[65px] z-40">
      <div className="flex w-max space-x-2 p-4">
        {CATEGORIES.map((cat, i) => {
          const Icon = cat.icon;
          const isActive = i === 0;
          return (
            <Button
              key={cat.id}
              variant={isActive ? "default" : "outline"}
              className={cn(
                "rounded-full border border-white/10 px-5 transition-all font-semibold",
                isActive 
                  ? "bg-white text-black hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.2)]" 
                  : "bg-[#160d29] text-white/70 hover:bg-[#20133b] hover:text-white"
              )}
            >
              <Icon className={cn("w-4 h-4 mr-2", isActive ? "text-black" : "text-[#00ff88]")} />
              {cat.name}
            </Button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function GameCard({ game, featured = false }: { game: Game; featured?: boolean }) {
  return (
    <div className={cn(
      "group relative rounded-xl overflow-hidden cursor-pointer flex-shrink-0 transition-transform duration-300 hover:-translate-y-1",
      featured ? "w-[240px] sm:w-[280px]" : "w-full"
    )}>
      {/* Aspect Ratio Container */}
      <div className={cn(
        "relative w-full",
        featured ? "aspect-[4/3]" : "aspect-square"
      )}>
        <div className={cn("absolute inset-0", game.image)} />
        
        {/* Overlay Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-[#00ff88]/0 group-hover:bg-[#00ff88]/10 transition-colors duration-300" />
        
        {/* Badges */}
        {game.badge && (
          <Badge className={cn("absolute top-3 left-3 border-0 font-bold text-[10px] tracking-wider uppercase shadow-lg", game.badge.color)}>
            {game.badge.text}
          </Badge>
        )}

        {/* Hover Play Button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 scale-90 group-hover:scale-100">
          <div className="w-14 h-14 rounded-full bg-[#00ff88] flex items-center justify-center shadow-[0_0_30px_rgba(0,255,136,0.5)]">
            <Play className="w-6 h-6 text-black ml-1" fill="currentColor" />
          </div>
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-0.5">{game.provider}</p>
              <h3 className="text-white font-bold text-lg sm:text-xl leading-tight">{game.name}</h3>
            </div>
            <div className="flex items-center gap-1 bg-black/50 backdrop-blur rounded-full px-2 py-1 border border-white/10">
              <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
              <span className="text-[10px] font-medium text-white/80">{game.players.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HotCarousel() {
  return (
    <div className="py-6">
      <div className="px-4 flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-[#ff0055]" fill="currentColor" />
          <h2 className="text-xl font-bold text-white uppercase italic tracking-wide">Hot Right Now</h2>
        </div>
        <Button variant="ghost" size="sm" className="text-white/50 hover:text-white text-xs font-semibold">
          See All <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
      
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex w-max space-x-4 px-4 pb-4">
          {HOT_GAMES.map((game) => (
            <GameCard key={game.id} game={game} featured />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function GameGrid() {
  return (
    <div className="px-4 py-2 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-5 h-5 text-[#00ffee]" />
          <h2 className="text-xl font-bold text-white uppercase italic tracking-wide">All Games</h2>
        </div>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" className="w-8 h-8 rounded bg-[#160d29] border-white/10 text-white/70 hover:text-white">
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {ALL_GAMES.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
      
      <div className="mt-8 text-center">
        <Button variant="outline" className="border-white/10 bg-[#160d29] text-white hover:bg-white/10 font-bold px-8">
          Load More Games
        </Button>
      </div>
    </div>
  );
}

function BottomNav() {
  const navItems = [
    { icon: Home, label: 'Lobby', active: true },
    { icon: Play, label: 'Live' },
    { icon: Ticket, label: 'My Bets' },
    { icon: Wallet, label: 'Wallet' },
    { icon: User, label: 'Profile' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0612]/95 backdrop-blur-xl border-t border-white/10 px-2 sm:px-6 py-2 safe-area-bottom">
      <div className="flex items-center justify-between max-w-md mx-auto">
        {navItems.map((item, i) => {
          const Icon = item.icon;
          return (
            <button 
              key={i} 
              className={cn(
                "flex flex-col items-center justify-center p-2 min-w-[64px] rounded-lg transition-colors",
                item.active ? "text-[#00ff88]" : "text-white/50 hover:text-white hover:bg-white/5"
              )}
            >
              <div className="relative mb-1">
                <Icon className={cn("w-5 h-5", item.active && "drop-shadow-[0_0_8px_rgba(0,255,136,0.8)]")} fill={item.active ? "currentColor" : "none"} />
                {item.label === 'My Bets' && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#ff0055] rounded-full border border-[#0a0612]" />
                )}
              </div>
              <span className="text-[10px] font-bold tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Lobby() {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.33%); }
        }
        
        .safe-area-bottom {
          padding-bottom: env(safe-area-inset-bottom, 1rem);
        }
      `}} />
      <div className="min-h-[100dvh] w-full bg-[#0a0612] text-white font-['Inter',sans-serif] selection:bg-[#00ff88] selection:text-black flex justify-center">
        {/* Desktop Container Constraints - feels like an app even on wide screens */}
        <div className="w-full max-w-7xl relative shadow-2xl bg-[#0a0612] min-h-screen border-x border-white/5 flex flex-col">
          <TopBar />
          
          <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide pb-16">
            <HeroBanner />
            <WinnersTicker />
            <CategoryTabs />
            <HotCarousel />
            
            <div className="px-4 my-2">
              <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
            
            <GameGrid />
          </div>
          
          <BottomNav />
        </div>
      </div>
    </>
  );
}
