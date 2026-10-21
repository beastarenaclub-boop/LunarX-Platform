import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  House,
  Info,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Settings,
  ShieldCheck,
  Trash2,
  ChevronDown,
  UserRound,
} from "lucide-react";
import {
  POKER_GAMES,
  POKER_TITLES,
  POKER_CONFIG,
  HAND_NAMES,
  TWO_CARD_BONUS,
  SEVEN_CARD_BONUS,
  playerName,
  type PokerGame,
  type PokerQuote,
} from "@workspace/api-zod/poker";
import { useAuth } from "@/lib/auth";
import { B2C_BRAND, B2C_LOGO } from "@/components/b2c/config";
import { usePokerTable } from "@/components/poker/usePokerTable";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Cards } from "@/components/poker/PokerCards";
import { PokerScene } from "@/components/poker/PokerScene";
import "@/components/poker/poker.css";

const money = (value: string | number | bigint) =>
  `₹${(Number(value) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
function BonusRules() {
  return (
    <div className="pk-rules-tables">
      {[
        { title: "Bonus 1 (2 Cards Bonus)", rows: TWO_CARD_BONUS },
        { title: "Bonus 2 (7 Cards Bonus)", rows: SEVEN_CARD_BONUS },
      ].map((section) => (
        <table key={section.title}>
          <caption>{section.title}</caption>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>1 TO {row.profit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
export default function Poker({ game }: { game: PokerGame }) {
  const { user } = useAuth();
  return (
    <PokerTable
      key={`${user?.id}:${game}`}
      game={game}
      userId={user?.id}
      demo={!!user?.isDemo}
      displayName={user?.displayName ?? "Player"}
    />
  );
}
function PokerTable({
  game,
  userId,
  demo,
  displayName,
}: {
  game: PokerGame;
  userId?: string;
  demo: boolean;
  displayName: string;
}) {
  const table = usePokerTable(game, userId),
    { data } = table;
  const [slipOpen, setSlipOpen] = useState(false);
  const dockOpen =
    slipOpen || table.draft.length > 0 || table.retry || table.busy;
  useEffect(() => setSlipOpen(false), [data?.round.id, data?.slips.length]);
  const [info, setInfo] = useState<
    "rules" | "history" | "bets" | "settings" | "fairness" | null
  >(null);
  const [stake, setStake] = useState("100"),
    [tab, setTab] = useState<"hands" | "pattern">("hands");
  const [verification, setVerification] = useState("");
  const six = game === "poker-six-players",
    oneDay = game === "poker-one-day";
  const round = data?.round,
    phase = round?.phase;
  const winners = round?.outcome?.winners ?? [];
  const label = (p: number) => playerName(game, p);
  const short = (players: number[]) =>
    players.length > 1
      ? six
        ? players.map((p) => p + 1).join("/")
        : "T"
      : six
        ? String(players[0] + 1)
        : players[0] === 0
          ? "A"
          : "B";
  const status = !table.connected
    ? data
      ? "Reconnecting… Betting paused"
      : "Connecting to table…"
    : data?.enabled === false
      ? "TABLE PAUSED"
      : phase === "betting"
        ? "PLACE YOUR BETS"
        : phase === "result"
          ? `${winners.map(label).join(" & ")}${winners.length > 1 ? " · TIE" : " WINS"}`
          : phase === "deal"
            ? "BETTING CLOSED · DEALING"
            : `${phase?.toUpperCase()} · BETTING CLOSED`;
  useEffect(() => {
    document.title = `${POKER_TITLES[game]} · ${B2C_BRAND}`;
  }, [game]);
  useEffect(() => setVerification(""), [round?.id]);
  const amountFor = (id: string) =>
    table.draft.reduce(
      (sum, s) => sum + (s.market === id ? Number(s.amountPaise) : 0),
      0,
    );
  const placedFor = (id: string) =>
    data?.slips.reduce(
      (sum, s) =>
        sum +
        s.selections.reduce(
          (n, b) => n + (b.market === id ? Number(b.amountPaise) : 0),
          0,
        ),
      0,
    ) ?? 0;
  const market = (id: string, children?: ReactNode, extraClass = "") => {
    const q = data?.quotes.find((q) => q.id === id),
      selected = amountFor(id),
      placed = placedFor(id);
    return (
      <button
        key={id}
        type="button"
        className={`pk-market ${q?.kind === "lay" ? "pk-lay" : ""} ${selected ? "pk-selected" : ""} ${extraClass}`}
        disabled={!table.canEdit || !q}
        data-testid={`market-${id}`}
        aria-label={
          q
            ? `${q.label}${q.odds ? `, odds ${(q.odds / 100).toFixed(2)}` : ""}`
            : id
        }
        onClick={() => {
          table.add(id, Math.round(Number(stake) * 100));
          setSlipOpen(true);
        }}
      >
        {children}
        {table.canEdit && q ? (
          <strong>
            {q.odds
              ? (q.odds / 100).toFixed(2)
              : q.kind === "bonus2"
                ? "2 Cards Bonus"
                : "7 Cards Bonus"}
          </strong>
        ) : (
          <LockKeyhole className="pk-lock" size={24} fill="currentColor" />
        )}
        {!!(selected || placed) && (
          <span className="pk-market-stake">
            {selected ? "+ " : "✓ "}
            {money(selected || placed)}
          </span>
        )}
      </button>
    );
  };
  const verify = async () => {
    if (!round?.nonce) return;
    try {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([game, round.hands, round.board, round.nonce]),
        ),
      );
      const value = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      setVerification(
        value === round.commitment
          ? "Verified: these cards match the commitment published before betting."
          : "Verification failed: cards do not match the commitment.",
      );
    } catch {
      setVerification("Verification requires HTTPS or localhost.");
    }
  };
  const renderQuote = (q: PokerQuote) =>
    q.kind === "bonus2" || q.kind === "bonus7"
      ? "See bonus paytable"
      : `${(q.odds / 100).toFixed(2)}×`;
  return (
    <main
      className="pk-page"
      data-testid="poker-page"
      data-game={game}
      data-phase={phase ?? "loading"}
    >
      <div className="pk-shell">
        <header className="pk-header">
          <Link href="/" aria-label="Back to lobby" className="pk-home">
            <House size={27} />
          </Link>
          <Link href="/" className="pk-brand">
            <img src={B2C_LOGO} alt={B2C_BRAND} />
          </Link>
          <div className="pk-account">
            <Link
              href="/wallet"
              className="pk-balance"
              data-testid="poker-balance"
            >
              pts:{" "}
              {demo
                ? "∞"
                : data
                  ? (Number(data.balancePaise) / 100).toLocaleString("en-IN", {
                      maximumFractionDigits: 2,
                    })
                  : "—"}{" "}
              | {Number(table.spent) / 100}
            </Link>
            <button onClick={() => setInfo("bets")}>
              <UserRound size={14} /> {demo ? "Demo" : displayName}{" "}
              <ChevronDown size={13} />
            </button>
          </div>
          <button
            className="pk-settings"
            aria-label="Poker settings"
            onClick={() => setInfo("settings")}
          >
            <Settings size={25} />
          </button>
        </header>
        <div className="pk-announcement">
          <span>Play Poker 1-Day, 20-20 Poker and Poker 6 Players</span>
          <Megaphone size={22} />
        </div>
        <nav className="pk-game-tabs" aria-label="Poker games">
          {POKER_GAMES.map((code) => (
            <Link
              key={code}
              href={`/${code}`}
              className={code === game ? "pk-tab-active" : ""}
              aria-current={code === game ? "page" : undefined}
            >
              {POKER_TITLES[code]}
            </Link>
          ))}
        </nav>
        <section id="poker-live-table" className="pk-stage" aria-label="Poker cards and round">
          <div className="pk-stage-title">
            <h1>{POKER_TITLES[game]}</h1>
            <span>Round ID: {round?.id ?? "—"}</span>
          </div>
          <div className="pk-stage-tools">
            <Link href="/" aria-label="Go to lobby">
              <House size={21} />
            </Link>
            <button aria-label="Game rules" onClick={() => setInfo("rules")}>
              <Info size={21} />
            </button>
          </div>
          <div
            className={`pk-live-status ${phase === "betting" && table.connected ? "pk-betting" : ""}`}
            role="status"
          >
            <span>{status}</span>
            <b aria-label="Seconds remaining">
              {String(table.seconds).padStart(2, "0")}
            </b>
          </div>
          <PokerScene game={game} round={round} slips={data?.slips ?? []} />
          <button
            className="pk-fairness-link"
            onClick={() => setInfo("fairness")}
          >
            Round verification
          </button>
        </section>

        <section className="pk-markets" aria-label="Betting markets">
          {oneDay ? (
            <div className="pk-one-day">
              {[0, 1].map((p) => (
                <div key={p} className={`pk-player-column pk-player-${p}`}>
                  <div className="pk-winner-box">
                    <h2>{label(p)}</h2>
                    <div className="pk-back-lay-label">
                      <span>Back</span>
                      <span>Lay</span>
                    </div>
                    <div className="pk-dual">
                      {market(`p${p}-back`)}
                      {market(`p${p}-lay`)}
                    </div>
                  </div>
                  <div className="pk-dual pk-bonuses">
                    {market(`p${p}-bonus2`)}
                    {market(`p${p}-bonus7`)}
                  </div>
                </div>
              ))}
              <div className="pk-hole-cards">
                <span className="pk-poker-word">Poker</span>
                {[0, 1].map((p) => (
                  <div key={p} className={`pk-player-${p}`}>
                    <h3>{label(p)}</h3>
                    <Cards values={round?.hands[p] ?? [null, null]} />
                  </div>
                ))}
              </div>
            </div>
          ) : six ? (
            <>
              <div
                className="pk-view-tabs"
                role="tablist"
                aria-label="Six player view"
              >
                <button
                  role="tab"
                  aria-selected={tab === "hands"}
                  onClick={() => setTab("hands")}
                >
                  Hands
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "pattern"}
                  onClick={() => setTab("pattern")}
                >
                  Pattern
                </button>
              </div>
              {tab === "hands" ? (
                <div className="pk-six-grid" role="tabpanel">
                  {Array.from({ length: 6 }, (_, p) => (
                    <div
                      key={p}
                      className={winners.includes(p) ? "pk-winning-player" : ""}
                    >
                      <h2>{label(p)}</h2>
                      {market(
                        `p${p}-back`,
                        <Cards values={round?.hands[p] ?? [null, null]} />,
                        "pk-six-market",
                      )}
                      {phase === "result" && (
                        <small>
                          {HAND_NAMES[round!.outcome!.categories[p]]}
                        </small>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pk-pattern" role="tabpanel">
                  {data?.history.length ? (
                    data.history.map((h) => (
                      <div key={h.id}>
                        <small>#{h.id}</small>
                        <strong>{short(h.winners)}</strong>
                        <span>
                          {h.winners
                            .map((p) => HAND_NAMES[h.categories[p]])
                            .join(" / ")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>Completed rounds will appear here.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pk-twenty-grid">
              <div />
              <span className="pk-a">PLAYER A</span>
              <span className="pk-b">PLAYER B</span>
              {["Winner", ...HAND_NAMES.slice(1, 9)].map((name, i) => (
                <div className="pk-market-row" key={name}>
                  <h2>{name.toUpperCase()}</h2>
                  {[0, 1].map((p) =>
                    market(`p${p}-${i === 0 ? "back" : `hand${i}`}`),
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="pk-bet-dock" aria-label="Bet slip">
          <div className="pk-dock-summary">
            <button
              aria-expanded={dockOpen}
              aria-controls="poker-stake-controls"
              onClick={() => setSlipOpen((value) => !value)}
            >
              Stake {money(Math.round((Number(stake) || 0) * 100))}{" "}
              <ChevronDown size={14} />
            </button>
            <button onClick={() => setInfo("bets")}>
              My bets ({data?.slips.length ?? 0})
            </button>
          </div>
          <div id="poker-stake-controls" hidden={!dockOpen}>
            <div className="pk-chip-row">
              <label>
                Per tap{" "}
                <input
                  aria-label="Stake amount"
                  inputMode="decimal"
                  type="number"
                  min="10"
                  max="5000"
                  step="10"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  disabled={!table.canEdit}
                />
              </label>
              <div>
                {[10, 50, 100, 500, 1000].map((chip) => (
                  <button
                    key={chip}
                    className={Number(stake) === chip ? "pk-chip-active" : ""}
                    onClick={() => setStake(String(chip))}
                    disabled={!table.canEdit}
                  >
                    ₹{chip}
                  </button>
                ))}
              </div>
            </div>
            {table.draft.length > 0 && (
              <div className="pk-draft">
                {table.draft.map((s) => (
                  <div key={s.market}>
                    <span>
                      {data?.quotes.find((q) => q.id === s.market)?.label}
                    </span>
                    <b>{money(s.amountPaise)}</b>
                    <button
                      aria-label={`Remove ${s.market}`}
                      onClick={() => table.remove(s.market)}
                      disabled={table.busy || table.retry}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="pk-bet-actions">
              <span>
                <small>
                  {oneDay ? "STAKE / LAY LIABILITY" : "SELECTED STAKE"}
                </small>
                <strong data-testid="poker-debit">{money(table.debit)}</strong>
              </span>
              <button
                className="pk-clear"
                aria-label="Clear selected bets"
                disabled={!table.canEdit || !table.draft.length}
                onClick={table.clear}
              >
                <Trash2 size={19} />
              </button>
              <button
                className="pk-confirm"
                data-testid="poker-confirm"
                disabled={
                  table.busy ||
                  (!table.retry && (!table.canEdit || !table.draft.length))
                }
                onClick={() => void table.submit()}
              >
                {table.busy
                  ? "Confirming…"
                  : table.retry
                    ? "Retry confirmation"
                    : "Confirm bet"}
              </button>
            </div>
            <div className="pk-bet-meta">
              <span>Min ₹10 · Max ₹5,000 / round</span>
              <button onClick={() => setInfo("bets")}>
                My bets ({data?.slips.length ?? 0})
              </button>
            </div>
            {table.retry && (
              <p className="pk-retry" role="alert">
                Confirmation pending. Retry checks the same bet without charging
                twice.
              </p>
            )}
            {oneDay && (
              <p className="pk-liability-note">
                Back bets on a win. Lay bets against a win; the full liability
                is reserved.
              </p>
            )}
          </div>
        </section>
        <Link href="/help" className="pk-support-strip">
          <MessageCircle size={25} />
          <span>Play our Poker games · Help & support</span>
        </Link>
        <div className="pk-history" aria-label="Recent results">
          {data?.history.length ? (
            data.history.slice(0, 10).map((h) => (
              <button
                key={h.id}
                className={
                  !six
                    ? h.winners.length > 1
                      ? ""
                      : h.winners[0] === 0
                        ? "pk-a"
                        : "pk-b"
                    : ""
                }
                onClick={() => setInfo("history")}
                aria-label={`Round ${h.id}: ${h.winners.map(label).join(" and ")}`}
              >
                {short(h.winners)}
              </button>
            ))
          ) : (
            <span>Results appear after the first completed round</span>
          )}
          <button aria-label="All results" onClick={() => setInfo("history")}>
            ···
          </button>
        </div>
        {oneDay && (
          <section className="pk-inline-rules">
            <button
              className="pk-rules-heading"
              onClick={() => setInfo("rules")}
            >
              RULES <Info size={18} />
            </button>
            <BonusRules />
          </section>
        )}
        <footer className="pk-footer">
          <Link href="/help" className="pk-support-heading">
            24X7 Support
          </Link>
          <div>
            <Link href="/help">FAQ</Link>
            <button onClick={() => setInfo("rules")}>Rules</button>
            <button onClick={() => setInfo("bets")}>My bets</button>
          </div>
          <p>
            <ShieldCheck size={29} />
            <span>
              <b>ONE SHARED WALLET</b>
              <small>Accepted bets and settled returns in one place</small>
            </span>
          </p>
        </footer>
      </div>
      <Dialog
        open={!!info}
        onOpenChange={(open) => {
          if (!open) setInfo(null);
        }}
      >
        <DialogContent className="pk-dialog">
          <DialogTitle>
            {info === "rules"
              ? `${POKER_TITLES[game]} · Rules`
              : info === "bets"
                ? "My bets"
                : info === "history"
                  ? "Round results"
                  : info === "fairness"
                    ? "Round verification"
                    : "Poker settings"}
          </DialogTitle>
          <DialogDescription>
            {info === "rules"
              ? "Best five-card Texas Hold’em hand from two hole cards and five shared board cards."
              : info === "fairness"
                ? "Check the revealed cards against the pre-round commitment."
                : "Your current table and game information."}
          </DialogDescription>
          {info === "rules" && (
            <div className="pk-rule-copy">
              <p>
                Bet before the countdown ends. Cards are dealt after betting
                closes, followed by the flop, turn and river. Highest hand wins;
                suits do not break a tie. Ace can be high or low in A–2–3–4–5.
              </p>
              <p>
                {six
                  ? "All six starting hands are visible while betting. Odds are calculated for those hands and fixed for the round. On a tied win, the quoted total return is divided equally between the winning players."
                  : "A/B winner and lay bets are refunded on a tie. Side bets settle independently of the match winner."}
              </p>
              <p>
                Decimal odds include your stake. Bets are final once confirmed.
                The round limit includes all confirmed bets and lay liability.
              </p>
              {oneDay ? (
                <>
                  <p>
                    A lay stake is the amount you can win. At 2.02 odds, a ₹100
                    lay reserves ₹102; a win returns ₹202, and a loss returns
                    ₹0. Bonus tables show profit: 1 TO 3 returns ₹400 on a ₹100
                    stake. Only the highest qualifying bonus pays.
                  </p>
                  <BonusRules />
                </>
              ) : (
                !six && (
                  <>
                    <p>
                      Hand-category bets pay only the exact best category shown;
                      Royal Flush also qualifies for Straight Flush.
                    </p>
                    <table>
                      <tbody>
                        {data?.quotes
                          .filter((q) => q.player === 0)
                          .map((q) => (
                            <tr key={q.id}>
                              <td>{q.label.replace("Player A ", "")}</td>
                              <td>{renderQuote(q)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </>
                )
              )}
              <p>
                Betting window: {POKER_CONFIG.bettingMs[game] / 1000}s. Shared
                deck: 52 cards, no jokers.
              </p>
            </div>
          )}
          {info === "settings" && (
            <div className="pk-rule-copy">
              <label>
                Default stake{" "}
                <input
                  aria-label="Default stake"
                  type="number"
                  min="10"
                  max="5000"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                />
              </label>
              <p>
                Use the chip buttons to change your stake. Cards and balances
                update automatically.
              </p>
              <nav className="pk-settings-games">
                {POKER_GAMES.map((code) => (
                  <Link key={code} href={`/${code}`}>
                    {POKER_TITLES[code]}
                  </Link>
                ))}
              </nav>
            </div>
          )}
          {info === "history" && (
            <div className="pk-receipts">
              {data?.history.length ? (
                data.history.map((h) => (
                  <article key={h.id}>
                    <small>Round #{h.id}</small>
                    <strong>
                      {h.winners.map(label).join(" & ")}
                      {h.winners.length > 1 ? " · Tie" : " wins"}
                    </strong>
                    <span>
                      {h.winners
                        .map((p) => HAND_NAMES[h.categories[p]])
                        .join(" / ")}
                    </span>
                  </article>
                ))
              ) : (
                <p>No completed rounds yet.</p>
              )}
            </div>
          )}
          {info === "bets" && (
            <div className="pk-receipts">
              {data &&
                [
                  ...data.slips,
                  ...data.recent.filter(
                    (b) => !data.slips.some((s) => s.id === b.id),
                  ),
                ].map((b) => (
                  <article key={b.id}>
                    <small>
                      Round #{b.roundId} · Bet #{b.id}
                    </small>
                    {b.selections.map((s, i) => (
                      <span key={i}>
                        {s.quote.label} · {money(s.amountPaise)} ·{" "}
                        {renderQuote(s.quote)}
                      </span>
                    ))}
                    <strong>Debited {money(b.stakePaise)}</strong>
                    <span>
                      {b.payoutPaise === null
                        ? "Accepted · awaiting result"
                        : `Returned ${money(b.payoutPaise)}`}
                    </span>
                  </article>
                ))}
              {!data || (!data.slips.length && !data.recent.length) ? (
                <p>No bets yet. Choose a stake, select a market and confirm.</p>
              ) : null}
            </div>
          )}
          {info === "fairness" && (
            <div className="pk-rule-copy">
              <p>Round #{round?.id ?? "—"}</p>
              <code className="pk-commitment">
                {round?.commitment ?? "Connecting…"}
              </code>
              <p>
                A random nonce keeps hidden cards private. After the result,
                SHA-256 of the game, all hands, board and nonce must match this
                hash. This checks the commitment; it is not an independent audit
                of randomness.
              </p>
              <button
                className="pk-confirm"
                disabled={!round?.nonce}
                onClick={() => void verify()}
              >
                Verify revealed cards
              </button>
              {verification && <p role="status">{verification}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
