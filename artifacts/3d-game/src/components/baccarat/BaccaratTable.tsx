import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  ShieldCheck,
  RotateCcw,
  Undo2,
  Trash2,
  Users,
} from "lucide-react";
import { GameRulesButton } from "@/components/game/GameRules";
import {
  TableCoinRack,
  type useCoinPreferences,
} from "@/components/table/CoinSettings";
import { AutoBetStatus } from "@/components/table/AutoBet";
import { CoinFace } from "@/components/table/chips";
import type { TableRoundState } from "@/components/table/useTableRound";
import { formatRupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import BaccaratAudioControls from "./BaccaratAudioControls";
import { useBaccaratAudio } from "./useBaccaratAudio";
import { commentaryLines } from "./commentary";
import DealerStudio, { type Presentation } from "./DealerStudio";
import {
  handTotal,
  orderedCards,
  visibleHand,
  type StudioDeal,
  type Side,
} from "./studioTimeline";
import {
  BET_LABELS,
  BET_PAYOUT_LABELS,
  cardIsRed,
  cardRankLabel,
  cardSuitSymbol,
  type BaccaratBetType,
} from "./cards";
import { BigRoad, BeadPlate, type RoadEntry } from "./StudioRoads";
import "./baccarat-studio.css";

interface Props {
  round: TableRoundState<StudioDeal>;
  deal: StudioDeal | null;
  balance: string;
  disabled: boolean;
  available: boolean;
  placing: boolean;
  bets: Map<BaccaratBetType, number>;
  chip: number;
  selectChip: (n: number) => void;
  coins: ReturnType<typeof useCoinPreferences>;
  total: number;
  accepted: string;
  payout: string;
  canUndo: boolean;
  canRebet: boolean;
  onBet: (s: BaccaratBetType) => void;
  onUndo: () => void;
  onClear: () => void;
  onRebet: () => void;
  onDouble: () => void;
  onFairness: () => void;
  payouts?: Record<BaccaratBetType, number>;
  roads: RoadEntry[];
}
const spots: BaccaratBetType[] = [
  "playerPair",
  "player",
  "tie",
  "banker",
  "bankerPair",
];
function Card({ card }: { card: number }) {
  return (
    <span
      className={cn("bc-mini-card", cardIsRed(card) && "bc-red-card")}
      aria-label={`${cardRankLabel(card)} ${cardSuitSymbol(card)}`}
    >
      <b>{cardRankLabel(card)}</b>
      <span>{cardSuitSymbol(card)}</span>
    </span>
  );
}

export default function BaccaratTable(p: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [presentation, setPresentation] = useState<Presentation>({
    roundId: null,
    count: 0,
  });
  const onPresentation = useCallback(
    (next: Presentation) =>
      setPresentation((previous) =>
        next.roundId === previous.roundId && next.count === previous.count
          ? previous
          : next,
      ),
    [],
  );
  const r = p.round,
    betting = r.bettingOpen && r.remainingMs > 0;
  const editable = betting && p.available && !p.disabled && !p.placing;
  const count =
    p.deal && presentation.roundId === r.roundId ? presentation.count : 0;
  const audio = useBaccaratAudio(r, p.deal, count, p.available && !p.disabled);
  const complete = !!p.deal && count >= orderedCards(p.deal).length;
  const winner = complete ? p.deal!.winner : null;
  const elapsed =
    r.phase === "settling"
      ? 0
      : Math.max(0, (r.phaseDurationMs ?? 0) - r.remainingMs);
  const seconds = Math.ceil(r.remainingMs / 1000);
  const phaseLabel = p.disabled
    ? "Table paused"
    : !r.phase || !p.available
      ? "Connecting to table"
      : betting
        ? "Place your bets"
        : winner
          ? `${winner === "tie" ? "Tie" : `${BET_LABELS[winner]} wins`}`
          : "No more bets";
  const currentRoads =
    complete && p.deal
      ? [
          ...p.roads,
          {
            winner: p.deal.winner,
            playerPair: p.deal.playerPair,
            bankerPair: p.deal.bankerPair,
          },
        ]
      : p.roads;
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      /* Browser may disallow fullscreen in an embedded preview. */
    }
  };
  function hand(side: Side) {
    const cards = visibleHand(p.deal, count, side);
    return (
      <div className={`bc-hand bc-hand-${side}`} data-testid={`hand-${side}`}>
        <span className="bc-score" data-testid={`text-${side}-total`}>
          {cards.length ? handTotal(cards) : "–"}
        </span>
        <div className="bc-hand-cards">
          {cards.map((card, i) => (
            <Card key={`${r.roundId}-${i}`} card={card} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div
      ref={root}
      className="bc-page"
      data-game-screen="baccarat"
      data-testid="baccarat-table"
      data-audio-state={audio.audioState}
      data-commentary={audio.line ?? "idle"}
      data-music-playing={audio.musicPlaying}
    >
      <div className="bc-stage">
        <DealerStudio
          roundId={r.roundId}
          phase={r.phase}
          deal={p.deal}
          elapsedMs={elapsed}
          revealMs={r.config?.revealDurationMs ?? 12000}
          motion={motion}
          onPresentation={onPresentation}
        />
        <div className="bc-stage-shade" />
        {audio.needsTap && <button className="bc-enable-audio" onClick={() => audio.activate(true)} data-testid="baccarat-enable-audio">Tap for sound</button>}
        {audio.line && <div className="bc-commentary-caption" lang="hi" data-testid="baccarat-commentary-caption">{commentaryLines[audio.line]}</div>}
        <div
          className={cn("bc-round-indicator", winner && `bc-result-${winner}`)}
        >
          {betting && (
            <div
              className={cn("bc-timer", seconds <= 5 && "bc-timer-warning")}
              style={
                {
                  "--timer-progress": `${Math.max(0, Math.min(1, r.remainingMs / (r.phaseDurationMs || 1))) * 360}deg`,
                } as CSSProperties
              }
            >
              <span data-testid="baccarat-countdown">{seconds}</span>
            </div>
          )}
          <div role="status" data-testid="text-result-winner">
            {phaseLabel}
          </div>
          {complete && p.deal?.natural && (
            <small>
              NATURAL {Math.max(p.deal.playerTotal, p.deal.bankerTotal)}
            </small>
          )}
        </div>
      </div>

      <header className="bc-header">
        <div className="bc-brand">
          <Link
            href="/"
            className="bc-icon"
            aria-label="Back to lobby"
            data-testid="btn-back"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1>
              <strong>Baccarat</strong> VIP
            </h1>
            <span className="bc-limits">
              ₹{formatRupees(r.config?.minStakePaise ?? "10000")} – ₹
              {formatRupees(r.config?.maxStakePaise ?? "50000000")}
            </span>
          </div>
          <span className="bc-studio-label">
            <i /> STUDIO
          </span>
        </div>
        <nav aria-label="Table controls">
          <BaccaratAudioControls audio={audio} />
          <button
            className="bc-icon"
            aria-label={motion ? "Pause dealer motion" : "Play dealer motion"}
            onClick={() => setMotion((v) => !v)}
          >
            {motion ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="bc-icon"
            aria-label="Verify fairness"
            data-testid="btn-fairness"
            onClick={p.onFairness}
          >
            <ShieldCheck size={18} />
          </button>
          <GameRulesButton gameCode="baccarat" />
          <button
            className="bc-icon bc-fullscreen"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <Link href="/" className="bc-lobby">
            Lobby <ArrowLeft size={13} />
          </Link>
        </nav>
      </header>

      <div className="bc-console">
        <section className="bc-dock" aria-label="Baccarat betting table">
          <div className="bc-betting-board">
            {spots.map((spot) => {
              const staged = p.bets.get(spot) ?? 0;
              const accepted = r.myBets.reduce(
                (sum, slip) =>
                  sum +
                  (Array.isArray(slip.bets)
                    ? slip.bets
                        .filter((b: { type?: string }) => b.type === spot)
                        .reduce(
                          (s: number, b: { amountPaise?: string }) =>
                            s + Number(b.amountPaise ?? 0) / 100,
                          0,
                        )
                    : 0),
                0,
              );
              const amount = staged + accepted;
              const won =
                complete &&
                (winner === spot ||
                  (spot === "playerPair" && p.deal?.playerPair) ||
                  (spot === "bankerPair" && p.deal?.bankerPair));
              return (
                <button
                  type="button"
                  key={spot}
                  className={cn(
                    "bc-spot",
                    `bc-spot-${spot}`,
                    won && "bc-spot-won",
                    amount > 0 && "bc-spot-selected",
                  )}
                  disabled={!editable}
                  onClick={() => p.onBet(spot)}
                  aria-label={`Bet on ${BET_LABELS[spot]}`}
                  data-game-bet
                  data-testid={`spot-${spot}`}
                >
                  {(spot === "player" || spot === "banker") && hand(spot)}
                  <span className="bc-spot-title">
                    {spot === "playerPair"
                      ? "P Pair"
                      : spot === "bankerPair"
                        ? "B Pair"
                        : BET_LABELS[spot]}
                  </span>
                  <span className="bc-odds">
                    {p.payouts
                      ? `${p.payouts[spot].toFixed(2)}× return`
                      : BET_PAYOUT_LABELS[spot]}
                  </span>
                  {amount > 0 && (
                    <span
                      className="bc-bet-chip"
                      data-testid={`chipstack-${spot}`}
                    >
                      <CoinFace value={amount} sizeClass="w-9 h-9" />
                      <span className="sr-only">₹{amount}</span>
                    </span>
                  )}
                  {won && <span className="bc-win-mark">WIN</span>}
                </button>
              );
            })}
          </div>
          <div className="bc-coins">
            <TableCoinRack
              preferences={p.coins}
              chip={p.chip}
              onSelect={p.selectChip}
              disabled={!editable}
            />
          </div>
          <div className="bc-actions">
            <button
              className="bc-icon"
              onClick={p.onUndo}
              disabled={!editable || !p.canUndo}
              aria-label="Undo bet"
              data-testid="btn-undo"
            >
              <Undo2 size={17} />
            </button>
            <button
              className="bc-icon"
              onClick={p.onClear}
              disabled={!editable || !p.bets.size}
              aria-label="Clear bets"
              data-testid="btn-clear"
            >
              <Trash2 size={16} />
            </button>
            <button
              className="bc-icon"
              onClick={p.onRebet}
              disabled={!editable || !p.canRebet}
              aria-label="Repeat last bets"
              data-testid="btn-rebet"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="bc-icon bc-double"
              onClick={p.onDouble}
              disabled={!editable || !p.bets.size}
              aria-label="Double bets"
              data-testid="btn-double"
            >
              ×2
            </button>
            <AutoBetStatus
              selected={p.bets.size > 0}
              busy={p.placing}
              seconds={p.bets.size ? seconds : null}
              className="bc-auto-status"
            />
          </div>
          <div className="bc-stake-line">
            <span data-testid="text-total-staked">
              Selected <b>₹{p.total.toLocaleString("en-IN")}</b>
            </span>
            <span data-testid="placed-summary">
              Accepted <b>₹{formatRupees(p.accepted)}</b>
            </span>
          </div>
        </section>

        <section className="bc-roads" aria-label="Baccarat results history">
          <div className="bc-road-heading">
            <span>
              SHOE HISTORY <b>{currentRoads.length}</b>
            </span>
            <div>
              {(["player", "banker", "tie"] as const).map((side) => (
                <span key={side} className={`bc-count-${side}`}>
                  {side[0].toUpperCase()}{" "}
                  <b>{currentRoads.filter((e) => e.winner === side).length}</b>
                </span>
              ))}
            </div>
          </div>
          <BeadPlate entries={currentRoads} />
          <BigRoad entries={currentRoads} />
          <div className="bc-road-legend">
            <span>
              <i className="bc-player-dot" /> Player
            </span>
            <span>
              <i className="bc-banker-dot" /> Banker
            </span>
            <span>
              <i className="bc-tie-dot" /> Tie
            </span>
            <span>8 decks · Punto Banco</span>
          </div>
        </section>
        <aside className="bc-table-details">
          <span className="bc-audience">
            <Users size={13} /> {r.playerCount} at the table
          </span>
          <span className="bc-round-id">
            ROUND {r.roundId?.slice(-8).toUpperCase() ?? "—"}
          </span>
          <div className="bc-wallet">
            <span>
              Balance{" "}
              <strong data-testid="text-baccarat-balance">
                ₹{formatRupees(p.balance)}
              </strong>
            </span>
            <span>
              Round return{" "}
              <b data-testid="text-result-payout">
                ₹{formatRupees(r.phase === "settling" ? p.payout : "0")}
              </b>
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
