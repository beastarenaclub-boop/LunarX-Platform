import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  Download,
  FileText,
  Headphones,
  KeyRound,
  Landmark,
  Layers3,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Ticket as TicketIcon,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { ViewProps } from "./App";
import type { Account, Draw, Game, Settings, Ticket } from "./types";
import { priceRange, seriesPrice } from "./pricing";
import {
  seriesName,
  money,
  csvDownload,
  date,
  SERIES,
  time,
  TITLI,
} from "./api";
import {
  Badge,
  Busy,
  Empty,
  Heading,
  Modal,
  Notice,
  Stat,
  Success,
  TextLink,
} from "./ui";

const kind = (status: string) =>
  ({
    pending: "warning",
    won: "success",
    claimed: "success",
    lost: "neutral",
    cancelled: "danger",
    open: "warning",
    resolved: "success",
  })[status] ?? "neutral";
const title = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const totals = (tickets: Ticket[]) => {
  const valid = tickets.filter((t) => t.status !== "cancelled");
  return {
    sales: valid.reduce((s, t) => s + t.total, 0),
    prizes: valid.reduce((s, t) => s + t.payout, 0),
    commission: valid
      .filter((t) => t.status !== "pending")
      .reduce((s, t) => s + t.commission, 0),
    count: valid.length,
  };
};
const dateKey = (n: number, tz = "Asia/Dubai") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(n);
function ticketCsv(tickets: Ticket[], name = "tickets.csv") {
  csvDownload(name, [
    [
      "Ticket",
      "Account",
      "Created",
      "Game",
      "Draw",
      "Selections",
      "Quantity",
      "Sale (INR)",
      "Prize (INR)",
      "Commission (INR)",
      "Status",
    ],
    ...tickets.map((t) => [
      t.id,
      t.seller_id,
      new Date(t.created).toISOString(),
      t.game,
      t.draw_id,
      t.lines
        .map(
          (l) =>
            `${seriesName(l.series)}:${l.number}x${l.quantity}@INR${l.unitPrice}`,
        )
        .join(" "),
      t.lines.reduce((s, l) => s + l.quantity, 0),
      t.total,
      t.payout,
      t.commission,
      t.status,
    ]),
  ]);
}
function Panel({
  title: label,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{label}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function TicketRows({
  tickets,
  onSelect,
}: {
  tickets: Ticket[];
  onSelect: (t: Ticket) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Ticket / customer</th>
            <th>Game</th>
            <th>Selections</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>
                <button className="table-ticket" onClick={() => onSelect(t)}>
                  {t.id}
                </button>
                <small>
                  {t.customer} · {time(t.created)}
                </small>
              </td>
              <td>
                <span className="game-pill">{t.game}</span>
              </td>
              <td>
                {t.lines.length}
                <small>
                  {t.lines.reduce((s, l) => s + l.quantity, 0)} units
                </small>
              </td>
              <td className="amount">
                {money(t.total)}
                {t.payout > 0 && (
                  <small className="text-green">+{money(t.payout)} prize</small>
                )}
              </td>
              <td>
                <Badge kind={kind(t.status)}>{title(t.status)}</Badge>
              </td>
              <td>
                <button
                  className="icon-btn"
                  aria-label={`Open ticket ${t.id}`}
                  onClick={() => onSelect(t)}
                >
                  <ArrowUpRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({ data, now, navigate }: ViewProps) {
  const role = data.account.role,
    net = data.stats.sales - data.stats.prizes - data.stats.commission;
  const next = data.draws.find((d) => d.status === "open" && d.closes > now),
    last = data.draws.filter((d) => d.status === "settled").at(-1);
  const hours = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 3600000;
      return {
        label: time(end).split(" ")[0],
        amount: data.tickets
          .filter(
            (t) =>
              t.created > end - 3600000 &&
              t.created <= end &&
              t.status !== "cancelled",
          )
          .reduce((s, t) => s + t.total, 0),
      };
    }),
    max = Math.max(1, ...hours.map((h) => h.amount));
  return (
    <>
      <Heading
        eyebrow="YOUR WORKSPACE AT A GLANCE"
        title={
          role === "admin"
            ? "The bigger picture."
            : role === "agent"
              ? "A stronger network, together."
              : `Welcome back, ${data.account.name.split(" ")[0]}.`
        }
        description={
          role === "admin"
            ? "A clear view of every draw, every shop and every transaction."
            : role === "agent"
              ? "Your shops, sales and commissions. All moving in the same direction."
              : "Your tickets, balance and latest activity, at a glance."
        }
        action={
          <button className="btn" onClick={() => navigate("reports")}>
            <CalendarDays size={16} />
            Today’s report
            <ArrowUpRight size={15} />
          </button>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Today’s ticket sales"
          value={`${money(data.stats.sales)}`}
          detail={`${data.stats.tickets} issued tickets today`}
          icon={<TicketIcon size={19} />}
        />
        <Stat
          label={role === "agent" ? "Earned commission" : "Prize winnings"}
          value={`${money(role === "agent" ? data.stats.commission : data.stats.prizes)}`}
          detail={
            role === "agent"
              ? "Credited after draw settlement"
              : `${data.stats.pendingClaims} prizes awaiting claim`
          }
          icon={<Trophy size={19} />}
          accent="gold"
        />
        <Stat
          label={
            role === "admin"
              ? "Net after prizes & commission"
              : "Available balance"
          }
          value={`${money(role === "admin" ? net : data.account.balance)}`}
          detail={
            role === "admin"
              ? "Based on today’s tickets"
              : "Ready for your next transaction"
          }
          icon={<Wallet size={19} />}
          accent="blue"
        />
        <Stat
          label={
            role === "admin" || role === "agent"
              ? "Active network accounts"
              : "Draws ahead"
          }
          value={String(
            role === "admin" || role === "agent"
              ? data.accounts.filter((a) => a.active).length
              : data.draws.filter((d) => d.status === "open" && d.closes > now)
                  .length,
          )}
          detail={
            role === "admin" || role === "agent"
              ? `${data.accounts.filter((a) => a.role === "shop").length} registered shops`
              : "Advance booking is available"
          }
          icon={<Store size={19} />}
          accent="violet"
        />
      </div>
      <div className="overview-grid">
        <Panel
          title="Sales activity"
          subtitle="Your last 12 hours · recorded ticket sales"
          action={<Badge kind="success">Live data</Badge>}
        >
          <div className="chart-total">
            <strong>{money(hours.reduce((s, h) => s + h.amount, 0))}</strong>
            <span>
              <TrendingUp size={16} /> Every ticket accounted for
            </span>
          </div>
          <div className="bar-chart">
            <div className="chart-grid">
              <span>{money(max)}</span>
              <span>{money(Math.round(max / 2))}</span>
              <span>₹0</span>
            </div>
            <div className="chart-bars">
              {hours.map((h, i) => (
                <div key={i} title={`${h.label}: ${h.amount}`}>
                  <div
                    className={i === hours.length - 1 ? "current" : ""}
                    style={{
                      height: `${h.amount ? Math.max(3, (h.amount / max) * 100) : 1}%`,
                    }}
                  />
                  <small>{i % 2 === 0 ? h.label : ""}</small>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <section className="next-draw-card">
          <div>
            <Layers3 size={22} />
            <Badge kind="success">Next draw</Badge>
          </div>
          <span>THE COUNTDOWN IS ON</span>
          <h2>
            A little luck.
            <br />A new possibility.
          </h2>
          <strong>{next ? time(next.ends) : "Scheduling…"}</strong>
          <p>
            {next ? date(next.ends) : ""} · {data.settings.timezone}
          </p>
          <div className="draw-game-pills">
            <span>2D</span>
            <span>3D</span>
            <span>Titli</span>
          </div>
          <button
            className="btn primary full"
            onClick={() =>
              navigate(
                role === "shop" || role === "user" ? "terminal" : "results",
              )
            }
          >
            {role === "shop" || role === "user"
              ? "Open ticket terminal"
              : "View draw schedule"}
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="overview-grid bottom">
        <Panel
          title="Recent tickets"
          subtitle="The latest activity in your workspace"
          action={
            <TextLink onClick={() => navigate("tickets")}>All tickets</TextLink>
          }
        >
          {data.tickets.length ? (
            <TicketRows
              tickets={data.tickets.slice(0, 5)}
              onSelect={() => navigate("tickets")}
            />
          ) : (
            <Empty
              title="Your first ticket is the start."
              description="Issued tickets and their status will appear here."
            />
          )}
        </Panel>
        <Panel
          title="Latest winning numbers"
          subtitle={
            last
              ? `${time(last.ends)} · 2D draw`
              : "Results appear after the first draw"
          }
          action={<Trophy size={19} />}
        >
          <div className="mini-results">
            {SERIES.slice(0, 6).map((s, i) => (
              <div key={s} data-series={s}>
                <span>{seriesName(s)}</span>
                <strong className={`result-color-${i % 5}`}>
                  {last?.results?.[s]?.["2D"] ?? "—"}
                </strong>
              </div>
            ))}
          </div>
          <div className="panel-foot">
            <TextLink onClick={() => navigate("results")}>
              Explore all results
            </TextLink>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function Tickets(props: ViewProps) {
  const { data, now, run, busy, printTicket } = props;
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Ticket | null>(null),
    [action, setAction] = useState<"cancel" | "claim" | null>(null);
  const current = selected
    ? (data.tickets.find((t) => t.id === selected.id) ?? selected)
    : null;
  const filtered = data.tickets.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      `${t.id} ${t.customer} ${t.seller_id} ${t.lines.map((l) => l.number).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / 20) - 1),
    safePage = Math.min(page, maxPage);
  const draw = data.draws.find((d) => d.id === current?.draw_id),
    owns = current?.seller_id === data.account.id;
  async function act() {
    if (!current || !action) return;
    const result = await run(
      `/tickets/${current.id}/${action}`,
      {},
      action === "cancel"
        ? "Ticket cancelled and amount refunded."
        : "Prize claim recorded and shop balance updated.",
    );
    if (result) setAction(null);
  }
  return (
    <>
      <Heading
        eyebrow="EVERY ENTRY, IN ONE PLACE"
        title={data.account.role === "user" ? "My tickets" : "Tickets & claims"}
        description="Find a ticket, check its result and follow its complete journey."
        action={
          <button className="btn" onClick={() => ticketCsv(filtered)}>
            <Download size={16} />
            Export CSV
          </button>
        }
      />
      <div className="stats-grid compact">
        <Stat
          label="Issued tickets"
          value={String(
            data.tickets.filter((t) => t.status !== "cancelled").length,
          )}
          detail="Across your ticket history"
          icon={<TicketIcon size={18} />}
        />
        <Stat
          label="Awaiting draw"
          value={String(
            data.tickets.filter((t) => t.status === "pending").length,
          )}
          detail="Entries confirmed on the server"
          icon={<Clock3 size={18} />}
          accent="blue"
        />
        <Stat
          label="Ready to claim"
          value={String(data.stats.pendingClaims)}
          detail="Winning shop tickets"
          icon={<Trophy size={18} />}
          accent="gold"
        />
      </div>
      <Panel
        title="Ticket history"
        subtitle={`${filtered.length} matching tickets`}
      >
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search tickets"
              placeholder="Ticket ID, customer or number…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label="Ticket status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            {["all", "pending", "won", "claimed", "lost", "cancelled"].map(
              (s) => (
                <option value={s} key={s}>
                  {s === "all" ? "All statuses" : title(s)}
                </option>
              ),
            )}
          </select>
        </div>
        {filtered.length ? (
          <TicketRows
            tickets={filtered.slice(safePage * 20, safePage * 20 + 20)}
            onSelect={setSelected}
          />
        ) : (
          <Empty
            title={
              query ? "No matching tickets" : "Your ticket history starts here"
            }
            description="Tickets you issue or purchase appear here with their live status."
          />
        )}
        <div className="pagination">
          <span>
            {filtered.length
              ? `${safePage * 20 + 1}–${Math.min(filtered.length, safePage * 20 + 20)} of ${filtered.length}`
              : "0 tickets"}
          </span>
          <button
            className="icon-btn"
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-btn"
            aria-label="Next page"
            disabled={safePage >= maxPage}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </Panel>
      {current && (
        <Modal
          title="Ticket details"
          wide
          onClose={() => {
            if (!busy) {
              setSelected(null);
              setAction(null);
            }
          }}
        >
          <div className="ticket-detail-head">
            <div>
              <code>{current.id}</code>
              <p>
                {current.customer} · {date(current.created)}{" "}
                {time(current.created)}
              </p>
            </div>
            <Badge kind={kind(current.status)}>{title(current.status)}</Badge>
          </div>
          <div className="detail-stats">
            <div>
              <span>Game</span>
              <strong>{current.game}</strong>
            </div>
            <div>
              <span>Ticket total</span>
              <strong>{money(current.total)}</strong>
            </div>
            <div>
              <span>Prize</span>
              <strong className="text-green">{money(current.payout)}</strong>
            </div>
          </div>
          <p className="muted">
            Issued by {current.seller_id} · Draw{" "}
            {draw ? `${date(draw.ends)} ${time(draw.ends)}` : current.draw_id}
          </p>
          <div className="table-scroll detail-lines">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Number</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Amount</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {current.lines.map((l) => (
                  <tr key={l.series + l.number}>
                    <td>{seriesName(l.series)}</td>
                    <td className="number-text">
                      {l.number}
                      {current.game === "Titli"
                        ? ` · ${TITLI[Number(l.number)]}`
                        : ""}
                    </td>
                    <td>{l.quantity}</td>
                    <td>{money(l.unitPrice)}</td>
                    <td>{money(l.unitPrice * l.quantity)}</td>
                    <td>
                      {current.status === "cancelled" ? (
                        "Cancelled"
                      ) : draw?.results ? (
                        draw.results[l.series][current.game] === l.number ? (
                          <Badge kind="success">Winner</Badge>
                        ) : (
                          "No match"
                        )
                      ) : (
                        "Awaiting draw"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.claimed && (
            <Notice>
              Claimed on {date(current.claimed)} at {time(current.claimed)}.
              This prize cannot be claimed again.
            </Notice>
          )}
          {action && (
            <div className="action-confirm">
              <strong>
                {action === "cancel"
                  ? "Cancel this ticket?"
                  : "Confirm prize payout?"}
              </strong>
              <p>
                {action === "cancel"
                  ? `${money(current.total)} will return to the originating account.`
                  : `Confirm the original ticket and pay the customer ${money(current.payout)}. This records a single claim and restores the corresponding shop balance.`}
              </p>
              <div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setAction(null)}
                >
                  Go back
                </button>
                <button
                  className={`btn ${action === "cancel" ? "danger" : "primary"}`}
                  disabled={busy}
                  onClick={() => void act()}
                >
                  <Busy busy={busy}>
                    {action === "cancel"
                      ? "Confirm cancellation"
                      : "Confirm claim"}
                  </Busy>
                </button>
              </div>
            </div>
          )}
          <div className="modal-actions">
            {owns &&
              current.status === "pending" &&
              draw &&
              now < draw.closes && (
                <button
                  className="btn danger-text"
                  disabled={busy}
                  onClick={() => setAction("cancel")}
                >
                  Cancel ticket
                </button>
              )}
            {owns &&
              data.account.role === "shop" &&
              current.status !== "cancelled" && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void printTicket(current.id)}
                >
                  <Printer size={15} />
                  {current.print_count ? "Reprint receipt" : "Print receipt"}
                </button>
              )}
            {owns &&
              data.account.role === "shop" &&
              current.status === "won" && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => setAction("claim")}
                >
                  <CheckCircle2 size={15} />
                  Claim prize
                </button>
              )}
            <button
              className="btn"
              onClick={() => {
                setSelected(null);
                setAction(null);
              }}
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Results({ data, now }: ViewProps) {
  const [game, setGame] = useState<Game>("2D"),
    [selected, setSelected] = useState(""),
    [proof, setProof] = useState<Draw | null>(null),
    [verified, setVerified] = useState<boolean | null>(null);
  const settled = data.draws.filter((d) => d.status === "settled").reverse(),
    current = settled.find((d) => d.id === selected) ?? settled[0],
    upcoming = data.draws.filter((d) => d.status === "open" && d.ends > now);
  async function verify(draw: Draw) {
    if (!draw.seed) return;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(draw.seed),
    );
    setVerified(
      Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("") === draw.commitment,
    );
  }
  return (
    <>
      <Heading
        eyebrow="THE NUMBERS ARE IN"
        title="Draw results"
        description="Published results, upcoming draws and a verifiable record of every outcome."
        action={<Badge kind="success">Server-published results</Badge>}
      />
      <div className="results-layout">
        <Panel
          title="Winning numbers"
          subtitle={
            current
              ? `${date(current.ends)} · ${time(current.ends)}`
              : "Waiting for the first scheduled draw"
          }
          action={
            <div className="segmented">
              {(["2D", "3D", "Titli"] as Game[]).map((g) => (
                <button
                  className={g === game ? "active" : ""}
                  onClick={() => setGame(g)}
                  key={g}
                >
                  {g}
                </button>
              ))}
            </div>
          }
        >
          {current ? (
            <>
              <div className="draw-selection">
                <label>
                  DRAW
                  <select
                    value={current.id}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {settled.map((d) => (
                      <option value={d.id} key={d.id}>
                        {date(d.ends)} · {time(d.ends)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-link"
                  onClick={() => {
                    setProof(current);
                    setVerified(null);
                  }}
                >
                  <ShieldCheck size={16} />
                  Verify draw
                </button>
              </div>
              <div className="winning-grid">
                {SERIES.map((s, i) => (
                  <article key={s} data-series={s}>
                    <div>
                      <span className={`series-marker marker-${i % 5}`} />
                      {seriesName(s)}
                      <CheckCircle2 size={13} />
                    </div>
                    <strong className={`result-color-${i % 5}`}>
                      {current.results?.[s]?.[game] ?? "—"}
                    </strong>
                    <small>
                      {game === "Titli"
                        ? TITLI[Number(current.results?.[s]?.Titli)]
                        : `${game} winning number`}
                    </small>
                  </article>
                ))}
              </div>
              <div className="panel-foot">
                <ShieldCheck size={14} />
                <span>
                  Settled results are final. Prizes use the rules saved with
                  this draw.
                </span>
              </div>
            </>
          ) : (
            <Empty
              title="Every draw has its moment."
              description={`The first results will appear at ${upcoming[0] ? time(upcoming[0].ends) : "the next scheduled draw"}.`}
            />
          )}
        </Panel>
        <Panel title="Coming up next" subtitle="Advance draws open for booking">
          <div className="upcoming-list">
            {upcoming.map((d, i) => (
              <div key={d.id}>
                <span className="draw-time-icon">
                  <Clock3 size={18} />
                </span>
                <span>
                  <strong>{time(d.ends)}</strong>
                  <small>
                    {date(d.ends)} · {d.config.interval} min
                  </small>
                </span>
                <Badge kind={i === 0 ? "success" : "neutral"}>
                  {now >= d.closes ? "Locked" : i === 0 ? "Next" : "Open"}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Notice>
        {data.mode === "demo" ? "These are local demo lottery results. " : ""}
        Each draw’s seed commitment is recorded before sales. The seed is
        revealed after settlement. Existing tickets keep their original ticket
        price and payout rules.
      </Notice>
      {proof && (
        <Modal title="Verify this draw" onClose={() => setProof(null)}>
          <p className="muted">
            Confirm that the revealed seed matches the commitment published
            before ticket sales.
          </p>
          <label>
            Draw ID<code className="proof-code">{proof.id}</code>
          </label>
          <label>
            Pre-draw SHA-256 commitment
            <code className="proof-code">{proof.commitment}</code>
          </label>
          <label>
            Revealed seed<code className="proof-code">{proof.seed}</code>
          </label>
          {verified !== null && (
            <Notice>
              {verified
                ? "Verified: this seed matches the original commitment."
                : "Verification failed: the seed does not match."}
            </Notice>
          )}
          <div className="modal-actions">
            <button className="btn primary" onClick={() => void verify(proof)}>
              <ShieldCheck size={16} />
              Verify commitment
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Accounts({ data, run, busy }: ViewProps) {
  const [query, setQuery] = useState(""),
    [roleFilter, setRoleFilter] = useState("all"),
    [adding, setAdding] = useState(false),
    [created, setCreated] = useState<Account | null>(null),
    [toggle, setToggle] = useState<Account | null>(null);
  const [form, setForm] = useState({
    name: "",
    role: data.account.role === "agent" ? "shop" : "agent",
    parentId:
      data.accounts.find((a) => a.role === "agent" && a.active)?.id ?? "",
    password: "",
    commission: 5,
  });
  const isAdmin = data.account.role === "admin",
    accounts = data.accounts.filter(
      (a) =>
        (roleFilter === "all" || a.role === roleFilter) &&
        `${a.id} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
    );
  async function create(e: FormEvent) {
    e.preventDefault();
    const result = await run<Account>(
      "/accounts",
      { ...form, commission: Math.round(form.commission * 100) },
      "New account created.",
    );
    if (result) {
      setCreated(result);
      setAdding(false);
      setForm({ ...form, name: "", password: "" });
    }
  }
  return (
    <>
      <Heading
        eyebrow="CONNECTED PEOPLE. CONNECTED BUSINESS."
        title={isAdmin ? "Network & accounts" : "Your shop network"}
        description={
          isAdmin
            ? "Separate identities and clear access for every member of your business."
            : "Create shop accounts, follow their balances and keep your counters connected."
        }
        action={
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Create account
          </button>
        }
      />
      <div className="stats-grid compact">
        <Stat
          label={isAdmin ? "Registered agents" : "Registered shops"}
          value={String(
            data.accounts.filter((a) => a.role === (isAdmin ? "agent" : "shop"))
              .length,
          )}
          detail={
            isAdmin ? "Distribution partners" : "Connected to your agent ID"
          }
          icon={<Users size={19} />}
        />
        <Stat
          label="Active accounts"
          value={String(data.accounts.filter((a) => a.active).length)}
          detail="Able to access their own portal"
          icon={<ShieldCheck size={19} />}
          accent="blue"
        />
        <Stat
          label="Network balance"
          value={`${money(data.accounts.filter((a) => a.role !== "admin").reduce((s, a) => s + a.balance, 0))}`}
          detail="Current balances across visible accounts"
          icon={<Wallet size={19} />}
          accent="gold"
        />
      </div>
      <Panel title="Directory" subtitle={`${accounts.length} accounts in view`}>
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search accounts"
              value={query}
              placeholder="Search by name or ID…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {isAdmin && (
            <select
              aria-label="Account role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              {["all", "admin", "agent", "shop", "user"].map((r) => (
                <option value={r} key={r}>
                  {r === "all" ? "All roles" : title(r)}
                </option>
              ))}
            </select>
          )}
        </div>
        {accounts.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Parent agent</th>
                  <th>Balance</th>
                  <th>Status</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <small>{a.id}</small>
                    </td>
                    <td>
                      <span className="game-pill">{title(a.role)}</span>
                      {a.role === "agent" && (
                        <small>{a.commission / 100}% commission</small>
                      )}
                    </td>
                    <td>{a.parent_id ?? "—"}</td>
                    <td className="amount">{money(a.balance)}</td>
                    <td>
                      <Badge kind={a.active ? "success" : "danger"}>
                        {a.active ? "Active" : "Suspended"}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td>
                        {a.id !== data.account.id && (
                          <button
                            className="table-action"
                            onClick={() => setToggle(a)}
                          >
                            {a.active ? "Suspend" : "Activate"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Build your network"
            description="New accounts will appear here with their own IDs and access."
          />
        )}
      </Panel>
      {adding && (
        <Modal
          title={`Create ${isAdmin ? "an account" : "a shop account"}`}
          onClose={() => !busy && setAdding(false)}
        >
          <form onSubmit={create} className="form-grid">
            <label>
              Display name
              <input
                required
                minLength={2}
                maxLength={60}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Riverside Lottery Shop"
              />
            </label>
            {isAdmin && (
              <label>
                Account role
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="agent">Agent</option>
                  <option value="shop">Shop</option>
                  <option value="user">User</option>
                </select>
              </label>
            )}
            {form.role === "shop" && isAdmin && (
              <label>
                Parent agent
                <select
                  required
                  value={form.parentId}
                  onChange={(e) =>
                    setForm({ ...form, parentId: e.target.value })
                  }
                >
                  <option value="">Choose an agent</option>
                  {data.accounts
                    .filter((a) => a.role === "agent" && a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {form.role === "agent" && (
              <label>
                Sales commission (%)
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.01"
                  required
                  value={form.commission}
                  onChange={(e) =>
                    setForm({ ...form, commission: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <label>
              Initial password
              <input
                autoComplete="new-password"
                type="password"
                minLength={10}
                maxLength={128}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 10 characters"
              />
            </label>
            <Notice>
              A unique{" "}
              {form.role === "agent"
                ? "AGT"
                : form.role === "shop"
                  ? "SHP"
                  : "USR"}{" "}
              ID will be generated. New accounts start with ₹0.
            </Notice>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                <Busy busy={busy}>Create account</Busy>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {created && (
        <Modal title="Account created" onClose={() => setCreated(null)}>
          <Success title={created.name}>
            <p>{title(created.role)} portal account is ready.</p>
            <code>{created.id}</code>
            <p>
              Share this ID and the password you set with the account holder.
            </p>
            <a
              className="btn"
              href={`/${created.role}`}
              target="_blank"
              rel="noreferrer"
            >
              Open {created.role} sign-in
              <ArrowUpRight size={15} />
            </a>
          </Success>
        </Modal>
      )}
      {toggle && (
        <Modal
          title={toggle.active ? "Suspend account?" : "Activate account?"}
          onClose={() => setToggle(null)}
        >
          <p>
            {toggle.name} · {toggle.id}
          </p>
          <Notice>
            {toggle.active
              ? "Signing in will be disabled and existing sessions revoked. Suspending an agent also blocks new ticket sales at their shops."
              : "The account will be able to sign in again."}
          </Notice>
          <div className="modal-actions">
            <button className="btn" onClick={() => setToggle(null)}>
              Go back
            </button>
            <button
              className={`btn ${toggle.active ? "danger" : "primary"}`}
              disabled={busy}
              onClick={async () => {
                const r = await run(
                  `/accounts/${toggle.id}/status`,
                  { active: !toggle.active },
                  "Account status updated.",
                );
                if (r) setToggle(null);
              }}
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function WalletView({ data, run, busy }: ViewProps) {
  const [fund, setFund] = useState(false),
    [targetId, setTargetId] = useState(""),
    [amount, setAmount] = useState(1000),
    [note, setNote] = useState(""),
    [query, setQuery] = useState(""),
    [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const canFund = ["admin", "agent"].includes(data.account.role),
    targets = data.accounts.filter(
      (a) => a.active && a.role !== "admin" && a.id !== data.account.id,
    );
  const rows = data.ledger.filter((l) =>
    `${l.reference} ${l.kind} ${l.account_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function transfer(e: FormEvent) {
    e.preventDefault();
    const result = await run(
      "/transfers",
      { targetId, amount, note },
      "Balance transferred successfully.",
      transferKey,
    );
    if (result) {
      setFund(false);
      setNote("");
      setTransferKey(crypto.randomUUID());
    }
  }
  return (
    <>
      <Heading
        eyebrow="A BALANCE YOU CAN FOLLOW"
        title="Wallet & ledger"
        description="Every payment has a record. Follow sales, prizes, refunds and transfers."
        action={
          canFund && (
            <button
              className="btn primary"
              onClick={() => {
                setTargetId(targets[0]?.id ?? "");
                setTransferKey(crypto.randomUUID());
                setFund(true);
              }}
            >
              <Plus size={16} />
              {data.account.role === "admin"
                ? "Allocate balance"
                : "Fund a shop"}
            </button>
          )
        }
      />
      <div className="wallet-hero">
        <div>
          <span className="eyebrow">
            {data.account.role === "admin"
              ? "WORKSPACE BALANCE"
              : "AVAILABLE BALANCE"}
          </span>
          <h2>
            {money(
              data.account.role === "admin"
                ? data.accounts.reduce((s, a) => s + a.balance, 0)
                : data.account.balance,
            )}{" "}
          </h2>
          <p>
            {data.account.role === "admin"
              ? "Total balances across the network"
              : `${data.account.name} · ${data.account.id}`}
          </p>
          <Badge kind="success">
            {data.mode === "demo" ? "Demo balance (₹)" : "Internal balance (₹)"}
          </Badge>
        </div>
        <div className="wallet-illustration">
          <Wallet size={75} strokeWidth={1} />
          <span>IL</span>
        </div>
      </div>
      <Panel
        title="Transaction ledger"
        subtitle="Latest 500 entries · money added and money deducted"
        action={
          <button
            className="btn small"
            onClick={() =>
              csvDownload("irland-lotto-ledger.csv", [
                [
                  "ID",
                  "Account",
                  "Date",
                  "Type",
                  "Reference",
                  "Amount (INR)",
                  "Balance (INR)",
                ],
                ...rows.map((l) => [
                  l.id,
                  l.account_id,
                  new Date(l.created).toISOString(),
                  l.kind,
                  l.reference,
                  l.amount,
                  l.balance,
                ]),
              ])
            }
          >
            <Download size={14} />
            Export CSV
          </button>
        }
      >
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search ledger"
              placeholder="Search reference, account or transaction…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Account</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="transaction-kind">
                        <span className={l.amount >= 0 ? "credit" : "debit"}>
                          {l.amount >= 0 ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </span>
                        <div>
                          <strong>{title(l.kind)}</strong>
                          <small>
                            {date(l.created)} · {time(l.created)}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {l.account_name}
                      <small>{l.account_id}</small>
                    </td>
                    <td className="mono">{l.reference}</td>
                    <td
                      className={`amount ${l.amount >= 0 ? "text-green" : ""}`}
                    >
                      {l.amount > 0 ? "+" : ""}
                      {money(l.amount)}
                    </td>
                    <td>{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A clean starting point"
            description="Your first transaction will appear here."
          />
        )}
      </Panel>
      {fund && (
        <Modal
          title={
            data.account.role === "admin"
              ? "Allocate account balance"
              : "Transfer to a shop"
          }
          onClose={() => !busy && setFund(false)}
        >
          <form className="form-grid" onSubmit={transfer}>
            <label>
              Destination account
              <select
                required
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setTransferKey(crypto.randomUUID());
                }}
              >
                <option value="">Choose account</option>
                {targets.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name} · {a.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (₹)
              <input
                type="number"
                min="1"
                max="10000000"
                step="1"
                required
                value={amount || ""}
                onChange={(e) => {
                  setAmount(Number(e.target.value));
                  setTransferKey(crypto.randomUUID());
                }}
              />
            </label>
            <label>
              Transfer reference
              <input
                required
                minLength={3}
                maxLength={160}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setTransferKey(crypto.randomUUID());
                }}
                placeholder="e.g. Opening counter balance"
              />
            </label>
            <Notice>
              {data.account.role === "admin"
                ? "This creates an audited internal credit allocation. It does not process a bank payment."
                : `${money(amount)} will move from your balance to the selected shop.`}
            </Notice>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setFund(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy || !targets.length}
              >
                <Busy busy={busy}>Confirm transfer</Busy>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Reports({ data, now }: ViewProps) {
  const [from, setFrom] = useState(dateKey(now, data.settings.timezone)),
    [to, setTo] = useState(dateKey(now, data.settings.timezone));
  const tickets = data.tickets.filter((t) => {
      const d = dateKey(t.created, data.settings.timezone);
      return d >= from && d <= to;
    }),
    s = totals(tickets);
  const groups = [...new Set(tickets.map((t) => t.seller_id))].map((id) => ({
    id,
    name: tickets.find((t) => t.seller_id === id)?.seller_name ?? id,
    ...totals(tickets.filter((t) => t.seller_id === id)),
  }));
  return (
    <>
      <Heading
        eyebrow="MAKE EVERY DAY ADD UP"
        title="Sales & settlement reports"
        description="Daily totals and account-level performance, calculated from recorded tickets."
        action={
          <button
            className="btn"
            onClick={() =>
              ticketCsv(tickets, `irland-lotto-report-${from}-${to}.csv`)
            }
          >
            <Download size={16} />
            Export report
          </button>
        }
      />
      <div className="report-filters">
        <CalendarDays size={20} />
        <label>
          From
          <input
            aria-label="Report start date"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <span>→</span>
        <label>
          To
          <input
            aria-label="Report end date"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="btn small"
          onClick={() => {
            setFrom(dateKey(now, data.settings.timezone));
            setTo(dateKey(now, data.settings.timezone));
          }}
        >
          Today
        </button>
        <span className="muted">{data.settings.timezone}</span>
      </div>
      <div className="stats-grid">
        <Stat
          label="Gross ticket sales"
          value={`${money(s.sales)}`}
          detail={`${s.count} valid tickets · cancelled excluded`}
          icon={<TicketIcon size={18} />}
        />
        <Stat
          label="Prize liability"
          value={`${money(s.prizes)}`}
          detail="Won + already claimed prizes"
          icon={<Trophy size={18} />}
          accent="gold"
        />
        <Stat
          label="Agent commissions"
          value={`${money(s.commission)}`}
          detail="Earned on settled, valid tickets"
          icon={<Users size={18} />}
          accent="violet"
        />
        <Stat
          label="Net after settlement"
          value={`${money(s.sales - s.prizes - s.commission)}`}
          detail="Sales − known prizes − earned commissions"
          icon={<Landmark size={18} />}
          accent="blue"
        />
      </div>
      <Panel title="Account performance" subtitle={`${from} to ${to}`}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Tickets</th>
                <th>Sales</th>
                <th>Prizes</th>
                <th>Commission</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name}</strong>
                    <small>{g.id}</small>
                  </td>
                  <td>{g.count}</td>
                  <td>{money(g.sales)}</td>
                  <td>{money(g.prizes)}</td>
                  <td>{money(g.commission)}</td>
                  <td className="amount">
                    {money(g.sales - g.prizes - g.commission)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{s.count}</td>
                <td>{money(s.sales)}</td>
                <td>{money(s.prizes)}</td>
                <td>{money(s.commission)}</td>
                <td>{money(s.sales - s.prizes - s.commission)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!groups.length && (
          <Empty
            title="No sales in this period"
            description="Try another date range, or issue your first ticket."
          />
        )}
      </Panel>
      <Notice>
        {tickets.filter((t) => t.status === "pending").length} tickets in this
        report are awaiting their draw. Their final prizes and commissions are
        not yet known. Totals update after settlement. Cancelled ticket refunds
        are recorded in the ledger.
      </Notice>
    </>
  );
}

export function SettingsView({ data, run, busy }: ViewProps) {
  const [settings, setSettings] = useState<Settings>(data.settings),
    [saved, setSaved] = useState(false),
    [password, setPassword] = useState({
      current: "",
      password: "",
      confirm: "",
    }),
    [changing, setChanging] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    const result = await run(
      "/settings",
      settings,
      "Settings saved. Already scheduled draws keep their original rules.",
    );
    if (result) setSaved(true);
  }
  return (
    <>
      <Heading
        eyebrow="SET UP YOUR WORKSPACE"
        title="Settings"
        description="Your identity, security and the rules that keep everything running."
      />
      <div className="settings-grid">
        <Panel
          title="Account identity"
          subtitle="Your access is tied to your role"
        >
          <div className="identity-card">
            <span className="big-avatar">
              {data.account.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <h3>{data.account.name}</h3>
            <code>{data.account.id}</code>
            <Badge kind="success">{title(data.account.role)} account</Badge>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Parent agent</dt>
              <dd>{data.account.parent_id ?? "Independent account"}</dd>
            </div>
            <div>
              <dt>Receipt printing</dt>
              <dd>
                {data.account.role === "shop"
                  ? "Enabled for your own tickets"
                  : "Shop accounts only"}
              </dd>
            </div>
            <div>
              <dt>Session duration</dt>
              <dd>8 hours</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{data.settings.timezone}</dd>
            </div>
          </dl>
          <div className="panel-foot">
            <button className="btn full" onClick={() => setChanging(true)}>
              <KeyRound size={15} />
              Change password
            </button>
          </div>
        </Panel>
        {data.account.role === "admin" ? (
          <Panel
            title="Game configuration"
            subtitle="New rules apply to newly scheduled draws"
          >
            <form onSubmit={save} className="settings-form">
              <label>
                Workspace name
                <input
                  maxLength={30}
                  required
                  value={settings.brand}
                  onChange={(e) => {
                    setSettings({ ...settings, brand: e.target.value });
                    setSaved(false);
                  }}
                />
              </label>
              <div className="form-two">
                <label>
                  Draw interval (minutes)
                  <input
                    type="number"
                    min="1"
                    max="120"
                    required
                    value={settings.interval}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        interval: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Ticket price range
                  <strong className="settings-price-range">
                    {priceRange(settings)}
                  </strong>
                </label>
              </div>
              <fieldset className="series-price-settings">
                <legend>Irland Lotto  ticket prices (₹)</legend>
                <p>Fixed price per ticket · ₹100–₹10,000</p>
                <div>
                  {SERIES.map((s) => (
                    <label key={s}>
                      {seriesName(s)} price (₹)
                      <input
                        type="number"
                        min="100"
                        max="10000"
                        step="1"
                        required
                        value={seriesPrice(settings, s)}
                        onChange={(e) => {
                          setSettings({
                            ...settings,
                            seriesPrices: {
                              ...Object.fromEntries(
                                SERIES.map((key) => [
                                  key,
                                  seriesPrice(settings, key),
                                ]),
                              ),
                              [s]: Number(e.target.value),
                            },
                          });
                          setSaved(false);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Maximum ticket value (₹)
                <input
                  type="number"
                  min="10"
                  max="1000000"
                  required
                  value={settings.maxTicket}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxTicket: Number(e.target.value),
                    })
                  }
                />
              </label>
              <div className="form-three">
                {(["2D", "3D", "Titli"] as Game[]).map((g) => (
                  <label key={g}>
                    {g} payout multiplier
                    <input
                      type="number"
                      min="1"
                      max={g === "3D" ? 100000 : g === "2D" ? 10000 : 1000}
                      required
                      value={settings.payouts[g]}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payouts: {
                            ...settings.payouts,
                            [g]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="toggle-setting">
                <span>
                  <strong>Ticket sales</strong>
                  <small>
                    Pause new ticket sales across all accounts immediately.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.salesEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, salesEnabled: e.target.checked })
                  }
                />
              </label>
              <Notice>
                Up to 8 future draws are scheduled. Price, interval and payout
                changes take effect after those draws. Existing tickets and
                published results remain unchanged.
              </Notice>
              <button className="btn primary" disabled={busy}>
                <Busy busy={busy}>Save configuration</Busy>
                <CheckCircle2 size={16} />
              </button>
            </form>
          </Panel>
        ) : (
          <Panel
            title="Current game rules"
            subtitle="Rules are managed by your administrator"
          >
            <dl className="definition-list">
              {[
                ...SERIES.map((s) => [
                  seriesName(s),
                  money(seriesPrice(data.settings, s)),
                ]),
                ["Draw interval", `${data.settings.interval} minutes`],
                [
                  "2D exact-match payout",
                  `${data.settings.payouts["2D"]}× stake`,
                ],
                [
                  "3D exact-match payout",
                  `${data.settings.payouts["3D"]}× stake`,
                ],
                [
                  "Titli exact-match payout",
                  `${data.settings.payouts.Titli}× stake`,
                ],
                ["Sales cutoff", "10 seconds before draw"],
                ["User prize claims", "Automatically credited"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="panel-foot">
              <Notice>
                Each draw keeps the rules it was created with. Check the ticket
                terminal for the price and payout of your selected draw.
              </Notice>
            </div>
          </Panel>
        )}
      </div>
      {changing && (
        <Modal
          title="Change your password"
          onClose={() => !busy && setChanging(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (password.password !== password.confirm) return;
              await run(
                "/password",
                { current: password.current, password: password.password },
                "Password changed. Sign in with your new password.",
              );
            }}
          >
            <label>
              Current password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password.current}
                onChange={(e) =>
                  setPassword({ ...password, current: e.target.value })
                }
              />
            </label>
            <label>
              New password
              <input
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                value={password.password}
                onChange={(e) =>
                  setPassword({ ...password, password: e.target.value })
                }
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password.confirm}
                onChange={(e) =>
                  setPassword({ ...password, confirm: e.target.value })
                }
              />
            </label>
            {password.confirm && password.confirm !== password.password && (
              <p className="inline-error">Passwords do not match.</p>
            )}
            <Notice>
              All sessions for this account will be signed out after the
              password changes.
            </Notice>
            <button
              className="btn primary"
              disabled={busy || password.password !== password.confirm}
            >
              <Busy busy={busy}>Update password</Busy>
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Support({ data, run, busy }: ViewProps) {
  const [adding, setAdding] = useState(false),
    [subject, setSubject] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [reply, setReply] = useState("");
  const request = data.complaints.find((c) => c.id === selected);
  const guides = [
    [
      "How do I issue a ticket?",
      "Open the ticket terminal, select a game and Irland Lotto  series, pick numbers, set the quantity and confirm. The server checks your credit and draw cutoff before issuing the ticket.",
    ],
    [
      "Who can print tickets?",
      "Only Shop accounts can request a printable receipt for their own tickets. Reprints use the original ticket ID and are marked as duplicate copies.",
    ],
    [
      "How do claims work?",
      "A winning shop ticket is claimed once at its issuing shop. Confirm the ticket, record the payout and the shop balance is restored. User prizes are credited automatically after the draw.",
    ],
    [
      "Can I sell without internet?",
      "A physical shop uses the Shop panel, but it needs a connection to the local lottery server. A disconnected terminal cannot issue or claim tickets. This prevents duplicate entries and stale draw sales.",
    ],
    [
      "How are commissions calculated?",
      "An agent earns their configured percentage on valid shop ticket sales after the draw settles. Cancelled tickets earn no commission. Amounts are rounded down to whole rupees.",
    ],
    [
      "Can results be changed?",
      "Results are produced by the server from a committed random seed. Settled outcomes are immutable. The seed is revealed for verification after the draw.",
    ],
  ];
  return (
    <>
      <Heading
        eyebrow="A LITTLE HELP GOES A LONG WAY"
        title="Help & support"
        description="Practical answers for your daily operations, and a direct line to your administrator."
        action={
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            New support request
          </button>
        }
      />
      <div className="support-grid">
        <Panel
          title="Workspace guide"
          subtitle="The essentials, explained simply"
        >
          <div className="faq-list">
            {guides.map(([q, a], i) => (
              <details key={q} open={i === 0}>
                <summary>
                  {q}
                  <Plus size={15} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Panel>
        <Panel
          title={
            data.account.role === "admin"
              ? "Support inbox"
              : "Your support requests"
          }
          subtitle={`${data.complaints.filter((c) => c.status === "open").length} open requests`}
        >
          {data.complaints.length ? (
            <div className="support-list">
              {data.complaints.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelected(c.id);
                    setReply(c.reply);
                  }}
                >
                  <span>
                    <strong>{c.subject}</strong>
                    <small>
                      {c.id} · {date(c.created)}
                    </small>
                  </span>
                  <Badge kind={kind(c.status)}>{title(c.status)}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="We’re here when you need us."
              description="Submit a question or report a ticket issue. Your administrator can reply here."
              icon={<Headphones size={25} />}
            />
          )}
        </Panel>
      </div>
      {adding && (
        <Modal
          title="New support request"
          onClose={() => !busy && setAdding(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(
                "/complaints",
                { subject, message },
                "Support request submitted.",
              );
              if (r) {
                setAdding(false);
                setSubject("");
                setMessage("");
              }
            }}
          >
            <label>
              Subject
              <input
                required
                minLength={3}
                maxLength={100}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="How can we help?"
              />
            </label>
            <label>
              Details
              <textarea
                required
                minLength={10}
                maxLength={2000}
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Include the ticket ID and a description of the issue."
              />
            </label>
            <button className="btn primary" disabled={busy}>
              <Busy busy={busy}>Submit request</Busy>
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {request && (
        <Modal title={request.subject} onClose={() => setSelected(null)}>
          <p className="muted">
            {request.id} · {request.account_id} · {date(request.created)}
          </p>
          <p className="support-message">{request.message}</p>
          {request.reply && (
            <div className="support-reply">
              <strong>Administrator’s reply</strong>
              <p>{request.reply}</p>
            </div>
          )}
          {data.account.role === "admin" && request.status === "open" && (
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await run(
                  `/complaints/${request.id}/resolve`,
                  { reply },
                  "Reply saved and request resolved.",
                );
                if (r) setSelected(null);
              }}
            >
              <label>
                Reply
                <textarea
                  required
                  minLength={3}
                  maxLength={2000}
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
              </label>
              <button className="btn primary" disabled={busy}>
                Reply & resolve
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function Audit({ data }: ViewProps) {
  const [query, setQuery] = useState("");
  const rows = data.audit.filter((a) =>
    `${a.actor_id} ${a.action} ${a.detail}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="CLARITY AT EVERY STEP"
        title="Activity log"
        description="An append-only application record of account, draw and ticket actions."
        action={
          <button
            className="btn"
            onClick={() =>
              csvDownload("irland-lotto-audit.csv", [
                ["Time", "Actor", "Action", "Details"],
                ...rows.map((a) => [
                  new Date(a.created).toISOString(),
                  a.actor_id,
                  a.action,
                  a.detail,
                ]),
              ])
            }
          >
            <Download size={16} />
            Export log
          </button>
        }
      />
      <Panel
        title="Recent activity"
        subtitle="Latest 150 events across the workspace"
      >
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search activity"
              placeholder="Search account, ticket or action…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    {date(a.created)}
                    <small>{time(a.created)}</small>
                  </td>
                  <td className="mono">{a.actor_id}</td>
                  <td>
                    <span className="game-pill">{title(a.action)}</span>
                  </td>
                  <td>
                    <code className="audit-detail">{a.detail}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title="No matching events"
            description="Try a different search term."
          />
        )}
      </Panel>
    </>
  );
}
