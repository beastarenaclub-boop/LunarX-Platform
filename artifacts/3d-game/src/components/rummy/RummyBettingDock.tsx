import { GameInformationSection } from "@/components/game/GameInformation";
import { AutoBetStatus, useSelectionBet } from "../table/AutoBet";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  ChevronRight,
  Coins,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Timer,
  Zap,
} from "lucide-react";
import { CoinFace, LIVE_TABLE_COIN_VALUES } from "@/components/table/chips";
import type { useRummy } from "@/game/rummy/useRummy";
import { CoinSettingsButton, CoinSettingsDialog, useCoinPreferences } from "@/components/table/CoinSettings";

const format = (n: number) => n.toLocaleString("en-IN");
export default function RummyBettingDock({
  session,
  tableRef,
  onHeightChange,
  userId,
}: {
  session: ReturnType<typeof useRummy>;
  tableRef: RefObject<HTMLElement | null>;
  onHeightChange: (height: number) => void;
  userId: string;
}) {
  const { table: t, auto, autoPlay, notice, dispatch } = session;
  const [stake, setStake] = useState<number>(t.stake);
  const coinPreferences = useCoinPreferences("rummy", userId, 10000);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!coinPreferences.values.includes(stake)) setStake(coinPreferences.values[0]);
  }, [coinPreferences.values, stake]);
  useEffect(() => { if (t.phase === "finished" && t.result?.winner === 0) setSettingsOpen(false); }, [t.phase, t.result]);
  const [tab, setTab] = useState<"manual" | "auto">("manual");
  const [rounds, setRounds] = useState(5);
  const [lossLimit, setLossLimit] = useState(500);
  const [profitTarget, setProfitTarget] = useState(1000);
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState({ left: 0, width: 0 });
  const dockRef = useRef<HTMLElement>(null);
  const canStart = t.phase === "ready" || t.phase === "finished";
  const editable = canStart && !auto && !session.pending;
  const validAuto =
    Number.isInteger(rounds) &&
    rounds >= 1 &&
    rounds <= 50 &&
    Number.isFinite(lossLimit) &&
    lossLimit >= stake &&
    Number.isFinite(profitTarget) &&
    profitTarget >= 1;

  useLayoutEffect(() => {
    const dock = dockRef.current;
    const table = tableRef.current;
    if (!dock || !table) return;
    const measure = () => {
      // Inside the shared viewport the dock is in normal document flow.
      // Browser-relative coordinates would shift it outside its centred frame.
      if (!dock.closest("[data-game-viewport]")) {
        const rect = table.getBoundingClientRect();
        setFrame({
          left: window.innerWidth <= 950 ? 0 : rect.left,
          width: window.innerWidth <= 950 ? window.innerWidth : rect.width,
        });
      }
      onHeightChange(Math.ceil(dock.getBoundingClientRect().height));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    observer.observe(table);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tableRef, onHeightChange]);

  const autoSubmit = useSelectionBet({ enabled: editable, scope: tab, submit: () => {
    if (t.balance >= stake && (tab !== "auto" || validAuto)) start();
  } });
  const selectStake = (value: number) => { setStake(value); autoSubmit.select(); };
  const start = () =>
    tab === "auto"
      ? dispatch({ type: "auto-start", stake, rounds, lossLimit, profitTarget })
      : dispatch({ type: "start", stake });
  return (
    <section
      ref={dockRef}
      className="rm-betting-dock"
      style={frame.width ? { left: frame.left, width: frame.width } : undefined}
      data-testid="rummy-betting-dock"
      data-active={!canStart}
      data-expanded={expanded}
      aria-label="Rummy betting controls"
    >
      <div className="rm-dock-scroll">
        <div className="rm-betting-heading">
          <span className={editable ? "is-open" : ""}>
            {editable ? <Timer size={14} /> : <LockKeyhole size={14} />}
            {auto
              ? `AUTO BET · ${auto.remaining} ROUNDS LEFT`
              : editable
                ? tab === "auto" ? `AUTO ENTRY ? ${rounds} ROUNDS` : "PLACE YOUR ENTRY"
                : "ROUND IN PROGRESS"}
          </span>
          <span>
            13-CARD RUMMY <b>4 SEATS</b>
          </span>
          {!canStart && (
            <button
              className="rm-expand-bets"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide bets" : "Bet controls"}
            </button>
          )}
        </div>
        <div className="rm-bet-options">
          <GameInformationSection><div className="rm-bet-spots">
            <div className="rm-mode-spots" role="tablist" aria-label="Bet mode">
              <button
                role="tab"
                aria-selected={tab === "manual"}
                disabled={!!auto}
                className="rm-bet-spot rm-spot-blue"
                onClick={() => setTab("manual")}
              >
                <Play size={17} />
                <strong>Single round</strong>
                <small>Play your own hand</small>
                <span>{format(stake)} CHIPS</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "auto"}
                disabled={!!auto}
                className="rm-bet-spot rm-spot-gold"
                onClick={() => {
                  setTab("auto");
                  setExpanded(true);
                }}
              >
                <Zap size={17} />
                <strong>Auto bet</strong>
                <small>Automatic rounds</small>
                <span>{rounds} ROUNDS</span>
              </button>
            </div>
            <button
              className="rm-bet-spot rm-spot-rose"
              aria-label="Repeat last entry"
              disabled={!editable || t.round === 0 || t.balance < t.stake}
              onClick={() => {
                setStake(t.stake);
                setTab("manual");
                dispatch({ type: "start", stake: t.stake });
              }}
            >
              <RotateCcw size={17} />
              <strong>Repeat last</strong>
              <small>Same entry, new hand</small>
              <span>
                {t.round ? `${format(t.stake)} CHIPS` : "AFTER FIRST ROUND"}
              </span>
            </button>
          </div></GameInformationSection>
          <div className="rm-chip-line">
            <div
              className="rm-chip-rack"
              role="group"
              aria-label="Entry chip denomination"
              title="Scroll for chips up to 10,000"
            >
              {coinPreferences.values.map((value) => (
                <button
                  key={value}
                  className="rm-stake-chip"
                  data-game-coin
                  disabled={!editable}
                  aria-pressed={stake === value}
                  aria-label={`Entry ${value} chips`}
                  onClick={() => selectStake(value)}
                >
                  <CoinFace value={value} sizeClass="rm-coin-face" />
                </button>
              ))}
            </div>
            <CoinSettingsButton onClick={() => setSettingsOpen(true)} />
            <div className="rm-placed-total">
              <small>{canStart ? "SELECTED ENTRY" : "THIS ROUND"}</small>
              <b data-testid="rummy-selected-entry">
                {format(canStart ? stake : t.stake)}
                <span> chips</span>
              </b>
            </div>
          </div>
          {tab === "auto" && (
            <GameInformationSection><div className="rm-auto-settings">
              <label>
                Rounds
                <select
                  aria-label="Auto bet rounds"
                  disabled={!!auto}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                >
                  {[1, 3, 5, 10, 25, 50].map((v) => (
                    <option key={v} value={v}>
                      {v} rounds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stop loss
                <input
                  type="number"
                  aria-label="Stop loss chips"
                  min={stake}
                  step={25}
                  disabled={!!auto}
                  value={Number.isNaN(lossLimit) ? "" : lossLimit}
                  onChange={(e) => setLossLimit(e.target.valueAsNumber)}
                />
              </label>
              <label>
                Take profit
                <input
                  type="number"
                  aria-label="Take profit chips"
                  min={1}
                  step={25}
                  disabled={!!auto}
                  value={Number.isNaN(profitTarget) ? "" : profitTarget}
                  onChange={(e) => setProfitTarget(e.target.valueAsNumber)}
                />
              </label>
              <p>
                {Number.isFinite(lossLimit) && lossLimit < stake
                  ? `Stop loss must be at least ${format(stake)} chips for this entry.`
                  : "Auto-play included · Limits apply to net chips in this run."}
              </p>
            </div></GameInformationSection>
          )}
        </div>
        {notice && (
          <p className="rm-control-notice" role="status">
            {notice}
          </p>
        )}
        {t.balance < stake && t.balance >= LIVE_TABLE_COIN_VALUES[0] && editable && (
          <p className="rm-control-notice">Choose a lower entry to continue.</p>
        )}
        {t.balance < LIVE_TABLE_COIN_VALUES[0] && editable && (
          <a
            className="rm-refill"
            href="/wallet"
          >
            Add funds to your wallet
          </a>
        )}
      </div>
      <CoinSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} preferences={coinPreferences}
        onSave={coinPreferences.save} unit="chips" maxValue={10000} allowCustom={false} />
      <div className="rm-dock-actions">
        <GameInformationSection><label className="rm-autoplay">
          <input
            type="checkbox"
            role="switch"
            aria-label="Auto-play my hand"
            checked={autoPlay}
            onChange={(e) =>
              dispatch({ type: "auto-play", enabled: e.target.checked })
            }
          />
          <span>
            Auto-play<small>Draw & discard for me</small>
          </span>
        </label></GameInformationSection>
        <div className="rm-dock-pot">
          <Coins size={15} />
          <span>
            Winning pot<b>{format((canStart ? stake : t.stake) * 4)} chips</b>
          </span>
        </div>
        {auto ? (
          <button
            className="rm-start rm-stop"
            data-game-bet data-testid="rummy-stop-auto"
            onClick={() => dispatch({ type: "auto-stop" })}
          >
            <Square size={14} fill="currentColor" /> Stop auto bet{" "}
            <span>{auto.remaining} left</span>
          </button>
        ) : (
          <AutoBetStatus seconds={autoSubmit.seconds} busy={session.pending} onCancel={autoSubmit.cancel} />
        )}
      </div>
      <GameInformationSection><div className="rm-dock-footnote">
        <ShieldCheck size={10} /> Shared wallet chips{" "}
        <span>Winner takes the pot · No fee</span>
      </div></GameInformationSection>
    </section>
  );
}
