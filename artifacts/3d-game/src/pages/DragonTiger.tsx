import { DRAGON_TIGER_RETURNS } from "@workspace/api-zod/game-economics";
import { GameInformationDrawer } from "@/components/game/GameInformation";
import { GameInformationSection, GameInformationTarget, restoreGameInformationFocus } from "@/components/game/GameInformation";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoBetStatus, BET_SEND_BUFFER_MS } from "@/components/table/AutoBet";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Info,
  Coins,
  Crown,
  History,
  Hand,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  sfx,
  playGameSound,
  unlockAudio,
  dealerAudioUnlocked,
  preloadDealerAudio,
  preloadTableAudio,
} from "@/game/audio";
import { notifyPlayStarted, updateSettings } from "@/game/engine";
import { useStore } from "@/game/store";
import { dealerVoiceUrl } from "@/components/dragonTiger/DealerVoice";
import Emblem from "@/components/dragonTiger/Emblem";
import DragonTigerDealer, {
  type DealerCue,
} from "@/components/dragonTiger/DragonTigerDealer";
import ChipRack, { CoinFace } from "@/components/table/chips";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import {
  CoinSettingsButton,
  CoinSettingsDialog,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import {
  useDragonTiger,
  type Leader,
  type Side,
} from "@/components/dragonTiger/useDragonTiger";
import "@/components/dragonTiger/dragon-tiger.css";

const format = (n: number) => n.toLocaleString("en-IN");
const signed = (n: number) => `${n > 0 ? "+" : ""}${format(n)}`;
const LABELS = { dragon: "Dragon", tiger: "Tiger", tie: "Tie" };
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

function Card({
  card,
  side,
  won,
}: {
  card?: number;
  side: "dragon" | "tiger";
  won: boolean;
}) {
  const rank = card === undefined ? "" : RANKS[card % 13];
  const suit = card === undefined ? "" : SUITS[Math.floor(card / 13)];
  const red = suit === "♥" || suit === "♦";
  return (
    <div className={`dt-card-slot ${won ? "dt-card-won" : ""}`}>
      <div
        className={`dt-card ${card !== undefined ? "dt-card-revealed" : ""}`}
        data-testid={`dt-card-${side}`}
        aria-label={`${LABELS[side]} card: ${card === undefined ? "face down" : rank + suit}`}
      >
        <div className="dt-card-back">
          <span>◆</span>
          <Swords />
          <small>D / T</small>
          <span>◆</span>
        </div>
        <div className={`dt-card-face ${red ? "dt-card-red" : ""}`}>
          <span className="dt-card-corner">
            {rank}
            <small>{suit}</small>
          </span>
          <span className="dt-card-center">
            <b data-testid={`dt-card-rank-${side}`}>{rank}</b>
            <span className="dt-card-suit">{suit}</span>
          </span>
          <span className="dt-card-corner dt-card-corner-bottom">
            {rank}
            <small>{suit}</small>
          </span>
        </div>
      </div>
      <span className={`dt-card-caption dt-color-${side}`}>{LABELS[side]}</span>
    </div>
  );
}

function LeaderRow({ leader, you }: { leader: Leader; you: boolean }) {
  return (
    <li className={`dt-leader-row ${you ? "dt-leader-you" : ""}`}>
      <span className="dt-rank">
        {leader.rank === 1 ? (
          <Crown size={16} />
        ) : (
          String(leader.rank).padStart(2, "0")
        )}
      </span>
      <span
        className="dt-avatar"
        style={
          {
            "--avatar-hue": (leader.name.charCodeAt(0) * 19) % 360,
          } as CSSProperties
        }
      >
        {leader.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="dt-leader-name">
        <b>
          {leader.name}
          {you && <small>YOU</small>}
        </b>
        <span>
          {leader.wins} wins · {leader.played} rounds
        </span>
      </span>
      <strong className={leader.net < 0 ? "dt-negative" : "dt-positive"}>
        {signed(leader.net)}
        <small>chips</small>
      </strong>
    </li>
  );
}

export default function DragonTiger() {
  const { user } = useAuth();
  return <DragonTigerTable key={user!.id} userId={user!.id} />;
}

function DragonTigerTable({ userId }: { userId: string }) {
  const game = useDragonTiger(userId);
  const { data } = game;
  const mainProfit = (data?.round.mainProfitPaisePerRupee ?? DRAGON_TIGER_RETURNS.mainProfitPaisePerRupee) / 100;
  const tieProfit = (data?.round.tieProfitPaisePerRupee ?? DRAGON_TIGER_RETURNS.tieProfitPaisePerRupee) / 100;
  const coinPreferences = useCoinPreferences("dragon-tiger", userId, 5000);
  const { chip, selectChip: setChip } = coinPreferences;
  const [coinSettingsOpen, setCoinSettingsOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const sound = useStore((s) => s.settings.sound);
  const masterVolume = useStore((s) => s.settings.masterVolume);
  const effectsVolume = useStore((s) => s.settings.sfxVolume);
  const [audioReady, setAudioReady] = useState(dealerAudioUnlocked);
  const soundOn = sound && audioReady && masterVolume > 0 && effectsVolume > 0;
  const activateAudio = () => {
    notifyPlayStarted();
    void unlockAudio().then(() => setAudioReady(dealerAudioUnlocked()));
  };
  const activateFromTable = (target: EventTarget) => {
    // The speaker handles its own tap. Unlocking on its pointer-down could
    // change "enable" to "mute" before the user's pointer-up/click arrives.
    if (
      sound &&
      target instanceof Element &&
      !target.closest('[data-testid="dt-sound"]')
    )
      activateAudio();
  };
  const [dealerCue, setDealerCue] = useState<DealerCue | null>(null);
  const cueId = useRef(0);
  const [allLeaders, setAllLeaders] = useState(false);
  const [newLeader, setNewLeader] = useState("");
  const leaderId = useRef<string | null>(null);
  const announced = useRef("");
  const confirmed = useRef<number | null>(null);
  const top = data?.leaderboard[0];
  useEffect(() => {
    document.title = "Dragon Tiger · Lunar Casino";
  }, []);
  useEffect(() => {
    if (!sound) return;
    preloadTableAudio();
    void preloadDealerAudio(dealerVoiceUrl);
  }, [sound]);
  useEffect(() => {
    if (!top) return;
    if (leaderId.current && leaderId.current !== top.userId)
      setNewLeader(`${top.name} takes the lead!`);
    leaderId.current = top.userId;
  }, [top?.userId, top?.name]);
  useEffect(() => {
    if (!newLeader) return;
    const timer = window.setTimeout(() => setNewLeader(""), 7000);
    return () => window.clearTimeout(timer);
  }, [newLeader]);
  useEffect(() => {
    if (!data) return;
    const event = `${data.round.id}:${data.round.phase}`;
    if (announced.current === event) return;
    announced.current = event;
    if (
      soundOn &&
      (data.round.phase === "dealing" || data.round.phase === "result")
    )
      playGameSound(data.round.phase === "result" ? "reveal" : "deal", "dragon-tiger");
  }, [data?.round.phase, data?.round.id, soundOn]);
  useEffect(() => {
    if (!data?.myBet || confirmed.current === data.round.id) return;
    confirmed.current = data.round.id;
    if (soundOn) sfx.chipStackPush();
  }, [data?.myBet, data?.round.id, soundOn]);

  const phase = data?.round.phase;
  const winner = data?.round.winner;
  const dragonRank =
    data?.round.dragon === undefined ? undefined : data.round.dragon % 13;
  const tigerRank =
    data?.round.tiger === undefined ? undefined : data.round.tiger % 13;
  const compared =
    phase === "result" && dragonRank !== undefined && tigerRank !== undefined;
  const comparison = compared
    ? `${RANKS[dragonRank]} ${dragonRank === tigerRank ? "=" : dragonRank > tigerRank ? ">" : "<"} ${RANKS[tigerRank]}`
    : "VS";
  const deadline =
    phase === "betting"
      ? data!.round.closesAt - BET_SEND_BUFFER_MS
      : phase === "dealing"
        ? data!.round.revealsAt
        : data?.round.endsAt;
  const seconds = Math.max(
    0,
    Math.ceil(((deadline ?? game.now) - game.now) / 1000),
  );
  const status = !data
    ? "Connecting to the table"
    : !game.connected
      ? "Reconnecting…"
      : phase === "result" && winner
        ? `${LABELS[winner]} ${winner === "tie" ? "game" : "wins"}`
        : phase === "dealing" || !seconds
          ? "Dealing cards"
          : data.myBet
            ? "Your bet is confirmed"
            : "Place your bets";
  const add = (side: Side) => {
    game.add(side, chip);
    setDealerCue({ id: ++cueId.current, kind: side, roundId: data?.round.id });
    if (sound) sfx.chipPlace();
  };
  const result = data?.lastResult;
  const heardResult = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "result" || !result || result.roundId !== data?.round.id || heardResult.current === result.roundId) return;
    heardResult.current = result.roundId;
    if (soundOn && result.payout < result.stake) sfx.tableLose("dragon-tiger");
  }, [phase, result, data?.round.id, soundOn]);
  const roundWin = useRoundWin({
    game: "dragon-tiger", userId,
    roundId: data ? String(data.round.id) : null,
    eligible: phase === "result" && result?.roundId === data?.round.id,
    bets: result ? [{ status: "settled", totalStake: String(Math.round(result.stake * 100)), payoutAmount: String(Math.round(result.payout * 100)) }] : [],
  });
  useEffect(() => { if (roundWin.win) setCoinSettingsOpen(false); }, [roundWin.win]);
  const counts = { dragon: 0, tiger: 0, tie: 0 };
  data?.history.forEach((r) => counts[r.winner]++);

  return (
    <main
      className="game-page dt-page"
      data-testid="dragon-tiger-page"
      data-phase={phase ?? "loading"}
      data-audio-ready={audioReady}
      onPointerDownCapture={(event) => activateFromTable(event.target)}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" || event.key === " ")
          activateFromTable(event.target);
      }}
    >
      <div className="dt-ambient dt-ambient-red" />
      <div className="dt-ambient dt-ambient-blue" />
      <div className="game-shell dt-shell">
        <header className="dt-topbar">
          <Link href="/" className="dt-back" aria-label="Back to lobby">
            <ArrowLeft size={18} />
            <span>Lobby</span>
          </Link>
          <div className="dt-brand">
            <Swords size={21} />
            <span>
              LUNAR<span>TABLE GAMES</span>
            </span>
          </div>
          <div className="dt-top-actions">
            <span className="dt-practice">Shared wallet</span>
            <button
              className="dt-icon"
              aria-label={soundOn ? "Mute game sounds" : "Enable game sounds"}
              data-testid="dt-sound"
              aria-pressed={soundOn}
              onClick={() => {
                const enable = !soundOn;
                updateSettings(
                  enable
                    ? {
                        sound: true,
                        masterVolume: masterVolume || 0.7,
                        sfxVolume: effectsVolume || 0.8,
                      }
                    : { sound: false },
                );
                activateAudio();
                if (enable) {
                  sfx.click();
                  if (game.connected && phase === "betting" && seconds >= 9) {
                    setDealerCue({
                      id: ++cueId.current,
                      kind: "invite",
                      restart: true,
                      roundId: data?.round.id,
                    });
                  }
                }
              }}
            >
              {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              className={`dt-icon ${rules ? "dt-active" : ""}`}
              aria-label="Game information"
              data-testid="btn-game-rules"
              aria-expanded={rules}
              aria-controls="dt-rules"
              onClick={() => setRules(!rules)}
            >
              <Info size={18} />
            </button>
          </div>
        </header>

        <section
          className="dt-table"
          aria-label="Dragon Tiger game table"
          data-testid="dt-table"
        >
          <div className="dt-table-header">
            <div>
              <span className="dt-eyebrow">THE EMPEROR’S TABLE · NO. 01</span>
              <h1>
                DRAGON <span>&</span> TIGER
              </h1>
            </div>
            <div className="dt-header-balance">
              <Coins size={19} />
              <span>
                YOUR CHIPS
                <strong data-testid="dt-balance">
                  {data ? format(data.player.balance) : "—"}
                </strong>
              </span>
            </div>
            <div className="dt-table-meta">
              <span
                className={`dt-live ${!game.connected ? "dt-disconnected" : ""}`}
              >
                <i />
                {game.connected ? "LIVE TABLE" : "CONNECTING"}
              </span>
              <span className="dt-round-number">
                ROUND #{data ? String(data.round.id).padStart(5, "0") : "—"}
              </span>
            </div>
          </div>

          <Dialog open={rules} onOpenChange={setRules}>
            <GameInformationDrawer onCloseAutoFocus={restoreGameInformationFocus} className="max-w-2xl bg-[#15110c] text-white">
              <DialogHeader><DialogTitle>Dragon Tiger information</DialogTitle></DialogHeader>
              <GameInformationTarget />
            <section
              className="dt-rules"
              id="dt-rules"
              aria-label="How to play"
            >
              <div>
                <h2>Two cards. Pick the higher one.</h2>
                <button
                  className="dt-text-button"
                  onClick={() => setRules(false)}
                >
                  Close
                </button>
              </div>
              <p>
                Select a chip and tap Dragon, Tiger or Tie. Your selected chips
                are placed automatically when the countdown ends. One confirmed slip per round; you can
                include all three spots.
              </p>
              <p>
                Ace is lowest, King highest. Eight decks are sampled afresh each
                round. For each ₹1 bet, Dragon and Tiger pay <b>₹{mainProfit.toFixed(2)} profit</b>;
                Tie pays <b>₹{tieProfit} profit</b>, plus your original stake.
                A ₹100 winning bet returns ₹{format(100 * (1 + mainProfit))} on Dragon/Tiger
                or ₹{format(100 * (1 + tieProfit))} on Tie. On a tie, half of any Dragon or Tiger
                stake is returned. Suits do not break ties.
              </p>
              <p>
                10–5,000 chips per round from your shared wallet. The live
                leaderboard ranks real accounts by all-time net chips won, then
                wins. One chip equals ₹1. Selected chips submit at timer end.
              </p>
            </section>
            </GameInformationDrawer>
          </Dialog>

          <div className="dt-table-grid">
            <GameInformationSection><aside
              className={`dt-leaderboard ${allLeaders ? "dt-leaderboard-expanded" : ""}`}
              aria-label="Live leaderboard"
              data-testid="dt-live-leaderboard"
            >
              <div className="dt-leaderboard-heading">
                <h2>
                  <Trophy size={20} /> Live leaderboard
                </h2>
                <span className="dt-mobile-leader" aria-live="polite">
                  <b>{newLeader || top?.name || "No leader yet"}</b>
                  <small>
                    {top ? `${signed(top.net)} chips` : "Join the rankings"}
                  </small>
                </span>
                <button
                  className="dt-leader-toggle"
                  aria-label={
                    allLeaders ? "Collapse leaderboard" : "Expand leaderboard"
                  }
                  aria-expanded={allLeaders}
                  aria-controls="dt-ranking-list"
                  onClick={() => setAllLeaders(!allLeaders)}
                >
                  {allLeaders ? <X size={16} /> : <ChevronDown size={16} />}
                </button>
                <span
                  className={`dt-live-dot ${!game.connected ? "dt-offline-dot" : ""}`}
                  title={
                    game.connected
                      ? "Updates every 1.5 seconds"
                      : "Reconnecting"
                  }
                />
              </div>
              <div className="dt-leaderboard-sub">
                <span>TOP PLAYERS · NET CHIPS WON</span>
                <span>{game.connected ? "LIVE" : "OFFLINE"}</span>
              </div>
              <div className="dt-leader-banner" aria-live="polite">
                <Crown size={25} />
                <span>
                  {newLeader ||
                    (top
                      ? `${top.name} leads the table`
                      : "Who will take the lead?")}
                  <small>
                    {top
                      ? `${signed(top.net)} chips · #1 player`
                      : "Finish your first round to get ranked."}
                  </small>
                </span>
                <Sparkles size={17} />
              </div>
              <ol
                className={`dt-leaders ${allLeaders ? "dt-leaders-expanded" : ""}`}
                data-testid="dt-leaders"
                id="dt-ranking-list"
              >
                {data?.leaderboard.length ? (
                  data.leaderboard.map((leader) => (
                    <LeaderRow
                      key={leader.userId}
                      leader={leader}
                      you={leader.userId === userId}
                    />
                  ))
                ) : (
                  <li className="dt-empty-leaders">
                    <div className="dt-empty-podium" aria-hidden="true">
                      <span>
                        <small>2</small>
                        <i>—</i>
                      </span>
                      <span>
                        <Crown size={25} />
                        <small>1</small>
                        <i>—</i>
                      </span>
                      <span>
                        <small>3</small>
                        <i>—</i>
                      </span>
                    </div>
                    <b>Be the first on the board</b>
                    <span>
                      No ranked players yet. A completed round puts you here.
                    </span>
                  </li>
                )}
              </ol>
              {(data?.leaderboard.length ?? 0) > 3 && (
                <button
                  className="dt-expand-leaders"
                  aria-expanded={allLeaders}
                  onClick={() => setAllLeaders(!allLeaders)}
                >
                  {allLeaders ? "Show top 3" : "View top 10"}
                  <ChevronDown size={14} />
                </button>
              )}
              <div className="dt-your-rank">
                <span className="dt-you-badge">YOU</span>
                <span>
                  Your position
                  <strong>
                    {data?.player.rank ? `#${data.player.rank}` : "Unranked"}
                  </strong>
                </span>
                <span>
                  Net winnings
                  <strong
                    className={
                      (data?.player.net ?? 0) < 0
                        ? "dt-negative"
                        : "dt-positive"
                    }
                  >
                    {signed(data?.player.net ?? 0)}
                  </strong>
                </span>
              </div>
              <p className="dt-ranking-note">
                <Radio size={12} /> Rankings update after every result.
              </p>
            </aside></GameInformationSection>
            <section data-game-screen="dragon-tiger"
              className="dt-play-area"
              aria-label="Cards and betting controls"
            >
              <div className="dt-studio-scene" data-testid="dt-dealer-scene">
                <DragonTigerDealer
                  key={data?.round.id ?? "loading"}
                  canInvite={
                    game.connected && phase === "betting" && seconds >= 9
                  }
                  sound={sound}
                  audioReady={audioReady}
                  volume={masterVolume * effectsVolume}
                  phase={
                    phase === "betting" && seconds === 0 ? "dealing" : phase
                  }
                  cue={dealerCue?.roundId === data?.round.id ? dealerCue : null}
                />
                <button
                  type="button"
                  className="dt-dealer-tag"
                  aria-label={
                    phase === "result" ? "Zara, AI dealer" : "Replay dealer hand reaction"
                  }
                  disabled={phase === "result"}
                  data-testid="dt-dealer-react"
                  onClick={() => {
                    if (phase === "result") return;
                    setDealerCue({
                      id: ++cueId.current,
                      roundId: data?.round.id,
                      kind:
                        phase === "dealing" || seconds === 0 ? "deal" : "invite",
                      manual: true,
                    });
                  }}
                >
                  <span className="dt-dealer-dot" />
                  <span>
                    <b>Zara</b>
                    <small>
                      {phase === "result" ? "AI dealer" : "AI dealer · Tap to react"}
                    </small>
                  </span>
                  {phase !== "result" && <Hand size={17} aria-hidden="true" />}
                </button>
                <div className="dt-studio-title">
                  DRAGON TIGER<small>ACE LOW · KING HIGH</small>
                </div>
                <div className="dt-arena">
                  <div className="dt-contender dt-contender-dragon">
                    <Emblem side="dragon" />
                    <span>THE DRAGON</span>
                    <small>龍 · DRAGON WINS {mainProfit}:1</small>
                  </div>
                  <div
                    className="dt-card-stage"
                    key={data?.round.id ?? "loading"}
                  >
                    <div className="dt-cards">
                      <Card
                        side="dragon"
                        card={data?.round.dragon}
                        won={winner === "dragon" || winner === "tie"}
                      />
                      <span
                        className={`dt-versus ${compared ? "dt-card-comparison" : ""}`}
                        data-testid="dt-card-comparison"
                        aria-label={
                          compared
                            ? `Dragon ${RANKS[dragonRank]}, Tiger ${RANKS[tigerRank]}. ${status}.`
                            : "Cards face down"
                        }
                      >
                        <b>{comparison}</b>
                        {compared && (
                          <small>
                            {winner === "tie"
                              ? "SAME RANK"
                              : "HIGHER CARD WINS"}
                          </small>
                        )}
                      </span>
                      <Card
                        side="tiger"
                        card={data?.round.tiger}
                        won={winner === "tiger" || winner === "tie"}
                      />
                    </div>
                  </div>
                  <div className="dt-contender dt-contender-tiger">
                    <Emblem side="tiger" />
                    <span>THE TIGER</span>
                    <small>虎 · TIGER WINS {mainProfit}:1</small>
                  </div>
                </div>
              </div>

              <div className="dt-betting-dock" data-live-bet-dock>
                <div className="dt-phase-line">
                  <div
                    className={`dt-round-status ${winner ? `dt-color-${winner}` : ""}`}
                    role="status"
                  >
                    <span>
                      {compared ? `${status} · ${comparison}` : status}
                    </span>
                    <small>
                      {phase === "result"
                        ? `A = 1 · J = 11 · Q = 12 · K = 13 · Next ${seconds}s`
                        : phase === "dealing"
                          ? "Bets are locked"
                          : "Bet lagaiye · Dragon ya Tiger"}
                    </small>
                  </div>
                  <div
                    className={`dt-timer ${seconds <= 5 && phase === "betting" ? "dt-timer-urgent" : ""}`}
                    aria-label={`${seconds} seconds remaining`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, (seconds / (phase === "betting" ? 20 : phase === "dealing" ? 3 : 6)) * 100)}%`,
                      }}
                    />
                    <b>{seconds}s</b>
                  </div>
                </div>
                <div className="dt-bet-spots">
                  {(["dragon", "tie", "tiger"] as const).map((side) => (
                    <button
                      key={side}
                      className={`dt-bet-spot dt-bet-${side} ${game.spots[side] ? "dt-spot-selected" : ""} ${winner === side ? "dt-spot-winner" : ""}`}
                      data-game-bet data-testid={`dt-bet-${side}`}
                      aria-label={`Bet ${chip} chips on ${LABELS[side]}`}
                      disabled={!game.editable}
                      onClick={() => add(side)}
                    >
                      <span className="dt-spot-kicker">
                        {side === "tie" ? "SAME RANK" : "HIGHER CARD"}
                      </span>
                      <span className="dt-spot-name">{LABELS[side]}</span>
                      <span className="dt-spot-payout">
                        {side === "tie" ? tieProfit : mainProfit}:1
                      </span>
                      <span
                        className={`dt-spot-stake ${game.spots[side] ? "dt-has-stake" : ""}`}
                      >
                        {game.spots[side] ? (
                          <>
                            <CoinFace
                              value={game.spots[side]}
                              sizeClass="w-8 h-8"
                              className="dt-placed-coin"
                            />
                            <span>{format(game.spots[side])}</span>
                          </>
                        ) : (
                          "+ PLACE CHIP"
                        )}
                      </span>
                      {winner === side && (
                        <span className="dt-winner-label">
                          <Crown size={11} /> WINNER
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="dt-chip-line">
                  <div className="dt-chip-heading">
                    <span>SELECT COIN</span>
                    <span>{format(chip)} chips</span>
                  </div>
                  <ChipRack
                    key={
                      coinPreferences.values.join(",") +
                      coinPreferences.showCustom
                    }
                    chip={chip}
                    onSelect={setChip}
                    layout="fit"
                    unit="chips"
                    minValue={10}
                    maxValue={5000}
                    step={10}
                    values={coinPreferences.values}
                    showCustom={coinPreferences.showCustom}
                    disabled={!game.editable}
                    idSuffix="-dt"
                  />
                </div>
                <div className="dt-controls-line">
                  <CoinSettingsButton
                    onClick={() => setCoinSettingsOpen(true)}
                  />
                  <div className="dt-edit-actions">
                    <button
                      className="dt-icon"
                      aria-label="Undo last chip"
                      disabled={!game.canUndo}
                      onClick={() => {
                        game.undo();
                        if (sound) sfx.chipScoop();
                      }}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      className="dt-icon"
                      aria-label="Clear chips"
                      disabled={!game.canUndo}
                      onClick={() => {
                        game.clear();
                        if (sound) sfx.chipScoop();
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="dt-confirm-line">
                    <button
                      className="dt-action-secondary"
                      disabled={
                        !game.editable ||
                        game.total === 0 ||
                        game.total * 2 >
                          Math.min(data?.player.balance ?? 0, 5000)
                      }
                      onClick={() => {
                        game.double();
                        if (sound) sfx.chipPlace();
                      }}
                    >
                      2×
                    </button>
                    <button
                      className="dt-action-secondary dt-repeat"
                      disabled={!game.canRepeat}
                      onClick={() => {
                        game.repeat();
                        if (sound) sfx.chipPlace();
                      }}
                      aria-label="Repeat previous bet"
                    >
                      <RotateCcw size={15} />
                      <span>Rebet</span>
                    </button>
                  </div>
                </div>
                <div className="dt-summary-line">
                  <div className="dt-stake-total">
                    <span>TOTAL BET</span>
                    <strong data-testid="dt-total">
                      {format(game.total)} <small>chips</small>
                    </strong>
                  </div>
                  <AutoBetStatus selected={!data?.myBet && game.total > 0 && game.betting} busy={game.pending} seconds={!data?.myBet && game.total > 0 ? seconds : null} className="dt-auto-bet" />
                </div>
                {game.message && (
                  <p className="dt-feedback" role="alert">
                    {game.message}
                  </p>
                )}
                {(game.query.isError || (!!data && !game.connected)) && (
                  <p className="dt-feedback" role="alert">
                    <WifiOff size={14} /> Connection interrupted. Bets are
                    paused.{" "}
                    <button onClick={() => void game.query.refetch()}>
                      Reconnect
                    </button>
                  </p>
                )}
              </div>

              <GameInformationSection><div className="dt-history">
                <div className="dt-history-heading">
                  <span>
                    <History size={13} /> RECENT ROUNDS
                  </span>
                  <div>
                    {(["dragon", "tie", "tiger"] as const).map((s) => (
                      <span key={s} className={`dt-color-${s}`}>
                        {LABELS[s][0]} <b>{counts[s]}</b>
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  className="dt-road"
                  aria-label="Round history, newest first"
                >
                  {data?.history.length ? (
                    data.history.map((r) => (
                      <span
                        key={r.id}
                        className={`dt-result-dot dt-dot-${r.winner}`}
                        title={`Round ${r.id}: ${LABELS[r.winner]}`}
                        aria-label={`Round ${r.id}: ${LABELS[r.winner]}`}
                      >
                        {LABELS[r.winner][0]}
                      </span>
                    ))
                  ) : (
                    <span className="dt-empty-history">
                      The first result will appear here.
                    </span>
                  )}
                </div>
              </div></GameInformationSection>
            </section>
          </div>

          <footer className="dt-table-footer">
            <div className="dt-balance">
              <span className="dt-wallet-icon">
                <Coins size={18} />
              </span>
              <span>
                TABLE LIMITS · SHARED WALLET
                <strong>
                  10–5,000
                  <small> chips / round</small>
                </strong>
              </span>
            </div>
            <div className="dt-last-result">
              <span>LAST ROUND</span>
              <strong
                className={
                  result && result.payout - result.stake < 0
                    ? "dt-negative"
                    : "dt-positive"
                }
              >
                {result
                  ? `${signed(result.payout - result.stake)} chips`
                  : "Take your seat"}
              </strong>
            </div>
            <span className="dt-online">
              <Users size={14} />
              {data?.online ?? 0}
              <span> at the table</span>
            </span>
          </footer>
        </section>
        <div className="dt-under-table">
          <span>
            <ShieldCheck size={13} /> Server-dealt cards · Saved results
          </span>
          <span>Shared wallet · 10–5,000 chips</span>
        </div>
      </div>
      <CoinSettingsDialog
        open={coinSettingsOpen}
        onOpenChange={setCoinSettingsOpen}
        preferences={coinPreferences}
        onSave={coinPreferences.save}
        maxValue={5000}
        unit="chips"
      />
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
    </main>
  );
}
