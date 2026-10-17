import { useMemo, useRef, useState, type FormEvent, type ComponentType } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Minus,
  Plus,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ViewProps } from "./App";
import type { Game, Ticket as LotteryTicket } from "./types";
import { money, seriesName, time, TITLI } from "./api";
import { Busy, Modal, Notice, Success } from "./ui";
import { SeriesTickets } from "./SeriesTickets";
import { LatestDrawResults } from "./LatestDrawResults";
import { priceRange, seriesPrice } from "./pricing";
import { useStandaloneGameAudio, type GameAudioBridge } from "../../src/game/useStandaloneGameAudio";

const symbols = ["🦋", "🌹", "☀️", "🌙", "⭐", "🍃", "💎", "👑", "♥", "🔔"];
const games: Game[] = ["2D", "3D", "Titli"];
const digitsFor = (game: Game) => (game === "3D" ? 3 : game === "2D" ? 2 : 1);

export type LotteryCoinProps = { price: number; quantity: number; max: number; disabled: boolean; onQuantity: (value: number) => void };
export function PlayerGame({ data, now, navigate, run, busy, CoinControls, audioBridge }: ViewProps & {
  CoinControls?: ComponentType<LotteryCoinProps>; audioBridge?: GameAudioBridge;
}) {
  const [game, setGame] = useState<Game>("2D");
  const audio = useStandaloneGameAudio(game === "2D" ? "lottery-2d" : game === "3D" ? "lottery-3d" : "lottery-titli", "lottery:sound", audioBridge);
  const [series, setSeries] = useState<string[]>(["JP10"]);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [hundred, setHundred] = useState(0);
  const [page, setPage] = useState(0);
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState("");
  const [drawId, setDrawId] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [sold, setSold] = useState<LotteryTicket | null>(null);
  const [rules, setRules] = useState(false);
  const request = useRef({ body: "", key: "" });
  const draws = data.draws.filter((d) => d.status === "open" && d.closes > now);
  const draw = confirmation
    ? data.draws.find((d) => d.id === confirmation)
    : (draws.find((d) => d.id === drawId) ?? draws[0]);
  const pricing = draw?.config ?? data.settings;
  const price = series.reduce((sum, s) => sum + seriesPrice(pricing, s), 0);
  const payout = draw?.config.payouts[game] ?? data.settings.payouts[game];
  const limit = Math.min(draw?.config.maxTicket ?? data.settings.maxTicket, data.settings.maxTicket);
  const lines = useMemo(
    () =>
      series.flatMap((s) =>
        numbers.map((number) => ({ series: s, number, quantity })),
      ),
    [series, numbers, quantity],
  );
  const total = numbers.length * quantity * price;
  const perNumber = quantity * price;
  const remaining = Math.max(
    0,
    Math.ceil(((draw?.closes ?? now) - now) / 1000),
  );
  const countdown = [
    Math.floor(remaining / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const open =
    !!draw &&
    draw.status === "open" &&
    draw.closes > now &&
    data.settings.salesEnabled;
  const validQuantity =
    Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 500;
  const valid =
    open &&
    lines.length > 0 &&
    lines.length <= 1000 &&
    validQuantity &&
    total <= limit &&
    total <= data.account.balance &&
    !busy;
  const visible = Array.from({ length: game === "Titli" ? 10 : 25 }, (_, i) =>
    String(
      game === "Titli"
        ? i
        : (game === "3D" ? hundred * 100 : 0) + page * 25 + i,
    ).padStart(digitsFor(game), "0"),
  );
  const numberGroup = useMemo(
    () =>
      Array.from({ length: 100 }, (_, i) =>
        String((game === "3D" ? hundred * 100 : 0) + i).padStart(
          digitsFor(game),
          "0",
        ),
      ),
    [game, hundred],
  );
  const groupSelection = numbers.filter((n) => numberGroup.includes(n));
  const quickSelections = (["All", "Even", "Odd"] as const).map((label) => {
    const values = numberGroup.filter(
      (n) => label === "All" || Number(n) % 2 === (label === "Even" ? 0 : 1),
    );
    return {
      label,
      values,
      active:
        groupSelection.length === values.length &&
        values.every((n) => numbers.includes(n)),
    };
  });
  const calculation = `${numbers.length} number${numbers.length === 1 ? "" : "s"} × ${money(perNumber)}`;

  function toggle(number: string) {
    audio.play("select");
    setNumbers((old) =>
      old.includes(number) ? old.filter((n) => n !== number) : [...old, number],
    );
  }
  function changeGame(next: Game) {
    setGame(next);
    setNumbers([]);
    setHundred(0);
    setPage(0);
    setEntry("");
    setEntryError("");
  }
  function addNumber(event: FormEvent) {
    event.preventDefault();
    const value = entry.trim();
    if (!new RegExp(`^[0-9]{1,${digitsFor(game)}}$`).test(value)) {
      setEntryError(
        game === "3D"
          ? "000 se 999 ke beech number likhein."
          : "00 se 99 ke beech number likhein.",
      );
      return;
    }
    const number = value.padStart(digitsFor(game), "0");
    audio.play("select");
    setNumbers((old) => (old.includes(number) ? old : [...old, number]));
    setHundred(Math.floor(Number(number) / 100));
    setPage(Math.floor((Number(number) % 100) / 25));
    setEntry("");
    setEntryError("");
  }
  async function buy() {
    if (!valid || !draw) return;
    const body = { drawId: draw.id, game, lines };
    const encoded = JSON.stringify(body);
    if (request.current.body !== encoded)
      request.current = { body: encoded, key: crypto.randomUUID() };
    const result = await run<LotteryTicket>(
      "/tickets",
      body,
      "Bet lag gayi. Ticket save ho gaya.",
      request.current.key,
    );
    if (result) {
      audio.play("bet");
      setConfirmation(null);
      setSold(result);
      setNumbers([]);
      request.current = { body: "", key: "" };
    }
  }
  const review = () => {
    if (valid && draw) setConfirmation(draw.id);
  };

  return (
    <div
      className={`player-game player-easy ${numbers.length ? "has-picks" : ""}`}
    >
      <div className="player-greeting">
        <div>
          <h1>Bet lagayein</h1>
          <p>Ticket chunein. Number chunein. Confirm karein.</p>
        </div>
        <button onClick={audio.toggle} className="player-rules-button" aria-label={audio.enabled ? "Mute game sounds" : "Enable game sounds"} aria-pressed={audio.enabled}>
          {audio.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button onClick={() => setRules(true)} className="player-rules-button">
          <CircleHelp size={16} /> Kaise khelein?
        </button>
      </div>
      <div className="easy-draw-bar">
        <span>
          Draw <strong>{draw ? time(draw.ends) : "—"}</strong>
        </span>
        <span className={remaining <= 30 ? "closing" : ""}>
          {open ? "Band hone mein" : "Abhi band hai"}{" "}
          <strong>{open ? countdown : "—"}</strong>
        </span>
        <b>{priceRange(pricing)} / ticket</b>
      </div>
      <LatestDrawResults
        draws={data.draws}
        timezone={data.settings.timezone}
        onViewAll={() => navigate("results")}
      />
      <details className="easy-options">
        <summary>
          <span>
            <strong>
              {game} · {series.map(seriesName).join(", ")}
            </strong>
            <small>More options · game, draw</small>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="easy-options-body">
          <div
            className="player-game-modes game-tabs"
            aria-label="Choose your lottery game"
          >
            {games.map((g) => (
              <button
                key={g}
                className={game === g ? "active" : ""}
                aria-pressed={game === g}
                onClick={() => changeGame(g)}
              >
                {g}
                {game === g && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="easy-option-fields">
            <label>
              Draw time
              <select
                aria-label="Draw time"
                value={draw?.id ?? ""}
                onChange={(e) => setDrawId(e.target.value)}
              >
                {draws.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {time(d.ends)}
                    {i === 0 ? " · Next draw" : " · Advance draw"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </details>
      <SeriesTickets
        selected={series}
        onChange={setSeries}
        pricing={pricing}
        drawTime={draw?.ends}
        game={game}
      />
      <div className="player-game-layout">
        <section className="player-numbers-panel">
          <div className="easy-step-title">
            <span>1</span>
            <h2>{game === "Titli" ? "Symbol chunein" : "Number chunein"}</h2>
            <small>{numbers.length} selected</small>
          </div>
          {game !== "Titli" && (
            <>
              <form className="easy-number-entry" onSubmit={addNumber}>
                <label className="sr-only" htmlFor="player-number-entry">
                  Number likhein
                </label>
                <input
                  id="player-number-entry"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={
                    game === "3D"
                      ? "Number likhein, jaise 007"
                      : "Number likhein, jaise 07"
                  }
                  value={entry}
                  onChange={(e) => {
                    setEntry(e.target.value);
                    setEntryError("");
                  }}
                />
                <button type="submit" className="btn" disabled={!entry.trim()}>
                  <Plus size={15} /> Add
                </button>
              </form>
              {entryError && (
                <p className="player-error" role="alert">
                  {entryError}
                </p>
              )}
              <div className="easy-grid-label">
                <span>Ya neeche se chunein</span>
                {game === "3D" && (
                  <select
                    aria-label="Hundreds group"
                    value={hundred}
                    onChange={(e) => setHundred(Number(e.target.value))}
                  >
                    {Array.from({ length: 10 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}00 – {i}99
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div
                className="easy-parity-selection"
                role="group"
                aria-label="Select All, Even or Odd numbers"
              >
                <div>
                  <span>Ek saath chunein</span>
                  <small>
                    {numberGroup[0]}–{numberGroup[99]} ke numbers
                  </small>
                </div>
                <div className="easy-parity-buttons">
                  {quickSelections.map(({ label, values, active }) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={active}
                      className={active ? "selected" : ""}
                      onClick={() =>
                        setNumbers((old) => [
                          ...old.filter((n) => !numberGroup.includes(n)),
                          ...values,
                        ])
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="player-number-pages">
                {[0, 1, 2, 3].map((p) => (
                  <button
                    key={p}
                    aria-pressed={page === p}
                    className={page === p ? "selected" : ""}
                    onClick={() => setPage(p)}
                  >
                    {String(
                      (game === "3D" ? hundred * 100 : 0) + p * 25,
                    ).padStart(digitsFor(game), "0")}{" "}
                    –{" "}
                    {String(
                      (game === "3D" ? hundred * 100 : 0) + p * 25 + 24,
                    ).padStart(digitsFor(game), "0")}
                  </button>
                ))}
              </div>
            </>
          )}
          <div
            className={`player-number-grid ${game === "Titli" ? "player-symbol-grid" : ""}`}
          >
            {visible.map((n) => (
              <button
                key={n}
                className={numbers.includes(n) ? "selected" : ""}
                aria-label={
                  game === "Titli" ? `${TITLI[Number(n)]} ${n}` : `Number ${n}`
                }
                aria-pressed={numbers.includes(n)}
                onClick={() => toggle(n)}
              >
                {game === "Titli" ? (
                  <>
                    <span className="player-symbol">{symbols[Number(n)]}</span>
                    <span>{TITLI[Number(n)]}</span>
                  </>
                ) : (
                  n
                )}
                {numbers.includes(n) && (
                  <span className="number-check">
                    <Check size={10} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="easy-picks">
            <div>
              <span>Aapke numbers</span>
              <button disabled={!numbers.length} onClick={() => setNumbers([])}>
                Sab hatayein
              </button>
            </div>
            {numbers.length ? (
              <div className="player-picked-numbers">
                {[...numbers].sort().map((n) => (
                  <button
                    key={n}
                    onClick={() => toggle(n)}
                    aria-label={`Remove ${n}`}
                  >
                    {game === "Titli" ? TITLI[Number(n)] : n}
                    <X size={12} />
                  </button>
                ))}
              </div>
            ) : (
              <p>Number par tap karke select karein.</p>
            )}
          </div>
        </section>
        <aside className="player-right-rail">
          <section className="player-betslip">
            <div className="easy-step-title">
              <span>2</span>
              <h2>Quantity chunein</h2>
            </div>
            <div className="player-slip-body">
              <p className="easy-amount-label">
                Har number ke liye kitne tickets?
              </p>
              {CoinControls ? <CoinControls price={price} quantity={quantity} max={limit} disabled={busy || !open} onQuantity={setQuantity} /> : <div className="player-chips">
                {[1, 2, 5, 10, 20].map((q) => (
                  <button
                    key={q}
                    className={`player-chip ${quantity === q ? "selected" : ""}`}
                    aria-label={`${q} units per number`}
                    aria-pressed={quantity === q}
                    onClick={() => setQuantity(q)}
                  >
                    {q}×
                  </button>
                ))}
              </div>}
              <div className="player-custom-quantity">
                <label htmlFor="player-quantity">
                  Quantity <small>Har selected series mein</small>
                </label>
                <div>
                  <button
                    aria-label="Decrease quantity"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    id="player-quantity"
                    aria-label="Quantity per number"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="500"
                    step="1"
                    value={quantity || ""}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                  <button
                    aria-label="Increase quantity"
                    disabled={quantity >= 500}
                    onClick={() => setQuantity(Math.min(500, quantity + 1))}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div
                className="series-price-breakdown"
                aria-label="Selected ticket prices"
              >
                {series.map((s) => (
                  <div key={s}>
                    <span>
                      {seriesName(s)}{" "}
                      <small>
                        {money(seriesPrice(pricing, s))} × {quantity || 0}
                      </small>
                    </span>
                    <strong>{money(seriesPrice(pricing, s) * quantity)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="player-checkout">
              <div className="easy-bet-math">
                <span>{calculation}</span>
                <strong>{money(total)}</strong>
              </div>
              <div className="player-total">
                <span>Total rakam</span>
                <strong>{money(total)}</strong>
              </div>
              {total > data.account.balance && (
                <p className="player-error" role="alert">
                  Wallet mein itni rakam nahi hai.
                </p>
              )}
              {total > limit && (
                <p className="player-error" role="alert">
                  Ek bet ki limit {money(limit)} hai.
                </p>
              )}
              {lines.length > 1000 && (
                <p className="player-error" role="alert">
                  Ek bet mein 1,000 tak selections kar sakte hain.
                </p>
              )}
              {!validQuantity && (
                <p className="player-error" role="alert">
                  Quantity 1 se 500 ke beech poora number honi chahiye.
                </p>
              )}
              {!open && (
                <p className="player-error" role="alert">
                  Bet abhi band hai. Agla draw aane dein.
                </p>
              )}
              <button className="player-buy" disabled={!valid} onClick={review}>
                <span>Bet lagayein · {money(total)}</span>
                <ArrowRight size={17} />
              </button>
              <p className="player-slip-note">
                Exact match par {payout}× us series ki rakam milegi. Jeet ki
                rakam wallet mein aayegi.
              </p>
            </div>
          </section>
        </aside>
      </div>
      {numbers.length > 0 && (
        <div className="easy-mobile-bet">
          <div>
            <small>{numbers.length} numbers selected</small>
            <strong>{money(total)}</strong>
          </div>
          <button
            disabled={!valid}
            onClick={review}
            aria-label="Mobile bet lagayein"
          >
            Bet lagayein
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {confirmation && (
        <Modal
          title="Bet confirm karein"
          onClose={() => !busy && setConfirmation(null)}
        >
          <div className="easy-review">
            <div>
              <span>Game / Series</span>
              <strong>
                {game} · {series.map(seriesName).join(", ")}
              </strong>
            </div>
            <div>
              <span>Draw</span>
              <strong>{draw ? time(draw.ends) : "Unavailable"}</strong>
            </div>
            <div>
              <span>Numbers</span>
              <strong>
                {[...numbers]
                  .sort()
                  .map((n) => (game === "Titli" ? TITLI[Number(n)] : n))
                  .join(", ")}
              </strong>
            </div>
            <div>
              <span>Har number par</span>
              <strong>{money(perNumber)}</strong>
            </div>
            <div className="easy-review-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
          </div>
          <Notice>
            {open
              ? `Wallet se ${money(total)} katega. Confirm karne ke baad hi bet lagegi.`
              : "Yeh draw band ho gaya. Wapas jaakar agla draw chunein."}
          </Notice>
          <div className="modal-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Wapas
            </button>
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => void buy()}
            >
              <Busy busy={busy}>Confirm bet · {money(total)}</Busy>
            </button>
          </div>
        </Modal>
      )}
      {sold && (
        <Modal title="Bet lag gayi" onClose={() => setSold(null)}>
          <Success title="Aapka ticket save ho gaya.">
            <p>
              {sold.game} · {sold.lines.length} selections · {money(sold.total)}
            </p>
            <code>{sold.id}</code>
            <p>Result ke baad jeet ki rakam wallet mein aa jayegi.</p>
          </Success>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setSold(null);
                navigate("tickets");
              }}
            >
              My tickets
            </button>
            <button className="btn primary" onClick={() => setSold(null)}>
              Nayi bet
            </button>
          </div>
        </Modal>
      )}
      {rules && (
        <Modal title="Kaise khelein?" onClose={() => setRules(false)}>
          <div className="player-rules">
            <div>
              <b>1</b>
              <span>
                <strong>Number chunein</strong>
                <p>
                  Upar Irland Lotto  ticket chunein, phir number likhkar Add karein ya
                  number buttons par tap karein. Game aur draw badalne ke liye
                  More options kholein.
                </p>
              </span>
            </div>
            <div>
              <b>2</b>
              <span>
                <strong>Ticket quantity chunein</strong>
                <p>
                  Har Irland Lotto  series ka apna fixed rate hai, jo ticket par diya
                  hai. Quantity badhane par har selected series mein utne
                  tickets lagenge. Total = numbers × quantity × selected series
                  ke rates ka jod.
                </p>
              </span>
            </div>
            <div>
              <b>3</b>
              <span>
                <strong>Bet confirm karein</strong>
                <p>
                  Total check karke confirm karein. Number aur series dono match
                  hone par return milega. Return mein aapki lagayi rakam shamil
                  hai.
                </p>
              </span>
            </div>
          </div>
          <Notice>
            Draw se 10 seconds pehle bet aur cancellation band ho jaate hain.
            {data.mode === "demo"
              ? " Demo ₹ balance ki cash value nahi hai."
              : ""}
          </Notice>
          <button className="btn primary full" onClick={() => setRules(false)}>
            Samajh gaya
          </button>
        </Modal>
      )}
    </div>
  );
}
