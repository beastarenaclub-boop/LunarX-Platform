import type { WinGoBetControlsProps } from "../../../wingo/src/App";
import { useAuth } from "@/lib/auth";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useTimedBet } from "./AutoBet";
import { TableCoinRack, useCoinPreferences } from "./CoinSettings";
import "./wingo-betting.css";

/** The lobby edition uses the same coins and submission clock as the tables. */
export default function WinGoBetControls(props: WinGoBetControlsProps) {
  const { user } = useAuth();
  const coins = useCoinPreferences("wingo", user?.id, 10000);
  const deadline = props.closesAt === null ? null : props.closesAt - BET_SEND_BUFFER_MS;
  useTimedBet({
    roundKey: props.roundKey,
    deadline,
    expiresAt: props.closesAt === null ? null : props.closesAt - 300,
    armed: props.selected,
    enabled: props.enabled,
    submit: props.onSubmit,
  });
  return <div className="wingo-shared-betting">
    <TableCoinRack preferences={coins} chip={props.chip} onSelect={props.onSelect}
      layout="fit" unit="chips" maxValue={10000} disabled={props.locked || props.busy} />
    <div className="wingo-selected-stake">Play amount <strong>{Number.isFinite(props.chip) ? props.chip.toLocaleString("en-IN") : "—"} coins</strong></div>
    <AutoBetStatus selected={props.selected} busy={props.busy} onCancel={props.onCancel}
      seconds={props.selected && deadline !== null ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null} />
  </div>;
}
