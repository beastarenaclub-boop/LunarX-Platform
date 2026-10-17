"use client";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Award,
  LayoutDashboard,
  Network,
  Building2,
  ClipboardList,
  Wallet,
  BarChart3,
  ShieldCheck,
  MapPin,
  Settings,
  Plus,
  ArrowUpRight,
  Copy,
  Download,
  LogOut,
  Menu,
  X,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  Receipt,
  BookOpen,
  Users,
  UserPlus,
  Camera,
} from "lucide-react";
import { Emblem, Avatar, Badge, Panel, Dialog, Empty, Tree } from "../App";
import type { Data } from "../model";
import Onboarding from "./Onboarding";
import AccountSummary from "./AccountSummary";
import PasswordAccess, { RecoveryCode } from "./PasswordAccess";
import LocationAccess, { LocationNotice } from "./LocationAccess";
import { requestLoginLocation } from "./location";
import PortalChooser from "./PortalChooser";
import EntryGame, { TrianglePuzzle } from "./EntryGame";
import EntrySoundscape from "./EntrySoundscape";
import CyberBackdrop from "./CyberBackdrop";
import VisitorCheckIn from "./VisitorCheckIn";
import AdminVisitors from "./AdminVisitors";
import { playEntrySound } from "./entry-audio";
import { entryDestination } from "./entry-destination";
import AgentJourney from "./AgentJourney";
import { portalLabel, rolePortal, portalPath, type Portal } from "./portals";
import PortalGuide from "./PortalGuide";
import ReferralPlacement, { binaryPosition } from "./ReferralPlacement";
import { MemberDirectory, MemberDossier, InviteMember } from "./AdminMembers";
import Reports from "./Reports";
import Rewards from "./Rewards";
import TeamPerformance from "./TeamPerformance";
import {
  BANKS,
  BANK_SOURCE,
  BANK_SOURCE_SECONDARY,
  QUICK_BANKS,
} from "./banks";
import {
  DOCUMENT_KINDS,
  dayIST,
  inr,
  progress,
  accountSummary,
  accountProofKind,
  documentLabel,
  type Snapshot,
  type LiveMember,
  type LiveTask,
} from "./types";
import { totals, taskSheets, excel, pdf } from "./reporting";
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["members", "Members & documents", Users],
  ["invite", "New member signup", UserPlus],
  ["eligibility", "Agent eligibility", Award],
  ["onboarding", "My onboarding", ShieldCheck],
  ["network", "Binary network", Network],
  ["accounts", "Account register", Building2],
  ["tasks", "Work & tasks", ClipboardList],
  ["wallet", "Wallet & ledger", Wallet],
  ["expenses", "Expenses & allowances", Receipt],
  ["rewards", "Commissions & rewards", Award],
  ["performance", "Member performance", BarChart3],
  ["reports", "Reports & exports", BarChart3],
  ["reviews", "Review center", CheckCircle2],
  ["activity", "Access & activity", MapPin],
  ["visitors", "Visitor check-ins", Camera],
  ["settings", "Workspace settings", Settings],
  ["guide", "Portal guide", BookOpen],
] as const;
type Action = (path: string, payload: unknown) => Promise<any>;
export default function LiveApp({
  accessMode,
  portal,
}: {
  accessMode?: "login" | "signup";
  portal?: Portal;
}) {
  const gate = !!accessMode || !!portal;
  const router = useRouter();
  const [signupComplete, setSignupComplete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [locationRequired, setLocationRequired] = useState(false);
  const [entryGame, setEntryGame] = useState(false);
  const [entranceAngles, setEntranceAngles] = useState([1, 2, 1]);
  const [visitorOpen, setVisitorOpen] = useState(false);
  const [eyeMarked, setEyeMarked] = useState(false);
  const [performanceMember, setPerformanceMember] = useState<string | null>(
    null,
  );
  const closeVisitor = useCallback(() => setVisitorOpen(false), []);
  const [state, setState] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [unauthorized, setUnauthorized] = useState(false),
    [page, setPage] = useState("overview"),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [open, setOpen] = useState(false),
    [modal, setModal] = useState<"entry" | "task" | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [taps, setTaps] = useState(0),
    [gateReady, setGateReady] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (
      gate ||
      entryGame ||
      visitorOpen ||
      !entranceAngles.every((value) => value === 0)
    )
      return;
    const timer = setTimeout(() => {
      setEntryGame(true);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, 600);
    return () => clearTimeout(timer);
  }, [gate, entryGame, entranceAngles, visitorOpen]);
  const logged = useRef(false);
  const notify = useCallback((message: string) => setToast(message), []);
  const finishEntry = useCallback(() => {
    router.push(
      entryDestination(new URLSearchParams(location.search).get("next")),
    );
  }, [router]);
  useEffect(() => {
    setGateReady(true);
  }, []);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (n !== seq.current) return;
      if (response.status === 401) {
        setUnauthorized(true);
        setLocationRequired(false);
        setState(null);
        return;
      }
      if (response.status === 428) {
        setLocationRequired(true);
        setUnauthorized(false);
        setState(null);
        return;
      }
      const value = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw Error(value.error || "Workspace unavailable.");
      setState(value);
      setUnauthorized(false);
      setLocationRequired(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    }
  }, []);
  useEffect(() => {
    if (!gate) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh, gate]);
  useEffect(() => {
    if (!state || !navigator.permissions) return;
    let permission: PermissionStatus | undefined,
      disposed = false;
    const changed = () => {
      if (permission?.state === "granted") return;
      ++seq.current;
      setState(null);
      setUnauthorized(true);
      void fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then(() => refresh());
    };
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((value) => {
        if (disposed) return;
        permission = value;
        permission.addEventListener("change", changed);
        if (permission.state === "denied") changed();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      permission?.removeEventListener("change", changed);
    };
  }, [state?.identity.email, refresh]);
  useEffect(() => {
    if (state?.me && !logged.current) {
      logged.current = true;
      void fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then(() => refresh());
    }
  }, [state?.me?.id, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (
      !state?.me ||
      !gate ||
      recoveryCode ||
      (accessMode === "signup" && !signupComplete)
    )
      return;
    const actual = rolePortal(state.me.role);
    if (
      portal &&
      portal !== actual &&
      !signupComplete &&
      !(portal === "member" && actual === "agent")
    )
      return;
    const destination = portalPath(actual);
    if (location.pathname !== destination) location.replace(destination);
  }, [state?.me?.role, gate, recoveryCode, portal, accessMode, signupComplete]);
  const act: Action = async (path, payload) => {
    setBusy(true);
    setActionError("");
    try {
      if (path === "auth/change-password")
        payload = {
          ...(payload as object),
          location: await requestLoginLocation(),
        };
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json()) as {
        error?: string;
        duplicate?: boolean;
        [key: string]: any;
      };
      if (!r.ok) throw Error(data.error || "Could not save.");
      if (path === "register") {
        setSignupComplete(true);
      }
      await refresh();
      notify(
        data.duplicate
          ? "This reference was already recorded; no duplicate added."
          : "Saved successfully.",
      );
      return data;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save.");
      notify(e instanceof Error ? e.message : "Could not save.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  async function signOut(
    destination = portalPath(
      state?.me ? rolePortal(state.me.role) : portal || "member",
      "login",
    ),
  ) {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw Error("Could not sign out. Retry.");
      location.assign(
        state?.identity.passwordLogin
          ? destination
          : "/signout-with-chatgpt?return_to=" +
              encodeURIComponent(destination),
      );
    } catch {
      notify("Could not sign out. Check the connection and retry.");
    }
  }
  async function upload(
    kind: string,
    file: File,
    accountId?: string,
    entryId?: string,
  ) {
    if (file.size > 15 * 1024 * 1024)
      return notify("Maximum upload size is 15 MB.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      if (accountId) form.set("accountId", accountId);
      if (entryId) form.set("entryId", entryId);
      const r = await fetch("/api/documents", { method: "POST", body: form });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(result.error || "Upload failed.");
      await refresh();
      notify("Private document uploaded.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  const toastView = toast && (
    <div className="live-toast" role="status">
      {toast}
      <button onClick={() => setToast("")} aria-label="Dismiss notification">
        <X size={16} />
      </button>
    </div>
  );
  if (!gate && entryGame)
    return (
      <EntryGame
        initialAligned
        initialEyeMarked={eyeMarked}
        complete={finishEntry}
        exit={() => {
          setEntryGame(false);
          setEyeMarked(false);
          setVisitorOpen(false);
          setTaps(0);
          setEntranceAngles([1, 2, 1]);
        }}
      />
    );
  if (!gate)
    return (
      <main className="live-gateway">
        <CyberBackdrop />
        <header className="gateway-header">
          <span className="gateway-top">SYNDICATE / EARNINGS & OPERATIONS</span>
          <EntrySoundscape scene="entrance" />
        </header>
        <div
          className="tap-dots"
          aria-label={`${entranceAngles.filter((value) => value === 0).length} of 3 fragments aligned`}
        >
          {entranceAngles.map((angle, n) => (
            <i className={angle === 0 ? "filled" : ""} key={n} />
          ))}
        </div>
        <small id="gateway-tap-hint">
          {gateReady
            ? entranceAngles.every((value) => value === 0)
              ? "Triangle complete. Opening the gate."
              : "Align all three pieces to open the gate. No camera required."
            : "Loading the entrance…"}
        </small>
        <div
          className="live-emblem entrance-puzzle"
          aria-describedby="gateway-tap-hint"
        >
          <TrianglePuzzle
            angles={entranceAngles}
            disabled={!gateReady}
            camera={() => setVisitorOpen(true)}
            cameraLocked={!gateReady}
            eyeMarked={eyeMarked}
            rotate={(index) => {
              if (!gateReady || entranceAngles.every((value) => value === 0))
                return;
              const next = entranceAngles.map((value, i) =>
                i === index ? (value + 1) % 3 : value,
              );
              playEntrySound(next[index] === 0 ? "aligned" : "rotate");
              setEntranceAngles(next);
              setTaps((value) => value + 1);
            }}
          />
        </div>
        <div className="eyebrow">THE INNER GATE · {taps} MOVES</div>
        <h1>
          Your work.
          <br />
          Your earning journey.
        </h1>
        <p>
          Align the triangle. Follow the light.
          <br />
          Find the key to the inner gate.
        </p>
        <span className="gateway-bottom">
          PRIVATE ACCESS · AUTHENTICATED AFTER ENTRY
        </span>
        {visitorOpen && (
          <VisitorCheckIn close={closeVisitor} onStatus={setEyeMarked} />
        )}
      </main>
    );
  if (recoveryCode)
    return (
      <RecoveryCode
        code={recoveryCode}
        done={() => {
          setRecoveryCode("");
          void refresh();
        }}
      />
    );
  if (locationRequired)
    return (
      <LocationAccess
        done={() => {
          logged.current = false;
          void refresh();
        }}
        signOut={() => void signOut()}
      />
    );
  if (!state && unauthorized)
    if (!portal)
      return (
        <main className="live-auth portal-hub">
          <CyberBackdrop variant="login" />
          <EntrySoundscape scene="login" />
          <Emblem />
          <div className="eyebrow">ILLUMINATI SYNDICATE / THE INNER CIRCLE</div>
          <h1>Choose your panel.</h1>
          <p>
            New members start one journey. Agent access is earned;
            administration stays with the existing owner.
          </p>
          <PortalChooser />
        </main>
      );
    else
      return (
        <PasswordAccess
          key={`${portal}:${accessMode || "login"}`}
          portal={portal}
          initialMode={accessMode === "signup" ? "signup" : "login"}
          done={(code) => {
            logged.current = false;
            if (code) setRecoveryCode(code);
            void refresh();
          }}
        />
      );
  if (!state)
    return (
      <main className="live-auth">
        <Emblem />
        <div className="eyebrow">SYNDICATE WORKSPACE</div>
        <h1>Connecting your workspace…</h1>
        <p>{error || "Loading secure account data."}</p>
        <button className="btn secondary" onClick={() => void refresh()}>
          Retry connection
        </button>
        {toastView}
      </main>
    );
  if (!state.me)
    return (
      <>
        <Registration
          state={state}
          act={act}
          busy={busy}
          signOut={signOut}
          error={actionError}
        />
        {toastView}
      </>
    );
  if (accessMode === "signup" && !signupComplete)
    return (
      <main className="live-auth password-access">
        <Emblem />
        <h1>Create another {portal || "member"} account.</h1>
        <p>
          You are signed in as {state.identity.email}. Each account needs its
          own email and password.
        </p>
        <a
          className="btn secondary"
          href={portalPath(rolePortal(state.me.role))}
        >
          Return to my dashboard
        </a>
        <button
          className="btn primary"
          onClick={() => void signOut(location.pathname + location.search)}
        >
          Sign out and start new signup
        </button>
        {toastView}
      </main>
    );
  if (
    portal &&
    rolePortal(state.me.role) !== portal &&
    !signupComplete &&
    !(portal === "member" && state.me.role === "agent")
  )
    return (
      <main className="live-auth password-access">
        <Emblem />
        <div className="eyebrow">{portal.toUpperCase()} PANEL</div>
        <h1>Use your {rolePortal(state.me.role)} panel.</h1>
        <p>
          You are signed in as {state.identity.email}. Your current access is{" "}
          {portalLabel(rolePortal(state.me.role))}.
        </p>
        {portal === "agent" && state.me.role === "user" && (
          <p>
            Agent access requires your approved profile and two approved direct
            members.
          </p>
        )}
        <a className="btn primary" href={portalPath(rolePortal(state.me.role))}>
          Open my {rolePortal(state.me.role)} dashboard
        </a>
        <button
          className="btn secondary"
          onClick={() => void signOut(portalPath(portal, "login"))}
        >
          Sign in with another account
        </button>
        {toastView}
      </main>
    );
  if (!portal || accessMode || signupComplete)
    return (
      <main className="live-auth">
        <Emblem />
        <h1>Opening your {rolePortal(state.me.role)} panel…</h1>
      </main>
    );
  const me = state.me,
    admin = me.role === "admin";
  const target = state.members.find((m) => m.id === selected);
  const visit = (id: string) => {
    setPage(id);
    setOpen(false);
  };
  const selectMember = (id: string) => {
    if (me.role === "agent") {
      setSelected(null);
      setPerformanceMember(id);
      visit("performance");
      return;
    }
    setSelected(id);
    if (admin) visit("member");
  };
  const total = totals(state.entries);
  const title =
    page === "member" && target
      ? target.name + " · complete profile"
      : page === "accounts" && !admin
        ? "My bank accounts"
        : nav.find((n) => n[0] === page)?.[1] || "Overview";
  return (
    <div className="live-shell">
      <aside className={"live-sidebar " + (open ? "open" : "")}>
        <button className="brand" onClick={() => visit("overview")}>
          <Emblem />
          <span>
            SYNDICATE<small>{rolePortal(me.role).toUpperCase()} PANEL</small>
          </span>
        </button>
        <div className="live-workspace">
          <span className="live-dot" />
          <div>
            <strong>{state.settings.company}</strong>
            <small>Connected workspace</small>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav
            .filter(
              (n) =>
                (!["reviews", "members", "visitors"].includes(n[0]) || admin) &&
                (n[0] !== "eligibility" || !admin),
            )
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={
                  page === id || (id === "members" && page === "member")
                    ? "active"
                    : ""
                }
                onClick={() => visit(id)}
              >
                <Icon size={18} />
                {id === "accounts" && !admin ? "My bank accounts" : label}
                {id === "reviews" && (
                  <span>
                    {state.members.filter((m) => m.status === "In review")
                      .length +
                      state.entries.filter((e) => e.status === "Pending")
                        .length}
                  </span>
                )}
              </button>
            ))}
        </nav>
        <div className="live-sidebar-bottom">
          <small>Database connected · records saved</small>
          <div className="live-profile">
            <Avatar name={me.name} />
            <div>
              <strong>{me.name}</strong>
              <small>{me.role === "user" ? "Member" : me.role} access</small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-btn"
              onClick={() => void signOut()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="live-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="live-content">
        <header className="live-topbar">
          <button
            className="live-menu icon-btn"
            aria-label="Open navigation"
            onClick={() => setOpen(!open)}
          >
            <Menu size={20} />
          </button>
          <span>
            {portalLabel(rolePortal(me.role))} panel <ChevronRight size={13} />{" "}
            <strong>{title}</strong>
          </span>
          <div>
            <span className={"connection " + (error ? "offline" : "")}>
              <i />
              {error ? "Connection interrupted" : "Synced every 15s"}
            </span>
            <button
              className="icon-btn"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
            <Badge tone="gold">{me.role === "user" ? "Member" : me.role}</Badge>
          </div>
        </header>
        <main className="live-main">
          <div className="live-page-heading">
            <div>
              <div className="eyebrow">{dayIST()} / MERCHANT OPERATIONS</div>
              <h1>
                {page === "overview"
                  ? `Welcome back, ${me.name.split(" ")[0]}.`
                  : title}
              </h1>
              <p>
                {page === "overview"
                  ? "A clear view of your network, accounts and daily operations."
                  : page === "reports"
                    ? "Filter the period. Reconcile the details. Export your records."
                    : "Your workspace records, connected and up to date."}
              </p>
            </div>
            {(page === "overview" ||
              page === "wallet" ||
              page === "expenses" ||
              page === "reports") && (
              <button
                className="btn primary"
                disabled={me.status !== "Approved"}
                onClick={() => setModal("entry")}
              >
                <Plus size={16} /> Record transaction
              </button>
            )}
          </div>
          {error && (
            <div className="review-note" role="alert">
              {error} Displaying the last successful sync.
            </div>
          )}
          {page === "overview" && (
            <>
              {!admin && <AgentJourney state={state} visit={visit} compact />}
              <div className="stats-grid live-overview-stats">
                {[
                  {
                    label: "Visible members",
                    value: state.members.length,
                    note: `${state.members.filter((m) => m.status === "Approved").length} approved profiles`,
                    icon: Network,
                  },
                  {
                    label: admin
                      ? "Total account references"
                      : "My saved accounts",
                    value: admin
                      ? state.members.reduce(
                          (n, m) => n + (m.accountCount || 0),
                          0,
                        )
                      : `${me.profile.accounts?.length || 0} / 7`,
                    note: admin
                      ? "Five current + two savings per plan"
                      : `${accountSummary(me, state.documents).current}/5 current · ${accountSummary(me, state.documents).savings}/2 savings`,
                    icon: Building2,
                  },
                  {
                    label: "Approved turnover",
                    value: inr(total.turnover),
                    note: "Recorded transaction volume",
                    icon: BarChart3,
                  },
                  {
                    label: "Operating ledger",
                    value: inr(total.net),
                    note: "Approved income less expenses",
                    icon: Wallet,
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <s.icon size={18} />
                    </div>
                    <div className="stat-main">
                      <div>
                        <strong>{s.value}</strong>
                        <small>{s.note}</small>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!admin && (
                <AccountSummary state={state} open={() => visit("accounts")} />
              )}
              {admin && (
                <>
                  <div className="page-actions">
                    <button
                      className="btn primary"
                      onClick={() => visit("members")}
                    >
                      <Users size={16} /> View all members &amp; documents
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => visit("invite")}
                    >
                      <UserPlus size={16} /> New member signup
                    </button>
                  </div>
                  <MemberDirectory
                    state={state}
                    select={selectMember}
                    notify={notify}
                    compact
                  />
                </>
              )}
              <div className="live-two-col">
                <Panel title="Your next steps" eyebrow="KEEP THINGS MOVING">
                  <div className="live-form-pad next-steps">
                    <button
                      onClick={() => visit(admin ? "reviews" : "onboarding")}
                    >
                      <ShieldCheck />
                      <div>
                        <strong>
                          {admin
                            ? "Review incoming work"
                            : me.status === "Approved"
                              ? "Onboarding approved"
                              : "Complete your onboarding"}
                        </strong>
                        <p>
                          {admin
                            ? `${state.members.filter((m) => m.status === "In review").length} profiles awaiting review`
                            : me.status + " · business, contacts and documents"}
                        </p>
                      </div>
                      <ArrowUpRight size={18} />
                    </button>
                    <button onClick={() => visit("tasks")}>
                      <ClipboardList />
                      <div>
                        <strong>
                          {
                            state.tasks.filter((t) => t.status !== "Complete")
                              .length
                          }{" "}
                          active tasks
                        </strong>
                        <p>Assigned work, instructions and task PDFs</p>
                      </div>
                      <ArrowUpRight size={18} />
                    </button>
                    <button onClick={() => visit("reports")}>
                      <BarChart3 />
                      <div>
                        <strong>Daily performance reports</strong>
                        <p>Bank, day and month · Excel & PDF</p>
                      </div>
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                </Panel>
                <Panel
                  title="Your referral position"
                  eyebrow="A NETWORK WITH TWO BRANCHES"
                >
                  <div className="live-form-pad">
                    <div className="referral-card">
                      <span>YOUR REFERRAL ID</span>
                      <strong>{me.ref}</strong>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(me.ref)
                            .then(() => notify("Referral ID copied."))
                            .catch(() => notify(me.ref))
                        }
                      >
                        <Copy size={15} /> Copy ID
                      </button>
                    </div>
                    <ReferralPlacement member={me} />
                    <div className="qualification">
                      {["left", "right"].map((side) => {
                        const child = state.members.find(
                          (m) => m.parent === me.id && m.position === side,
                        );
                        return (
                          <div key={side}>
                            <span>{side} position</span>
                            <strong>{child?.name || "Open position"}</strong>
                            <Badge
                              tone={
                                child?.status === "Approved" ? "green" : "gold"
                              }
                            >
                              {child?.status || "Available"}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                    <p className="subtle-note no-pad">
                      Agent access unlocks after your profile and both direct
                      members are approved. Each member has at most two direct
                      positions.
                    </p>
                  </div>
                </Panel>
              </div>
              <Panel title="Recent activity" className="spaced">
                <Activity state={state} limit={5} />
              </Panel>
            </>
          )}
          {page === "eligibility" && !admin && (
            <AgentJourney state={state} visit={visit} />
          )}
          {(page === "onboarding" || (page === "accounts" && !admin)) && (
            <Onboarding
              key={me.id + "-" + me.revision}
              state={state}
              act={act}
              busy={busy}
              upload={upload}
              notify={notify}
            />
          )}
          {page === "network" && (
            <NetworkView state={state} select={selectMember} notify={notify} />
          )}
          {page === "members" && admin && (
            <MemberDirectory
              state={state}
              select={selectMember}
              notify={notify}
            />
          )}
          {page === "invite" && <InviteMember state={state} notify={notify} />}
          {page === "member" && admin && target && (
            <MemberDossier
              key={target.id}
              state={state}
              member={target}
              back={() => visit("members")}
            >
              <button
                className="btn secondary"
                onClick={() => {
                  setPerformanceMember(target.id);
                  visit("performance");
                }}
              >
                View member performance <ArrowUpRight size={16} />
              </button>
              <MemberDetail
                member={target}
                state={state}
                busy={busy}
                act={act}
                reviewOnly
              />
            </MemberDossier>
          )}
          {page === "accounts" && admin && (
            <Accounts state={state} select={selectMember} />
          )}
          {page === "tasks" && !admin && (
            <AgentJourney state={state} visit={visit} compact />
          )}
          {page === "tasks" && (
            <Tasks
              state={state}
              act={act}
              busy={busy}
              create={() => setModal("task")}
              notify={notify}
            />
          )}
          {(page === "wallet" || page === "reports" || page === "expenses") && (
            <Reports
              state={state}
              notify={notify}
              wallet={page === "wallet"}
              operating={page === "expenses"}
              uploadReceipt={(id, file) =>
                upload("Expense receipt", file, undefined, id)
              }
            />
          )}
          {page === "reviews" && admin && (
            <Reviews
              state={state}
              act={act}
              busy={busy}
              select={selectMember}
            />
          )}
          {page === "visitors" && admin && <AdminVisitors />}
          {page === "activity" && (
            <>
              <div className="info-banner">
                <MapPin size={24} />
                <div>
                  <strong>Connection logs & login location</strong>
                  <p>
                    IP and device details are logged for authenticated activity.
                    Browser location is required at sign-in. Coordinates are
                    approximate and browser-reported; IP-based city may be
                    unavailable.
                  </p>
                </div>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => {
                    if (!navigator.geolocation)
                      return notify("Location is unavailable in this browser.");
                    navigator.geolocation.getCurrentPosition(
                      (p) =>
                        void act("location", {
                          consent: true,
                          latitude: p.coords.latitude,
                          longitude: p.coords.longitude,
                          accuracy: p.coords.accuracy,
                        }),
                      () =>
                        notify(
                          "Location permission was declined or the position is unavailable.",
                        ),
                      { enableHighAccuracy: false, timeout: 12000 },
                    );
                  }}
                >
                  Share my location
                </button>
              </div>
              <Panel
                title="Access & audit trail"
                action={
                  <Badge>
                    Last 90 days · {admin ? "250" : "100"} recent events
                  </Badge>
                }
              >
                <Activity state={state} />
              </Panel>
            </>
          )}
          {page === "rewards" && (
            <Rewards state={state} act={act} busy={busy} notify={notify} />
          )}
          {page === "performance" && (
            <TeamPerformance
              state={state}
              memberId={performanceMember || me.id}
              select={setPerformanceMember}
              notify={notify}
            />
          )}
          {page === "settings" && (
            <SettingsView
              state={state}
              act={act}
              busy={busy}
              notify={notify}
              recover={setRecoveryCode}
            />
          )}
          {page === "guide" && <PortalGuide visit={visit} />}
          <footer className="live-footer">
            <span>SYNDICATE / {state.settings.company}</span>
            <span>Internal review · no connected bank transfers</span>
          </footer>
        </main>
      </div>
      {modal === "entry" && (
        <Dialog title="Record a transaction" close={() => setModal(null)}>
          <EntryForm
            state={state}
            busy={busy}
            submit={async (b) => {
              if (await act("entries", b)) setModal(null);
            }}
          />
        </Dialog>
      )}
      {modal === "task" && (
        <Dialog title="Assign a task" close={() => setModal(null)}>
          <TaskForm
            state={state}
            busy={busy}
            submit={async (b) => {
              if (await act("tasks", b)) setModal(null);
            }}
          />
        </Dialog>
      )}
      {target && !admin && (
        <Dialog title={target.name} close={() => setSelected(null)}>
          <MemberDetail member={target} state={state} busy={busy} act={act} />
        </Dialog>
      )}
      {toastView}
    </div>
  );
}
function Registration({
  state,
  act,
  busy,
  signOut,
  error,
}: {
  state: Snapshot;
  act: Action;
  busy: boolean;
  signOut: () => Promise<void>;
  error: string;
}) {
  const [ref, setRef] = useState("");
  useEffect(
    () => setRef(new URLSearchParams(location.search).get("ref") || ""),
    [],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act("register", {
      name: f.get("name"),
      city: f.get("city"),
      ref: f.get("ref"),
      banks: QUICK_BANKS.map((_, i) => f.get("bank" + i)),
    });
  }
  if (state.setupRequired)
    return (
      <main className="live-auth">
        <Emblem />
        <h1>Member registration is not open yet.</h1>
        <p>The existing administrator needs to prepare the workspace.</p>
        <button className="btn secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  return (
    <main className="live-registration">
      <a className="brand" href="/">
        <Emblem />
        <span>
          SYNDICATE<small>MEMBER INITIATION</small>
        </span>
      </a>
      <div className="registration-layout">
        <div className="registration-intro">
          <div className="eyebrow">ILLUMINATI SYNDICATE / FIRST STEP</div>
          <h1>
            One identity.
            <br />
            Your path begins here.
          </h1>
          <p>
            Join as a member through your sponsor's referral ID. Complete your
            documents and bank verification, then help your left and right
            members complete the same process. Three approvals unlock agent
            access on this account.
          </p>
          <div className="registration-features">
            <p>
              <ShieldCheck /> 01 · Your verification and administrator approval
            </p>
            <p>
              <Network /> 02 · Left + right direct members approved
            </p>
            <p>
              <Award /> 03 · Same member ID becomes Syndicate Agent
            </p>
          </div>
        </div>
        <Panel title="Create your member profile">
          <form className="form live-form-pad" onSubmit={submit}>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <p className="muted small">Signed in as {state.identity.email}</p>
            <button
              type="button"
              className="link-button"
              onClick={() => void signOut()}
            >
              Sign out / use another account
            </button>
            <label>
              Full name
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={state.identity.name}
              />
            </label>
            <label>
              City
              <input name="city" required maxLength={80} />
            </label>
            <label>
              Referrer ID
              <input
                name="ref"
                required
                maxLength={40}
                placeholder="SYN-XXXXXXXX"
                value={ref}
                onChange={(e) => setRef(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Plan
              <input value="Merchant onboarding" readOnly />
            </label>
            <div className="form-columns">
              {QUICK_BANKS.map((bank, i) => (
                <label key={i}>
                  Current bank preference {i + 1}
                  <select name={"bank" + i} defaultValue={bank}>
                    {BANKS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="subtle-note no-pad">
              Bank preferences start your checklist. Account references, proofs,
              registered contacts, GST and KYC are completed inside the member
              panel.
            </p>
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Create profile"}
              <ArrowUpRight size={16} />
            </button>
            <p className="muted small">
              Signups and subsequent activity record your connection IP and
              device information, along with the approximate location shared at
              sign-in.
            </p>
          </form>
        </Panel>
      </div>
    </main>
  );
}
function NetworkView({
  state,
  select,
  notify,
}: {
  state: Snapshot;
  select: (id: string) => void;
  notify: (s: string) => void;
}) {
  const [root, setRoot] = useState(state.me!.id);
  const selectedRoot = state.members.find((m) => m.id === root) || state.me!;
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const data: Data = {
    version: 1,
    members: state.members.map((m) => ({
      id: m.id,
      name: m.name,
      city: m.city,
      ref: m.ref,
      parent: m.parent,
      side: m.position,
      kyc:
        m.status === "Approved"
          ? "Verified"
          : m.status === "In review"
            ? "In review"
            : m.status === "Changes requested"
              ? "Changes requested"
              : "Not started",
      joined: m.created_at.slice(0, 10),
      documents: {},
      accounts: [],
      video: false,
      consent: false,
    })),
    tasks: [],
    ledger: [],
    expenses: [],
    activity: [],
  };
  return (
    <>
      <div className="info-banner">
        <Network />
        <div>
          <strong>Two branches. Clear ownership.</strong>
          <p>
            Use a member’s own referral ID to fill their open positions. Once
            both positions are full, choose a lower branch.
          </p>
        </div>
        <label className="form">
          Explore branch
          <select value={root} onChange={(e) => setRoot(e.target.value)}>
            {state.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Panel title="Selected member's referral placement" className="spaced">
        <div className="live-form-pad">
          <strong>
            {selectedRoot.name} · Own ID: {selectedRoot.ref}
          </strong>
          <ReferralPlacement member={selectedRoot} />
        </div>
      </Panel>
      <Panel title="Your binary network" className="network-tree spaced">
        <Tree
          data={data}
          root={root}
          roleLabel={(m) => {
            const role = byId.get(m.id)?.role;
            return role === "admin"
              ? "Admin"
              : role === "agent"
                ? "Agent"
                : "Member";
          }}
          nodeDetails={(m) => {
            const member = byId.get(m.id)!;
            return (
              <span className="tree-referral">
                <span>
                  {member.parent
                    ? `${binaryPosition(member)} of ${member.sponsor?.name || "sponsor"}`
                    : "Root · workspace owner"}
                </span>
                {member.parent && (
                  <span>
                    Joined via: {member.sponsor?.ref || "Unavailable"}
                  </span>
                )}
              </span>
            );
          }}
          onMember={(m) => select(m.id)}
          invite={() =>
            notify(
              "Choose the intended sponsor in the member register and copy their referral ID.",
            )
          }
        />
      </Panel>
      <Panel title="Member register" className="spaced">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Member's own referral ID</th>
                <th>Under / Sponsor</th>
                <th>Referral ID used to join</th>
                <th>Binary position</th>
                <th>Role</th>
                <th>Review</th>
                <th>Accounts / documents</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <small className="table-sub">{m.city}</small>
                  </td>
                  <td>{m.ref}</td>
                  <td>
                    {m.sponsor?.name ||
                      (m.parent ? "Sponsor unavailable" : "Workspace owner")}
                  </td>
                  <td>
                    {m.sponsor?.ref ||
                      (m.parent ? "Unavailable" : "No referral")}
                  </td>
                  <td>
                    <Badge>{binaryPosition(m)}</Badge>
                  </td>
                  <td>{m.role}</td>
                  <td>
                    <Badge tone={m.status === "Approved" ? "green" : "gold"}>
                      {m.status}
                    </Badge>
                  </td>
                  <td>
                    {m.accountCount || 0} / {m.documentCount || 0}
                  </td>
                  <td>
                    <button
                      className="btn secondary small"
                      onClick={() => select(m.id)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
function Accounts({
  state,
  select,
}: {
  state: Snapshot;
  select: (id: string) => void;
}) {
  const rows = state.members.flatMap((m) =>
    (m.profile.accounts || []).map((a) => ({
      ...a,
      member: m.name,
      memberId: m.id,
    })),
  );
  return (
    <>
      <div className="summary-pills">
        <span>
          Total references{" "}
          <strong>
            {state.members.reduce((n, m) => n + (m.accountCount || 0), 0)}
          </strong>
        </span>
        <span>
          Current{" "}
          <strong>{rows.filter((a) => a.type === "Current").length}</strong>
        </span>
        <span>
          Savings{" "}
          <strong>{rows.filter((a) => a.type === "Savings").length}</strong>
        </span>
        <span>
          Approved visible{" "}
          <strong>{rows.filter((a) => a.status === "Approved").length}</strong>
        </span>
      </div>
      <Panel
        title="Bank account register"
        action={<Badge>Masked details</Badge>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member / holder</th>
                <th>Bank</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Contact</th>
                <th>Approved daily limit</th>
                <th>Review</th>
                <th>Bank proof</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => select(a.memberId)}
                    >
                      {a.member}
                    </button>
                    <small className="table-sub">{a.holder}</small>
                  </td>
                  <td>{a.bank}</td>
                  <td>{a.type}</td>
                  <td>•••• {a.last4}</td>
                  <td>Contact {a.contact + 1}</td>
                  <td>
                    {a.type === "Savings"
                      ? "Not applicable"
                      : a.approvedLimit
                        ? inr(a.approvedLimit * 100)
                        : "Awaiting evidence"}
                  </td>
                  <td>
                    <Badge tone={a.status === "Approved" ? "green" : "gold"}>
                      {a.status}
                    </Badge>
                  </td>
                  <td>
                    {(() => {
                      const proof = state.documents.find(
                        (d) => d.kind === accountProofKind(a),
                      );
                      return proof ? (
                        <a href={"/api/documents/" + proof.id}>
                          Download proof
                        </a>
                      ) : (
                        "Not uploaded"
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              title="No visible account references"
              detail="Account details are available only to their owner and administrators. Agents see completion counts."
            />
          )}
        </div>
      </Panel>
      <p className="subtle-note">
        Bank choices follow the{" "}
        <a href={BANK_SOURCE} target="_blank" rel="noreferrer">
          RBI bank directory
        </a>{" "}
        and{" "}
        <a href={BANK_SOURCE_SECONDARY} target="_blank" rel="noreferrer">
          MSME lender handbook
        </a>
        . Quick choices are preferences, not rankings. Daily limits depend on
        the bank’s approval.
      </p>
    </>
  );
}
function Tasks({
  state,
  act,
  busy,
  create,
  notify,
}: {
  state: Snapshot;
  act: Action;
  busy: boolean;
  create: () => void;
  notify: (s: string) => void;
}) {
  const me = state.me!;
  async function exportTasks(tasks: LiveTask[], format = "pdf") {
    try {
      if (format === "excel")
        await excel(taskSheets(tasks, state.members), "syndicate-tasks");
      else
        await pdf(
          "Work & task register",
          `Generated for ${me.name}`,
          taskSheets(tasks, state.members),
          "syndicate-tasks",
        );
    } catch {
      notify("Task download failed. Retry.");
    }
  }
  return (
    <>
      <div className="page-actions">
        <button
          className="btn secondary"
          onClick={() => void exportTasks(state.tasks, "excel")}
        >
          <Download size={15} /> Task Excel
        </button>
        <button
          className="btn secondary"
          onClick={() => void exportTasks(state.tasks)}
        >
          <Download size={15} /> Task PDF
        </button>
        {me.role !== "user" && (
          <button className="btn primary" onClick={create}>
            <Plus size={15} /> Assign task
          </button>
        )}
      </div>
      <div className="live-task-grid">
        {state.tasks.map((t) => {
          const own = t.assignee === me.id;
          const approve =
            t.status === "In review" &&
            (me.role === "admin" ||
              (me.role === "agent" && t.assigned_by === me.id));
          return (
            <article className="panel live-task" key={t.id}>
              <div className="task-status-row">
                <Badge tone={t.status === "Complete" ? "green" : "gold"}>
                  {t.status}
                </Badge>
                <span>{t.due}</span>
              </div>
              <h3>{t.title}</h3>
              <p>{t.description}</p>
              <small>
                Assigned to{" "}
                {state.members.find((m) => m.id === t.assignee)?.name ||
                  "Member"}
              </small>
              <div className="page-actions">
                {own && ["To do", "In progress"].includes(t.status) && (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void act("task-status", {
                        id: t.id,
                        status:
                          t.status === "To do" ? "In progress" : "In review",
                      })
                    }
                  >
                    {t.status === "To do" ? "Start work" : "Submit for review"}
                  </button>
                )}
                {approve && (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void act("task-status", { id: t.id, status: "Complete" })
                    }
                  >
                    Approve completion
                  </button>
                )}
                <button
                  className="btn secondary"
                  onClick={() => void exportTasks([t])}
                >
                  <Download size={14} /> PDF
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!state.tasks.length && (
        <Panel title="Assigned work">
          <Empty
            title="No tasks assigned yet"
            detail={
              me.role === "user"
                ? "Tasks can be assigned after your onboarding is approved."
                : "Assign instructions to an approved member to get started."
            }
          />
        </Panel>
      )}
    </>
  );
}
function TaskForm({
  state,
  busy,
  submit,
}: {
  state: Snapshot;
  busy: boolean;
  submit: (b: unknown) => Promise<void>;
}) {
  const members = state.members.filter(
    (m) =>
      m.status === "Approved" &&
      (state.me!.role === "admin" || m.id !== state.me!.id),
  );
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit(Object.fromEntries(f));
      }}
    >
      <label>
        Task title
        <input name="title" required maxLength={120} />
      </label>
      <label>
        Instructions
        <textarea name="description" required maxLength={1000} />
      </label>
      <label>
        Assign to
        <select name="assignee" required>
          <option value="">Choose approved member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input type="date" name="due" defaultValue={dayIST()} required />
      </label>
      <button className="btn primary" disabled={busy || !members.length}>
        Assign task
      </button>
    </form>
  );
}
function EntryForm({
  state,
  busy,
  submit,
}: {
  state: Snapshot;
  busy: boolean;
  submit: (b: unknown) => Promise<void>;
}) {
  const [member, setMember] = useState(state.me!.id),
    [kind, setKind] = useState("Income");
  const target = state.members.find((m) => m.id === member)!;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({
          ...Object.fromEntries(f),
          member,
          kind: kind === "Allowance" ? "Income" : kind,
          allowance: kind === "Allowance",
        });
      }}
    >
      <div className="info-banner compact-info">
        Records enter a review queue. Only approved income and expenses affect
        the bookkeeping balance.
      </div>
      {state.me!.role === "admin" && (
        <label>
          Member
          <select value={member} onChange={(e) => setMember(e.target.value)}>
            {state.members
              .filter((m) => m.status === "Approved")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="form-columns">
        <label>
          Record type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {[
              "Income",
              "Expense",
              "Turnover",
              ...(state.me!.role === "admin" ? ["Allowance"] : []),
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Date (IST)
          <input type="date" name="date" required defaultValue={dayIST()} />
        </label>
      </div>
      <label>
        Account / ledger
        <select
          name="account"
          required={kind === "Turnover"}
          key={member + kind}
        >
          <option value="">
            {kind === "Turnover"
              ? "Select an approved account"
              : "Company ledger"}
          </option>
          {target.profile.accounts
            ?.filter((a) => a.status === "Approved")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank} · {a.type} · •••• {a.last4}
              </option>
            ))}
        </select>
      </label>
      <div className="form-columns">
        <label>
          Amount (INR)
          <input
            name="amount"
            inputMode="decimal"
            required
            pattern="[0-9]+(\.[0-9]{1,2})?"
            placeholder="0.00"
          />
        </label>
        <label>
          Unique transaction reference
          <input name="reference" maxLength={120} required />
        </label>
      </div>
      <label>
        Description
        <textarea name="description" maxLength={500} required />
      </label>
      {kind === "Expense" && (
        <p className="small muted">
          After saving, attach the receipt in Expenses & allowances. A receipt
          is required before approval.
        </p>
      )}
      {kind === "Allowance" && (
        <p className="small muted">
          An approved allowance is an income record for the selected member.
          This records authorization; it does not send a bank transfer.
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        Submit record for review
      </button>
    </form>
  );
}
function Reviews({
  state,
  act,
  busy,
  select,
}: {
  state: Snapshot;
  act: Action;
  busy: boolean;
  select: (id: string) => void;
}) {
  const queue = state.members.filter((m) => m.status === "In review");
  const entries = state.entries.filter((e) => e.status === "Pending");
  return (
    <>
      <Panel
        title="Merchant review queue"
        action={<Badge tone="gold">{queue.length} pending</Badge>}
      >
        <div className="review-members">
          {queue.map((m) => (
            <button key={m.id} onClick={() => select(m.id)}>
              <Avatar name={m.name} />
              <div>
                <strong>{m.name}</strong>
                <small>
                  {m.profile.firm} ·{" "}
                  {accountSummary(m, state.documents).documents}/7 KYC documents
                  · {accountSummary(m, state.documents).proofs}/7 bank proofs
                </small>
              </div>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
        {!queue.length && (
          <Empty
            title="No profiles awaiting review"
            detail="Submitted member profiles appear here with their documents and account references."
          />
        )}
      </Panel>
      <Panel
        title="Income, turnover & expense approvals"
        className="spaced"
        action={<Badge tone="gold">{entries.length} pending</Badge>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Reference / date</th>
                <th>Member</th>
                <th>Description</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.reference}
                    <small className="table-sub">{e.date}</small>
                  </td>
                  <td>
                    {state.members.find((m) => m.id === e.member_id)?.name}
                  </td>
                  <td>{e.description}</td>
                  <td>{e.kind}</td>
                  <td>{inr(e.amount_paise)}</td>
                  <td>
                    {e.kind === "Expense" &&
                      (state.documents.find(
                        (d) => d.kind === "Expense receipt:" + e.id,
                      ) ? (
                        <a
                          href={
                            "/api/documents/" +
                            state.documents.find(
                              (d) => d.kind === "Expense receipt:" + e.id,
                            )!.id
                          }
                        >
                          View receipt
                        </a>
                      ) : (
                        <small className="muted">Receipt required</small>
                      ))}
                    <div className="page-actions">
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() =>
                          void act("review-entry", {
                            id: e.id,
                            status: "Approved",
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="btn secondary small"
                        disabled={busy}
                        onClick={() =>
                          void act("review-entry", {
                            id: e.id,
                            status: "Rejected",
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <Empty
              title="Transaction queue is clear"
              detail="New manual and API records require approval before entering financial totals."
            />
          )}
        </div>
      </Panel>
    </>
  );
}
function MemberDetail({
  member: m,
  state,
  busy,
  act,
  reviewOnly = false,
}: {
  member: LiveMember;
  state: Snapshot;
  busy: boolean;
  act: Action;
  reviewOnly?: boolean;
}) {
  const admin = state.me!.role === "admin";
  const docs = state.documents.filter((d) => d.member_id === m.id);
  return (
    <div className="form">
      {!reviewOnly && (
        <>
          <div className="member-detail-heading">
            <Avatar name={m.name} />
            <div>
              <strong>{m.profile.firm || m.name}</strong>
              <p>
                {m.city} · {m.role}
              </p>
            </div>
            <Badge tone={m.status === "Approved" ? "green" : "gold"}>
              {m.status}
            </Badge>
          </div>
          <label>
            Member's own referral ID
            <input readOnly value={m.ref} onFocus={(e) => e.target.select()} />
          </label>
          <ReferralPlacement member={m} />
          <p className="small muted">
            {m.accountCount || 0} account references · {m.documentCount || 0}{" "}
            documents submitted
          </p>
          {m.profile.gst && <p>GSTIN: {m.profile.gst}</p>}
          {docs.length > 0 && (
            <div className="form">
              {docs.map((d) => (
                <a
                  className="document-download"
                  href={"/api/documents/" + d.id}
                  key={d.id}
                >
                  <span>
                    {documentLabel(d, m.profile)}
                    <small>{d.name}</small>
                  </span>
                  <Download size={16} />
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {admin && m.role !== "admin" && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const limits = Object.fromEntries(
              (m.profile.accounts || [])
                .filter((a) => a.type === "Current")
                .map((a) => [a.id, Number(f.get("limit-" + a.id))]),
            );
            const decision =
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ||
              "changes";
            void act("review-profile", {
              member: m.id,
              revision: m.revision,
              note: f.get("note"),
              decision,
              limits,
            });
          }}
        >
          {m.status === "In review" && (
            <>
              <h3>Bank evidence review</h3>
              <p className="muted small">
                Enter each bank-approved daily limit from reviewed evidence.
                Requested limits do not constitute approval.
              </p>
              {m.profile.accounts
                ?.filter((a) => a.type === "Current")
                .map((a) => (
                  <label key={a.id}>
                    {a.bank} · •••• {a.last4} · approved daily limit (INR)
                    <input
                      name={"limit-" + a.id}
                      type="number"
                      min={5000000}
                      max={10000000}
                      step={1}
                      placeholder="Bank-evidenced amount"
                    />
                  </label>
                ))}
            </>
          )}
          <label>
            Review note
            <textarea
              name="note"
              required
              maxLength={500}
              placeholder="Record what was checked or what must be corrected."
            />
          </label>
          <div className="page-actions">
            {m.status === "In review" ? (
              <>
                <button className="btn primary" value="approve" disabled={busy}>
                  Approve profile
                </button>
                <button
                  className="btn secondary"
                  value="changes"
                  disabled={busy}
                >
                  Request changes
                </button>
              </>
            ) : (
              <button className="btn secondary" value="reset" disabled={busy}>
                Reopen for corrections
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
function Activity({ state, limit }: { state: Snapshot; limit?: number }) {
  const records = limit ? state.audit.slice(0, limit) : state.audit;
  return (
    <div className="live-activity">
      {records.map((a) => {
        let location = "";
        try {
          const l = JSON.parse(a.location || "null");
          if (l) location = `Shared: ${l.latitude}, ${l.longitude} (approx.)`;
        } catch {}
        return (
          <article key={a.id}>
            <span className="activity-dot" />
            <div>
              <strong>{a.action}</strong>
              <p>{a.detail}</p>
              <small>
                {state.members.find((m) => m.id === a.actor)?.name || "Member"}{" "}
                ·{" "}
                {new Date(a.created_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </small>
              {!limit && (
                <>
                  <div className="log-facts">
                    <code>IP {a.ip}</code>
                    <span>
                      {[a.city, a.country].filter(Boolean).join(", ") ||
                        "Network location unavailable"}
                    </span>
                    {location && <span>{location}</span>}
                  </div>
                  <small className="device-info">
                    {a.user_agent || "Device information unavailable"}
                  </small>
                </>
              )}
            </div>
          </article>
        );
      })}
      {!records.length && (
        <Empty
          title="No recorded activity"
          detail="Authenticated access and changes appear here."
        />
      )}
    </div>
  );
}
function SettingsView({
  state,
  act,
  busy,
  notify,
  recover,
}: {
  state: Snapshot;
  act: Action;
  busy: boolean;
  notify: (s: string) => void;
  recover: (code: string) => void;
}) {
  const [token, setToken] = useState("");
  const admin = state.me!.role === "admin";
  return (
    <>
      <Panel title="Company workspace">
        <form
          className="live-form-pad form"
          key={JSON.stringify(state.settings)}
          onSubmit={(e) => {
            e.preventDefault();
            if (admin)
              void act(
                "workspace",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
          }}
        >
          <label>
            Company
            <input
              name="company"
              required
              maxLength={100}
              readOnly={!admin}
              defaultValue={state.settings.company}
            />
          </label>
          <label>
            Declared service
            <textarea
              name="business"
              required
              maxLength={300}
              readOnly={!admin}
              defaultValue={state.settings.business}
            />
          </label>
          <label>
            Declared license / registration
            <input
              name="license"
              required
              maxLength={200}
              readOnly={!admin}
              defaultValue={state.settings.license}
            />
          </label>
          <p className="muted small">
            Company-provided details. The portal does not independently certify
            licenses.
          </p>
          {admin && (
            <button className="btn primary" disabled={busy}>
              Save company settings
            </button>
          )}
        </form>
      </Panel>
      {admin && (
        <Panel title="Administrator access" className="spaced">
          <p className="live-form-pad muted">
            Existing owner account only. New accounts join as members; agent
            access is earned through verified eligibility.
          </p>
        </Panel>
      )}
      {state.identity.passwordLogin && (
        <Panel title="Password & recovery" className="spaced">
          <form
            className="live-form-pad form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (f.get("password") !== f.get("confirm"))
                return notify("Passwords do not match.");
              if (f.get("locationConsent") !== "on")
                return notify(
                  "Agree to share your location before continuing.",
                );
              const result = await act(
                "auth/change-password",
                Object.fromEntries(f),
              );
              if (result?.recoveryCode) recover(result.recoveryCode);
            }}
          >
            <LocationNotice />
            <label>
              Current password
              <input
                type="password"
                name="currentPassword"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </label>
            <label>
              New password
              <input
                type="password"
                name="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirm"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <p className="small muted">
              Changing your password signs out your other sessions and creates a
              new recovery code.
            </p>
            <button className="btn primary" disabled={busy}>
              Change password
            </button>
          </form>
        </Panel>
      )}
      <div className="info-banner spaced">
        <Wallet />
        <div>
          <strong>Commission & reward controls</strong>
          <p>
            Open Commissions & rewards for the calculator, membership targets,
            funded benefits and versioned administrator plan.
          </p>
        </div>
        <Badge tone="gold">
          {state.rewards?.plan.enabled ? "Active policy" : "Draft policy"}
        </Badge>
      </div>
      {admin && (
        <Panel
          title="Transaction ingestion API"
          className="spaced"
          eyebrow="MANUAL + API REPORTING"
        >
          <div className="live-form-pad form">
            <p className="muted small">
              An authorized integration can submit bookkeeping records. Records
              remain pending until reviewed. No bank connection or payment
              execution is included.
            </p>
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = new FormData(e.currentTarget).get("name");
                const result = await act("tokens", { name });
                if (result) setToken(result.token);
              }}
            >
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Integration name"
                aria-label="Integration name"
              />
              <button className="btn primary" disabled={busy}>
                Create API token
              </button>
            </form>
            {token && (
              <div className="token-result">
                <strong>Copy now — this token is shown only once.</strong>
                <input aria-label="New API token" value={token} readOnly />
                <div className="page-actions">
                  <button
                    className="btn secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(token)
                        .then(() =>
                          notify("Token copied. Keep it on your server."),
                        )
                    }
                  >
                    Copy token
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => setToken("")}
                  >
                    Hide token
                  </button>
                </div>
              </div>
            )}
            <div className="api-example">
              <code>POST /api/entries</code>
              <p>
                Authorization: Bearer YOUR_TOKEN
                <br />
                Content-Type: application/json
              </p>
              <pre>
                {JSON.stringify(
                  {
                    member: "MEMBER_ID",
                    account: "ACCOUNT_ID",
                    kind: "Turnover",
                    amount: "10000.00",
                    date: dayIST(),
                    reference: "YOUR_UNIQUE_REFERENCE",
                    description: "Verified payment processing volume",
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
            <p className="small muted">
              Use unique references for retry-safe imports. Reusing a reference
              with changed amounts is rejected. Tokens permit transaction
              ingestion only; store them on your integration server.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Integration</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.tokens.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{t.created_at.slice(0, 10)}</td>
                      <td>{t.revoked_at ? "Revoked" : "Active"}</td>
                      <td>
                        {!t.revoked_at && (
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() =>
                              void act("revoke-token", { id: t.id })
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Integration identifiers</summary>
              {state.members.map((m) => (
                <div className="integration-ids" key={m.id}>
                  <strong>{m.name}</strong>
                  <code>Member: {m.id}</code>
                  {m.profile.accounts?.map((a) => (
                    <code key={a.id}>
                      {a.bank} / {a.last4}: {a.id}
                    </code>
                  ))}
                </div>
              ))}
            </details>
          </div>
        </Panel>
      )}
    </>
  );
}
