import { History, Users } from "lucide-react";
import { useStore } from "@/game/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jetxPlayers } from "./jetxPlayers";

const avatarStyle = (index: number) => ({ background: `radial-gradient(circle at 33% 25%, hsl(${(index * 53 + 220) % 360} 75% 65%), hsl(${(index * 53 + 240) % 360} 65% 23%) 70%)` });
const money = (value: number) => `₹ ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function JetXActivity() {
  const live = useStore(s => s.liveBets);
  const realLiveBetsActive = useStore(s => s.realLiveBetsActive);
  const myBets = useStore(s => s.myBets);
  const rounds = useStore(s => s.rounds);
  const roundId = useStore(s => s.roundId);
  // The shared engine can contain simulated atmosphere. Only actual player
  // events belong in this public activity list.
  const players = jetxPlayers(roundId, live, realLiveBetsActive, myBets).sort((a, b) => b.amount - a.amount);
  const won = players.reduce((sum, b) => sum + (b.cashedOutAt != null ? b.payout : 0), 0);
  const top = players.filter(b => b.cashedOutAt != null).sort((a, b) => b.payout - a.payout);
  return <Tabs defaultValue="players" className="jetx-activity">
    <TabsList aria-label="Flight activity" className="jetx-activity-tabs">
      <TabsTrigger value="players">Players</TabsTrigger>
      <TabsTrigger value="rounds">Rounds</TabsTrigger>
      <TabsTrigger value="top">Top</TabsTrigger>
    </TabsList>
    <TabsContent value="players" className="jetx-activity-content">
      <div className="jetx-players-summary">{players.length > 0 && <div className="jetx-summary-avatars">{players.slice(0, 3).map((bet, i) => <i className="jetx-player-avatar" key={bet.id} style={avatarStyle(i)}>{bet.name[0].toUpperCase()}</i>)}</div>}<div><strong>{players.length} Bets</strong><span>This round</span></div><div><strong>{money(won)}</strong><span>Total win</span></div></div>
      <div className="jetx-player-row jetx-table-heading"><span>Player</span><span>Bet</span><span>X</span><span>Win</span></div>
      <div className="jetx-activity-scroll">
        {players.map((bet, i) => <div className="jetx-player-row" key={bet.id}>
          <span className="jetx-player-name"><i className="jetx-player-avatar" style={avatarStyle(i)}>{bet.name.slice(0, 1).toUpperCase()}</i>{bet.name === "You" ? "You" : `${bet.name.slice(0, 1)}•••${bet.name.slice(-1)}`}</span>
          <span>{money(bet.amount)}</span><span className={bet.cashedOutAt != null ? "jetx-won" : ""}>{bet.cashedOutAt != null ? `${bet.cashedOutAt.toFixed(2)}x` : "--"}</span>
          <span className={bet.cashedOutAt != null ? "jetx-won" : ""}>{bet.cashedOutAt != null ? money(bet.payout) : "--"}</span>
        </div>)}
        {!players.length && <div className="jetx-activity-empty"><strong>No bets this round yet</strong></div>}
      </div>
    </TabsContent>
    <TabsContent value="rounds" className="jetx-activity-content">
      <div className="jetx-list-heading">Recent flights<span>{rounds.length} rounds</span></div>
      <div className="jetx-activity-scroll">{[...rounds].sort((a, b) => b.ts - a.ts).slice(0, 50).map(round => <div className="jetx-history-row" key={round.id}><span><History size={14} />{new Date(round.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><strong data-multiplier-tier={round.crashAt < 2 ? "low" : round.crashAt < 10 ? "medium" : "high"}>{round.crashAt.toFixed(2)}×</strong></div>)}
        {!rounds.length && <div className="jetx-activity-empty"><History size={26} /><strong>No completed flights yet</strong><p>Results will appear after each round.</p></div>}
      </div>
    </TabsContent>
    <TabsContent value="top" className="jetx-activity-content">
      <div className="jetx-list-heading">Top wins<span>This round</span></div>
      <div className="jetx-activity-scroll">{top.slice(0, 50).map(bet => <div className="jetx-personal-row" key={bet.id}>
        <div><strong>{bet.name.slice(0, 1)}•••{bet.name.slice(-1)}</strong><span>Bet {money(bet.amount)}</span></div><div><strong className="jetx-won">{money(bet.payout)}</strong><span>{bet.cashedOutAt!.toFixed(2)}x</span></div>
      </div>)}
        {!top.length && <div className="jetx-activity-empty"><strong>No cashouts this round yet</strong></div>}
      </div>
    </TabsContent>
  </Tabs>;
}
