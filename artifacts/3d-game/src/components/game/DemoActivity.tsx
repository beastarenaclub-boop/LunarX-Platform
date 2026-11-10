import { useEffect, useId, useState } from "react";
import { ChevronDown, Bot } from "lucide-react";
import { useLocation } from "wouter";
import { LOBBY_GAMES } from "../lobby/catalog";
import {
  demoActivitySnapshot,
  resolveDemoActivityGame,
} from "./demoActivityModel";
import "./demo-activity.css";

const games = LOBBY_GAMES.filter((game) => game.enabled).map((game) => game.id);

export default function DemoActivity({
  fallbackGame,
}: {
  fallbackGame?: string;
}) {
  const [location] = useLocation();
  const game = resolveDemoActivityGame(
    LOBBY_GAMES,
    location,
    fallbackGame,
    new URLSearchParams(window.location.search).get("game"),
  );
  const [now, setNow] = useState(Date.now),
    [expanded, setExpanded] = useState(false);
  const panelId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setExpanded(false), [game]);
  const snapshot = demoActivitySnapshot(games, now),
    players = snapshot.byGame[game ?? ""] ?? [];
  if (!game) return null;
  return (
    <aside
      className="demo-activity"
      aria-label="Simulated demo activity"
      data-testid="demo-activity"
      data-demo-total={snapshot.total}
    >
      <button
        className="demo-activity-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="demo-activity-label">
          <Bot size={15} />
          <strong>Demo activity</strong>
          <em>SIMULATED</em>
        </span>
        {players[0] && (
          <span className="demo-activity-example">
            <span className="demo-activity-pulse" aria-hidden="true" />
            {players[0].id} · {players[0].state}
          </span>
        )}
        <span className="demo-activity-count">
          {players.length} here <i>·</i> {snapshot.total} across games{" "}
          <ChevronDown size={13} />
        </span>
      </button>
      {expanded && (
        <section
          id={panelId}
          className="demo-activity-panel"
          aria-label="Demo practice players"
        >
          <p>
            Simulated practice players only. These are not real users, bets or
            winnings.
          </p>
          <ul>
            {players.map((player) => (
              <li key={player.id}>
                <span className="demo-activity-avatar">
                  <Bot size={19} />
                </span>
                <span>
                  <b>{player.id}</b>
                  <small>{player.state}</small>
                </span>
                <span className="demo-activity-pulse" aria-hidden="true" />
              </li>
            ))}
          </ul>
          {!players.length && (
            <p>No simulated practice players in this game right now.</p>
          )}
          <footer>
            Shared pool: {snapshot.total} / 100 simulated players across all
            games.
          </footer>
        </section>
      )}
    </aside>
  );
}
