import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useEffect,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type NodeChoice = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
};
type Row = Record<string, string | number | string[] | null>;
type LiveData = {
  role: string;
  windowSeconds: number;
  generatedAt: string;
  nodes: NodeChoice[];
  totals: {
    totalPlayers: number;
    online: number;
    betting: number;
    sessions: number;
  };
  items: Row[];
};
type Report = {
  role: string;
  generatedAt: string;
  range: { from: string; to: string; timezone: string };
  nodes: NodeChoice[];
  totals: Record<string, string | number>;
  items: Row[];
  entries: { total: number; items: Row[] };
  evidence: Row[];
  games?: string[];
};
const money = (value: unknown) => {
  const n = BigInt(String(value ?? "0")),
    abs = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}₹${(abs / 100n).toLocaleString("en-IN")}.${String(abs % 100n).padStart(2, "0")}`;
};
const stamp = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "short",
        timeStyle: "medium",
      })
    : "—";
const str = (value: unknown) => (value == null ? "—" : String(value));

export function LivePlayerBar() {
  const [offset, setOffset] = useState(0);
  const live = useQuery({
    queryKey: ["operator-live", offset],
    queryFn: ({ signal }) =>
      customFetch<LiveData>(`/api/network/insights/live?offset=${offset}`, {
        signal,
      }),
    refetchInterval: 15_000,
    retry: false,
  });
  const data = live.isError ? undefined : live.data;
  return (
    <section className="oi-live" aria-label="Live player counts">
      <style>{styles}</style>
      <span className="oi-live-title">
        <i /> LIVE PLAYERS
      </span>
      {data ? (
        <>
          <strong>
            {data.totals.online} <span>online</span>
          </strong>
          <strong>
            {data.totals.betting} <span>betting</span>
          </strong>
          <strong>
            {data.totals.totalPlayers} <span>total players</span>
          </strong>
          <small>
            {data.role === "admin" ? "All channels" : "Your branch"} · Active in
            last 2 min ·{" "}
            {new Date(data.generatedAt).toLocaleTimeString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}{" "}
            IST
          </small>
        </>
      ) : (
        <span>
          {live.isError ? "Live counts unavailable" : "Loading live counts…"}
        </span>
      )}
      <button
        type="button"
        onClick={() => void live.refetch()}
        disabled={live.isFetching}
        aria-label="Refresh live player counts"
      >
        ↻
      </button>
      {data && (
        <details className="oi-live-list">
          <summary>View online players</summary>
          <div className="oi">
            <div className="oi-table">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Branch</th>
                    <th>Last seen (IST)</th>
                    <th>Sessions</th>
                    <th>Bets / 2 min</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={str(row.id)}>
                      <td>
                        {str(row.name ?? row.email)}
                        <small>{str(row.email)}</small>
                      </td>
                      <td>
                        {row.agent
                          ? `${row.master} / ${row.agent}`
                          : str(row.channel)}
                      </td>
                      <td>{stamp(row.last_seen)}</td>
                      <td>{str(row.sessions)}</td>
                      <td>{str(row.recent_bets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && <p>No online players in this selection.</p>}
            <Pager
              offset={offset}
              total={data.totals.online}
              setOffset={setOffset}
              loading={live.isFetching}
            />
          </div>
        </details>
      )}
    </section>
  );
}

type Filters = {
  period: string;
  channel: string;
  nodeId: string;
  playerId: string;
  search: string;
  from: string;
  to: string;
  game: string;
  roundId: string;
  status: string;
  minStake: string;
  maxStake: string;
  sort: string;
  reviewOnly: string;
  mismatchOnly: string;
};
const initial: Filters = {
  period: "today",
  channel: "all",
  nodeId: "",
  playerId: "",
  search: "",
  from: "",
  to: "",
  game: "",
  roundId: "",
  status: "",
  minStake: "",
  maxStake: "",
  sort: "stake",
  reviewOnly: "false",
  mismatchOnly: "false",
};
function Field({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="oi-field">
      <label id={id} htmlFor={`${id}-input`}>
        {title}
      </label>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        (child.type === "input" || child.type === "select")
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              id: `${id}-input`,
              "aria-labelledby": id,
            })
          : child,
      )}
    </div>
  );
}
function Pager({
  offset,
  total,
  setOffset,
  loading,
}: {
  offset: number;
  total: number;
  setOffset: (value: number) => void;
  loading: boolean;
}) {
  return (
    <div className="oi-pager">
      <span>
        {total
          ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total.toLocaleString()}`
          : "0 records"}
      </span>
      <button
        disabled={!offset || loading}
        onClick={() => setOffset(Math.max(0, offset - 50))}
      >
        Previous
      </button>
      <button
        disabled={offset + 50 >= total || loading}
        onClick={() => setOffset(offset + 50)}
      >
        Next
      </button>
    </div>
  );
}

