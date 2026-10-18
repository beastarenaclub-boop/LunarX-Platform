import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleHelp,
  CircleUserRound,
  Gamepad2,
  Gift,
  History,
  LogOut,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  disconnectRealtime,
  getGetMeQueryKey,
  getGetWalletBalanceQueryKey,
  useGetWalletBalance,
  useLogout,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { toast } from "sonner";
import vaultArtwork from "@/assets/lobby/event-vault.png";
import { MobileNavigation } from "./MobileNavigation";
import "./site.css";
import { useSiteChannel } from "@/lib/siteChannel";
import { ACCOUNT_OPTIONS } from "./AccountOptions";
import { B2C_STANDALONE, B2C_BRAND, B2C_ICON } from "@/components/b2c/config";
const accountBrand = B2C_STANDALONE ? B2C_BRAND : "Lunar Play";

const links = [
  { href: "/wallet", label: "My wallet", icon: Wallet },
  { href: "/history", label: "Activity & history", icon: History },
  { href: "/profile", label: "Profile & KYC", icon: CircleUserRound },
  ...ACCOUNT_OPTIONS,
  { href: "/promotions", label: "Promotions", icon: Gift },
  { href: "/help", label: "Help & support", icon: CircleHelp },
  { href: "/verify", label: "Round verifier", icon: ShieldCheck },
];

export function SiteBrand() {
  if (B2C_STANDALONE) return <Link href="/" className="site-brand" aria-label={`${B2C_BRAND} home`}><img className="account-brand-icon" src={B2C_ICON} alt="" />{B2C_BRAND}</Link>;
  return (
    <Link href="/" className="site-brand" aria-label="Lunar Play home">
      LUNAR<span>PLAY</span>
    </Link>
  );
}

function SiteHeader() {
  const site = useSiteChannel();
  const { user } = useAuth();
  const [location] = useLocation();
  const balance = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        enabled: !!user,
        retry: false,
      },
    },
  );
  return (
    <header className="site-header">
      <SiteBrand />
      <nav className="site-top-nav" aria-label="Main navigation">
        <Link href="/">
          <Gamepad2 /> Instant Games
        </Link>
        <Link
          href="/promotions"
          aria-current={location === "/promotions" ? "page" : undefined}
        >
          <Gift /> Promotions
        </Link>
        <Link
          href="/help"
          aria-current={location === "/help" ? "page" : undefined}
        >
          <CircleHelp /> Support
        </Link>
      </nav>
      <div className="site-header-actions">
        {user ? (
          <>
            <Link
              href="/wallet"
              className="site-header-balance"
              aria-label="Open wallet"
            >
              <Wallet />
              <span>
                {balance.isError
                  ? "Unavailable"
                  : balance.data
                    ? `₹${formatRupees(balance.data.balance)}`
                    : "…"}
              </span>
            </Link>
            <Link
              href="/wallet?tab=deposit"
              className="site-action site-action-primary"
            >
              Deposit
            </Link>
            <Link
              href="/profile"
              className="site-avatar"
              aria-label="Open profile"
            >
              {(user.displayName || user.email).slice(0, 1).toUpperCase()}
            </Link>
          </>
        ) : (
          <>
            <Link href="/login" className="site-action">
              Log in
            </Link>
            {site.data?.signupEnabled && <Link href="/signup" className="site-action site-action-primary">
              Sign up
            </Link>}
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>
        {accountBrand.toUpperCase()} <span className="site-footer-dot">·</span> All your games.
        One wallet.
      </span>
      <div>
        <Link href="/help">Help & support</Link>
        <Link href="/verify">Round verifier</Link>
        <span className="site-age">18+</span>
      </div>
    </footer>
  );
}

export function SiteLayout({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout({
    mutation: {
      onSuccess: async () => {
        disconnectRealtime();
        // A failed /me refetch retains old query data; clear the ended session first.
        qc.setQueryData(getGetMeQueryKey(), null);
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate("/login");
      },
      onError: () => toast.error("Could not sign out. Please try again."),
    },
  });
  useEffect(() => {
    document.title = `${title} — ${accountBrand}`;
  }, [title]);
  return (
    <div className={`site-shell ${className}`}>
      <a href="#site-main" className="site-skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <div className="site-workspace">
        <aside className="site-sidebar">
          <Link href="/" className="site-back" data-testid="btn-back-home">
            <ArrowLeft /> Back to games
          </Link>
          <div className="site-user">
            <div className="site-avatar">
              {(user?.displayName || user?.email || "L")
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div>
              <strong>{user?.displayName || "Your account"}</strong>
              <span>{user?.email || "Welcome to Lunar Play"}</span>
            </div>
          </div>
          <p className="site-nav-label">MY ACCOUNT</p>
          <nav className="site-account-nav" aria-label="Account navigation">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={location === href ? "page" : undefined}
              >
                <Icon />
                <span>{label}</span>
                <ArrowUpRight className="site-nav-arrow" />
              </Link>
            ))}
          </nav>
          <div className="site-sidebar-bottom">
            <p>Need a hand?</p>
            <span>Track a payment or get help with your account.</span>
            <Link href="/help">
              Contact support <ArrowUpRight />
            </Link>
          </div>
          {user && (
            <button
              type="button"
              className="site-signout"
              disabled={logout.isPending}
              onClick={() => logout.mutate(undefined)}
            >
              <LogOut />
              {logout.isPending ? "Signing out…" : "Sign out"}
            </button>
          )}
        </aside>
        <main id="site-main" className="site-content" tabIndex={-1}>
          <div className="site-page-heading">
            <p className="site-eyebrow">{accountBrand.toUpperCase()} / MY ACCOUNT</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {user && location === "/profile" && <button type="button" className="site-mobile-signout" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}><LogOut size={18} />{logout.isPending ? "Signing out…" : "Sign out"}</button>}
        </main>
      </div>
      <SiteFooter />
      {user && <MobileNavigation />}
    </div>
  );
}

export function AuthLayout({
  children,
  title = "Welcome to Lunar Play",
}: {
  children: ReactNode;
  title?: string;
}) {
  useEffect(() => {
    document.title = `${title} — ${accountBrand}`;
  }, [title]);
  return (
    <div className="site-shell auth-shell">
      <SiteHeader />
      <main className="site-auth-main">
        <section className="site-auth-story" aria-label="Welcome to Lunar Play">
          <img
            src={vaultArtwork}
            alt="An illuminated gold vault in a dark casino"
          />
          <div className="site-auth-story-copy">
            <p className="site-eyebrow">WELCOME TO LUNAR PLAY</p>
            <h1>
              Every game.
              <br />
              <span>One place.</span>
            </h1>
            <p>
              Your favourites, your balance and your next game.
              <br />
              All together in your Lunar account.
            </p>
            <div className="site-auth-features">
              <span>
                <Gamepad2 /> Instant games
              </span>
              <span>
                <Wallet /> Shared wallet
              </span>
            </div>
          </div>
        </section>
        <section className="site-auth-form" aria-label={title}>
          {children}
          <p className="site-auth-note">
            Play responsibly. For players aged 18 and over.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
