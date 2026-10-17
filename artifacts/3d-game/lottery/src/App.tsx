import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  Ticket,
  Store,
  Users,
  Wallet,
  BarChart3,
  Trophy,
  Settings2,
  ShieldCheck,
  Headphones,
  ChevronDown,
  Bell,
  Menu,
  LogOut,
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Activity,
  Search,
  X,
  CircleDot,
  LockKeyhole,
  Eye,
  EyeOff,
  BookOpen,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError, money, date, time } from "./api";
import type { Data, Role, Receipt } from "./types";
import { Brand, Badge, ReceiptView, Modal, Busy } from "./ui";
import { Terminal } from "./Terminal";
import { PlayerShell } from "./PlayerShell";
import { PlayerGame } from "./PlayerGame";
import "./player.css";
import {
  Overview,
  Tickets,
  Results,
  Reports,
  WalletView,
  Support,
  SettingsView,
  Accounts,
  Audit,
} from "./Views";

const roleMeta = {
  shop: {
    title: "Shop terminal",
    subtitle: "Your counter. Connected.",
    description:
      "A faster way to sell tickets, follow every draw and keep your shop in sync.",
    id: "SHP-3001",
    icon: Store,
    home: "terminal",
  },
  admin: {
    title: "Admin workspace",
    subtitle: "The complete picture.",
    description:
      "Manage your network, configure draws and keep every transaction accountable.",
    id: "ADM-1001",
    icon: ShieldCheck,
    home: "overview",
  },
  agent: {
    title: "Agent workspace",
    subtitle: "Grow your network.",
    description:
      "Keep your shops funded, track sales and see every commission in one place.",
    id: "AGT-2001",
    icon: Users,
    home: "overview",
  },
  user: {
    title: "User panel",
    subtitle: "Welcome back",
    description:
      "Sign in to choose numbers, view your tickets and check results.",
    id: "USR-4001",
    icon: Ticket,
    home: "terminal",
  },
};
const roles: Role[] = ["shop", "admin", "agent", "user"];
const roleFromPath = (): Role =>
  roles.includes(location.pathname.split("/")[1] as Role)
    ? (location.pathname.split("/")[1] as Role)
    : "shop";
const navItems = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    roles: ["admin", "agent", "shop", "user"],
  },
  {
    id: "terminal",
    label: "Ticket terminal",
    icon: Ticket,
    roles: ["shop", "user"],
  },
  {
    id: "tickets",
    label: "Tickets & claims",
    icon: BookOpen,
    roles: ["admin", "agent", "shop", "user"],
  },
  {
    id: "results",
    label: "Draw results",
    icon: Trophy,
    roles: ["admin", "agent", "shop", "user"],
  },
  {
    id: "accounts",
    label: "Network & accounts",
    icon: Users,
    roles: ["admin", "agent"],
  },
  {
    id: "wallet",
    label: "Wallet & ledger",
    icon: Wallet,
    roles: ["admin", "agent", "shop", "user"],
  },
  {
    id: "reports",
    label: "Sales reports",
    icon: BarChart3,
    roles: ["admin", "agent", "shop", "user"],
  },
  { id: "audit", label: "Activity log", icon: Activity, roles: ["admin"] },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    roles: ["admin", "agent", "shop", "user"],
  },
  {
    id: "support",
    label: "Help & support",
    icon: Headphones,
    roles: ["admin", "agent", "shop", "user"],
  },
];
export type ViewProps = {
  data: Data;
  now: number;
  navigate: (page: string) => void;
  run: <T>(
    path: string,
    body: unknown,
    message?: string,
    key?: string,
  ) => Promise<T | undefined>;
  busy: boolean;
  printTicket: (id: string) => Promise<void>;
};

