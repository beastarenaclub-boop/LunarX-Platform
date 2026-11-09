import { useState } from "react";
import { useStore, store } from "@/game/store";
import {
  placeBet,
  cashOut,
  setPanelAmount,
  setPanelAutoCash,
  setAutoBet,
} from "@/game/engine";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Minus, Plus, X, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtINR } from "./avUtils";

const QUICK = [100, 200, 500, 1000] as const;

// The -/+ buttons are the amount control; the browser's own spinner arrows
// are redundant and sit on top of the value inside the field.
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

// Reference .buttons-block button: fills its 4px frame, 83px minimum, radius 11,
// label 24px/500 in white. The green carries a ~1px lighter inner edge (#5bc044)
// rather than being flat.
const ACTION_BTN =
  "flex h-full min-h-[83px] w-full flex-col items-center justify-center rounded-[11px] text-white transition-colors";
const ACTION_LABEL = "text-[24px] font-normal leading-none";
const ACTION_SUB = "mt-[2px] text-[24px] font-normal leading-none tabular-nums";
const ACTION_CCY = "ml-1 text-[16px] opacity-70";

// Reference auto-row switch: light grey knob on a #3a3b40 track, green track
// when on. The shared ui/switch defaults to theme colours, so override both.
// The track is resized here, so the THUMB has to be resized with it. The base
// ui/switch is h-5 w-9 with an h-4 w-4 thumb that travels translate-x-4 (16px)
// when checked — 16px of thumb plus 16px of travel is 32px inside a 26px
// track, so an ON switch overflowed its own track by ~6px and covered the
// rounds-left number sitting next to it. Track is w-26 with border-2, so the
// content box is 22px: a 10px thumb travels 12px and lands flush.
const AUTO_SWITCH =
  "h-[14px] w-[26px] data-[state=unchecked]:bg-[#3a3b40] data-[state=checked]:bg-[#36a800] " +
  "[&>span]:h-[10px] [&>span]:w-[10px] [&>span]:bg-[#c9cacd] " +
  "data-[state=checked]:[&>span]:translate-x-[12px]";

/**
 * Spribe-exact bet panel (UI_SPEC_AVIATOR.md §5).
 *
 * Layout is HORIZONTAL: stepper + 2x2 quick-chip grid on the left, the big
 * green action button on the right, whole panel ~113px tall. The Auto tab is
 * the same body plus one row of switches — the reference keeps the green Bet
 * button visible in Auto mode. Our extra auto-bet limits (rounds, stop-on-win,
 * ...) have no counterpart in the reference, so they live behind the gear.
 */
