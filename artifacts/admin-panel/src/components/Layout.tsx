import { Link, useLocation } from "wouter";
import { useState, useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Wallet,
  ClipboardCheck,
  ArrowDownToLine,
  ArrowUpToLine,
  Gift,
  ShieldAlert,
  ScrollText,
  Dice5,
  LogOut,
  FileText,
  Shield,
  MessageSquare,
  Megaphone,
  Bell,
  UserCheck,
  Scale,
  Sparkles,
  Building2,
  BookOpen,
  PlayCircle,
  Coins,
  CloudRain,
  ToggleRight,
  Menu,
  X,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/network", label: "B2B / B2C Network", icon: Building2 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/kyc", label: "KYC", icon: ClipboardCheck },
  { href: "/bets", label: "Bets", icon: Dice5 },
  { href: "/round-profit", label: "Round Profit Split", icon: Coins },
  { href: "/deposits", label: "Deposits", icon: ArrowUpToLine },
  { href: "/withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
  { href: "/reconciliation", label: "Reconciliation", icon: Scale },
  { href: "/bonus", label: "Bonus", icon: Gift },
  { href: "/free-bets", label: "Free Bets & Rain", icon: CloudRain },
  { href: "/promotions", label: "Promotions", icon: Sparkles },
  { href: "/support", label: "Support", icon: MessageSquare },
  { href: "/banners", label: "Banners", icon: Megaphone },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/demo-nudge", label: "Demo Nudges", icon: Sparkles },
  { href: "/fraud", label: "Fraud", icon: ShieldAlert },
  { href: "/games", label: "Games", icon: ToggleRight },
  { href: "/lottery", label: "Irland Lotto", icon: Dice5 },
  { href: "/prize-lotto", label: "Prize Lotto", icon: Dice5 },
  { href: "/rtp", label: "RTP Config", icon: Shield },
  { href: "/agents", label: "Legacy Agents", icon: UserCheck },
  { href: "/partners", label: "Partners", icon: Building2 },
  { href: "/developer-docs", label: "Developer Docs", icon: BookOpen },
  { href: "/integration-demo", label: "Integration Demo", icon: PlayCircle },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/logs", label: "Logs", icon: FileText },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (mobile navigation).
  useEffect(() => {
    setOpen(false);
  }, [location]);

  // Close the drawer on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold">Operator Console</span>
          </div>
          <button
            type="button"
            className="lg:hidden text-slate-400 hover:text-white p-1"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            data-testid="button-close-menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Lunar platform</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {NAV.map((item) => {
          const Active =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`nav-${item.label.toLowerCase()}`}
              className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                Active
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-3 border-t border-slate-800">
        <div className="text-xs text-slate-400 mb-2">
          <div className="font-medium text-slate-200 truncate" data-testid="text-user-email">
            {user?.email}
          </div>
          <div className="uppercase text-[10px] tracking-wide">{user?.role}</div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          data-testid="button-logout"
          onClick={() => void logout()}
        >
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 bg-slate-900 text-slate-100 flex-col sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] bg-slate-900 text-slate-100 flex flex-col h-full shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center gap-2 bg-slate-900 text-slate-100 px-3 py-2.5 shadow">
          <button
            type="button"
            className="p-2 -ml-1 rounded hover:bg-slate-800"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            data-testid="button-open-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Wallet className="h-4 w-4 text-emerald-400" />
          <span className="font-semibold text-sm truncate">Operator Console</span>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
