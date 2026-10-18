import { useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import {
  ACTORS,
  actor,
  label,
  initialDemo,
  applyDemo,
  available,
  collectorFor,
  canManageAccounts,
  inScope,
  weeklyLocked,
  visibleRequests,
  dateRange,
  istDay,
  DEMO_CLOCKS,
  type ActorId,
  type DemoAction,
  type Period,
} from "@/features/collection-demo/model";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const credits = (n: number) => `${n.toLocaleString("en-IN")} test credits`;
const time = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
const selectClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{title}</span>
      {children}
    </label>
  );
}
function CollectionSimulation() {
  const [state, setState] = useState(initialDemo);
  const [viewer, setViewer] = useState<ActorId>("demo-admin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestKind, setRequestKind] = useState<"deposit" | "withdrawal">(
    "deposit",
  );
  const [requestAmount, setRequestAmount] = useState("500");
  const [chosenAccount, setChosenAccount] = useState("");
  const [settlementAmount, setSettlementAmount] = useState("100");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const who = actor(viewer);
  const masters = ACTORS.filter((a) => a.role === "master" && inScope(who, a));
  const agents = ACTORS.filter((a) => a.role === "agent" && inScope(who, a));
  const customers = ACTORS.filter(
    (a) => a.role === "customer" && inScope(who, a),
  );
  const collector = who.role === "customer" ? collectorFor(state, who) : null;
  const accounts = state.accounts.filter(
    (a) => a.owner === (collector ?? viewer) && a.active,
  );
  const accountId = accounts.some((a) => a.id === chosenAccount)
    ? chosenAccount
    : (accounts[0]?.id ?? "");
  const allRows = visibleRequests(state, who);
  const filtered = useMemo(() => {
    try {
      const range = dateRange(state.clock, period, from, to),
        needle = search.trim().toLowerCase();
      return {
        error: "",
        rows: visibleRequests(state, actor(viewer))
          .filter(
            (r) =>
              (status === "all" || status === r.status) &&
              (kind === "all" || kind === r.kind) &&
              (!agentFilter || agentFilter === r.agent) &&
              (!range.from || istDay(r.createdAt) >= range.from) &&
              (!range.to || istDay(r.createdAt) <= range.to) &&
              (!needle ||
                `${r.id} ${label(r.customer)} ${label(r.collector)}`
                  .toLowerCase()
                  .includes(needle)),
          )
          .slice()
          .reverse(),
      };
    } catch (e) {
      return { error: (e as Error).message, rows: [] };
    }
  }, [state, viewer, period, from, to, status, kind, search, agentFilter]);
  function run(action: DemoAction) {
    setError("");
    setNotice("");
    try {
      const next = applyDemo(state, viewer, action);
      setState(next);
      setNotice(next.audit[0]?.detail ?? "Demo updated");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function switchViewer(value: ActorId) {
    setViewer(value);
    setError("");
    setNotice("");
    setChosenAccount("");
    setAgentFilter("");
    setSearch("");
    setStatus("all");
    setKind("all");
  }
  const sampleStatements = state.statements.filter(
    (s) => who.role === "admin" || who.masterId === s.master,
  );
  const ledgerTotal = customers.reduce(
    (n, c) => n + (state.balances[c.id] ?? 0),
    0,
  );
  const reserved = customers.reduce(
    (n, c) => n + (state.balances[c.id] ?? 0) - available(state, c.id),
    0,
  );
  return (
    <div className="space-y-6 min-w-0" data-testid="collection-demo">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Interactive prototype
        </p>
        <h1 className="text-2xl font-semibold">Branch collection sandbox</h1>
        <p className="text-sm text-slate-600 mt-1">
          Review who collects, who approves and how a branch delegates work.
        </p>
      </div>
      <div
        role="note"
        className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      >
        <strong>Simulation only — fictional accounts and test credits.</strong>{" "}
        This page cannot collect money, contact a bank, change a real wallet or
        start gameplay. There is no live-payment switch. Reloading or resetting
        clears the demo.
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Choose a demo role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field title="Simulated identity">
              <select
                aria-label="Simulated identity"
                className={selectClass}
                value={viewer}
                onChange={(e) => switchViewer(e.target.value as ActorId)}
              >
                {ACTORS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Simulation clock (India time)">
              <select
                aria-label="Simulation clock"
                className={selectClass}
                value={state.clock}
                onChange={(e) => {
                  setState({ ...state, clock: e.target.value });
                  setError("");
                  setNotice("");
                }}
              >
                <option value={DEMO_CLOCKS.monday}>
                  Monday 19 Oct · 12:00 — payment grace
                </option>
                <option value={DEMO_CLOCKS.tuesday}>
                  Tuesday 20 Oct · 00:00 — due check
                </option>
                <option value={DEMO_CLOCKS.wednesday}>
                  Wednesday 21 Oct · 00:00
                </option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Role switching previews fictional screens. Your actual administrator
            login stays unchanged.
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Try the complete flow
            </summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>As demo admin, assign East master to master collection.</li>
              <li>
                Switch to East master, add fictional account A, and optionally
                delegate Alpha agent.
              </li>
              <li>
                For delegated collection, switch to Alpha agent and add its
                fictional account.
              </li>
              <li>
                As Asha, submit a deposit. Switch to the assigned collector to
                approve it.
              </li>
              <li>
                As Asha, request a withdrawal. The assigned collector approves
                or rejects it.
              </li>
              <li>
                Advance the clock to Tuesday. Submit a sample weekly receipt as
                East master, then confirm it as demo admin.
              </li>
            </ol>
          </details>
          <Button
            variant="outline"
            onClick={() => {
              setState(initialDemo());
              switchViewer("demo-admin");
              setPeriod("all");
              setFrom("");
              setTo("");
              setNotice("Demo reset. Production records were not changed.");
            }}
          >
            Reset fictional scenario
          </Button>
        </CardContent>
      </Card>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Demo balances">
        {[
          ["Customer balance", ledgerTotal],
          ["Reserved withdrawals", reserved],
          ["Available credits", ledgerTotal - reserved],
        ].map(([title, value]) => (
          <Card key={title}>
            <CardContent className="pt-5">
              <p className="text-xs text-slate-500">{title}</p>
              <p className="text-lg font-semibold mt-1">
                {credits(Number(value))}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {who.role === "admin" && (
        <Card aria-label="Master collection permissions">
          <CardHeader>
            <CardTitle>Assign collection mode to each master</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Admin collection is the default. Only the demo admin can grant
              master collection. Mode changes require affected balances and
              pending requests to be cleared.
            </p>
            {masters.map((m) => (
              <div
                key={m.id}
                className="grid gap-3 sm:grid-cols-2 border rounded-lg p-4"
              >
                <div>
                  <strong>{m.name}</strong>
                  <p className="text-xs text-slate-500">
                    {state.masterModes[m.id] === "admin"
                      ? "Admin accounts and admin approvals"
                      : "Master controls this branch and may delegate agents"}
                  </p>
                </div>
                <select
                  aria-label={`${m.name} collection mode`}
                  className={selectClass}
                  value={state.masterModes[m.id]}
                  onChange={(e) =>
                    run({
                      type: "master-mode",
                      master: m.id,
                      mode: e.target.value as "admin" | "master",
                    })
                  }
                >
                  <option value="admin">Admin collection</option>
                  <option value="master">Master collection</option>
                </select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(who.role === "admin" || who.role === "master") && (
        <Card aria-label="Demo team management">
          <CardHeader>
            <CardTitle>Team & agent permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {who.role === "master" && (
              <p className="text-sm">
                Branch mode:{" "}
                <strong>
                  {state.masterModes[who.id] === "master"
                    ? "Master collection assigned"
                    : "Admin collection — delegation unavailable"}
                </strong>
              </p>
            )}
            {agents.map((a) => (
              <div
                key={a.id}
                className="grid gap-3 md:grid-cols-3 border rounded-lg p-4"
              >
                <div>
                  <strong>{a.name}</strong>
                  <p className="text-xs text-slate-500">
                    {label(a.masterId!)} ·{" "}
                    {state.teamActive[a.id]
                      ? "Active"
                      : "Paused for new deposits"}
                  </p>
                </div>
                {who.role === "master" ? (
                  <select
                    aria-label={`${a.name} collection mode`}
                    className={selectClass}
                    disabled={state.masterModes[who.id] !== "master"}
                    value={state.agentModes[a.id]}
                    onChange={(e) =>
                      run({
                        type: "agent-mode",
                        agent: a.id,
                        mode: e.target.value as "master" | "agent",
                      })
                    }
                  >
                    <option value="master">Use master's account</option>
                    <option value="agent">Agent manages own collection</option>
                  </select>
                ) : (
                  <p className="text-sm self-center">
                    {state.masterModes[a.masterId!] === "admin"
                      ? "Admin collects"
                      : state.agentModes[a.id] === "agent"
                        ? "Agent collects"
                        : "Master collects"}
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    run({
                      type: "team-status",
                      agent: a.id,
                      active: !state.teamActive[a.id],
                    })
                  }
                >
                  {state.teamActive[a.id] ? "Pause" : "Resume"} {a.name}
                </Button>
              </div>
            ))}
            <p className="text-xs text-slate-500">
              Pausing an agent prevents new deposit credits. Existing
              withdrawals can still be resolved.
            </p>
          </CardContent>
        </Card>
      )}

      {who.role !== "customer" && (
        <Card aria-label="Fictional collection accounts">
          <CardHeader>
            <CardTitle>Your fictional collection accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManageAccounts(state, who) ? (
              <>
                <p className="text-sm text-slate-600">
                  Select a fake account slot to demonstrate account management.
                  No bank number, UPI ID, QR or payment link is accepted.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["A", "B"] as const).map((slot) => (
                    <Button
                      key={slot}
                      disabled={state.accounts.some(
                        (a) => a.owner === viewer && a.slot === slot,
                      )}
                      onClick={() => run({ type: "add-account", slot })}
                    >
                      Add fictional account {slot}
                    </Button>
                  ))}
                </div>
                {state.accounts
                  .filter((a) => a.owner === viewer)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"
                    >
                      <div>
                        <strong>Fictional account {a.slot}</strong>
                        <p className="text-xs text-slate-500">
                          {a.id} · {a.active ? "Enabled" : "Disabled"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() =>
                          run({
                            type: "account-status",
                            id: a.id,
                            active: !a.active,
                          })
                        }
                      >
                        {a.active ? "Disable" : "Enable"} account {a.slot}
                      </Button>
                    </div>
                  ))}
              </>
            ) : (
              <p>
                Collection is managed upstream. Your customers use the assigned
                admin or master account.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {who.role === "customer" && (
        <Card aria-label="Customer request simulator">
          <CardHeader>
            <CardTitle>Submit a fictional request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded bg-slate-50 p-3 text-sm">
              <p>
                Assigned collector:{" "}
                <strong data-testid="assigned-collector">
                  {label(collector!)}
                </strong>
              </p>
              <p>
                Available: <strong>{credits(available(state, viewer))}</strong>
              </p>
              <p>
                Branch:{" "}
                {weeklyLocked(state, who.masterId)
                  ? "Locked for new deposits — weekly sample balance overdue"
                  : "Open"}
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                run({
                  type: "request",
                  kind: requestKind,
                  amount: Number(requestAmount),
                  account: accountId,
                });
              }}
            >
              <Field title="Request type">
                <select
                  aria-label="Request type"
                  className={selectClass}
                  value={requestKind}
                  onChange={(e) =>
                    setRequestKind(e.target.value as "deposit" | "withdrawal")
                  }
                >
                  <option value="deposit">Deposit simulation</option>
                  <option value="withdrawal">Withdrawal simulation</option>
                </select>
              </Field>
              <Field title="Test credits">
                <Input
                  aria-label="Request test credits"
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  required
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(e.target.value)}
                />
              </Field>
              {requestKind === "deposit" && (
                <Field title="Fictional destination">
                  <select
                    aria-label="Fictional destination"
                    className={selectClass}
                    value={accountId}
                    onChange={(e) => setChosenAccount(e.target.value)}
                  >
                    {!accounts.length && (
                      <option value="">
                        Collector has no enabled demo account
                      </option>
                    )}
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {label(a.owner)} · fictional account {a.slot}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="self-end">
                <Button type="submit">Submit simulated {requestKind}</Button>
              </div>
            </form>
            <p className="text-xs text-slate-500">
              Deposits remain pending until the assigned collector approves.
              Withdrawal requests reserve test credits; rejection or
              cancellation releases the reservation.
            </p>
          </CardContent>
        </Card>
      )}

      <Card aria-label="Demo request history">
        <CardHeader>
          <CardTitle>Requests & approvals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field title="Period">
              <select
                aria-label="Request period"
                className={selectClass}
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
              >
                {(
                  [
                    ["all", "All dates"],
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
                    ["weekly", "Weekly"],
                    ["monthly", "Monthly"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Status">
              <select
                aria-label="Request status filter"
                className={selectClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["all", "pending", "approved", "rejected", "cancelled"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s === "all" ? "All statuses" : s}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field title="Type">
              <select
                aria-label="Request type filter"
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">Both types</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </Field>
            <Field title="Search">
              <Input
                aria-label="Search demo requests"
                placeholder="Test customer, collector or ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            {who.role !== "customer" && (
              <Field title="Agent">
                <select
                  aria-label="Request agent filter"
                  className={selectClass}
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                >
                  <option value="">All visible agents</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {period === "custom" && (
              <>
                <Field title="From (IST)">
                  <Input
                    aria-label="Request from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Field>
                <Field title="To (IST)">
                  <Input
                    aria-label="Request to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          {filtered.error && (
            <p role="alert" className="text-red-700">
              {filtered.error}
            </p>
          )}
          <p className="text-sm text-slate-600">
            {filtered.rows.length} matching requests ·{" "}
            {allRows.filter((r) => r.status === "pending").length} pending in
            this role's scope. Times are IST.
          </p>
          {!filtered.rows.length && (
            <p>No demo requests match these filters.</p>
          )}
          {filtered.rows.map((r) => (
            <article
              key={r.id}
              className="border rounded-lg p-4 space-y-2 text-sm break-words"
              aria-label={`Demo request ${r.id}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {label(r.customer)} · {r.kind} · {credits(r.amount)}
                </strong>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs">
                  {r.status}
                </span>
              </div>
              <p>
                Collector: {label(r.collector)}
                {r.account ? ` · ${r.account}` : " · fictional payout"}
              </p>
              <p className="text-xs text-slate-500">
                {r.id} · {time(r.createdAt)}
                {r.reviewedBy ? ` · ${r.status} by ${label(r.reviewedBy)}` : ""}
              </p>
              {r.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  {r.collector === viewer && (
                    <>
                      <Button
                        onClick={() =>
                          run({
                            type: "review",
                            id: r.id,
                            decision: "approved",
                          })
                        }
                      >
                        Approve demo {r.kind}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          run({
                            type: "review",
                            id: r.id,
                            decision: "rejected",
                          })
                        }
                      >
                        Reject demo {r.kind}
                      </Button>
                    </>
                  )}
                  {r.customer === viewer && (
                    <Button
                      variant="outline"
                      onClick={() => run({ type: "cancel", id: r.id })}
                    >
                      Cancel demo request
                    </Button>
                  )}
                  {r.collector !== viewer && r.customer !== viewer && (
                    <p className="text-xs text-slate-500">
                      Read-only oversight. The assigned collector reviews this
                      request.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </CardContent>
      </Card>

      {who.role !== "customer" && (
        <Card aria-label="Example weekly statements">
          <CardHeader>
            <CardTitle>Example commission & Monday grace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Fixed example for 12–19 October 2026: 1,000 credits of sample
              income, 10% platform share. Customer deposits are not income.
              These examples never read gameplay or real statements.
            </p>
            {sampleStatements.map((s) => (
              <div
                key={s.master}
                className="rounded-lg border p-4 space-y-3 text-sm"
              >
                <strong>{label(s.master)}</strong>
                <div className="grid gap-2 sm:grid-cols-3">
                  <p>Sample income: {credits(s.income)}</p>
                  <p>Platform share: {credits(s.due)}</p>
                  <p>Branch share: {credits(s.income - s.due)}</p>
                </div>
                {state.masterModes[s.master] === "admin" ? (
                  <p>
                    Admin collection: the admin retains the platform share and
                    owes the branch {credits(s.income - s.due)} in this example.
                    No master-to-admin payment is due.
                  </p>
                ) : (
                  <>
                    <p>
                      Master collection: confirmed to admin {credits(s.paid)};
                      outstanding <strong>{credits(s.due - s.paid)}</strong>.
                    </p>
                    <p
                      className={
                        weeklyLocked(state, s.master)
                          ? "text-red-700 font-medium"
                          : "text-emerald-800"
                      }
                    >
                      {weeklyLocked(state, s.master)
                        ? "Demo branch locked — sample commission overdue"
                        : s.paid === s.due
                          ? "Sample commission settled — branch unlocked"
                          : "Monday payment window — branch open"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Deadline: {time(s.dueAt)}. A submitted receipt does not
                      count as paid until the demo admin confirms it.
                      Withdrawals remain available while new deposits are
                      locked.
                    </p>
                    {who.id === s.master && s.paid < s.due && (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run({
                            type: "submit-settlement",
                            amount: Number(settlementAmount),
                          });
                        }}
                      >
                        <Field title="Fictional weekly receipt">
                          <Input
                            aria-label="Weekly receipt credits"
                            type="number"
                            required
                            min="1"
                            max={s.due - s.paid}
                            step="1"
                            value={settlementAmount}
                            onChange={(e) =>
                              setSettlementAmount(e.target.value)
                            }
                          />
                        </Field>
                        <Button type="submit">
                          Submit demo weekly receipt
                        </Button>
                      </form>
                    )}
                  </>
                )}
                <details>
                  <summary className="cursor-pointer">
                    Example agent split and settlement direction
                  </summary>
                  <div className="mt-3 space-y-3">
                    {ACTORS.filter(
                      (a) => a.role === "agent" && a.masterId === s.master,
                    ).map((a) => {
                      const count = ACTORS.filter(
                        (x) => x.role === "agent" && x.masterId === s.master,
                      ).length;
                      const income = s.income / count,
                        fee = s.due / count,
                        agentShare = (income - fee) / 2;
                      return (
                        <div key={a.id} className="rounded bg-slate-50 p-3">
                          <strong>{a.name}</strong>
                          <p>
                            Illustrative income {credits(income)} · platform{" "}
                            {credits(fee)} · master {credits(agentShare)} ·
                            agent {credits(agentShare)}
                          </p>
                          <p>
                            {state.masterModes[s.master] === "admin"
                              ? `Admin → master: ${credits(income - fee)}; master → agent: ${credits(agentShare)}.`
                              : state.agentModes[a.id] === "agent"
                                ? `Agent → master: ${credits(fee + agentShare)}; master → admin: ${credits(fee)}.`
                                : `Master → agent: ${credits(agentShare)}; master → admin: ${credits(fee)}.`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </details>
                {state.settlements
                  .filter((r) => r.master === s.master)
                  .map((r) => (
                    <div key={r.id} className="border-t pt-2">
                      <p>
                        {r.id} · {credits(r.amount)} · {r.status}
                      </p>
                      {who.role === "admin" && r.status === "pending" && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            onClick={() =>
                              run({
                                type: "review-settlement",
                                id: r.id,
                                decision: "confirmed",
                              })
                            }
                          >
                            Confirm demo weekly receipt
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              run({
                                type: "review-settlement",
                                id: r.id,
                                decision: "rejected",
                              })
                            }
                          >
                            Reject demo weekly receipt
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {who.role !== "customer" && (
        <Card>
          <CardHeader>
            <CardTitle>Visible test customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customers.map((c) => (
              <p key={c.id} className="text-sm">
                {c.name} · collector {label(collectorFor(state, c))} · balance{" "}
                {credits(state.balances[c.id] ?? 0)} · available{" "}
                {credits(available(state, c.id))}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {who.role !== "customer" && (
        <Card aria-label="Demo audit trail">
          <CardHeader>
            <CardTitle>Demo audit trail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Records of actions in this temporary simulation only.
            </p>
            {state.audit
              .filter((a) => inScope(who, actor(a.actor)))
              .slice(0, 30)
              .map((a) => (
                <div key={a.id} className="border-b pb-2 text-sm">
                  <p>
                    <strong>{label(a.actor)}</strong> · {a.detail}
                  </p>
                  <p className="text-xs text-slate-500">{time(a.at)}</p>
                </div>
              ))}
            {!state.audit.some((a) => inScope(who, actor(a.actor))) && (
              <p>No visible demo actions yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default function CollectionDemoPage() {
  const { user } = useAuth();
  if (!user || !["admin", "super_admin"].includes(user.role))
    return <p>Administrator access is required to review the sandbox.</p>;
  return <CollectionSimulation key={user.id} />;
}
