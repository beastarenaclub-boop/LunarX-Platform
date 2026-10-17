import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Dices,
  Eraser,
  Grid2X2,
  Info,
  Layers3,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import { seriesName, money, date, SERIES, time, TITLI } from "./api";
import type { Game, Ticket as TicketType } from "./types";
import type { ViewProps } from "./App";
import { Badge, Busy, Heading, Modal, Notice, Success } from "./ui";
import { SeriesTickets } from "./SeriesTickets";
import { priceRange, seriesPrice } from "./pricing";

const symbols = ["🦋", "🌹", "☀️", "🌙", "⭐", "🍃", "💎", "👑", "♥", "🔔"];
function permutations(value: string): string[] {
  if (value.length <= 1) return [value];
  return [
    ...new Set(
      [...value].flatMap((c, i) =>
        permutations(value.slice(0, i) + value.slice(i + 1)).map((p) => c + p),
      ),
    ),
  ];
}
export function Terminal({
  data,
  now,
  navigate,
  run,
  busy,
  printTicket,
}: ViewProps) {
  const [game, setGame] = useState<Game>("2D"),
    [series, setSeries] = useState<string[]>(["JP10"]),
    [numbers, setNumbers] = useState<string[]>([]),
    [quantity, setQuantity] = useState(1),
    [hundred, setHundred] = useState(0),
    [customer, setCustomer] = useState(""),
    [chosenDraw, setChosenDraw] = useState(""),
    [confirm, setConfirm] = useState(false),
    [sold, setSold] = useState<TicketType | null>(null),
    [rules, setRules] = useState(false),
    [filter, setFilter] = useState("all");
  const [confirmationDraw, setConfirmationDraw] = useState("");
  const available = data.draws.filter(
      (d) => d.status === "open" && d.closes > now,
    ),
    draw = confirm
      ? data.draws.find((d) => d.id === confirmationDraw)
      : (available.find((d) => d.id === chosenDraw) ?? available[0]),
    last = data.draws.filter((d) => d.status === "settled").at(-1),
    isShop = data.account.role === "shop";
  const idempotency = useRef({ payload: "", key: "" });
  const pricing = draw?.config ?? data.settings,
    payout = draw?.config.payouts[game] ?? data.settings.payouts[game];
  const lines = useMemo(
    () =>
      series.flatMap((s) =>
        numbers.map((n) => ({ series: s, number: n, quantity })),
      ),
    [series, numbers, quantity],
  );
  const total = lines.reduce(
      (s, l) => s + l.quantity * seriesPrice(pricing, l.series),
      0,
    ),
    units = lines.length * quantity;
  const remaining = Math.max(
      0,
      Math.floor(((draw?.closes ?? now) - now) / 1000),
    ),
    countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const limit = draw?.config.maxTicket ?? data.settings.maxTicket;
  const valid =
    !!draw &&
    draw.status === "open" &&
    draw.closes > now &&
    numbers.length > 0 &&
    series.length > 0 &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 500 &&
    total <= data.account.balance &&
    total <= limit &&
    lines.length <= 1000 &&
    data.settings.salesEnabled &&
    !busy;
  function openConfirmation() {
    if (!draw || !valid) return;
    setConfirmationDraw(draw.id);
    setConfirm(true);
  }
  const visible = Array.from({ length: game === "Titli" ? 10 : 100 }, (_, i) =>
    String(game === "3D" ? hundred * 100 + i : i).padStart(
      game === "3D" ? 3 : game === "2D" ? 2 : 1,
      "0",
    ),
  );
  function selectBatch(batch: string[]) {
    setNumbers((prev) => [...new Set([...prev, ...batch])]);
  }
  function toggle(n: string) {
    setNumbers((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  }
  function reset() {
    setNumbers([]);
    setSeries(["JP10"]);
    setQuantity(1);
    setCustomer("");
    setFilter("all");
  }
  function quickPick() {
    const values = new Uint32Array(10);
    crypto.getRandomValues(values);
    const max = game === "3D" ? 1000 : game === "2D" ? 100 : 10,
      digits = game === "3D" ? 3 : game === "2D" ? 2 : 1;
    selectBatch(
      [
        ...new Set(
          Array.from(values).map((v) => String(v % max).padStart(digits, "0")),
        ),
      ].slice(0, 5),
    );
  }
  async function sell() {
    if (!valid || !draw) return;
    const body = { drawId: draw.id, game, lines, customer },
      payload = JSON.stringify(body);
    if (idempotency.current.payload !== payload)
      idempotency.current = { payload, key: crypto.randomUUID() };
    const ticket = await run<TicketType>(
      "/tickets",
      body,
      "Ticket successfully issued.",
      idempotency.current.key,
    );
    if (ticket) {
      setConfirm(false);
      setSold(ticket);
      setNumbers([]);
      setCustomer("");
      idempotency.current = { payload: "", key: "" };
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.matches("input,textarea,select") ||
        confirm ||
        sold ||
        rules
      )
        return;
      if (["F1", "F2", "F3", "F5", "F6"].includes(e.key)) e.preventDefault();
      if (e.key === "F1") navigate("results");
      if (e.key === "F2") navigate("reports");
      if (e.key === "F3" && isShop) {
        const t = data.tickets.find((t) => t.status !== "cancelled");
        if (t) void printTicket(t.id);
      }
      if (e.key === "F5") reset();
      if (e.key === "F6" && valid) openConfirmation();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    confirm,
    sold,
    rules,
    navigate,
    data.tickets,
    isShop,
    printTicket,
    valid,
    draw?.id,
  ]);
  return (
    <>
      <Heading
        eyebrow={
          isShop ? "LET’S MAKE TODAY A GOOD ONE" : "A LITTLE LUCK STARTS HERE"
        }
        title={isShop ? "Ticket terminal" : "Pick your lucky numbers"}
        description={
          isShop
            ? "A smoother counter. A better day. Everything you need to issue a ticket."
            : "Choose a game, select your numbers and follow the next draw."
        }
        action={
          <div className="balance-card">
            <span className="balance-icon">
              <Wallet size={19} />
            </span>
            <div>
              <small>
                {isShop ? "Available shop balance" : "Your available balance"}
              </small>
              <strong>{money(data.account.balance)}</strong>
            </div>
            <button
              className="icon-btn"
              aria-label="Open wallet"
              onClick={() => navigate("wallet")}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        }
      />
      <div className="draw-banner">
        <div className="draw-banner-title">
          <span className="draw-orb">
            <Layers3 size={23} />
          </span>
          <div>
            <div className="draw-caption">
              {isShop ? "YOUR COUNTER IS READY" : "YOUR NEXT CHANCE"}
              <Badge kind={data.settings.salesEnabled ? "success" : "warning"}>
                {data.settings.salesEnabled ? "Sales open" : "Sales paused"}
              </Badge>
            </div>
            <h2>The next lucky moment awaits.</h2>
            <p>
              Irland Lotto 10–Irland Lotto 19 <i /> {priceRange(pricing)} per ticket <i />{" "}
              {draw?.config.interval ?? data.settings.interval}-minute draws
            </p>
          </div>
        </div>
        <div className="draw-countdown">
          <div>
            <Clock3 size={14} /> SALES CLOSE IN
          </div>
          <strong>
            {countdown.slice(0, 2)}
            <span>:</span>
            {countdown.slice(3)}
          </strong>
          <small>Draw at {draw ? time(draw.ends) : "—"} · 10s cutoff</small>
        </div>
        <div className="banner-lines" />
      </div>
      <section className="results-ribbon">
        <div className="results-ribbon-label">
          <Trophy size={17} />
          <span>
            Latest results
            <small>{last ? time(last.ends) : "Awaiting first draw"}</small>
          </span>
        </div>
        <div className="results-ribbon-grid">
          {SERIES.map((s, i) => (
            <div key={s} data-series={s}>
              <span>{seriesName(s)}</span>
              <strong className={`result-color-${i % 5}`}>
                {last?.results?.[s]?.[game] ?? "—"}
              </strong>
            </div>
          ))}
        </div>
        <button
          aria-label="See all results"
          className="icon-btn"
          onClick={() => navigate("results")}
        >
          <ArrowRight size={17} />
        </button>
      </section>
      <section
        className="shop-ticket-selection"
        aria-label="Choose ticket series"
      >
        <div className="game-toolbar">
          <div className="game-tabs">
            {(["2D", "3D", "Titli"] as Game[]).map((g) => (
              <button
                key={g}
                className={game === g ? "active" : ""}
                onClick={() => {
                  setGame(g);
                  setNumbers([]);
                  setFilter("all");
                }}
              >
                {g === "Titli" ? <Sparkles size={16} /> : <Grid2X2 size={15} />}{" "}
                {g}
                <small>
                  {g === "2D" ? "00–99" : g === "3D" ? "000–999" : "Symbols"}
                </small>
              </button>
            ))}
          </div>
          <button className="text-link" onClick={() => setRules(true)}>
            <Info size={15} /> Game guide
          </button>
        </div>
        <SeriesTickets
          selected={series}
          onChange={setSeries}
          pricing={pricing}
          drawTime={draw?.ends}
          game={game}
          selectionMode="multiple"
        />
      </section>
      <div className="terminal-layout">
        <section className="number-workspace">
          <div className="number-body">
            <div className="number-main">
              <div className="number-section-head">
                <div className="section-label">
                  02 <span>PICK YOUR NUMBERS</span>
                </div>
                <span className="selection-count">
                  {numbers.length} selected
                </span>
              </div>
              <div className="number-filters">
                <div className="segmented">
                  {["all", "even", "odd"].map((f) => (
                    <button
                      className={filter === f ? "active" : ""}
                      key={f}
                      onClick={() => setFilter(f)}
                    >
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="quick-actions">
                  <button onClick={quickPick}>
                    <Dices size={14} />
                    Quick pick
                  </button>
                  <button
                    onClick={() => setNumbers([])}
                    disabled={!numbers.length}
                    aria-label="Clear selected numbers"
                  >
                    <Eraser size={15} />
                  </button>
                </div>
              </div>
              {game === "3D" && (
                <div className="hundreds-selector" aria-label="Hundreds group">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button
                      key={i}
                      className={hundred === i ? "active" : ""}
                      onClick={() => setHundred(i)}
                    >
                      {i}00
                    </button>
                  ))}
                </div>
              )}
              {game === "Titli" ? (
                <div className="symbol-grid">
                  {visible.map((n, i) => (
                    <button
                      aria-pressed={numbers.includes(n)}
                      className={numbers.includes(n) ? "selected" : ""}
                      key={n}
                      onClick={() => toggle(n)}
                    >
                      <span>{symbols[i]}</span>
                      <strong>{TITLI[i]}</strong>
                      <small>{n}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="number-grid-wrap">
                  <div className="column-picks">
                    <button
                      title="Select every visible number"
                      onClick={() =>
                        selectBatch(
                          visible.filter(
                            (n) =>
                              filter === "all" ||
                              Number(n) % 2 === (filter === "even" ? 0 : 1),
                          ),
                        )
                      }
                    >
                      <Grid2X2 size={11} />
                    </button>
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        title={`Select column ${i}`}
                        onClick={() =>
                          selectBatch(
                            visible.filter((n) => Number(n) % 10 === i),
                          )
                        }
                      >
                        {i}
                        <ChevronDown size={9} />
                      </button>
                    ))}
                  </div>
                  <div className="number-grid">
                    {Array.from({ length: 10 }, (_, row) => (
                      <div className="number-grid-row" key={row}>
                        <button
                          className="row-pick"
                          title={`Select row ${row}`}
                          onClick={() =>
                            selectBatch(visible.slice(row * 10, row * 10 + 10))
                          }
                        >
                          {row}
                          <ArrowRight size={9} />
                        </button>
                        {visible.slice(row * 10, row * 10 + 10).map((n) => (
                          <button
                            key={n}
                            aria-label={`Number ${n}`}
                            aria-pressed={numbers.includes(n)}
                            disabled={
                              filter !== "all" &&
                              Number(n) % 2 !== (filter === "even" ? 0 : 1)
                            }
                            className={`number-cell ${numbers.includes(n) ? "selected" : ""}`}
                            onClick={() => toggle(n)}
                          >
                            {n}
                            {numbers.includes(n) && <i />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid-footer">
                <span>
                  <i />
                  Selected number
                </span>
                <div>
                  <button
                    disabled={!numbers.length}
                    onClick={() => selectBatch(numbers.flatMap(permutations))}
                    title="Add every unique permutation of your selected numbers"
                  >
                    Family
                  </button>
                  <button
                    disabled={!numbers.length || game === "Titli"}
                    onClick={() => {
                      const base = Number(numbers[0]) % 100;
                      selectBatch(
                        visible.filter(
                          (n) =>
                            Math.floor((Number(n) % 100) / 10) ===
                              Math.floor(base / 10) ||
                            Number(n) % 10 === base % 10,
                        ),
                      );
                    }}
                    title="Select the row and column of your first chosen number"
                  >
                    Cross
                  </button>
                  <button
                    disabled={game === "Titli"}
                    onClick={() => {
                      const base = Number(numbers[0] ?? "0") % 100;
                      selectBatch(
                        visible.filter(
                          (n) =>
                            Math.floor((Number(n) % 100) / 50) ===
                              Math.floor(base / 50) &&
                            Math.floor((Number(n) % 10) / 5) ===
                              Math.floor((base % 10) / 5),
                        ),
                      );
                    }}
                    title="Select a 5 by 5 block containing your first chosen number"
                  >
                    Box 25
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="terminal-note">
            <ShieldCheck size={15} />
            <span>
              Server-verified tickets. Automatic draw cutoff. Every entry
              recorded.
            </span>
            <span className="shortcut-hint">F1 Results · F2 Reports</span>
          </div>
        </section>
        <aside className="ticket-slip">
          <div className="slip-heading">
            <span>
              <Ticket size={20} /> {isShop ? "New ticket" : "Your ticket"}
            </span>
            <span className="slip-tag">{game}</span>
          </div>
          <div className="slip-content">
            <label className="draw-select-label">
              DRAW TIME
              <select
                aria-label="Draw time"
                value={draw?.id ?? ""}
                onChange={(e) => setChosenDraw(e.target.value)}
              >
                {available.map((d, i) => (
                  <option value={d.id} key={d.id}>
                    {time(d.ends)}
                    {i === 0 ? " · Next draw" : " · Advance draw"}
                  </option>
                ))}
              </select>
            </label>
            <div className="slip-section-title">
              <span>YOUR SELECTIONS</span>
              <button
                disabled={!numbers.length}
                onClick={() => setNumbers([])}
                aria-label="Clear ticket"
              >
                <Trash2 size={13} />
              </button>
            </div>
            {numbers.length > 0 ? (
              <>
                <div className="slip-series">
                  {series.map((s) => (
                    <span key={s}>{seriesName(s)}</span>
                  ))}
                  {series.length === 0 && (
                    <span className="text-danger">Select a series</span>
                  )}
                </div>
                <div className="selected-numbers">
                  {[...numbers].sort().map((n) => (
                    <button
                      key={n}
                      title={`Remove ${n}`}
                      onClick={() => toggle(n)}
                    >
                      {game === "Titli" ? symbols[Number(n)] : n}
                      <X size={10} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="slip-empty">
                <div className="mini-ticket">
                  <Ticket size={23} />
                  <Plus size={12} />
                </div>
                <strong>Your next ticket starts here</strong>
                <p>
                  Pick a series and tap a number.
                  <br />
                  We’ll take care of the rest.
                </p>
              </div>
            )}
            <div className="quantity-section">
              <div className="section-label">
                03 <span>SET QUANTITY</span>
              </div>
              <div className="quantity-control">
                <button
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Minus size={15} />
                </button>
                <input
                  aria-label="Quantity per number"
                  type="number"
                  min="1"
                  max="500"
                  value={quantity || ""}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
                <button
                  aria-label="Increase quantity"
                  onClick={() => setQuantity(Math.min(500, quantity + 1))}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="quantity-presets">
                {[1, 2, 5, 10].map((q) => (
                  <button
                    className={quantity === q ? "active" : ""}
                    key={q}
                    onClick={() => setQuantity(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            {isShop && (
              <label className="customer-label">
                Customer reference <span>optional</span>
                <input
                  placeholder="Name or reference"
                  maxLength={60}
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                />
              </label>
            )}
            <div className="slip-calculations">
              <div>
                <span>Selections</span>
                <strong>
                  {numbers.length} × {series.length} series
                </strong>
              </div>
              <div>
                <span>Total units</span>
                <strong>{units}</strong>
              </div>
              <div>
                <span>Price per ticket</span>
                <strong>{priceRange(pricing, series)}</strong>
              </div>
              {series.map((s) => (
                <div key={s}>
                  <span>
                    {seriesName(s)} · {money(seriesPrice(pricing, s))} ×{" "}
                    {numbers.length * quantity}
                  </span>
                  <strong>
                    {money(seriesPrice(pricing, s) * numbers.length * quantity)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
          <div className="slip-checkout">
            <div className="slip-total">
              <span>Total amount</span>
              <strong>{money(total)}</strong>
            </div>
            {total > data.account.balance && (
              <p className="inline-error">Not enough available balance.</p>
            )}
            {total > limit && (
              <p className="inline-error">Maximum {money(limit)} per ticket.</p>
            )}
            {!data.settings.salesEnabled && (
              <p className="inline-error">
                Sales are paused by the administrator.
              </p>
            )}
            <button
              className="btn primary full sale-button"
              disabled={!valid}
              onClick={openConfirmation}
            >
              <Ticket size={17} />
              {isShop ? "Issue ticket" : "Buy ticket"}
              <span>F6</span>
            </button>
            <button className="reset-ticket" onClick={reset}>
              <RotateCcw size={13} /> Reset ticket <kbd>F5</kbd>
            </button>
          </div>
          <div className="slip-perforation" />
          <div className="slip-bottom">
            <LockIcon />
            Protected & recorded in your ledger
          </div>
        </aside>
      </div>
      <section className="terminal-bottom">
        <div>
          <span className="live-dot" />
          <span>
            {isShop ? "Counter" : "Account"} {data.account.id}
          </span>
          <i />
          <span>{data.stats.tickets} tickets today</span>
        </div>
        <div>
          <button onClick={() => navigate("tickets")}>
            <Ticket size={14} /> {isShop ? "Tickets & claims" : "My tickets"}
          </button>
          {isShop && (
            <button
              disabled={
                busy || !data.tickets.some((t) => t.status !== "cancelled")
              }
              onClick={() => {
                const t = data.tickets.find((t) => t.status !== "cancelled");
                if (t) void printTicket(t.id);
              }}
            >
              <Printer size={14} /> Reprint last <kbd>F3</kbd>
            </button>
          )}
          <button onClick={() => navigate("support")}>
            Need help? <ArrowRight size={13} />
          </button>
        </div>
      </section>
      {confirm && (
        <Modal
          title="Confirm your ticket"
          onClose={() => !busy && setConfirm(false)}
        >
          <div className="confirm-summary">
            <span className="confirm-icon">
              <Ticket size={26} />
            </span>
            <h3>{money(total)}</h3>
            <p>
              {game} · {lines.length} selections · {units} units
            </p>
            <Badge kind="success">
              Draw {draw ? time(draw.ends) : "unavailable"}
            </Badge>
          </div>
          <Notice>
            {money(total)} will be deducted from your{" "}
            {isShop ? "shop" : "personal"} balance. Check your numbers before
            confirming.
          </Notice>
          <div className="confirm-numbers">
            {series.map(seriesName).join(", ")}
            <br />
            <strong>{[...numbers].sort().join(" · ")}</strong>
          </div>
          <div className="modal-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep editing
            </button>
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => void sell()}
            >
              <Busy busy={busy}>Confirm & issue</Busy>
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {sold && (
        <Modal title="Ticket issued" onClose={() => setSold(null)}>
          <Success title="You’re all set.">
            <p>Your ticket has been saved and your balance updated.</p>
            <code>{sold.id}</code>
            <p>
              {money(sold.total)} · {sold.lines.length} selections
            </p>
          </Success>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setSold(null);
                navigate("tickets");
              }}
            >
              View ticket
            </button>
            {isShop ? (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void printTicket(sold.id)}
              >
                <Printer size={16} /> Print receipt
              </button>
            ) : (
              <button className="btn primary" onClick={() => setSold(null)}>
                Play again <ArrowRight size={16} />
              </button>
            )}
          </div>
        </Modal>
      )}
      {rules && (
        <Modal title={`${game} · How to play`} onClose={() => setRules(false)}>
          <div className="rules-content">
            <div className="rule-number">
              {game === "2D"
                ? "00–99"
                : game === "3D"
                  ? "000–999"
                  : "10 symbols"}
            </div>
            <p>
              Choose one or more Irland Lotto  series, pick your numbers, then set a
              quantity for each selection. Every selected series gets its own
              entry for each number.
            </p>
            <ul>
              <li>
                Each Irland Lotto  series has a fixed ticket price, shown on its card:
                <strong> {priceRange(pricing)}</strong>.
              </li>
              <li>
                An exact match in the same series pays{" "}
                <strong>{payout}× the stake</strong>, including your stake.
              </li>
              <li>Sales and cancellations close 10 seconds before the draw.</li>
              <li>
                Family adds unique digit permutations. Cross selects a row and
                column. Box 25 selects a 5 × 5 block.
              </li>
              <li>
                Shop wins must be claimed at the issuing shop. User wins are
                credited automatically.
              </li>
              <li>
                These are configured local game rules; demo balance has no cash
                value.
              </li>
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}
function LockIcon() {
  return <ShieldCheck size={12} />;
}
