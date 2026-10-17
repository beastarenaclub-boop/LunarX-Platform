import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletBalanceQueryKey, getGetWalletBalancesQueryKey, useGetWalletBalance } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { playGameSound, unlockAudio } from "@/game/audio";
import WinGoGame from "../../wingo/src/App";
import WinGoBetControls from "@/components/table/WinGoBetControls";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import GameViewport from "@/components/GameViewport";
import { GameInformationSection, GameInformationDrawer, GameInformationTarget, restoreGameInformationFocus } from "@/components/game/GameInformation";
import { Dialog, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "../../wingo/src/styles.css";
import "../../wingo/src/layout.css";
import "../../wingo/src/lunar.css";

function Secondary({ children }: { children: ReactNode }) {
  return <GameInformationSection><div className="wingo-theme">{children}</div></GameInformationSection>;
}

function Information() {
  return <Dialog>
    <DialogTrigger asChild><button className="icon-button" data-testid="btn-game-rules" aria-label="Lunar Colour Trading information"><Info size={19} /></button></DialogTrigger>
    <GameInformationDrawer onCloseAutoFocus={restoreGameInformationFocus} className="bg-white text-slate-800">
      <DialogTitle>Lunar Colour Trading</DialogTitle>
      <DialogDescription>Game guide, recent results and your activity.</DialogDescription>
      <GameInformationTarget />
    </GameInformationDrawer>
  </Dialog>;
}

/** Keep the round and betting controls together; secondary panels use the drawer. */
export default function WinGo() {
  const sound = useStore(s => s.settings.sound);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const wallet = useGetWalletBalance(undefined, { query: {
    queryKey: getGetWalletBalanceQueryKey(), enabled: !!user, refetchInterval: 5000,
  } });
  const refreshWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
  };
  return <GameViewport game="wingo"><WinGoGame key={user?.id} onBackToLobby={() => navigate("/")} BetControls={WinGoBetControls}
    audioBridge={{ enabled: sound, setEnabled: enabled => { void unlockAudio(); updateSettings({ sound: enabled }); }, play: cue => playGameSound(cue, "wingo") }}
    onOpenWallet={() => navigate("/wallet")} walletBalance={wallet.data?.balance} onWalletChange={refreshWallet}
    Secondary={Secondary} informationButton={<Information />} /></GameViewport>;
}
