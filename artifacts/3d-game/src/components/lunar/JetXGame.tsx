import { useState } from "react";
import TopBar from "./TopBar";
import HistoryStrip from "./HistoryStrip";
import JetXScene from "./JetXScene";
import JetXBetDock from "./JetXBetDock";
import JetXActivity from "./JetXActivity";
import Onboarding from "./Onboarding";
import { Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "./jetx-fit.css";
import "./jetx-reference.css";
import { setJetXPreferences, useJetXPreferences } from "./jetxPreferences";

/** A continuous flight stage, with the controls overlaid just like the reference. */
export default function JetXGame(_props: { userId: string }) {
  const [activityOpen, setActivityOpen] = useState(false);
  const preferences = useJetXPreferences();
  return <div className="game-page jetx-page">
    <Onboarding />
    <main className="jetx-layout" data-game-screen="jetx" data-sidebar={preferences.sidebar} data-panels={preferences.panelCount}>
      <section className="jetx-stage" aria-label="JetX flight">
        <JetXScene />
        <TopBar onJetXActivityToggle={() => {
          if (matchMedia('(max-width: 999px), (max-height: 500px)').matches) setActivityOpen(true);
          else setJetXPreferences({ sidebar: !preferences.sidebar });
        }} />
        <div className="jetx-round-toolbar">
          <HistoryStrip />
          <button className="jetx-activity-toggle" onClick={() => setActivityOpen(true)} aria-label="Open players and round activity"><Users size={16} /><span>Players</span></button>
        </div>
        <JetXBetDock />
      </section>
      <aside className="jetx-activity-column" aria-label="Round activity"><JetXActivity /></aside>
    </main>
    <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
      <DialogContent className="jetx-activity-dialog">
        <DialogTitle className="sr-only">Players and round activity</DialogTitle>
        <DialogDescription className="sr-only">Current player bets, recent rounds and top wins.</DialogDescription>
        <JetXActivity />
      </DialogContent>
    </Dialog>
  </div>;
}
