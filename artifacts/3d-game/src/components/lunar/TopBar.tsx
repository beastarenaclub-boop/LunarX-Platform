import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useStore } from "@/game/store";
import { unlockAudio, sfx } from "@/game/audio";
import { t } from "@/game/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Rocket,
  Coins,
  IndianRupee,
  Menu,
  PanelRightClose,
  Settings as SettingsIcon,
  BarChart3,
  ShieldCheck,
  Wallet,
  Users,
  Trophy,
  User as UserIcon,
  History as HistoryIcon,
  HelpCircle,
  LogIn,
  LogOut,
  Gift,
  ArrowLeft,
} from "lucide-react";
import SettingsDialog from "./SettingsDialog";
import StatsDialog from "./StatsDialog";
import ProvablyFairDialog from "./ProvablyFairDialog";
import AchievementsDialog from "./AchievementsDialog";
import NotificationBell from "./NotificationBell";
import { xpForNextLevel } from "@/game/progression";
import { useAuth } from "@/lib/auth";
import {
  useGetWalletBalance,
  useLogout,
  getGetMeQueryKey,
  getGetWalletBalanceQueryKey,
  useRealtimeTopic,
  useRealtimeResync,
  disconnectRealtime,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatRupees } from "@/lib/format";
import { toast } from "sonner";
import { getCrashTheme } from "@/game/crashThemes";
import { GameRulesButton } from "@/components/game/GameRules";
import type { GetWalletBalanceGame } from "@workspace/api-client-react";
import JetXMenu from "./JetXMenu";

