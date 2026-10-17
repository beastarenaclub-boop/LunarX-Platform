import { Undo2, Trash2, RotateCcw } from "lucide-react";
import { ROULETTE_COIN_VALUES } from "@workspace/api-zod/roulette-game";
import { TableCoinRack, type useCoinPreferences } from "@/components/table/CoinSettings";
import { AutoBetStatus } from "@/components/table/AutoBet";
import BettingBoard from "./BettingBoard";
import { betKey, betLabel, pocketColorHex, type PlacedBet } from "./wheelData";

interface Props {
  coins: ReturnType<typeof useCoinPreferences>;
  bets: Map<string, PlacedBet>;
  onPlace: (spot: Omit<PlacedBet, "amount">) => void;
  disabled: boolean;
  placing: boolean;
  automatic: boolean;
  setAutomatic: (value: boolean) => void;
  onSubmit: () => void;
  onClear: () => void;
  onUndo: () => void;
  onRebet: () => void;
  canUndo: boolean;
  canRebet: boolean;
  total: number;
  balance: string;
  placed: string;
  phase: string | null;
  remainingMs: number;
  durationMs: number;
  result: number | null;
  payoutBase: number;
}

const money = (paise: string) => (Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export default function RouletteBetPanel(props: Props) {
  const betting = props.phase === "betting";
  return <section className="roulette-betting-panel" data-testid="roulette-betting-dock" aria-label="Roulette betting controls">
    <div className="roulette-bet-toolbar">
    <div className="roulette-bet-clock" data-phase={props.phase}>
      <span>{betting ? "BETTING OPEN" : props.result !== null ? "WINNING NUMBER" : "BETS CLOSED · WHEEL SPINNING"}</span>
      {betting ? <strong data-testid="roulette-betting-seconds">{Math.max(0, Math.ceil(props.remainingMs / 1000))}<small>s</small></strong>
        : props.result !== null ? <strong className="roulette-pocket-badge" style={{ background: pocketColorHex(props.result) }}>{props.result}</strong> : <span className="roulette-waiting-dot" />}
      <div className="roulette-bet-progress" style={{ width: `${betting ? Math.min(100, Math.max(0, props.remainingMs / Math.max(1, props.durationMs) * 100)) : 0}%` }} />
    </div>
    <div className="roulette-wallet"><span>Balance</span><strong data-testid="roulette-wallet">₹{money(props.balance)}</strong></div>
    </div>
    <div className="roulette-bet-scroll">
    <div className="roulette-board-wrap" data-testid="roulette-board">
      <BettingBoard bets={props.bets} onPlace={props.onPlace} disabled={props.disabled} highlight={props.result} payoutBase={props.payoutBase} />
    </div>
    <div className="roulette-selected-bets" aria-label="Selected bets">
      {[...props.bets.values()].map(bet => <span key={betKey(bet)} data-testid={`roulette-staged-${betKey(bet)}`}>{betLabel(bet)} <b>₹{bet.amount.toLocaleString("en-IN")}</b></span>)}
    </div>
    <details className="roulette-bet-details">
    <summary>Limits &amp; payouts <span>Single number {props.payoutBase}×</span></summary>
    <div className="roulette-limit-strip" data-testid="roulette-bet-limits">
      <span>Single number <b>₹10–₹20,000</b></span><span>Other bets <b>₹10–₹1,00,000</b></span>
    </div>
    <div className="roulette-paytable" data-testid="roulette-paytable">
      {[["Single", 1], ["Split", 2], ["Street", 3], ["Corner", 4], ["Line", 6], ["Dozen", 12], ["Outside", 18]].map(([label, count]) => <span key={label}>{label}<b>{(props.payoutBase / Number(count)).toLocaleString("en-IN", { maximumFractionDigits: 4 })}×</b></span>)}
    </div>
    <p className="roulette-bet-note">Returns include your stake. Limits include earlier bets on the same selection this round. Select again for each new round.</p>
    </details>
    </div>
    <div className="roulette-bet-dock-controls">
    <div className="roulette-coin-section">
      <div className="roulette-coin-heading"><span>SELECT COIN</span><span>Selected <b>₹{props.coins.chip.toLocaleString("en-IN")}</b></span></div>
      <TableCoinRack preferences={props.coins} availableValues={ROULETTE_COIN_VALUES} chip={props.coins.chip} onSelect={props.coins.selectChip} layout="fit" minValue={10} maxValue={100000} disabled={props.placing} />
    </div>
    <div className="roulette-slip-summary"><span>Selected <b data-testid="text-total-staked">₹{props.total.toLocaleString("en-IN")}</b></span><span>Placed this round <b>₹{money(props.placed)}</b></span></div>
    <div className="roulette-bet-actions">
      <button type="button" onClick={props.onUndo} disabled={!props.canUndo || props.disabled} aria-label="Undo" data-testid="btn-undo"><Undo2 size={16} />Undo</button>
      <button type="button" onClick={props.onClear} disabled={!props.bets.size || props.placing} aria-label="Clear" data-testid="btn-clear"><Trash2 size={16} />Clear</button>
      <button type="button" onClick={props.onRebet} disabled={!props.canRebet || props.disabled} aria-label="Rebet" data-testid="btn-rebet"><RotateCcw size={16} />Rebet</button>
      <label className="roulette-auto-switch"><input type="checkbox" checked={props.automatic} disabled={props.placing} onChange={event => props.setAutomatic(event.target.checked)} /><span>Auto bet</span></label>
    </div>
    {props.automatic ? <AutoBetStatus selected={props.bets.size > 0} busy={props.placing} onCancel={props.onClear} />
      : <button type="button" className="roulette-submit" onClick={props.onSubmit} disabled={props.disabled || !props.bets.size} data-testid="roulette-submit">{props.placing ? "Placing bet…" : `Place ₹${props.total.toLocaleString("en-IN")} bet`}</button>}
    </div>
  </section>;
}
