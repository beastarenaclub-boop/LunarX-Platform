import { GameInformationSection } from "@/components/game/GameInformation";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import TopBar from "@/components/lunar/TopBar";
import CrashWinReceipt from "@/components/CrashWinReceipt";
import BannerStrip from "@/components/lunar/BannerStrip";
import GameCanvas from "@/components/lunar/GameCanvas";
import HistoryStrip from "@/components/lunar/HistoryStrip";
import BetPanel from "@/components/lunar/BetPanel";
import SidePanel from "@/components/lunar/SidePanel";
import ChatPanel from "@/components/lunar/ChatPanel";
import Onboarding from "@/components/lunar/Onboarding";
import { useStore } from "@/game/store";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCrashTheme } from "@/game/crashThemes";
import JetXScene from "@/components/lunar/JetXScene";
import JetXActivity from "@/components/lunar/JetXActivity";
import "@/components/lunar/jetx.css";
import JetXGame from "@/components/lunar/JetXGame";
import FuryScene from "@/components/lunar/FuryScene";
import FuryActivity from "@/components/lunar/FuryActivity";
import "@/components/lunar/fury.css";

function FlightTitle({ name }: { name: string }) {
  const multiplier = useStore(s => s.multiplier);
  useEffect(() => {
    document.title = `${multiplier.toFixed(2)}× • ${name}`;
  }, [multiplier, name]);
  return null;
}

/**
 * Shared crash-game page for JetX and Fury Flight. Each game has
 * its own server RTP config and branding, but shares the wallet, this
 * layout and the engine loop.
 */
export default function Lunar({ gameCode }: { gameCode: string }) {
  const theme = getCrashTheme(gameCode);
  const isJetX = gameCode === "jetx";
  const isFury = gameCode === "fury";
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [tinyPanel, setTinyPanel] = useState<"0" | "1">("0");

  useEffect(() => {
    if (!authLoading && !user) navigate("/");
  }, [authLoading, user, navigate]);

  if (!user) return null;
  if (isJetX) return <><FlightTitle name={theme.name} /><JetXGame userId={user.id} /></>;

  return (
    <div className={`game-page crash-page crash-focused flex flex-col bg-background text-foreground${isJetX ? " jetx-page" : ""}${isFury ? " fury-page" : ""}`}>
      <FlightTitle name={theme.name} />
      <TopBar />
      <CrashWinReceipt key={gameCode} game={gameCode} userId={user.id} />
      <Onboarding />
      <GameInformationSection>
        <BannerStrip />
        <div className="h-80 min-h-0 flex flex-col">
          <SidePanel />
        </div>
        <div className="h-80 min-h-0 flex flex-col">
          <ChatPanel />
        </div>
      </GameInformationSection>
      <div data-game-screen={gameCode} className="crash-play-area">
        <div className="crash-scene-column">
          {!isFury && <HistoryStrip />}
          <div className="crash-scene">
            {isFury ? <FuryScene /> : isJetX ? <JetXScene /> : <GameCanvas />}
          </div>
        </div>
        <div className="crash-bet-controls">
          <div className="crash-dual-bets hidden min-[700px]:grid gap-2">
            <BetPanel panelIdx={0} />
            <BetPanel panelIdx={1} />
          </div>
          <Tabs
            value={tinyPanel}
            onValueChange={(v) => setTinyPanel(v as "0" | "1")}
            className="crash-mobile-bets min-[700px]:hidden flex flex-col gap-1"
          >
            <TabsList className="grid grid-cols-2 h-9 w-full">
              <TabsTrigger value="0" data-testid="btn-tiny-panel-0">
                {isJetX || isFury ? "Bet 01" : "Panel 1"}
              </TabsTrigger>
              <TabsTrigger value="1" data-testid="btn-tiny-panel-1">
                {isJetX || isFury ? "Bet 02" : "Panel 2"}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="0" className="mt-0">
              <BetPanel panelIdx={0} />
            </TabsContent>
            <TabsContent value="1" className="mt-0">
              <BetPanel panelIdx={1} />
            </TabsContent>
          </Tabs>
        </div>
        {isJetX && <aside className="jetx-activity-column" aria-label="Round activity"><JetXActivity /></aside>}
        {isFury && <aside className="fury-activity-column" aria-label="Fury Flight activity"><FuryActivity /></aside>}
      </div>
      {isJetX && <footer className="jetx-page-footer"><span><b>JETX</b> FLIGHT CONTROL</span><span>Choose coins · Watch the flight · Cash out</span></footer>}
    </div>
  );
}