function Login({
  role,
  onRole,
  onLogin,
}: {
  role: Role;
  onRole: (r: Role) => void;
  onLogin: () => void;
}) {
  const [id, setId] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [show, setShow] = useState(false);
  const meta = roleMeta[role];
  useEffect(() => {
    setId("");
    setPassword("");
    setError("");
  }, [role]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(role, "/login", { role, id, password });
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`login-page role-${role} ${role === "user" ? "player-login" : ""}`}
    >
      {role !== "user" && (
        <div className="login-story">
          <Brand />
          <div className="story-copy">
            <span className="eyebrow">
              <span className="live-dot" /> A NEW CHAPTER IN LOTTERY
            </span>
            <h1>
              Small numbers.
              <br />
              Big possibilities<span>.</span>
            </h1>
            <p>
              One connected workspace for every ticket,
              <br />
              every shop, and every draw.
            </p>
          </div>
          <div className="lottery-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="art-ball ball-a">07</div>
            <div className="art-ball ball-b">24</div>
            <div className="art-ball ball-c">89</div>
            <div className="art-ticket">
              <div>
                <Brand small />
                <Sparkles size={20} />
              </div>
              <span>YOUR NEXT LUCKY MOMENT</span>
              <div className="art-numbers">
                <b>0</b>
                <b>7</b>
                <b>2</b>
                <b>4</b>
              </div>
              <div className="ticket-dash" />
              <small>
                <CheckCircle2 size={13} /> EVERY TICKET TELLS A STORY
              </small>
            </div>
            <div className="art-tag">
              <ShieldCheck size={16} /> One ticket. One verified entry.
            </div>
          </div>
          <div className="story-footer">
            <span>Built for the way your business works.</span>
            <span>01 — 04</span>
          </div>
        </div>
      )}
      <div className="login-side">
        <span className="login-top">
          LOTTERY OPERATIONS, REIMAGINED <ArrowUpRight size={17} />
        </span>
        <div className="login-form-wrap">
          {role === "user" && (
            <div className="player-login-brand">
              <Ticket size={23} /> Irland Lotto
            </div>
          )}
          <div className="role-tabs">
            {roles.map((r) => {
              const Icon = roleMeta[r].icon;
              return (
                <button
                  key={r}
                  className={role === r ? "active" : ""}
                  onClick={() => onRole(r)}
                >
                  <Icon size={17} />
                  {r === "user" ? "User" : r[0].toUpperCase() + r.slice(1)}
                </button>
              );
            })}
          </div>
          <span className="portal-label">{meta.title}</span>
          <h2>{meta.subtitle}</h2>
          <p>{meta.description}</p>
          <form onSubmit={submit}>
            <label>
              {role === "user" ? "User" : "Account"} ID
              <input
                autoComplete="username"
                placeholder={meta.id}
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <div className="secure-note">
              <LockKeyhole size={13} /> Secure access to your dedicated
              workspace
            </div>
            <button className="btn primary full large" disabled={busy}>
              <Busy busy={busy}>
                Sign in to {role === "user" ? "your account" : `${role} panel`}
              </Busy>
              <ArrowRight size={17} />
            </button>
          </form>
          <details className="demo-access">
            <summary>
              Explore the local demo <ChevronDown size={15} />
            </summary>
            <p>Demo balance in ₹ only. Each portal has its own account.</p>
            <button
              onClick={() => {
                setId(meta.id);
                setPassword("Lottery@123");
              }}
            >
              Use {meta.id}
              <ArrowUpRight size={14} />
            </button>
            <code>Password: Lottery@123</code>
          </details>
        </div>
        <div className="login-footer">
          <ShieldCheck size={15} />
          <span>Separate identities. Connected operations.</span>
          <span>v1.0</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState<Role>(roleFromPath),
    [page, setPage] = useState(
      location.pathname.split("/")[2] || roleMeta[role].home,
    ),
    [data, setData] = useState<Data | null>(null),
    [checking, setChecking] = useState(true),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [sidebar, setSidebar] = useState(false),
    [notifications, setNotifications] = useState(false),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [switcher, setSwitcher] = useState(false);
  const operation = useRef(false),
    generation = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRole = useRef(role);
  activeRole.current = role;
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5500);
  }, []);
  const refresh = useCallback(async () => {
    const current = generation.current;
    try {
      const result = await api<Data>(role, "/bootstrap");
      if (current !== generation.current || activeRole.current !== role) return;
      setData(result);
      setOffset(result.serverTime - Date.now());
      setOffline(false);
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
      } else {
        setOffline(true);
      }
    } finally {
      if (current === generation.current) setChecking(false);
    }
  }, [role]);
  useEffect(() => {
    generation.current++;
    setData(null);
    setChecking(true);
    setReceipt(null);
    void refresh();
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      generation.current++;
      clearInterval(poll);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const pop = () => {
      const r = roleFromPath();
      setRole(r);
      setPage(location.pathname.split("/")[2] || roleMeta[r].home);
    };
    window.addEventListener("popstate", pop);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", pop);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  const navigate = useCallback(
    (next: string) => {
      history.pushState({}, "", `/${role}/${next}`);
      setPage(next);
      setSidebar(false);
      setNotifications(false);
    },
    [role],
  );
  const changeRole = (r: Role) => {
    history.pushState({}, "", `/${r}/${roleMeta[r].home}`);
    if (r !== role) {
      generation.current++;
      setData(null);
      setChecking(true);
    }
    setRole(r);
    setPage(roleMeta[r].home);
    setSwitcher(false);
  };
  const run = useCallback(
    async <T,>(
      path: string,
      body: unknown,
      message?: string,
      key?: string,
    ): Promise<T | undefined> => {
      if (operation.current) return;
      operation.current = true;
      setBusy(true);
      try {
        const result = await api<T>(role, path, body, key);
        await refresh();
        if (message) notify(message);
        return result;
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Unable to complete this action.",
          true,
        );
        return undefined;
      } finally {
        operation.current = false;
        setBusy(false);
      }
    },
    [role, refresh, notify],
  );
  const printTicket = useCallback(
    async (id: string) => {
      if (role !== "shop") return;
      const result = await run<Receipt>(`/tickets/${id}/receipt`, {});
      if (result) {
        setReceipt(result);
        setTimeout(() => window.print(), 180);
      }
    },
    [role, run],
  );
  const logout = async () => {
    try {
      await api(role, "/logout", {});
      generation.current++;
      setData(null);
      setReceipt(null);
    } catch {
      notify("Sign out failed. Please retry.", true);
    }
  };
  if (checking)
    return (
      <div className={`app-loading ${role === "user" ? "player-loading" : ""}`}>
        <Brand />
        <LoaderCircle size={25} className="spin" />
        <p>Connecting your workspace…</p>
      </div>
    );
  if (!data)
    return (
      <>
        <Login role={role} onRole={changeRole} onLogin={() => void refresh()} />
        {offline && (
          <div className="connection-error">
            The lottery server is unavailable. Start it with{" "}
            <code>npm run lottery:start</code>.
          </div>
        )}
      </>
    );
  const meta = roleMeta[role],
    now = clock + offset,
    Icon = meta.icon;
  const allowed = navItems.filter((n) => n.roles.includes(role)),
    active = allowed.find((n) => n.id === page)?.id ?? meta.home;
  const props: ViewProps = {
    data,
    now,
    navigate,
    run,
    busy: busy || offline,
    printTicket,
  };
  const views: Record<string, React.ReactNode> = {
    overview: <Overview {...props} />,
    terminal: <Terminal {...props} />,
    tickets: <Tickets {...props} />,
    results: <Results {...props} />,
    accounts: <Accounts {...props} />,
    wallet: <WalletView {...props} />,
    reports: <Reports {...props} />,
    settings: <SettingsView {...props} />,
    support: <Support {...props} />,
    audit: <Audit {...props} />,
  };
  if (role === "user")
    return (
      <PlayerShell
        data={data}
        active={active}
        navigate={navigate}
        offline={offline}
        onRetry={() => void refresh()}
        onLogout={() => void logout()}
        toast={toast}
        dismissToast={() => setToast(null)}
      >
        {active === "terminal" || active === "overview" ? (
          <PlayerGame {...props} />
        ) : (
          views[active]
        )}
      </PlayerShell>
    );
  return (
    <div className={`app-shell role-${role}`}>
      <button
        className={`sidebar-scrim ${sidebar ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={() => setSidebar(false)}
      />
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand-link"
          href={`/${role}/${meta.home}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(meta.home);
          }}
        >
          <Brand />
        </a>
        <button
          className="workspace-selector"
          onClick={() => setSwitcher(true)}
        >
          <span className="workspace-icon">
            <Icon size={19} />
          </span>
          <span>
            {meta.title}
            <small>
              {data.mode === "demo" ? "Demo workspace" : "Local workspace"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-caption">WORKSPACE</span>
        <nav>
          {allowed.slice(0, -2).map((item) => (
            <button
              className={active === item.id ? "active" : ""}
              aria-current={active === item.id ? "page" : undefined}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>
                {role === "agent" && item.id === "accounts"
                  ? "My shops"
                  : item.label}
              </span>
              {item.id === "terminal" && <span className="nav-live">LIVE</span>}
              {item.id === "tickets" && data.stats.pendingClaims > 0 && (
                <b className="count-badge">{data.stats.pendingClaims}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-card">
            <span className="live-dot" />
            <strong>
              All your numbers.
              <br />
              One connected place.
            </strong>
            <p>Every sale and result, together.</p>
            <button onClick={() => navigate("support")}>
              Explore your workspace <ArrowUpRight size={14} />
            </button>
            <span className="side-decoration">07</span>
          </div>
          <nav>
            {allowed.slice(-2).map((item) => (
              <button
                className={active === item.id ? "active" : ""}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <button className="profile" onClick={() => navigate("settings")}>
            <span className="avatar">
              {data.account.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              {data.account.name}
              <small>{data.account.id}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>{meta.title}</span>
            <span>/</span>
            <strong>{allowed.find((n) => n.id === active)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="today-label">{date(now)}</span>
            <Badge kind={offline ? "danger" : "success"}>
              {offline ? "Disconnected" : "Connected"}
            </Badge>
            <div className="notification-wrap">
              <button
                className="icon-btn notification-btn"
                aria-label="Notifications"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                {data.stats.pendingClaims > 0 && <i />}
              </button>
              {notifications && (
                <div className="notification-popover">
                  <h3>Workspace updates</h3>
                  <p>
                    {data.stats.pendingClaims > 0
                      ? `${data.stats.pendingClaims} winning tickets are ready to claim.`
                      : "You’re all caught up. No pending claims."}
                  </p>
                  <button
                    className="text-link"
                    onClick={() => navigate("results")}
                  >
                    View draw results <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
            <span className="top-divider" />
            <button
              className="logout-btn"
              onClick={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut size={17} />
              <span>Sign out</span>
            </button>
          </div>
        </header>
        {offline && (
          <div className="offline-banner">
            Connection lost. Showing saved view; ticket sales are disabled until
            the server reconnects.
            <button onClick={() => void refresh()}>Retry connection</button>
          </div>
        )}
        <main className={active === "terminal" ? "shop-terminal" : undefined}>
          {views[active]}
        </main>
        <footer className="app-footer">
          <span>
            <CircleDot size={12} />
            {data.mode === "demo"
              ? "Demo environment · balance has no cash value"
              : "Local operations workspace"}
          </span>
          <span>
            Irland Lotto <i /> {data.settings.timezone} <i /> {time(now)}
          </span>
        </footer>
      </div>
      <ReceiptView receipt={role === "shop" ? receipt : null} />
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          <span>
            {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
          </span>
          {toast.message}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {switcher && (
        <Modal title="Choose a workspace" onClose={() => setSwitcher(false)}>
          <p className="muted">
            Each portal uses its own account and permissions.
          </p>
          <div className="portal-options">
            {roles.map((r) => {
              const RIcon = roleMeta[r].icon;
              return (
                <button key={r} onClick={() => changeRole(r)}>
                  <RIcon size={22} />
                  <span>
                    {roleMeta[r].title}
                    <small>
                      {r === role
                        ? "Current workspace"
                        : "Separate secure sign-in"}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
