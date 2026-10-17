import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "@/game/store";
import { BET_SEND_BUFFER_MS } from "../table/AutoBet";
import JetXFlightCanvas from "./JetXFlightCanvas";
import { jetxPlayers } from "./jetxPlayers";
import { Users, Wifi } from "lucide-react";
import { useJetXPreferences } from "./jetxPreferences";

/** The live flight scene follows the server round; controls remain native UI. */
export default function JetXScene() {
  const phase = useStore(s => s.phase);
  const multiplier = useStore(s => s.multiplier);
  const countdownMs = useStore(s => s.countdownMs);
  const countdownTotalMs = useStore(s => s.countdownTotalMs);
  const gameDisabled = useStore(s => s.gameDisabled);
  const roundId = useStore(s => s.roundId);
  const live = useStore(s => s.liveBets);
  const realLive = useStore(s => s.realLiveBetsActive);
  const myBets = useStore(s => s.myBets);
  const previousRound = useStore(s => s.rounds[0]?.id);
  const connecting = roundId === "connecting";
  const seconds = Math.ceil(Math.max(0, countdownMs - BET_SEND_BUFFER_MS) / 1000);
  const remaining = Math.max(0, Math.min(100, (countdownMs - BET_SEND_BUFFER_MS) / Math.max(1, countdownTotalMs - BET_SEND_BUFFER_MS) * 100));
  const players = jetxPlayers(roundId, live, realLive, myBets);
  const { topWinner } = useJetXPreferences();
  const previousReceipts = myBets.filter(b => b.roundId === previousRound && b.cashedOutAt != null);
  const [lastWins, setLastWins] = useState({ count: previousReceipts.length, payout: previousReceipts.reduce((sum, bet) => sum + bet.payout, 0) });
  const observed = useRef({ round: roundId, count: 0, payout: 0 });
  useEffect(() => {
    if (observed.current.round !== roundId) setLastWins({ count: observed.current.count, payout: observed.current.payout });
    const winners = jetxPlayers(roundId, live, realLive, myBets).filter(b => b.cashedOutAt != null);
    observed.current = { round: roundId, count: winners.length, payout: winners.reduce((sum, bet) => sum + bet.payout, 0) };
  }, [roundId, live, realLive, myBets]);
  return <div className="jetx-scene" data-phase={phase} data-testid="jetx-scene">
    <JetXFlightCanvas />
    <div className="jetx-flight-meta">
      {topWinner && phase === "betting" && lastWins.payout > 0 && <div className="jetx-winners-banner">{lastWins.count} {lastWins.count === 1 ? "bet has" : "bets have"} won&nbsp; ₹ {lastWins.payout.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
      <div className="jetx-flight-status"><span><Wifi />{connecting ? "Connecting" : "Live"} · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span><span><Users />{players.length} Bets</span></div>
    </div>
    <div className="jetx-flight-center">
      <div className="jetx-aircraft" aria-hidden="true" />
      <div className="jetx-readout">
        {connecting ? <p className="jetx-place-bet" role="status">Connecting…</p> : phase === "betting" ? <>
          <div className="jetx-countdown" data-testid="jetx-countdown" data-urgent={seconds <= 1} style={{ "--jetx-countdown": `${remaining}%` } as CSSProperties}><span>{seconds}</span></div>
          <p className="jetx-place-bet" role="status">{gameDisabled ? "Betting paused" : seconds > 0 ? "Place a bet" : "Taking off"}</p>
        </> : <>
          {phase === "crashed" && <p className="jetx-flew-away" role="status">Flew Away!</p>}
          <div className="jetx-multiplier" data-testid="jetx-multiplier">{multiplier.toFixed(2)}<span>x</span></div>
        </>}
      </div>
      <div className="jetx-bet-count">{players.length} Bets</div>
    </div>
  </div>;
}
