import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet } from "../table/AutoBet";
import { unlockAudio } from "@/game/audio";
import { useEffect, useId, useState } from "react";
import { useStore, store } from "@/game/store";
import {
  placeBet,
  cancelBet,
  cashOut,
  setPanelAmount,
  setPanelAutoCash,
  setAutoBet,
} from "@/game/engine";
import { t } from "@/game/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import { useAuth } from "@/lib/auth";

interface Props {
  panelIdx: 0 | 1;
}

const mountedPanels = [0, 0];

export default function BetPanel({ panelIdx }: Props) {
  const inputId = useId();
  const { user } = useAuth();
  useEffect(() => {
    mountedPanels[panelIdx]++;
    return () => {
      mountedPanels[panelIdx]--;
      if (mountedPanels[panelIdx] === 0) store.setState(s => ({
        panels: s.panels.map((p, i) => i === panelIdx ? { ...p, selectedRoundId: null } : p) as typeof s.panels,
      }));
    };
  }, [panelIdx]);
  const lang = useStore((s) => s.settings.language);
  const isJetX = useStore(s => s.activeGameCode === "jetx");
  const isFury = useStore(s => s.activeGameCode === "fury");
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);
  const balance = useStore((s) => s.balance);
  const panel = useStore((s) => s.panels[panelIdx]);
  const myBets = useStore((s) => s.myBets);
  const gameDisabled = useStore((s) => s.gameDisabled);
  const autoCashoutMin = useStore((s) => s.autoCashoutMin);
  const autoCashoutMax = useStore((s) => s.autoCashoutMax);
  const useBonusForBets = useStore((s) => s.useBonusForBets);
  const freeBetCount = useStore((s) => s.freeBetCount);
  const freeBetNextAmountPaise = useStore((s) => s.freeBetNextAmountPaise);
  const useFreeBetForBets = useStore((s) => s.useFreeBetForBets);
  const maxStakeRupees = useStore((s) => s.maxStakeRupees);
  const coins = useCoinPreferences("crash", user?.id, maxStakeRupees || Infinity);
  const freeBetArmed = useFreeBetForBets && freeBetCount > 0;
  const freeBetStake = Math.round(Number(freeBetNextAmountPaise) || 0) / 100;

  type BetTab = "bet" | "auto";
  const [tab, setTab] = useState<BetTab>("bet");
  const [autoRounds, setAutoRounds] = useState(panel.autoBet.rounds || 10);
  const [autoStopWin, setAutoStopWin] = useState(panel.autoBet.stopOnWin || 0);
  const [autoStopLoss, setAutoStopLoss] = useState(panel.autoBet.stopOnLoss || 0);
  const [autoStopBelow, setAutoStopBelow] = useState(panel.autoBet.stopOnBalanceBelow || 0);
  const [autoStopAbove, setAutoStopAbove] = useState(panel.autoBet.stopOnBalanceAbove || 0);

  const activeBet = panel.activeBetId
    ? myBets.find((b) => b.id === panel.activeBetId)
    : null;
  const potential = activeBet ? +(activeBet.amount * multiplier).toFixed(2) : 0;

  const roundId = useStore(s => s.roundId);
  const countdownMs = useStore(s => s.countdownMs);
  const selectedRound = panel.selectedRoundId;
  const setSelectedRound = (roundId: string | null) => store.setState(s => ({
    panels: s.panels.map((p, i) => i === panelIdx ? { ...p, selectedRoundId: roundId } : p) as typeof s.panels,
  }));
  const setQuick = (v: number) => {
    if (amountLocked || panel.autoBet.enabled) return;
    setPanelAmount(panelIdx, v);
    unlockAudio();
    if (phase === "betting" && countdownMs > BET_SEND_BUFFER_MS) setSelectedRound(roundId);
  };
  const adj = (factor: number) => setQuick(panel.amount * factor);
  const inc = (v: number) => setQuick(panel.amount + v);

  const canPlace =
    phase === "betting" &&
    !panel.pendingBet &&
    // Free bets don't touch the wallet, so the balance check only applies
    // to normal cash/bonus stakes.
    (freeBetArmed ? freeBetStake > 0 : panel.amount <= balance) &&
    !gameDisabled;
  const canCancel = phase === "betting" && panel.pendingBet;
  // Players can ALWAYS cash out an in-flight bet, even if an admin disables
  // the game mid-round — they shouldn't lose money to an admin toggle.
  const canCashOut = phase === "flying" && !!panel.activeBetId;
  // Stake is reserved at placeBet — lock amount controls until cancel/round start.
  const amountLocked = panel.pendingBet || !!panel.activeBetId;

  useTimedBet({
    roundKey: roundId,
    deadline: Date.now() + countdownMs - BET_SEND_BUFFER_MS,
    expiresAt: Date.now() + countdownMs - 300,
    armed: selectedRound === roundId,
    enabled: canPlace && !panel.autoBet.enabled,
    submit: () => {
      // Desktop and mobile can mount the same panel at once. Claim the
      // shared selection synchronously so only one instance can submit it.
      if (store.getState().panels[panelIdx].selectedRoundId !== roundId) return;
      setSelectedRound(null);
      return placeBet(panelIdx);
    },
  });
  const selectionStatus = (
    <AutoBetStatus
      className={isFury ? undefined : "crash-bet-action"}
      selected={phase === "betting" && selectedRound === roundId}
      seconds={phase === "betting" && selectedRound === roundId ? Math.ceil(Math.max(0, countdownMs - BET_SEND_BUFFER_MS) / 1000) : null}
      onCancel={() => setSelectedRound(null)}
    />
  );
  return (
    <div
      className={cn(
        "crash-bet-panel relative flex flex-col gap-3 p-3 lg:gap-2 lg:p-2.5 rounded-2xl border bg-[#101010]",
        panel.activeBetId ? "border-accent/50" : "border-card-border",
      )}
      data-testid={`bet-panel-${panelIdx}`}
    >
      {isJetX && <div className="jetx-bet-heading"><span><b>{String(panelIdx + 1).padStart(2, "0")}</b> Bet panel</span><small>{canCashOut ? "IN FLIGHT" : canCancel ? "BET PLACED" : "CHOOSE YOUR STAKE"}</small></div>}
      {isFury && <span className="fury-bet-caption">BET <b>{String(panelIdx + 1).padStart(2, "0")}</b></span>}
      {gameDisabled && !panel.activeBetId && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-background/85 backdrop-blur-sm text-center p-4"
          data-testid={`overlay-disabled-${panelIdx}`}
        >
          <div className="text-sm font-semibold text-foreground">
            Game temporarily disabled
          </div>
          <div className="text-xs text-muted-foreground max-w-[220px]">
            New bets are paused. Please check back shortly.
          </div>
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as BetTab)}>
        <TabsList className="grid grid-cols-2 w-56 max-w-full mx-auto h-8 max-[499px]:h-11 rounded-full bg-black/60 p-0.5">
          <TabsTrigger value="bet" className="text-xs touch-target-sm rounded-full">{t(lang, "bet")}</TabsTrigger>
          <TabsTrigger value="auto" className="text-xs touch-target-sm rounded-full">{t(lang, "autoBet")}</TabsTrigger>
        </TabsList>

        <TabsContent value="bet" className="crash-bet-manual mt-3 space-y-3 lg:mt-2 lg:space-y-2">
          {isJetX && <label className="jetx-amount-label" htmlFor={`${inputId}-amount`}>BET AMOUNT <span>INR</span></label>}
          {/* Amount row */}
          <div className="crash-amount-controls flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 max-[499px]:h-11 max-[499px]:w-11 shrink-0 rounded-full"
              onClick={() => inc(-10)}
              disabled={amountLocked}
              data-testid={`btn-amount-minus-${panelIdx}`}
              aria-label={`Decrease bet ${panelIdx + 1} amount`}
            >
              <Minus className="w-4 h-4" />
            </Button>
            <Input
              type="number"
              value={amountLocked ? activeBet?.amount ?? panel.pendingAmount : panel.amount}
              onChange={(e) => setQuick(parseFloat(e.target.value) || 1)}
              className="text-center font-mono font-bold text-lg h-10 max-[499px]:h-11 min-w-0 tabular-nums"
              min={1}
              disabled={amountLocked}
              readOnly={amountLocked}
              data-testid={`input-amount-${panelIdx}`}
              id={isJetX ? `${inputId}-amount` : undefined}
              aria-label={`Bet ${panelIdx + 1} amount`}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 max-[499px]:h-11 max-[499px]:w-11 shrink-0 rounded-full"
              onClick={() => inc(10)}
              disabled={amountLocked}
              data-testid={`btn-amount-plus-${panelIdx}`}
              aria-label={`Increase bet ${panelIdx + 1} amount`}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Coin chips — same ten denominations as every other game */}
          <TableCoinRack preferences={coins}
            chip={amountLocked ? panel.pendingAmount : panel.amount}
            onSelect={setQuick}
            idSuffix={`-lunar-${panelIdx}`}
            layout="fit"
            disabled={amountLocked}
            maxValue={maxStakeRupees || Infinity}
          />

          {/* ½  2× row */}
          <div className="crash-amount-multipliers grid grid-cols-2 gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs border border-border max-[499px]:h-11" onClick={() => adj(0.5)} disabled={amountLocked}>
              ½
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs border border-border max-[499px]:h-11" onClick={() => adj(2)} disabled={amountLocked}>
              2×
            </Button>
          </div>

          {/* Min / max stake hint */}
          <div
            className="text-[10px] text-muted-foreground text-center"
            data-testid={`text-stake-limits-${panelIdx}`}
          >
            Min ₹1.00
            {maxStakeRupees > 0 && <> • Max ₹{maxStakeRupees.toFixed(2)}</>}
          </div>

          {/* Use free bet (only when the player has grants) */}
          {(isJetX || isFury) && <div className="jetx-auto-cash">
            <label htmlFor={`${inputId}-auto-cash`}>Auto cash out</label>
            <Switch id={`${inputId}-auto-cash`} checked={panel.autoCashOutEnabled} disabled={amountLocked}
              onCheckedChange={enabled => setPanelAutoCash(panelIdx, enabled, panel.autoCashOut)} />
            <div><Input type="number" aria-label={`Bet ${panelIdx + 1} auto cash out multiplier`} value={panel.autoCashOut}
              disabled={amountLocked || !panel.autoCashOutEnabled} min={autoCashoutMin} max={autoCashoutMax} step={.1}
              onChange={e => setPanelAutoCash(panelIdx, true, parseFloat(e.target.value) || autoCashoutMin)} /><span>×</span></div>
          </div>}
          {freeBetCount > 0 && (
            <div
              className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-md px-3 py-2"
              data-testid={`row-use-free-bet-${panelIdx}`}
            >
              <span className="text-xs text-foreground">
                Free bet{" "}
                <span className="font-mono font-semibold">
                  ₹{freeBetStake.toFixed(2)}
                </span>{" "}
                <span className="text-muted-foreground">×{freeBetCount}</span>
              </span>
              <Switch
                checked={useFreeBetForBets}
                onCheckedChange={(c) => store.setState({ useFreeBetForBets: c })}
                disabled={amountLocked}
                data-testid={`switch-use-free-bet-${panelIdx}`}
              />
            </div>
          )}

          {/* Action button */}
          {canCashOut ? (
            <>
              <Button
                size="lg"
              className="crash-bet-action w-full h-16 text-base font-bold bg-accent hover:bg-accent/90 text-accent-foreground animate-pulse-glow sticky-cashout"
                onClick={() => cashOut(panelIdx)}
                data-game-bet data-testid={`btn-cashout-${panelIdx}`}
              >
                <div className="flex flex-col items-center">
                  <span>{t(lang, "cashOut")}</span>
                  <span className="max-w-full break-all px-1 font-mono text-xl leading-tight">₹{potential.toFixed(2)}</span>
                </div>
              </Button>
              <div className="sticky-cashout-spacer" aria-hidden />
            </>
          ) : canCancel ? (
            <Button
              size="lg"
              variant="destructive"
              className="crash-bet-action w-full h-16 text-base font-bold"
              onClick={() => cancelBet(panelIdx)}
              data-game-bet data-testid={`btn-cancel-${panelIdx}`}
            >
              {panel.activeBetId ? "Bet accepted" : "Placing bet…"}
              <span className="ml-2 min-w-0 break-all font-mono leading-tight">₹{panel.pendingAmount.toFixed(2)}</span>
            </Button>
          ) : (
            isFury ? (
              <div className="crash-bet-action fury-bet-selection">
                <strong>₹{panel.amount.toFixed(2)} <small>INR</small></strong>
                {selectionStatus}
              </div>
            ) : selectionStatus
          )}
        </TabsContent>

        <TabsContent value="auto" className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={amountLocked ? activeBet?.amount ?? panel.pendingAmount : panel.amount}
              onChange={(e) => setQuick(parseFloat(e.target.value) || 1)}
              className="text-center font-mono h-9"
              min={1}
              disabled={amountLocked}
              readOnly={amountLocked}
            />
            <Input
              type="number"
              value={panel.autoCashOut}
              disabled={amountLocked}
              onChange={(e) =>
                setPanelAutoCash(panelIdx, true, parseFloat(e.target.value) || autoCashoutMin)
              }
              step={0.1}
              min={autoCashoutMin}
              max={autoCashoutMax}
              className="text-center font-mono h-9 w-24"
              placeholder="@x"
            />
          </div>

          <div className="space-y-2 text-xs">
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">{t(lang, "autoBetRounds")}</span>
              <Input
                type="number"
                value={autoRounds}
                onChange={(e) => setAutoRounds(parseInt(e.target.value) || 1)}
                min={1}
                max={500}
                className="w-20 h-7 text-center"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">{t(lang, "stopOnWin")}</span>
              <Input
                type="number"
                value={autoStopWin}
                onChange={(e) => setAutoStopWin(parseFloat(e.target.value) || 0)}
                className="w-20 h-7 text-center"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">{t(lang, "stopOnLoss")}</span>
              <Input
                type="number"
                value={autoStopLoss}
                onChange={(e) => setAutoStopLoss(parseFloat(e.target.value) || 0)}
                className="w-20 h-7 text-center"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">{t(lang, "stopOnBalanceBelow")}</span>
              <Input
                type="number"
                value={autoStopBelow}
                onChange={(e) => setAutoStopBelow(parseFloat(e.target.value) || 0)}
                className="w-20 h-7 text-center"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">{t(lang, "stopOnBalanceAbove")}</span>
              <Input
                type="number"
                value={autoStopAbove}
                onChange={(e) => setAutoStopAbove(parseFloat(e.target.value) || 0)}
                className="w-20 h-7 text-center"
              />
            </label>
          </div>

          {panel.autoBet.enabled ? (
            <Button
              variant="destructive"
              className="w-full h-12 font-bold"
              onClick={() => setAutoBet(panelIdx, { enabled: false })}
            >
              {t(lang, "stop")} ({panel.autoBet.roundsLeft})
            </Button>
          ) : (
            <Button
              className="w-full h-14 text-base font-bold rounded-2xl bg-[#28a909] hover:bg-[#36c210] text-white border border-white/25"
              onClick={() => {
                setPanelAutoCash(panelIdx, true, panel.autoCashOut);
                setAutoBet(panelIdx, {
                  enabled: true,
                  rounds: autoRounds,
                  stopOnWin: autoStopWin,
                  stopOnLoss: autoStopLoss,
                  stopOnBalanceBelow: autoStopBelow,
                  stopOnBalanceAbove: autoStopAbove,
                });
              }}
            >
              {t(lang, "start")}
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