export function OperatorInsights({
  mode = "accounts",
  admin = false,
  channel,
}: {
  mode?: "accounts" | "bets";
  admin?: boolean;
  channel?: string;
}) {
  const bets = mode === "bets";
  const defaults = { ...initial, channel: channel ?? (admin ? "all" : "b2b") };
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState<Filters>(defaults);
  const [offset, setOffset] = useState(0),
    [entriesOffset, setEntriesOffset] = useState(0);
  const [error, setError] = useState(""),
    [downloading, setDownloading] = useState("");
  const [nodes, setNodes] = useState<NodeChoice[]>([]);
  const [games, setGames] = useState<string[]>([]);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => !!value),
  );
  query.set("offset", String(offset));
  query.set("entriesOffset", String(entriesOffset));
  const endpoint = bets
    ? "/api/admin/betting-insights"
    : "/api/network/insights/accounts";
  const report = useQuery({
    queryKey: ["operator-insights", mode, query.toString()],
    queryFn: ({ signal }) =>
      customFetch<Report>(`${endpoint}?${query}`, { signal }),
    refetchInterval: bets ? 15_000 : 30_000,
    retry: false,
  });
  const data = report.isError ? undefined : report.data;
  useEffect(() => {
    if (data) {
      setNodes(data.nodes);
      setGames((previous) =>
        [...new Set([...previous, ...(data.games ?? [])])].sort(),
      );
    }
  }, [data]);
  function apply(next: Filters) {
    setFilters(next);
    setDraft(next);
    setOffset(0);
    setEntriesOffset(0);
    setError("");
  }
  function input(key: keyof Filters, title: string, type = "text") {
    return (
      <Field title={title}>
        <input
          type={type}
          value={draft[key]}
          onChange={(event) =>
            setDraft({ ...draft, [key]: event.target.value })
          }
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? "0" : undefined}
        />
      </Field>
    );
  }
  async function download(format: "xlsx" | "pdf") {
    setDownloading(format);
    setError("");
    try {
      const params = new URLSearchParams(query);
      params.set("format", format);
      params.delete("offset");
      params.delete("entriesOffset");
      const blob = await customFetch<Blob>(`${endpoint}?${params}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `lunarx-${mode}-${data?.range.from ?? "report"}-${data?.range.to ?? ""}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Download failed. Please retry.",
      );
    } finally {
      setDownloading("");
    }
  }
  const selectedName = filters.playerId
    ? data?.items.find((row) => row.player_id === filters.playerId)?.email
    : null;
  const totals = data?.totals;
  const cards = bets
    ? ([
        ["Players", totals?.players, false],
        ["Bets placed", totals?.bets, false],
        ["Total stake", totals?.stake, true],
        ["Settled returns", totals?.payout, true],
        ["Settled house net", totals?.houseNet, true],
        ["Pending stake", totals?.pending, true],
        ["Needs review", totals?.review, false],
      ] as const)
    : ([
        ["Wallets", totals?.accounts, false],
        ["Opening", totals?.opening, true],
        ["Credits", totals?.credits, true],
        ["Debits", totals?.debits, true],
        ["Closing", totals?.closing, true],
        ["Mismatch wallets", totals?.mismatches, false],
      ] as const);
  return (
    <section
      className="oi"
      aria-label={
        bets ? "Admin bet investigation" : "Accounts and ledger tally"
      }
    >
      <style>{styles}</style>
      <header className="oi-heading">
        <div>
          <span className="oi-eyebrow">
            {bets
              ? "ADMIN · BETTING INTELLIGENCE"
              : "ACCOUNTS · AUTOMATIC TALLY"}
          </span>
          <h1>{bets ? "Bets & player review" : "Accounts & ledger tally"}</h1>
          <p>
            {bets
              ? "Find the biggest bettors, inspect their bets and review unusual activity."
              : "Match opening balances, credits, debits and closing balances across your players."}
          </p>
        </div>
        <div className="oi-actions">
          <button
            disabled={report.isFetching}
            onClick={() => void report.refetch()}
          >
            Refresh
          </button>
          <button
            disabled={!data || !!downloading}
            onClick={() => void download("xlsx")}
          >
            {downloading === "xlsx" ? "Preparing…" : "Download Excel"}
          </button>
          <button
            disabled={!data || !!downloading}
            onClick={() => void download("pdf")}
          >
            {downloading === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </header>
      <div className="oi-presets">
        {["today", "yesterday", "weekly", "monthly"].map((period) => (
          <button
            key={period}
            aria-pressed={filters.period === period}
            onClick={() => apply({ ...filters, period })}
          >
            {period[0]!.toUpperCase() + period.slice(1)}
          </button>
        ))}
      </div>
      <form
        className="oi-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            draft.period === "custom" &&
            (!draft.from || !draft.to || draft.from > draft.to)
          ) {
            setError("Choose a valid start and end date.");
            return;
          }
          apply(draft);
        }}
      >
        <Field title="Period">
          <select
            value={draft.period}
            onChange={(e) => setDraft({ ...draft, period: e.target.value })}
          >
            {["today", "yesterday", "weekly", "monthly", "custom"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </Field>
        {draft.period === "custom" && (
          <>
            {input("from", "From (IST)", "date")}
            {input("to", "To (IST)", "date")}
          </>
        )}
        {admin && !channel && (
          <Field title="Channel">
            <select
              value={draft.channel}
              onChange={(e) =>
                setDraft({ ...draft, channel: e.target.value, nodeId: "" })
              }
            >
              <option value="all">All channels</option>
              <option value="b2c">B2C</option>
              <option value="b2b">B2B</option>
            </select>
          </Field>
        )}
        {draft.channel !== "b2c" && (
          <Field title="Branch / agent">
            <select
              value={draft.nodeId}
              onChange={(e) => setDraft({ ...draft, nodeId: e.target.value })}
            >
              <option value="">All accessible accounts</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.kind})
                </option>
              ))}
            </select>
          </Field>
        )}
        {input("search", "Player name / email")}
        {input("playerId", "Exact player ID")}
        {bets && (
          <>
            <Field title="Game">
              <input
                list="oi-games"
                value={draft.game}
                onChange={(e) => setDraft({ ...draft, game: e.target.value })}
                placeholder="All games"
              />
              <datalist id="oi-games">
                {games.map((game) => (
                  <option key={game} value={game} />
                ))}
              </datalist>
            </Field>
            {input("roundId", "Round ID")}
            <Field title="Bet status">
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">All statuses</option>
                {["placed", "won", "lost", "cashed_out", "voided"].map(
                  (status) => (
                    <option key={status}>{status}</option>
                  ),
                )}
              </select>
            </Field>
            {input("minStake", "Minimum bet (INR)", "number")}
            {input("maxStake", "Maximum bet (INR)", "number")}
            <Field title="Rank players by">
              <select
                value={draft.sort}
                onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
              >
                {[
                  ["stake", "Highest total stake"],
                  ["bets", "Most bets"],
                  ["largest", "Largest single bet"],
                  ["payout", "Highest returns"],
                  ["profit", "Highest player profit"],
                  ["recent", "Latest activity"],
                ].map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <label className="oi-check">
          <input
            type="checkbox"
            checked={(bets ? draft.reviewOnly : draft.mismatchOnly) === "true"}
            onChange={(e) =>
              setDraft({
                ...draft,
                [bets ? "reviewOnly" : "mismatchOnly"]: String(
                  e.target.checked,
                ),
              })
            }
          />
          {bets ? "Needs review only" : "Mismatches only"}
        </label>
        <button className="oi-primary" type="submit">
          Apply filters
        </button>
        <button type="button" onClick={() => apply(defaults)}>
          Reset
        </button>
      </form>
      {filters.playerId && (
        <div className="oi-focus">
          Player: {selectedName ?? filters.playerId}
          <button onClick={() => apply({ ...filters, playerId: "" })}>
            Show all players
          </button>
        </div>
      )}
      {(error || report.error) && (
        <p className="oi-error" role="alert">
          {error ||
            (report.error instanceof Error
              ? report.error.message
              : "Report unavailable")}{" "}
          <button onClick={() => void report.refetch()}>Retry</button>
        </p>
      )}
      {report.isLoading && <p role="status">Loading report…</p>}
      {data && (
        <>
          <p className="oi-meta">
            {data.range.from} → {data.range.to} · IST · Updated{" "}
            {stamp(data.generatedAt)} · Auto refresh {bets ? "15" : "30"}s
          </p>
          <div className="oi-cards">
            {cards.map(([title, value, isMoney]) => (
              <article key={title}>
                <span>{title}</span>
                <strong>
                  {isMoney
                    ? money(value)
                    : Number(value ?? 0).toLocaleString("en-IN")}
                </strong>
              </article>
            ))}
          </div>
          <p className="oi-note">
            {bets
              ? "Totals follow bet placement dates and the applied filters. Pending and voided bets do not count towards settled profit. Review signals need investigation; they do not establish cheating or trigger account restrictions."
              : "Opening + credits − debits = closing. All wallet scopes are listed separately. Tally checks the full ledger up to the end date, including earlier balance breaks. Equal-timestamp entries are checked together. Downloads include every matching row, wallet entries and a separate commission sheet."}
          </p>
          {bets ? (
            <>
              <h2>Top betting players</h2>
              <div className="oi-table">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Player",
                        "Bets",
                        "Total stake",
                        "Largest bet",
                        "Settled returns",
                        "Player profit",
                        "Win rate",
                        "Pending",
                        "Review signals",
                        "Details",
                      ].map((title) => (
                        <th key={title}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={str(row.player_id)}>
                        <td>
                          <strong>{str(row.name ?? row.email)}</strong>
                          <small>{str(row.email)}</small>
                          <small>
                            {row.agent
                              ? `${row.master} / ${row.agent}`
                              : row.channel}
                          </small>
                        </td>
                        <td>{str(row.bets)}</td>
                        <td>{money(row.stake)}</td>
                        <td>{money(row.largest)}</td>
                        <td>{money(row.payout)}</td>
                        <td>{money(row.profit)}</td>
                        <td>
                          {Number(row.settled)
                            ? `${((Number(row.wins) / Number(row.settled)) * 100).toFixed(1)}%`
                            : "—"}
                          <small>{str(row.settled)} settled</small>
                        </td>
                        <td>
                          {money(row.pending)}
                          <small>{str(row.pending_bets)} bets</small>
                        </td>
                        <td className="oi-reasons">
                          {Array.isArray(row.reasons) && row.reasons.length ? (
                            row.reasons.map((reason) => (
                              <span className="oi-warning" key={reason}>
                                {reason}
                              </span>
                            ))
                          ) : (
                            <span className="oi-muted">
                              No signals in these checks
                            </span>
                          )}
                          <small>Peak: {str(row.peak)} bets/min</small>
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              apply({
                                ...filters,
                                playerId: str(row.player_id),
                              })
                            }
                          >
                            Inspect player
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <h2>Wallet reconciliation</h2>
              <div className="oi-table">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Player / wallet",
                        "Opening",
                        "Credits",
                        "Debits",
                        "Closing",
                        "Recorded",
                        "Difference",
                        "Tally",
                        "Details",
                      ].map((title) => (
                        <th key={title}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={str(row.wallet_id)}>
                        <td>
                          <strong>{str(row.name ?? row.email)}</strong>
                          <small>{str(row.email)}</small>
                          <small>
                            {str(row.scope)} · {str(row.currency)}
                          </small>
                        </td>
                        {[
                          "opening",
                          "credits",
                          "debits",
                          "closing",
                          "recorded",
                          "difference",
                        ].map((key) => (
                          <td key={key}>{money(row[key])}</td>
                        ))}
                        <td>
                          <span
                            className={
                              BigInt(str(row.difference)) !== 0n ||
                              Number(row.breaks)
                                ? "oi-warning"
                                : "oi-ok"
                            }
                          >
                            {BigInt(str(row.difference)) !== 0n ||
                            Number(row.breaks)
                              ? `${row.breaks} balance breaks`
                              : "Matched"}
                          </span>
                          <small>{str(row.entries)} entries</small>
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              apply({
                                ...filters,
                                playerId: str(row.player_id),
                              })
                            }
                          >
                            View ledger
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!data.items.length && (
            <p className="oi-empty">No players match these filters.</p>
          )}
          <Pager
            offset={offset}
            total={Number(data.totals[bets ? "players" : "accounts"])}
            setOffset={setOffset}
            loading={report.isFetching}
          />
          {bets && filters.playerId && (
            <section className="oi-evidence">
              <h2>Current security evidence</h2>
              {data.evidence.length ? (
                data.evidence.map((row) => (
                  <p key={str(row.id)}>
                    <strong>
                      {str(row.severity)} · {str(row.rule)}
                    </strong>
                    <br />
                    {str(row.description)}
                    <small>
                      {stamp(row.created_at)} · Flag {str(row.id)}
                    </small>
                  </p>
                ))
              ) : (
                <p>
                  No unresolved security flags for this player. This does not
                  certify fair play.
                </p>
              )}
            </section>
          )}
          <h2>{bets ? "Matching bets" : "Matching wallet entries"}</h2>
          <div className="oi-table">
            <table>
              <thead>
                <tr>
                  {(bets
                    ? [
                        "Placed (IST)",
                        "Player",
                        "Game / round / bet",
                        "Stake",
                        "Payout",
                        "Status",
                      ]
                    : [
                        "Date (IST)",
                        "Player / scope",
                        "Type",
                        "Amount",
                        "Balance after",
                        "Reference",
                      ]
                  ).map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.items.map((row) => (
                  <tr key={str(row.id)}>
                    <td>{stamp(bets ? row.at : row.created_at)}</td>
                    <td>
                      {str(row.email)}
                      {!bets && <small>{str(row.scope)}</small>}
                    </td>
                    <td>
                      {str(bets ? row.game : row.type)}
                      {bets && (
                        <>
                          <small>Round: {str(row.reference)}</small>
                          <small>Bet: {str(row.id)}</small>
                        </>
                      )}
                    </td>
                    <td>{money(bets ? row.stake : row.amount)}</td>
                    <td>{money(bets ? row.payout : row.balance_after)}</td>
                    <td>
                      {bets ? (
                        str(row.status)
                      ) : (
                        <>
                          {str(row.ref_type)}
                          <small>{str(row.ref_id)}</small>
                          <small>{str(row.memo)}</small>
                          <small>Entry: {str(row.id)}</small>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.entries.items.length && (
            <p className="oi-empty">No entries match these filters.</p>
          )}
          <Pager
            offset={entriesOffset}
            total={data.entries.total}
            setOffset={setEntriesOffset}
            loading={report.isFetching}
          />
          <p className="oi-meta">
            Excel: up to 50,000 rows per sheet. PDF: up to 5,000 records. Larger
            selections show a filter message; exports are never silently
            truncated.
          </p>
        </>
      )}
    </section>
  );
}

const styles = `
.oi-live-list{width:100%;min-width:0}.oi-live-list summary{cursor:pointer;color:#25644d;font-size:11px}.oi-live-list>div{margin-top:12px}
.oi,.oi-live{font-family:inherit;color:#183c36}.oi{min-width:0}.oi *{box-sizing:border-box}.oi h1{font-size:26px;font-weight:700;margin:5px 0}.oi h2{font-size:17px;font-weight:650;margin:24px 0 12px}.oi-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.oi-heading p,.oi-meta,.oi-note{font-size:12px;color:#647872;line-height:1.6}.oi-eyebrow{font-size:10px;letter-spacing:.16em;color:#14856d;font-weight:700}.oi-actions,.oi-presets{display:flex;gap:8px;flex-wrap:wrap}.oi-presets{margin:20px 0 12px}.oi button,.oi-live button{padding:8px 12px;border:1px solid #c7d9d2;border-radius:7px;background:#fff;color:#185e4e;font-size:12px;cursor:pointer;line-height:1.4}.oi button:disabled,.oi-live button:disabled{opacity:.45;cursor:default}.oi button:focus-visible,.oi input:focus-visible,.oi select:focus-visible,.oi-live button:focus-visible{outline:2px solid #15856d;outline-offset:2px}.oi .oi-primary,.oi button[aria-pressed=true]{background:#14664f;color:white;border-color:#14664f}.oi-filters{display:flex;align-items:end;flex-wrap:wrap;gap:12px;padding:18px;background:#f4f8f6;border:1px solid #deebe5;border-radius:10px}.oi-field{display:grid;gap:6px;flex:1 1 150px;min-width:130px;max-width:270px;font-size:11px;color:#526d63}.oi-field input,.oi-field select{width:100%;min-height:36px;border:1px solid #c7d9d2;border-radius:6px;background:white;padding:7px;color:#244239;font-size:12px}.oi-check{display:flex;align-items:center;gap:8px;font-size:12px;min-height:36px}.oi-check input{width:16px;height:16px}.oi-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:14px 0}.oi-cards article{border:1px solid #dbe8e1;border-radius:10px;padding:16px;background:#fff;min-width:0}.oi-cards span{display:block;font-size:11px;color:#628075;margin-bottom:8px}.oi-cards strong{font-size:20px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.oi-table{width:100%;overflow:auto;border:1px solid #dce7e1;border-radius:8px;background:white}.oi table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}.oi th{background:#edf4f0;color:#506b60;text-align:left;font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;padding:12px}.oi td{padding:12px;border-top:1px solid #e6ede9;vertical-align:top;font-variant-numeric:tabular-nums}.oi small{display:block;font-size:10px;color:#72867c;margin-top:4px;max-width:250px;white-space:normal;overflow-wrap:anywhere}.oi td strong{display:block;font-size:12px}.oi .oi-reasons{min-width:210px;max-width:280px;white-space:normal}.oi-warning,.oi-ok{display:block;border-radius:5px;padding:5px 7px;font-size:10px;margin-bottom:5px;white-space:normal}.oi-warning{color:#8e4c0e;background:#fff0d6}.oi-ok{background:#e3f5eb;color:#16644d}.oi-muted{color:#6f8278;font-size:11px}.oi-pager{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px;font-size:12px}.oi-pager span{margin-right:auto;color:#60776d}.oi-note{background:#eef5f1;padding:12px;border-radius:8px}.oi-error{border:1px solid #efc3ba;background:#fff2ee;color:#993d2c;padding:12px;border-radius:7px;font-size:13px;margin-top:16px}.oi-focus{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px;background:#e8f4ee;border-radius:7px;margin:12px 0;font-size:12px;overflow-wrap:anywhere}.oi-empty{padding:25px;text-align:center;color:#718579;font-size:13px}.oi-evidence{border:1px solid #e7d3b1;background:#fffaf2;padding:4px 16px 14px;border-radius:9px;margin-top:20px;font-size:12px}.oi-live{display:flex;align-items:center;gap:16px;flex-wrap:wrap;border:1px solid #cde3d8;background:#eff8f3;padding:12px 15px;border-radius:9px;margin-bottom:22px;font-size:12px}.oi-live strong{font-size:18px;font-variant-numeric:tabular-nums}.oi-live strong span{font-size:11px;font-weight:400;color:#637b6d}.oi-live small{font-size:10px;color:#6a8274;margin-left:auto}.oi-live-title{font-size:10px;letter-spacing:.1em;font-weight:700;display:flex;align-items:center;gap:6px}.oi-live-title i{width:7px;height:7px;border-radius:50%;background:#1e9569}.oi-live button{padding:3px 9px}.oi-meta{margin:12px 0}@media(max-width:600px){.oi-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.oi-cards strong{font-size:17px}.oi-heading h1{font-size:23px}.oi-field{max-width:none;flex-basis:42%}.oi-filters{padding:12px;gap:10px}.oi-actions{width:100%}.oi-actions button{flex:1}.oi-live{gap:10px}.oi-live small{width:100%;margin:0}.oi-live-title{width:100%}}
`;
