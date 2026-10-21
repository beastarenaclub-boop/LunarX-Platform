import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "wouter";
import {
  Check,
  CircleHelp,
  Clock3,
  Coins,
  House,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  Swords,
  Trash2,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import {
  OD_GAME,
  OD_MARKETS,
  OD_RANKS,
  OD_SUITS,
} from "@workspace/api-zod/dragon-tiger-one-day";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings, notifyPlayStarted } from "@/game/engine";
import { playGameSound, unlockAudio } from "@/game/audio";
import { useOneDayTable } from "@/components/dragonTigerOneDay/useOneDayTable";
import { AutoBetStatus } from "@/components/table/AutoBet";
import { OneDayDealer } from "@/components/dragonTigerOneDay/OneDayDealer";
import { OneDayStudio } from "@/components/dragonTigerOneDay/OneDayStudio";
import {
  OneDayCardMarkets,
  OneDayMatchMarkets,
} from "@/components/dragonTigerOneDay/OneDayMarkets";
import { CardBack, CardFace } from "@/components/teenpattiLive/TableCardArt";
import type { OneDayAudioHandle } from "@/components/dragonTigerOneDay/OneDayCommentary";
import {
  TableCoinRack,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/components/dragonTigerOneDay/one-day.css";
import "@/components/dragonTigerOneDay/one-day-reference.css";

const money = (paise: string | number | bigint) =>
  `₹${(Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const cardName = (card: number) =>
  `${OD_RANKS[card % 13]}${OD_SUITS[Math.floor((card % 52) / 13)]}`;
const fullLabel = (id: string) => {
  const m = OD_MARKETS.find((m) => m.id === id);
  return m ? `${m.side === "match" ? "" : m.side + " · "}${m.label}` : id;
};
function PlayingCard({
  side,
  card,
  won,
  dealing,
}: {
  side: "Dragon" | "Tiger";
  card?: number;
  won: boolean;
  dealing: boolean;
}) {
  const red =
    card !== undefined && [1, 2].includes(Math.floor((card % 52) / 13));
  return (
    <div
      className={`od-card-slot od-card-slot-${side.toLowerCase()} ${won ? "od-winner" : ""}`}
    >
      <span>{side}</span>
      <div className={`od-card-placement ${dealing ? "od-card-dealt" : ""}`}>
        <div
          key={card ?? "back"}
          className={`od-playing-card ${card === undefined ? "od-face-down" : "od-face-up"} ${red ? "od-red-card" : ""}`}
          data-testid={`od-card-${side.toLowerCase()}`}
          aria-label={`${side}: ${card === undefined ? "face down" : cardName(card)}`}
        >
          <svg
            className="od-card-art"
            viewBox="0 0 66 94"
            aria-hidden="true"
            focusable="false"
          >
            {card === undefined ? (
              <CardBack />
            ) : (
              <CardFace value={card} won={won} />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function DragonTigerOneDay() {
  const { user } = useAuth();
  return <OneDayTable key={user?.id} userId={user?.id} />;
}
function OneDayTable({ userId }: { userId?: string }) {
  const game = useOneDayTable(userId),
    { data, stage } = game;
  const coins = useCoinPreferences(OD_GAME, userId, 5000);
  const sound = useStore((s) => s.settings.sound);
  const masterVolume = useStore((s) => s.settings.masterVolume);
  const sfxVolume = useStore((s) => s.settings.sfxVolume);
  const audible = sound && masterVolume > 0 && sfxVolume > 0;
  const audio = useRef<OneDayAudioHandle>(null);
  const [cue, setCue] = useState<{
    id: number;
    take: "invite" | "dragon" | "tiger";
  } | null>(null);
  const lastCue = useRef(0);
  const [info, setInfo] = useState<
    "rules" | "history" | "fairness" | "bets" | null
  >(null);
  const [verification, setVerification] = useState<string | null>(null);
  const phaseSound = useRef("");
  const activate = () => {
    notifyPlayStarted();
    void unlockAudio();
  };
  useEffect(() => {
    document.title = "One Day Dragon Tiger · Lunar Casino";
  }, []);
  useEffect(() => {
    if (!data) return;
    const key = `${data.round.id}:${data.round.phase}`;
    if (phaseSound.current === key) return;
    phaseSound.current = key;
    if (sound && game.connected)
      playGameSound(
        data.round.phase === "second"
          ? "reveal"
          : data.round.phase === "result"
            ? "settle"
            : data.round.phase.includes("reveal")
              ? "deal"
              : "idle",
        OD_GAME,
      );
  }, [data?.round.id, data?.round.phase, sound, game.connected]);
  const tick = useRef(0);
  useEffect(() => {
    if (game.seconds === tick.current) return;
    tick.current = game.seconds;
    if (
      sound &&
      game.connected &&
      stage &&
      game.seconds > 0 &&
      game.seconds <= 5
    )
      playGameSound("tick", OD_GAME);
  }, [game.seconds, stage, sound, game.connected]);
  const win = useRoundWin({
    game: OD_GAME,
    userId,
    roundId: data ? String(data.round.id) : null,
    eligible:
      data?.round.phase === "result" &&
      !!data.slips.length &&
      data.slips.every((s) => s.payoutPaise !== null),
    bets:
      data?.slips.map((s) => ({
        status: s.payoutPaise === null ? "pending" : "settled",
        totalStake: s.stakePaise,
        payoutAmount: s.payoutPaise ?? "0",
      })) ?? [],
  });
  const selected = game.draft.bets.reduce(
    (sum, b) => sum + Number(b.amountPaise),
    0,
  );
  const activeQuotes = data?.quotes ?? [];
  const phase = data?.round.phase;
  const secondVisible =
    !!game.firstPlaced &&
    !!phase &&
    !["first", "dragon-reveal"].includes(phase);
  const firstStake = game.firstPlaced?.stakePaise ?? "0";
  const secondStake =
    data?.slips.find((s) => s.stage === "second")?.stakePaise ?? "0";
  const status = !game.connected
    ? "Connecting to table..."
    : phase === "first"
      ? game.placed
        ? "First bet accepted"
        : "First chance - place your bet"
      : phase === "dragon-reveal"
        ? "Opening Dragon..."
        : phase === "second"
          ? !game.firstPlaced
            ? "Wait for the next round"
            : game.placed
              ? "Second bet accepted"
              : "Second chance - updated bhav"
          : phase === "tiger-reveal"
            ? "Opening Tiger..."
            : (data?.round.winner?.toUpperCase() ?? "") +
              (data?.round.winner === "tie" ? " GAME" : " WINS");
  const hint =
    phase === "first"
      ? game.firstPlaced
        ? "Dragon opens next. Your second chance will unlock then."
        : "Choose a coin, then Dragon, Tiger or Tie."
      : phase === "second"
        ? !game.firstPlaced
          ? "A first-chance bet is required. Join the next round."
          : game.remainingLimit <= 0n
            ? "\u20b95,000 round limit used. Both chances share this limit."
            : game.placed
              ? "Prices locked. Waiting for Tiger."
              : "Dragon " +
                (data?.round.dragon === undefined
                  ? ""
                  : cardName(data.round.dragon)) +
                " is open. Choose the match or Tiger card."
        : phase === "result"
          ? "Returns are included in your shared wallet."
          : "Accepted bets keep their original prices.";
  const marketProps = {
    quotes: activeQuotes,
    canEdit: game.canEdit,
    amount: (id: string) =>
      Number(game.draft.bets.find((bet) => bet.type === id)?.amountPaise ?? 0) +
      (data?.slips.reduce(
        (sum, slip) =>
          sum +
          slip.selections.reduce(
            (total, bet) =>
              total + (bet.market === id ? Number(bet.amountPaise) : 0),
            0,
          ),
        0,
      ) ?? 0),
    selected: (id: string) => game.draft.bets.some((bet) => bet.type === id),
    onSelect: (id: string) => {
      activate();
      if (game.add(id, coins.chip)) {
        if (sound) playGameSound("select", OD_GAME);
        if (Date.now() - lastCue.current > 4000) {
          lastCue.current = Date.now();
          setCue({
            id: lastCue.current,
            take:
              id === "dragon"
                ? "dragon"
                : id.startsWith("tiger")
                  ? "tiger"
                  : "invite",
          });
        }
      }
    },
  };
  const verify = async () => {
    const r = data?.round;
    if (r?.dragon === undefined || r.tiger === undefined || !r.nonce) return;
    const bytes = new TextEncoder().encode(`${r.dragon}:${r.tiger}:${r.nonce}`);
    try {
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
      setVerification(
        hash === r.commitment
          ? "Verified — cards match the pre-round commitment."
          : "Verification failed.",
      );
    } catch {
      setVerification("Verification needs HTTPS or localhost.");
    }
  };
  useEffect(() => setVerification(null), [data?.round.id]);
  return (
    <main
      className="game-page od-page"
      data-testid="one-day-page"
      data-phase={phase ?? "loading"}
      onPointerDownCapture={activate}
      onKeyDownCapture={activate}
    >
      <div className="game-shell od-shell">
        <header className="od-topbar">
          <Link href="/" className="od-back" aria-label="Back to lobby">
            <House size={25} />
          </Link>
          <div className="od-brand">
            <Coins size={32} />
            <span>
              LUNAR<small>CASINO</small>
            </span>
          </div>
          <Link href="/wallet" className="od-wallet">
            <Wallet size={17} />
            <span>
              <small>SHARED WALLET</small>
              <b data-testid="od-balance">
                {data ? money(data.balancePaise) : "—"}
              </b>
            </span>
          </Link>
          <button
            className="od-icon"
            aria-label={audible ? "Mute game sounds" : "Enable game sounds"}
            aria-pressed={audible}
            onClick={() => {
              // Commit the settings before directly starting native media in
              // this tap; a later effect can lose mobile autoplay permission.
              flushSync(() =>
                updateSettings(
                  audible
                    ? { sound: false }
                    : {
                        sound: true,
                        masterVolume: masterVolume > 0 ? masterVolume : 0.7,
                        sfxVolume: sfxVolume > 0 ? sfxVolume : 0.8,
                      },
                ),
              );
              if (!audible) audio.current?.play();
              activate();
            }}
          >
            {audible ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="od-icon"
            aria-label="Game information"
            data-testid="btn-game-rules"
            onClick={() => setInfo("rules")}
          >
            <CircleHelp size={20} />
          </button>
        </header>
        <div className="od-announcement">
          <Megaphone size={17} aria-hidden="true" />
          <span>One Day Dragon Tiger · Two chances. One winning card.</span>
        </div>
        <div className="od-layout">
          <section
            className="od-studio-column"
            aria-label="Dealer studio and cards"
          >
            <div className="od-heading">
              <div>
                <h1>ONE DAY DRAGON TIGER</h1>
                <span className="od-round">
                  <i className={game.connected ? "od-online" : ""} />
                  Round ID: {data?.round.id ?? "—"}
                </span>
              </div>
              <span
                className="od-table-timer"
                aria-label={`${game.seconds} seconds remaining`}
              >
                <Clock3 size={15} /> {game.seconds.toString().padStart(2, "0")}
              </span>
            </div>
            <OneDayStudio>
              <OneDayDealer
                audioRef={audio}
                phase={phase}
                roundId={data?.round.id}
                winner={data?.round.winner}
                cue={cue}
                dragon={data?.round.dragon}
                remainingMs={(data?.round.phaseEndsAt ?? 0) - game.serverNow}
                connected={game.connected}
              />
              <div className="od-table-cards">
                <PlayingCard
                  key={`${data?.round.id}:dragon`}
                  side="Dragon"
                  dealing={phase === "first"}
                  card={data?.round.dragon}
                  won={phase === "result" && data?.round.winner === "dragon"}
                />
                <div className="od-versus">
                  <Swords size={22} />
                  <span>
                    {phase === "second"
                      ? "SECOND CHANCE"
                      : phase === "result"
                        ? "RESULT"
                        : "ONE DAY"}
                  </span>
                </div>
                <PlayingCard
                  key={`${data?.round.id}:tiger`}
                  side="Tiger"
                  dealing={phase === "first"}
                  card={data?.round.tiger}
                  won={phase === "result" && data?.round.winner === "tiger"}
                />
              </div>
            </OneDayStudio>
          </section>
          <section className="od-markets-panel" aria-label="Betting markets">
            <OneDayMatchMarkets {...marketProps} />
            <OneDayCardMarkets {...marketProps} side="dragon" />
            <div data-testid={secondVisible ? "od-second-options" : undefined}>
              <OneDayCardMarkets {...marketProps} side="tiger" />
            </div>
            {!secondVisible && (
              <div className="od-unlock" data-testid="od-second-locked">
                <LockKeyhole size={17} />
                <span>
                  {game.firstPlaced
                    ? "First bet accepted. Tiger card bets open after Dragon."
                    : "Place a first-chance match bet to unlock Tiger card bets."}
                </span>
              </div>
            )}
            <div className="od-betting-dock">
              <div className={"od-phase od-phase-" + phase} role="status">
                <span>
                  {status}
                  <small>{hint}</small>
                </span>
                <b>
                  <Clock3 size={16} />
                  {game.seconds.toString().padStart(2, "0")}
                </b>
              </div>
              <div className="od-controls">
                <div className="od-control-title">
                  <b>Choose coin</b>
                  <span>
                    Round limit left{" "}
                    <b data-testid="od-limit">{money(game.remainingLimit)}</b>
                  </span>
                </div>
                <TableCoinRack
                  preferences={coins}
                  chip={coins.chip}
                  onSelect={coins.selectChip}
                  maxValue={5000}
                  layout="fit"
                  disabled={!game.canEdit}
                />
              </div>
              <div className="od-bet-actions">
                <div>
                  <small>SELECTED · NOT DEBITED</small>
                  <b data-testid="od-staged">{money(selected)}</b>
                </div>
                <button
                  className="od-icon"
                  aria-label="Clear selected bets"
                  disabled={!game.canEdit || !selected}
                  onClick={game.draft.clear}
                >
                  <Trash2 size={17} />
                </button>
                <button
                  className="od-confirm"
                  data-testid="od-confirm"
                  disabled={!game.canEdit || !selected}
                  onClick={() => void game.submit()}
                >
                  {game.busy ? (
                    "Confirming…"
                  ) : game.placed ? (
                    <>
                      <Check size={16} /> Accepted
                    </>
                  ) : (
                    "Confirm " + money(selected)
                  )}
                </button>
              </div>
              <div className="od-auto-line">
                {game.placed ? (
                  <span>Accepted once · no further debit for this chance</span>
                ) : (
                  <AutoBetStatus
                    seconds={stage ? game.seconds : null}
                    selected={selected > 0}
                    busy={game.busy}
                    onCancel={game.draft.clear}
                  />
                )}
              </div>
            </div>
            <button
              className="od-wallet-receipt"
              data-testid="od-receipt"
              onClick={() => setInfo("bets")}
            >
              <span>
                1st bet <b>{money(firstStake)}</b>
              </span>
              <span>
                2nd bet <b>{money(secondStake)}</b>
              </span>
              <span>
                Debited <b data-testid="od-debited">{money(game.spent)}</b>
              </span>
              <small>Details ↗</small>
            </button>
          </section>
        </div>
        <Link href="/help" className="od-support-strip">
          <MessageCircle size={23} />
          <span>Need help? Contact support</span>
        </Link>
        <div className="od-recent">
          <div className="od-road">
            {data?.history.slice(0, 12).map((r) => (
              <span
                key={r.id}
                className={"od-bead-" + r.winner}
                title={
                  "#" +
                  r.id +
                  ": " +
                  cardName(r.dragon) +
                  " / " +
                  cardName(r.tiger)
                }
              >
                {r.winner === "dragon" ? "D" : r.winner === "tiger" ? "T" : "="}
              </span>
            ))}
            {!data?.history.length && <small>Recent results</small>}
          </div>
          <button onClick={() => setInfo("history")}>My history ↗</button>
        </div>
        <footer className="od-support-footer">
          <Link href="/help" className="od-support-title">
            Support <MessageCircle size={20} />
          </Link>
          <nav aria-label="Game help">
            <Link href="/help">FAQ</Link>
            <button onClick={() => setInfo("rules")}>Rules</button>
            <button onClick={() => setInfo("fairness")}>Verify round</button>
          </nav>
          <div className="od-trust-row">
            <ShieldCheck size={42} aria-hidden="true" />
            <div>
              <b>SHARED WALLET</b>
              <span>One balance across your games</span>
            </div>
          </div>
          <div className="od-responsible">
            <span>18+</span> Play responsibly
          </div>
          <p className="od-table-limits">
            8 decks · Ace low · ₹1 min · ₹5,000 / round
          </p>
          <p className="od-copyright">
            © {new Date().getFullYear()} Lunar Casino. All rights reserved.
          </p>
        </footer>
      </div>
      <Dialog
        open={info !== null}
        onOpenChange={(open) => {
          if (!open) setInfo(null);
        }}
      >
        <DialogContent className="od-info">
          <DialogTitle>
            {info === "rules"
              ? "One Day Dragon Tiger · Rules"
              : info === "bets"
                ? "Your accepted bets"
                : info === "history"
                  ? "Your betting history"
                  : "Round verification"}
          </DialogTitle>
          <DialogDescription>
            {info === "rules"
              ? "Two betting windows, the same shared wallet."
              : info === "bets"
                ? "Each accepted chance is debited once. Selected coins are not yet debited."
                : info === "history"
                  ? "Accepted prices and total returns for your settled bets."
                  : "Check that the cards match the commitment published before betting."}
          </DialogDescription>
          {info === "rules" && (
            <div className="od-rules-copy">
              <p>
                Place first-chance bets during the 20-second opening window.
                Dragon opens next, followed by a 15-second second chance before
                Tiger opens. A first-chance bet must be accepted to unlock the
                second chance. First chance offers the match winner; Tiger card
                options unlock after Dragon opens. Both chances settle together.
              </p>
              <p>
                Eight decks are sampled afresh each round without replacing the
                first card. Ace = 1, J = 11, Q = 12, K = 13. Higher rank wins;
                equal ranks are a Tie. Suited Tie also requires matching suits.{" "}
                <b>Dragon/Tiger bets lose on a tie in this One Day variant.</b>{" "}
                Tie bets also win on a Suited Tie.
              </p>
              <p>
                Odd: A, 3, 5, 9, J, K. Even: 2, 4, 6, 8, 10, Q.{" "}
                <b>Seven loses both odd/even and low/high bets.</b> Seven has
                its own market. Low = A–6; high = 8–K. Red = hearts/diamonds;
                black = spades/clubs. Face = J/Q/K; number = A–10.
              </p>
              <p>
                Bhav is the total return multiplier, including stake. A ₹100 win
                at 2.05× returns ₹205 (₹105 profit). Losing bets return ₹0.
                Second-chance odds are recalculated from the 415 remaining cards
                after Dragon is removed. Impossible and known outcomes close.
                Earlier bets keep their accepted odds.
              </p>
              <p>
                This game's prices target 85% theoretical return before downward
                rounding to two decimal places. Prices are calculated for this
                table, not copied from a live exchange. One accepted slip per
                chance; several markets may be included. ₹1 minimum per
                selection, whole rupees, ₹5,000 maximum combined per round.
                Selected coins submit automatically at the visible timer end;
                use Confirm bets to submit sooner.
              </p>
              <p>
                The dealer studio uses AI-generated footage with gestures timed
                to the game. Server cards determine results; the video is not a
                live human deal. Wallet settlement continues if you leave the
                page.
              </p>
            </div>
          )}
          {info === "bets" && (
            <div className="od-history-list">
              <p>
                Available wallet: <b>{data ? money(data.balancePaise) : "—"}</b>
                <br />
                Total debited this round: <b>{money(game.spent)}</b>
              </p>
              {data?.slips.length ? (
                data.slips.map((s) => (
                  <div key={s.id}>
                    <b>
                      {s.stage === "first" ? "First" : "Second"} chance ·{" "}
                      {money(s.stakePaise)} debited
                    </b>
                    {s.selections.map((b) => (
                      <small key={b.market}>
                        {fullLabel(b.market)} · {money(b.amountPaise)} @{" "}
                        {(b.oddsHundredths / 100).toFixed(2)}×
                      </small>
                    ))}
                    <span>
                      {s.payoutPaise === null
                        ? "Return pending"
                        : "Returned to wallet: " + money(s.payoutPaise)}
                    </span>
                  </div>
                ))
              ) : (
                <p>No accepted bets this round.</p>
              )}
            </div>
          )}
          {info === "history" && (
            <div className="od-history-list">
              {data?.recent.length ? (
                data.recent.map((s) => (
                  <div key={s.id}>
                    <b>
                      #{s.roundId} · {s.stage} chance
                    </b>
                    <span>
                      Stake {money(s.stakePaise)} · Return{" "}
                      {money(s.payoutPaise ?? "0")}
                    </span>
                    <small>
                      {s.selections
                        .map(
                          (b) =>
                            `${fullLabel(b.market)} @ ${(b.oddsHundredths / 100).toFixed(2)}×`,
                        )
                        .join(" · ")}
                    </small>
                  </div>
                ))
              ) : (
                <p>No settled bets yet.</p>
              )}
            </div>
          )}
          {info === "fairness" && (
            <div className="od-fairness">
              <p>
                Cards and a secret nonce are fixed before the first bet. This
                commitment verifies that the result stayed unchanged; it does
                not independently certify the random generator.
              </p>
              <small>SHA-256 commitment · Round #{data?.round.id}</small>
              <code>{data?.round.commitment ?? "Loading…"}</code>
              <p>
                {data?.round.nonce
                  ? `Revealed cards: ${cardName(data.round.dragon!)} / ${cardName(data.round.tiger!)}`
                  : "The hidden card and nonce are published after betting closes."}
              </p>
              {data?.round.nonce && (
                <>
                  <code>{`${data.round.dragon}:${data.round.tiger}:${data.round.nonce}`}</code>
                  <button className="od-confirm" onClick={() => void verify()}>
                    Verify result
                  </button>
                </>
              )}
              <p role="status">{verification}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <RoundWinDialog win={win.win} onClose={win.dismiss} />
    </main>
  );
}
