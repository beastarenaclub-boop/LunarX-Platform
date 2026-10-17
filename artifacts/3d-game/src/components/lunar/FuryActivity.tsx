import { History, Trophy, Users } from "lucide-react";
import { useStore } from "@/game/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Only server-backed bets are shown; the shared engine's atmosphere is excluded. */
export default function FuryActivity() {
  const liveBets = useStore(s => s.liveBets);
  const realLive = useStore(s => s.realLiveBetsActive);
  const roundId = useStore(s => s.roundId);
  const history = useStore(s => s.history);
  const myBets = useStore(s => s.myBets);
  const phase = useStore(s => s.phase);
  const players = realLive ? liveBets.filter(bet => bet.roundId === roundId) : [];
  const winners = players.filter(bet => bet.cashedOutAt != null).sort((a, b) => b.payout - a.payout);
  const totalReturn = winners.reduce((sum, bet) => sum + bet.payout, 0);

  return <Tabs defaultValue="live" className="fury-activity">
    <TabsList className="fury-activity-tabs" aria-label="Flight activity">
      <TabsTrigger value="live">Live Bets</TabsTrigger>
      <TabsTrigger value="top">Top Bets</TabsTrigger>
      <TabsTrigger value="mine">My Bets</TabsTrigger>
    </TabsList>
    <div className="fury-activity-summary">
      <div><span>Total return · INR</span><strong>{money(totalReturn)}</strong></div>
      <div><span>Previous round</span><strong className="fury-yellow">{history[0] != null ? `${history[0].toFixed(2)}×` : "—"}</strong></div>
    </div>
    {(["live", "top"] as const).map(tab => <TabsContent key={tab} value={tab} className="fury-activity-content">
      <div className="fury-bet-row fury-table-head"><span>Player</span><span>Bet ₹</span><span>×</span><span>Return ₹</span></div>
      <div className="fury-activity-scroll">
        {(tab === "live" ? players : winners).map(bet => <div className="fury-bet-row" data-cashed-out={bet.cashedOutAt != null} key={bet.id}>
          <span className="fury-player" title="Player name is hidden">{bet.name.slice(0, 1)}*{bet.name.slice(-1)}</span>
          <span>{money(bet.amount)}</span><span>{bet.cashedOutAt?.toFixed(2) ?? "—"}</span>
          <span>{bet.cashedOutAt != null ? money(bet.payout) : "—"}</span>
        </div>)}
        {!(tab === "live" ? players : winners).length && <div className="fury-activity-empty">
          {tab === "live" ? <Users size={26} /> : <Trophy size={26} />}
          <strong>{tab === "live" ? "Ready for takeoff" : "The sky is the limit"}</strong>
          <p>{tab === "live" ? "Bets appear here when players join this flight." : "Cash outs from this round appear here, highest return first."}</p>
        </div>}
      </div>
    </TabsContent>)}
    <TabsContent value="mine" className="fury-activity-content">
      <div className="fury-my-heading">Your flight history<span>{myBets.length} bets</span></div>
      <div className="fury-activity-scroll">
        {[...myBets].reverse().slice(0, 50).map(bet => <div className="fury-my-bet" key={bet.id}>
          <div><strong>₹{money(bet.amount)}</strong><span>Bet {bet.panel + 1}</span></div>
          <div><strong className={bet.cashedOutAt != null ? "fury-yellow" : ""}>{bet.cashedOutAt != null ? `${bet.cashedOutAt.toFixed(2)}×` : bet.roundId === roundId && phase !== "crashed" ? "In play" : "Flight ended"}</strong><span>{bet.cashedOutAt != null ? `₹${money(bet.payout)} returned` : "—"}</span></div>
        </div>)}
        {!myBets.length && <div className="fury-activity-empty"><History size={26} /><strong>Your next adventure</strong><p>Choose a coin amount to join a flight. Your bets will appear here.</p></div>}
      </div>
    </TabsContent>
    <div className="fury-activity-footer"><span className="fury-live-dot" />{players.length} bets this round</div>
  </Tabs>;
}
