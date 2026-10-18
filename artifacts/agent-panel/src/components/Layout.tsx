import { Link, useLocation } from "wouter";
import { useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { customFetch, getOperatorPanel } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  GitBranch,
  Users,
  LogOut,
  Link as LinkIcon,
  Menu,
  X,
  Globe,
  ReceiptText,
  Wallet,
  Handshake,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/downline", label: "Downline tree", icon: GitBranch },
  { href: "/agents", label: "Total Agents", icon: Users, masterOnly: true },
  { href: "/users", label: "Total Users", icon: Users },
  { href: "/ledger", label: "Commission & P&L", icon: ReceiptText },
  { href: "/transactions", label: "Wallet transactions", icon: Wallet },
  { href: "/payments", label: "Payment history", icon: Wallet },
  { href: "/manual-payments", label: "Manual payments", icon: Wallet, masterOnly: true },
  { href: "/settlements", label: "Settlements", icon: Handshake },
  { href: "/weekly", label: "Weekly account", icon: ReceiptText, masterOnly: true },
  { href: "/website", label: "Website links", icon: Globe },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const panelName = getOperatorPanel() === "master" ? "Master Panel" : "Agent Panel";
  const context = useQuery({
    queryKey: ["network", "context"],
    queryFn: () => customFetch<{ role: string; node: { manualPaymentsEnabled: boolean } | null }>("/api/network/context"),
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });
  const canCollect = context.data?.role === "master" && context.data.node?.manualPaymentsEnabled === true;

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
            <LinkIcon className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold">{panelName}</span>
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
        <p className="text-xs text-slate-400 mt-1">LunarX · Branch management</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {NAV.filter(
          (item) => (!item.masterOnly || getOperatorPanel() === "master") && (item.href !== "/manual-payments" || canCollect),
        ).map((item) => {
          const active =
            location === item.href ||
            (item.href !== "/" && location.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                active
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
          <div className="font-medium text-slate-200 truncate">
            {user?.email}
          </div>
          <div className="uppercase text-[10px] tracking-wide">
            {getOperatorPanel() ?? user?.role}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
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
          <LinkIcon className="h-4 w-4 text-emerald-400" />
          <span className="font-semibold text-sm truncate">
            {panelName}
          </span>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
