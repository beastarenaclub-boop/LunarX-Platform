import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Gamepad2,
  Headphones,
  History,
  LogOut,
  Settings2,
  Ticket,
  Trophy,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { money } from "./api";
import type { Data } from "./types";

const navigation = [
  { id: "terminal", label: "Play Irland Lotto", short: "Play", icon: Gamepad2 },
  { id: "tickets", label: "My tickets", short: "Tickets", icon: Ticket },
  { id: "results", label: "Draw results", short: "Results", icon: Trophy },
  { id: "wallet", label: "Wallet", short: "Wallet", icon: Wallet },
];
export function PlayerShell({
  data,
  active,
  navigate,
  children,
  offline,
  onRetry,
  onLogout,
  toast,
  dismissToast,
  onBackToLobby,
}: {
  data: Data;
  active: string;
  navigate: (page: string) => void;
  children: ReactNode;
  offline: boolean;
  onRetry: () => void;
  onLogout: () => void;
  toast: { message: string; error: boolean } | null;
  dismissToast: () => void;
  onBackToLobby?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Irland Lotto";
    return () => { document.title = previousTitle; };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  const go = (page: string) => {
    setMenu(false);
    navigate(page);
  };
  return (
    <div className="app-shell role-user player-shell">
      <header className="player-header">
        <div className="player-header-inner">
          {onBackToLobby && <button className="player-account-button" onClick={onBackToLobby} aria-label="Back to lobby" title="Back to lobby"><ArrowLeft size={18} /></button>}
          <a
            className="player-brand"
            href="/user/terminal"
            onClick={(e) => {
              e.preventDefault();
              go("terminal");
            }}
          >
            <span className="player-brand-icon">
              <Ticket size={20} />
            </span>
            <span>{data.settings.brand}</span>
          </a>
          <nav className="player-nav" aria-label="Player navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                aria-current={active === item.id ? "page" : undefined}
                className={
                  active === item.id ||
                  (active === "overview" && item.id === "terminal")
                    ? "active"
                    : ""
                }
                onClick={() => go(item.id)}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="player-header-actions">
            <button
              className="player-wallet"
              aria-label={`Wallet balance ${money(data.account.balance)}`}
              onClick={() => go("wallet")}
            >
              <Wallet size={17} />
              <strong>{money(data.account.balance)}</strong>
              <span>
                <ArrowRight size={13} />
              </span>
            </button>
            <div className="player-account-wrap" ref={menuRef}>
              <button
                className={`player-account-button ${menu ? "active" : ""}`}
                aria-label="Account menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <UserRound size={18} />
                <ChevronDown size={12} />
              </button>
              {menu && (
                <div className="player-account-menu">
                  <div>
                    <strong>{data.account.name}</strong>
                    <small>{data.account.id}</small>
                  </div>
                  <button onClick={() => go("settings")}>
                    <Settings2 size={16} />
                    Account settings
                  </button>
                  <button onClick={() => go("reports")}>
                    <History size={16} />
                    My activity
                  </button>
                  <button onClick={() => go("support")}>
                    <Headphones size={16} />
                    Help & support
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      onLogout();
                    }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      {offline && (
        <div className="player-offline" role="status">
          Connection lost. Reconnect to place a ticket.
          <button onClick={onRetry}>Try again</button>
        </div>
      )}
      <main
        className={`player-main ${active === "terminal" || active === "overview" ? "player-main-game" : "player-main-page"}`}
      >
        {active !== "terminal" && active !== "overview" && (
          <button className="player-back" onClick={() => go("terminal")}>
            <ArrowLeft size={15} />
            Back to game
          </button>
        )}
        {children}
      </main>
      <footer className="player-footer">
        <span>
          {data.mode === "demo"
            ? "Demo play · no cash value"
            : data.mode === "wallet" ? "Shared wallet (₹)" : "Internal balance (₹)"}
        </span>
        <button onClick={() => go("support")}>
          Help & support
          <CircleHelp size={12} />
        </button>
      </footer>
      <nav className="player-mobile-nav" aria-label="Mobile player navigation">
        {navigation.map((item) => (
          <button
            key={item.id}
            aria-label={item.label}
            aria-current={active === item.id ? "page" : undefined}
            className={
              active === item.id ||
              (active === "overview" && item.id === "terminal")
                ? "active"
                : ""
            }
            onClick={() => go(item.id)}
          >
            <item.icon size={20} />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          <span>
            {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
          </span>
          {toast.message}
          <button aria-label="Dismiss notification" onClick={dismissToast}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