export default function TopBar({ onJetXActivityToggle }: { onJetXActivityToggle?: () => void } = {}) {
  const activeGameCode = useStore(
    (s) => s.activeGameCode,
  ) as GetWalletBalanceGame;
  const theme = getCrashTheme(activeGameCode);
  const isJetX = activeGameCode === "jetx";
  const isFury = activeGameCode === "fury";
  const flightHeader = isJetX || isFury;
  const lang = useStore((s) => s.settings.language);
  const sound = useStore((s) => s.settings.sound);
  const tick = () => {
    unlockAudio();
    if (sound) sfx.uiSelect();
  };
  const onlinePlayers = useStore((s) => s.onlinePlayers);
  const level = useStore((s) => s.progression.level);
  const xp = useStore((s) => s.progression.xp);
  const dailyMissions = useStore((s) => s.progression.dailyMissions);
  const claimableMissions = dailyMissions.filter((m) => m.completed && !m.claimed).length;
  const xpNeeded = xpForNextLevel(level);
  const xpPct = Math.max(0, Math.min(100, (xp / xpNeeded) * 100));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const [achOpen, setAchOpen] = useState(false);

  const { user } = useAuth();
  const qc = useQueryClient();
  // Every crash game shows the same shared wallet balance.
  const balance = useGetWalletBalance(
    { game: activeGameCode },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: activeGameCode }),
        enabled: !!user,
        // Realtime push handles live updates; this is a 5-min safety net.
        refetchInterval: 300_000,
        retry: false,
      },
    },
  );
  // Push: server emits wallet:{userId} on every ledger change, carrying the
  // game `scope` so we update the matching per-game cache entry.
  useRealtimeTopic<{
    type: string;
    scope?: string;
    balance: string;
  }>(user ? `wallet:${user.id}` : null, (ev) => {
    if (ev?.type === "balance" && typeof ev.balance === "string") {
      qc.setQueryData(
        getGetWalletBalanceQueryKey({
          game: (ev.scope ?? "lunar") as GetWalletBalanceGame,
        }),
        (prev: unknown) => {
          if (prev && typeof prev === "object") {
            return { ...(prev as object), balance: ev.balance };
          }
          return prev;
        },
      );
    }
  });
  // Resync on (re)connect. The bare prefix key invalidates every per-game
  // balance query at once.
  useRealtimeResync(() => {
    if (user) qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
  });
  const [, navigate] = useLocation();
  const logout = useLogout({
    mutation: {
      onSuccess: async () => {
        disconnectRealtime();
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast.success("Signed out");
        navigate("/");
      },
    },
  });

  return (
    <header className="crash-header flex items-center justify-between px-4 py-3 max-[499px]:px-2 max-[499px]:py-2 border-b border-card-border bg-sidebar/80 backdrop-blur safe-pt">
      <div className="flex items-center gap-3 max-[499px]:gap-2 min-w-0">
        {flightHeader && <Link href="/" className={isFury ? "fury-back" : "jetx-back"} aria-label="Back to lobby"><ArrowLeft size={18} /></Link>}
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15 text-primary max-[499px]:hidden">
          {theme.code === "lunar" ? (
            <Rocket className="w-5 h-5" />
          ) : (
            <theme.Icon className="w-5 h-5" style={{ color: theme.accent }} />
          )}
        </div>
        <div className="min-w-0">
          <div className={`text-base font-bold leading-none tracking-tight${isJetX ? " jetx-wordmark" : ""}`}>
            {theme.code === "lunar" ? (
              t(lang, "appTitle")
            ) : (
              <>
                {theme.namePrimary}
                {isFury && " "}
                <span style={{ color: theme.accent }}>{theme.nameAccent}</span>
              </>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 max-[499px]:hidden">
            {isJetX ? "FLIGHT CONTROL" : "Crash Game"}
          </div>
        </div>
      </div>

      {/* XP/Level bar (hidden on small screens) */}
      {!flightHeader && <button
        className="hidden md:flex items-center gap-2 flex-1 max-w-xs mx-4 group"
        onClick={() => setAchOpen(true)}
        data-testid="btn-progression"
        aria-label="Progression"
      >
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/15 text-primary text-[11px] font-mono font-bold shrink-0 group-hover:bg-primary/25 transition">
          {level}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
            <span className="uppercase tracking-wider">Lv {level}</span>
            <span className="font-mono">{xp}/{xpNeeded} XP</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-primary transition-[width] duration-500"
              style={{ width: `${xpPct}%` }}
            />
          </div>
        </div>
      </button>}

      <div className="flex items-center gap-2 max-[499px]:gap-1 shrink-0">
        <Badge
          variant="outline"
          className="hidden sm:flex h-9 items-center gap-1.5 px-2.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono"
          data-testid="badge-online-players"
          title={`${onlinePlayers.toLocaleString()} ${t(lang, "playersOnline")}`}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <Users className="w-3.5 h-3.5" />
          <span className="tabular-nums text-xs font-bold">
            {onlinePlayers.toLocaleString()}
          </span>
        </Badge>

        {/* Achievements / Missions button */}
        {!flightHeader && <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 max-[499px]:h-11 max-[499px]:w-11 relative"
          onClick={() => {
            tick();
            setAchOpen(true);
          }}
          aria-label="Achievements"
          data-testid="btn-achievements"
        >
          <Trophy className="w-4 h-4" />
          {claimableMissions > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-[9px] font-bold text-accent-foreground flex items-center justify-center">
              {claimableMissions}
            </span>
          )}
        </Button>}

        {user && !flightHeader && <NotificationBell />}

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 max-[499px]:h-11 gap-2 border-accent/30 bg-accent/10 hover:bg-accent/20"
                onClick={unlockAudio}
                data-testid="btn-balance"
              >
                {isJetX ? <IndianRupee className="w-4 h-4 text-accent shrink-0" /> : <Coins className="w-4 h-4 text-accent shrink-0" />}
                <span className="font-mono font-bold text-sm" data-testid="text-balance">
                  {isJetX ? "" : "₹"}{formatRupees(balance.data?.balance ?? "0")}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5" />
                Signed in as {user.displayName || user.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/wallet" data-testid="menu-wallet">
                  <Wallet className="w-3.5 h-3.5 mr-2" /> Wallet
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/profile" data-testid="menu-profile">
                  <UserIcon className="w-3.5 h-3.5 mr-2" /> Profile & KYC
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/history" data-testid="menu-history">
                  <HistoryIcon className="w-3.5 h-3.5 mr-2" /> History
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/promotions" data-testid="menu-promotions">
                  <Gift className="w-3.5 h-3.5 mr-2" /> Promotions & Refer
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/help" data-testid="menu-help">
                  <HelpCircle className="w-3.5 h-3.5 mr-2" /> Help & Support
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logout.mutate(undefined)}
                data-testid="menu-logout"
              >
                <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <Button variant="ghost" size="icon" className="h-9 w-9 max-[499px]:h-11 max-[499px]:w-11 max-[499px]:hidden" onClick={() => { tick(); setStatsOpen(true); }} aria-label="Stats">
          <BarChart3 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 max-[499px]:h-11 max-[499px]:w-11 max-[499px]:hidden" onClick={() => { tick(); setFairOpen(true); }} aria-label="Provably Fair">
          <ShieldCheck className="w-4 h-4" />
        </Button>
        {isJetX ? <><JetXMenu /><button className="jetx-sidebar-toggle" aria-label="Toggle players sidebar" onClick={onJetXActivityToggle}><PanelRightClose size={18} /></button></> : <><GameRulesButton gameCode={activeGameCode} />
        <Button variant="ghost" size="icon" className="h-9 w-9 max-[499px]:h-11 max-[499px]:w-11" onClick={() => { tick(); setSettingsOpen(true); }} aria-label="Settings">
          {isJetX ? <Menu className="w-4 h-4" /> : <SettingsIcon className="w-4 h-4" />}
        </Button></>}
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <ProvablyFairDialog open={fairOpen} onOpenChange={setFairOpen} />
      <AchievementsDialog open={achOpen} onOpenChange={setAchOpen} />
    </header>
  );
}