export default function AvBetPanel({
  panelIdx,
  onRemove,
  onAdd,
}: {
  panelIdx: 0 | 1;
  /** Shown on the second panel — removes it, like the reference's toggle. */
  onRemove?: () => void;
  /** Shown on the first panel when the second is hidden. */
  onAdd?: () => void;
}) {
  const roundId = useStore((s) => s.roundId);
  const countdownMs = useStore((s) => s.countdownMs);
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);
  const balance = useStore((s) => s.balance);
  const panel = useStore((s) => s.panels[panelIdx]);
  const myBets = useStore((s) => s.myBets);
  const gameDisabled = useStore((s) => s.gameDisabled);
  const autoCashoutMin = useStore((s) => s.autoCashoutMin);
  const autoCashoutMax = useStore((s) => s.autoCashoutMax);
  const freeBetCount = useStore((s) => s.freeBetCount);
  const freeBetNextAmountPaise = useStore((s) => s.freeBetNextAmountPaise);
  const useFreeBetForBets = useStore((s) => s.useFreeBetForBets);
  const maxStakeRupees = useStore((s) => s.maxStakeRupees);

  const [tab, setTab] = useState<"bet" | "auto">("bet");
  const [cashingOut, setCashingOut] = useState(false);
  // Raw text while the amount field is focused; null = show formatted.
  const [draft, setDraft] = useState<string | null>(null);
  // Same for the auto-cash-out field, so typing "1." isn't fought by toFixed(2).
  const [autoCashDraft, setAutoCashDraft] = useState<string | null>(null);
  const [autoRounds, setAutoRounds] = useState(panel.autoBet.rounds || 10);
  const [autoStopWin, setAutoStopWin] = useState(panel.autoBet.stopOnWin || 0);
  const [autoStopLoss, setAutoStopLoss] = useState(panel.autoBet.stopOnLoss || 0);
  const [autoStopBelow, setAutoStopBelow] = useState(panel.autoBet.stopOnBalanceBelow || 0);
  const [autoStopAbove, setAutoStopAbove] = useState(panel.autoBet.stopOnBalanceAbove || 0);

  const freeBetArmed = useFreeBetForBets && freeBetCount > 0;
  const freeBetStake = Math.round(Number(freeBetNextAmountPaise) || 0) / 100;

  const activeBet = panel.activeBetId ? myBets.find((b) => b.id === panel.activeBetId) : null;
  const potential = activeBet ? +(activeBet.amount * multiplier).toFixed(2) : 0;

  const amountLocked = panel.pendingBet || !!panel.activeBetId;
  const canPlace =
    phase === "betting" &&
    !panel.pendingBet && !panel.activeBetId &&
    roundId.startsWith("crash-") && countdownMs > 300 &&
    Number.isFinite(panel.amount) && panel.amount > 0 &&
    (maxStakeRupees <= 0 || panel.amount <= maxStakeRupees) &&
    (freeBetArmed ? freeBetStake > 0 : panel.amount <= balance) &&
    !gameDisabled;
  const canCancel = phase === "betting" && panel.pendingBet;
  // Cashing out an in-flight bet stays possible even if an admin disables the
  // game mid-round — a player must never lose money to a toggle.
  const canCashOut = phase === "flying" && !!panel.activeBetId;

  // The reference has no min/max hint, so the clamp has to live in the control
  // itself — otherwise the UI can build a stake the server will reject.
  const setAmount = (v: number) => {
    const capped = maxStakeRupees > 0 ? Math.min(maxStakeRupees, v) : v;
    setPanelAmount(panelIdx, capped);
  };

  // Stepper/chip presses bypass the draft so the field snaps back to the
  // formatted value instead of showing stale typed text.
  const setAmountDirect = (v: number) => {
    setDraft(null);
    setAmount(v);
  };

  // Once the round is flying `pendingAmount` is cleared but the bet is still
  // live, so read the committed stake rather than the reservation.
  const staked = activeBet?.amount ?? (panel.pendingBet ? panel.pendingAmount : null);
  const shownAmount = amountLocked ? (staked ?? panel.amount) : panel.amount;

  return (
    <div
      className={cn(
        // Reference .bet-control: radius 20, 184px tall with the Auto tab
        // present, 310px min so a pair wraps instead of squeezing, and free
        // height below 992 where it stacks. Control sizes inside are identical
        // at every width — the reference has no mobile variant.
        // The pill is pinned at the top and the Auto row at the bottom; the
        // control cluster between them is centred in whatever is left. On the
        // Bet tab that leaves slack above AND below it; switching to Auto takes
        // the slack for the Auto row, so the cluster rides up and the gap under
        // the pill closes — the card height never changes.
        "relative flex min-h-[150px] w-full flex-1 basis-[310px] flex-col items-center rounded-[11px] border bg-[#1b1c1d] p-2 min-[992px]:min-w-[310px]",
        // Desktop height is FIXED, so toggling Bet/Auto never resizes the card
        // or shoves the canvas around — the Auto row's space is reserved up
        // front and the cluster just re-centres into what is left. 184 is the
        // reference card; +34 only when our free-bet strip is on screen, since
        // the reference has no such row to budget for. Below 992 the panels are
        // stacked and scrolling, so there they grow to fit instead.
        // +26px over the reference on both: enough for the auto row to take a
        // second line without the fixed height clipping it. Desktop is usually
        // wide enough that it does not wrap, so this is headroom, not layout.
        freeBetCount > 0 ? "min-[992px]:h-[244px]" : "min-[992px]:h-[210px]",
        panel.activeBetId ? "border-[#4caf50]/50" : "border-transparent",
      )}
      data-testid={`av-bet-panel-${panelIdx}`}
    >
      {gameDisabled && !panel.activeBetId && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-[10px] bg-black/85 p-4 text-center backdrop-blur-sm">
          <div className="text-[13px] font-semibold text-white">Game temporarily disabled</div>
          <div className="max-w-[240px] text-[11px] text-[#9ea0a4]">
            New bets are paused. Please check back shortly.
          </div>
        </div>
      )}

      {/* .controls-content-top — pill pinned to the top, control row centred in
          the remaining height */}
      <div className="flex w-full flex-1 flex-col items-center">
      {/* Bet | Auto pill — reference .navigation-wrapper is 208×32 */}
      <div className="flex items-center justify-center">
        {/* Track is 206x27 on a near-black #0d0e10, not the lighter #141516. */}
        <div className="grid h-[27px] w-[206px] grid-cols-2 rounded-full bg-[#0d0e10] p-[2px]">
          {(["bet", "auto"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={cn(
                "rounded-full text-[13px] font-medium capitalize transition-colors",
                tab === v ? "bg-[#2c2d30] text-white" : "text-[#9ea0a4] hover:text-white",
              )}
              data-testid={`btn-tab-${v}-${panelIdx}`}
            >
              {v}
            </button>
          ))}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            disabled={amountLocked || panel.autoBet.enabled}
            className="absolute right-2 top-2 flex h-[29px] w-[29px] items-center justify-center rounded-full border border-[#35363a] bg-[#1e1f22] text-[#9ea0a4] transition-colors hover:text-white"
            aria-label="Remove second bet panel"
            data-testid="btn-remove-panel"
          >
            <Minus className="h-3 w-3" />
          </button>
        )}
        {onAdd && (
          <button
            onClick={onAdd}
            className="absolute right-2 top-2 flex h-[29px] w-[29px] items-center justify-center rounded-full border border-[#35363a] bg-[#1e1f22] text-[#36a800] transition-colors hover:text-white"
            aria-label="Add second bet panel"
            data-testid="btn-add-panel"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* .first-row — 140px bet block, then the action button filling
          calc(100% - 148px) beside it. */}
      <div className="flex w-full max-w-[368px] flex-1 items-center justify-center pt-2">
        <div className="w-[140px] shrink-0">
          {/* Reference .spinner.big — the whole stepper is a 140x32 #141516
              pill; the -/+ are flat 24px circles inset 4px, no outline. */}
          <div className="flex h-[32px] items-center rounded-full bg-[#141516] p-1">
            <button
              onClick={() => setAmountDirect(panel.amount - 10)}
              disabled={amountLocked}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#2e2f33] text-[#9ea0a4] transition-colors hover:text-white disabled:opacity-40"
              aria-label="Decrease bet"
              data-testid={`btn-minus-${panelIdx}`}
            >
              <Minus className="h-3 w-3" />
            </button>
            {/* The original always shows two decimals and thousands grouping
                ("24,120.00"). Formatting is dropped only while the field is
                focused so typing isn't fought by the formatter. */}
            <input
              type="text"
              inputMode="decimal"
              value={draft ?? fmtINR(shownAmount)}
              onFocus={() => !amountLocked && setDraft(String(shownAmount))}
              onBlur={() => setDraft(null)}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setDraft(v);
                const n = parseFloat(v);
                if (!Number.isNaN(n)) setAmount(n);
              }}
              readOnly={amountLocked}
              className="h-[26px] min-w-0 flex-1 border-0 bg-transparent px-0 text-center text-[16px] font-medium leading-none tabular-nums text-white outline-none disabled:opacity-60"
              data-testid={`input-amount-${panelIdx}`}
            />
            <button
              onClick={() => setAmountDirect(panel.amount + 10)}
              disabled={amountLocked}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#2e2f33] text-[#9ea0a4] transition-colors hover:text-white disabled:opacity-40"
              aria-label="Increase bet"
              data-testid={`btn-plus-${panelIdx}`}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* .bets-opt-list — 2×2 of 68×24 chips, 4px gutters */}
          <div className="mt-1 grid grid-cols-2 gap-1">
            {QUICK.map((v) => (
              <button
                key={v}
                onClick={() => setAmountDirect(v)}
                disabled={amountLocked}
                className="h-[24px] rounded-full border-0 bg-[#141516] text-[14px] font-medium leading-none text-[#9ea0a4] transition-colors hover:bg-[#33343a] hover:text-white disabled:opacity-40"
                data-testid={`btn-quick-${v}-${panelIdx}`}
              >
                {v.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
        </div>

        {/* .buttons-block — a 4px #141516 inset frame around the action button */}
        <div className="ml-[7px] flex w-[calc(100%-148px)] min-w-0 items-center justify-center rounded-[16px] border-4 border-[#141516]">
          {canCashOut ? (
            <button
              onClick={async () => {
                setCashingOut(true);
                try { await cashOut(panelIdx); } finally { setCashingOut(false); }
              }}
              disabled={cashingOut}
              className={cn(
                ACTION_BTN,
                "bg-[#e8a30c] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-[#f5b120]",
                cashingOut && "opacity-70",
              )}
              data-testid={`btn-cashout-${panelIdx}`}
            >
              {/* The bet is still live until the server confirms. Showing
                  "Cashing out…" rather than the settled amount keeps the UI
                  from promising money that a rejection would take back. */}
              <span className={ACTION_LABEL}>{cashingOut ? "Cashing out…" : "Cash Out"}</span>
              <span className={ACTION_SUB}>
                {fmtINR(potential)}
                <span className={ACTION_CCY}>INR</span>
              </span>
            </button>
          ) : canCancel ? (
            <button
              disabled
              className={cn(ACTION_BTN, "bg-[#c02626] hover:bg-[#d63030]")}
              data-testid={`bet-accepted-${panelIdx}`}
            >
              <span className="text-[20px]">{panel.activeBetId ? "Bet placed" : "Placing bet…"}</span>
              <span className={ACTION_SUB}>
                {fmtINR(staked ?? panel.pendingAmount)}
                <span className={ACTION_CCY}>INR</span>
              </span>
            </button>
          ) : (
            <button
              onClick={() => placeBet(panelIdx)}
              disabled={!canPlace}
              className={cn(
                ACTION_BTN,
                "bg-[#36a800] shadow-[inset_0_0_0_1px_#5bc044] hover:bg-[#3fc000] disabled:cursor-not-allowed disabled:opacity-55",
              )}
              data-testid={`btn-bet-${panelIdx}`}
            >
              {/* The reference shows "Bet" in every idle phase — there is no
                  separate green "Next round" label. */}
              <span className={ACTION_LABEL}>Bet</span>
              <span className={ACTION_SUB}>
                {freeBetArmed ? `FREE ${fmtINR(freeBetStake)}` : fmtINR(panel.amount)}
                <span className={ACTION_CCY}>INR</span>
              </span>
            </button>
          )}
        </div>
      </div>
      </div>

      {/* .controls-content-bottom — pinned to the card's bottom edge, so the
          Auto row lands in the space the Bet tab leaves empty. Reversed so the
          Auto row hugs the edge and our free-bet row sits above it. */}
      <div className="flex w-full flex-col-reverse items-center">
      {tab === "auto" && (
        <div className="flex w-full flex-col items-center">
        <div className="h-px w-full bg-[#141516]" />
        {/* .second-row — 12px type, ends pushed apart.
            WRAPS, and is min-height rather than fixed height. Two things go
            wrong otherwise in a narrow panel (mobile, or a partner iframe,
            which is the launch profile): without nowrap the labels break
            mid-phrase — "Auto Cash Out" becomes three stacked lines — and with
            nowrap alone they instead overflow a fixed 39px row and get
            clipped. Letting the two clusters drop onto their own lines is the
            only version that stays readable at every width. Desktop is wide
            enough that they never wrap, so the fixed panel height above is
            unaffected. */}
        <div className="mx-auto flex min-h-[39px] w-full max-w-[390px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2 py-1.5">
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-[#cccccc]">
            Auto bet
            <Switch
              checked={panel.autoBet.enabled}
              onCheckedChange={(on) =>
                setAutoBet(panelIdx, {
                  enabled: on,
                  rounds: autoRounds,
                  stopOnWin: autoStopWin,
                  stopOnLoss: autoStopLoss,
                  stopOnBalanceBelow: autoStopBelow,
                  stopOnBalanceAbove: autoStopAbove,
                })
              }
              className={AUTO_SWITCH}
              data-testid={`switch-autobet-${panelIdx}`}
            />
            {panel.autoBet.enabled && (
              // Rounds still to be auto-bet. Number only: this is the
              // tightest row in the panel, and a label costs width exactly
              // where there is none.
              <span className="shrink-0 whitespace-nowrap tabular-nums text-[#4caf50]">
                {panel.autoBet.roundsLeft}
              </span>
            )}
          </label>

          {/* Right-hand cluster: the reference pushes Auto Cash Out, its value
              and the clear button to the far edge of the row. */}
          <div className="flex shrink-0 items-center gap-1.5">
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-[#cccccc]">
            Auto Cash Out
            <Switch
              checked={panel.autoCashOutEnabled}
              onCheckedChange={(on) => setPanelAutoCash(panelIdx, on, panel.autoCashOut)}
              className={AUTO_SWITCH}
              data-testid={`switch-autocash-${panelIdx}`}
            />
          </label>

          <div className="flex items-center gap-1">
            {/* 94x26 pill on #26272b. Always two decimals, and greyed until its
                own toggle is on — the value is inert while the switch is off. */}
            <input
              type="text"
              inputMode="decimal"
              value={
                autoCashDraft ?? panel.autoCashOut.toFixed(2)
              }
              onFocus={() => setAutoCashDraft(String(panel.autoCashOut))}
              onBlur={() => setAutoCashDraft(null)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.]/gu, "");
                setAutoCashDraft(raw);
                const n = parseFloat(raw);
                if (!Number.isNaN(n)) {
                  setPanelAutoCash(
                    panelIdx,
                    true,
                    Math.min(autoCashoutMax, Math.max(autoCashoutMin, n)),
                  );
                }
              }}
              className={cn(
                "h-[26px] w-[94px] rounded-full bg-[#26272b] px-2 text-center text-[12px] font-medium leading-none tabular-nums outline-none",
                panel.autoCashOutEnabled ? "text-white" : "text-[#8a8c90]",
                NO_SPINNER,
              )}
              data-testid={`input-autocash-${panelIdx}`}
            />
            <button
              onClick={() => setPanelAutoCash(panelIdx, false)}
              className="text-[#6b6b6b] transition-colors hover:text-white"
              aria-label="Clear auto cash out"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Ours, not the reference's: the only way to reach the auto-bet
              limits (rounds, stop-on-win/loss, balance guards). */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-[#6b6b6b] transition-colors hover:text-white"
                aria-label="Auto bet limits"
                data-testid={`btn-auto-limits-${panelIdx}`}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-2 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9ea0a4]">
                Auto bet limits
              </div>
              {(
                [
                  ["Number of rounds", autoRounds, setAutoRounds],
                  ["Stop if win exceeds", autoStopWin, setAutoStopWin],
                  ["Stop if loss exceeds", autoStopLoss, setAutoStopLoss],
                  ["Stop if balance below", autoStopBelow, setAutoStopBelow],
                  ["Stop if balance above", autoStopAbove, setAutoStopAbove],
                ] as const
              ).map(([label, val, set]) => (
                <label key={label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[#9ea0a4]">{label}</span>
                  <Input
                    type="number"
                    value={val}
                    onChange={(e) => set(parseFloat(e.target.value) || 0)}
                    className={cn("h-7 w-20 text-center text-[11px]", NO_SPINNER)}
                  />
                </label>
              ))}
            </PopoverContent>
          </Popover>
          </div>
        </div>
        </div>
      )}

      {/* Free bets are ours, not the reference's — kept to one compact row. */}
      {freeBetCount > 0 && (
        <div className="mx-auto mb-1 mt-1.5 flex w-fit items-center gap-2 rounded-full border border-[#4caf50]/30 bg-[#123405]/50 px-2.5 py-0.5">
          <span className="text-[11px] text-white/85">
            Free bet <span className="font-semibold tabular-nums">{fmtINR(freeBetStake)}</span>{" "}
            <span className="text-[#9ea0a4]">×{freeBetCount}</span>
          </span>
          <Switch
            checked={useFreeBetForBets}
            onCheckedChange={(c) => store.setState({ useFreeBetForBets: c })}
            disabled={amountLocked}
            className="h-[14px] w-[26px]"
            data-testid={`switch-free-bet-${panelIdx}`}
          />
        </div>
      )}
      </div>
    </div>
  );
}
