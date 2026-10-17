import { useEffect, useState } from "react";
import { Link } from "wouter";
import { History, Maximize2, Menu, Music2, PlayCircle, Trophy, Volume2, X, UserRound, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio } from "@/game/audio";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Switch } from "@/components/ui/switch";
import { GameRulesButton } from "@/components/game/GameRules";
import { canSetJetXPanelCount, setJetXPanelCount, setJetXPreferences, useJetXPreferences } from "./jetxPreferences";
import jetUrl from "@/assets/jetx/jet-v2.webp";

export default function JetXMenu() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState("");
  const { user } = useAuth();
  const settings = useStore(s => s.settings);
  useStore(s => s.panels); // Recheck panel visibility when a bet is accepted/settled.
  const prefs = useJetXPreferences();
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (document.querySelector('[data-game-viewport="jetx"]') || document.documentElement).requestFullscreen();
    } catch { setFullscreenError("Full screen is unavailable in this browser."); }
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button className="jetx-menu-trigger" aria-label="Settings">{open ? <X size={19} /> : <Menu size={19} />}</button></PopoverTrigger>
    <PopoverPrimitive.Portal container={fullscreen ? document.fullscreenElement as HTMLElement : undefined}><PopoverPrimitive.Content align="end" sideOffset={12} collisionPadding={12} className="jetx-menu z-50" aria-label="JetX settings">
      <div className="jetx-menu-profile"><span><img src={jetUrl} alt="" /></span><div><strong>{user?.displayName || "Player"}</strong><Link href="/profile" onClick={() => setOpen(false)}>My profile <UserRound size={12} /></Link></div></div>
      <h3>Preferences</h3>
      <label><Music2 size={19} /><span>Music</span><Switch aria-label="Music" checked={settings.music} onCheckedChange={music => { unlockAudio(); updateSettings({ music }); }} /></label>
      <label><Volume2 size={19} /><span>Sounds</span><Switch aria-label="Sounds" checked={settings.sound} onCheckedChange={sound => { unlockAudio(); updateSettings({ sound }); }} /></label>
      <label><PlayCircle size={19} /><span>Animations</span><Switch aria-label="Animations" checked={prefs.animations} onCheckedChange={animations => setJetXPreferences({ animations })} /></label>
      <label><Trophy size={19} /><span>Top winner</span><Switch aria-label="Top winner" checked={prefs.topWinner} onCheckedChange={topWinner => setJetXPreferences({ topWinner })} /></label>
      <label><Maximize2 size={19} /><span>Full screen</span><Switch aria-label="Full screen" checked={fullscreen} onCheckedChange={() => void toggleFullscreen()} /></label>
      {fullscreenError && <p role="status">{fullscreenError}</p>}
      <h3>Betting panels</h3>
      <div className="jetx-panel-options">{([1, 2, 4] as const).map(count => <button key={count} disabled={!canSetJetXPanelCount(count)} title={!canSetJetXPanelCount(count) ? "Finish the active bets before hiding their panels" : undefined} aria-pressed={prefs.panelCount === count} onClick={() => { setJetXPanelCount(count); setOpen(false); }}><i data-panels={count}>{Array.from({ length: count }, (_, i) => <b key={i} />)}</i><span><strong>{count} Panel</strong><small>{count === 1 ? "Simple" : count === 2 ? "New" : "Pro"}</small></span></button>)}</div>
      <h3>Other</h3>
      <Link href="/history" className="jetx-menu-link" onClick={() => setOpen(false)}><History size={19} />My bets</Link>
      <div className="jetx-menu-rules"><ShieldCheck size={19} /><span>Game rules</span><GameRulesButton gameCode="jetx" /></div>
    </PopoverPrimitive.Content></PopoverPrimitive.Portal>
  </Popover>;
}
