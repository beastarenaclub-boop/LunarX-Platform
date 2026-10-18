import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Club,
  Crown,
  Dice5,
  Flag,
  Gamepad2,
  Grid2X2,
  Headphones,
  LogOut,
  Menu,
  Megaphone,
  Play,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Spade,
  Ticket,
  Trophy,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  customFetch,
  disconnectRealtime,
  getGetMeQueryKey,
  getGetWalletBalancesQueryKey,
  useGetWalletBalances,
  useLogout,
  useRealtimeResync,
  useRealtimeTopic,
  type BetsPage,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  resolveCatalog,
  type Category,
  type LobbyGame,
  type RegistryEntry,
} from "@/components/lobby/catalog";
import { B2CAuthDialog } from "@/components/b2c/B2CAuthDialog";
import { B2C_BRAND, B2C_HEADLINE, B2C_HOME, B2C_ICON, B2C_LOGO } from "@/components/b2c/config";
import { applyB2CBranding } from "@/components/b2c/branding";
import { ACCOUNT_OPTIONS } from "@/components/site/AccountOptions";
import { B2CSlider } from "@/components/b2c/B2CSlider";
import {
  B2C_AVATAR,
  B2C_BANNERS,
  B2C_GAME_ORDER,
  B2C_LOTTERY,
  b2cArtwork,
} from "@/components/b2c/artwork";
import { useAuth } from "@/lib/auth";
import { useSiteChannel } from "@/lib/siteChannel";
import { formatRupees } from "@/lib/format";
import { getLoginDestination } from "@/lib/loginDestination";
import { toast } from "sonner";
import "@/components/b2c/b2c.css";

const CATEGORIES: { id: Category; name: string; icon: typeof Rocket }[] = [
  { id: "crash", name: "Crash", icon: Rocket },
  { id: "lottery", name: "Lottery", icon: Ticket },
  { id: "racing", name: "Virtual Sports", icon: Flag },
  { id: "live", name: "Live Casino", icon: Play },
  { id: "instant", name: "Instant Games", icon: Zap },
  { id: "table", name: "Table Games", icon: Spade },
];
const TABLE_FILTERS = [
  { name: "All Casino", term: "", icon: Grid2X2 },
  { name: "Roulette", term: "roulette", icon: CircleUserRound },
  { name: "Teenpatti", term: "teen patti", icon: Spade },
  { name: "Baccarat", term: "baccarat", icon: Club },
  { name: "Dragon Tiger", term: "dragon tiger", icon: Crown },
  { name: "Andar Bahar", term: "andar bahar", icon: Club },
  { name: "Lucky 7", term: "lucky 7", icon: Dice5 },
  { name: "Blackjack", term: "blackjack", icon: Spade },
  { name: "Rummy", term: "rummy", icon: Spade },
  { name: "Wheel", term: "wheel", icon: CircleUserRound },
  { name: "Sports", term: "", category: "racing" as Category, icon: Flag },
  { name: "Lottery", term: "", category: "lottery" as Category, icon: Ticket },
  { name: "Others", term: "", category: "instant" as Category, icon: Grid2X2 },
];
const TRENDING = [
  "roulette",
  "teen-patti-live",
  "lucky-7-live",
  "crazy-time",
  "baccarat",
  "andar-bahar-live",
  "dragon-tiger-one-day",
];

function RegistryListener({ code }: { code: string }) {
  const qc = useQueryClient();
  useRealtimeTopic<{ type: string }>(`game-config:${code}`, (event) => {
    if (event.type === "updated")
      void qc.invalidateQueries({ queryKey: ["game.registry"] });
  });
  return null;
}
function GameTile({
  game,
  onPlay,
  duplicate = false,
}: {
  game: LobbyGame;
  onPlay: (game: LobbyGame) => void;
  duplicate?: boolean;
}) {
  const art = b2cArtwork(game.id);
  return (
    <button
      className={`b2c-game${!game.enabled ? " is-unavailable" : ""}`}
      disabled={!game.enabled}
      onClick={() => onPlay(game)}
      aria-label={`${game.enabled ? "Play" : "Unavailable:"} ${game.name}`}
      data-game-id={game.id}
      title={game.name}
      tabIndex={duplicate ? -1 : undefined}
    >
      {art ? (
        <svg
          className="b2c-game-art"
          viewBox={art.viewBox}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <image href={art.src} width={art.width} height={art.height} />
        </svg>
      ) : (
        <img
          className="b2c-game-art"
          src={game.id === "lottery" ? B2C_LOTTERY : game.artwork}
          alt=""
          loading="lazy"
        />
      )}
      <span className="b2c-game-hover">
        <Play fill="currentColor" size={28} />
        <span>{game.name}</span>
      </span>
      {!game.enabled && (
        <span className="b2c-game-unavailable">Unavailable</span>
      )}
    </button>
  );
}
export default function B2C({
  initialLogin = false,
}: {
  initialLogin?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const site = useSiteChannel();
  const canDemo = site.data?.channel === "b2c";
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [demoPending, setDemoPending] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [tableFilter, setTableFilter] = useState("");
  const [provider, setProvider] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [comfortable, setComfortable] = useState(false);
  const [authOpen, setAuthOpen] = useState(initialLogin);
  const [destination, setDestination] = useState(
    initialLogin ? getLoginDestination : () => B2C_HOME,
  );
  const catalogRef = useRef<HTMLElement>(null);
  const bannerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const browse = !!user;
  const registry = useQuery({
    queryKey: ["game.registry"],
    queryFn: () => customFetch<RegistryEntry[]>("/api/game/registry"),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const wallet = useGetWalletBalances({
    query: {
      queryKey: getGetWalletBalancesQueryKey(),
      enabled: !!user,
      retry: false,
      refetchInterval: 300_000,
    },
  });
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["game.registry"] });
    if (user)
      void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
  });
  useRealtimeTopic<{ type: string }>(
    user ? `wallet:${user.id}` : null,
    (event) => {
      if (event.type === "balance")
        void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
    },
  );
  const wins = useQuery({
    queryKey: ["b2c.recent-wins", user?.id],
    queryFn: () => customFetch<BetsPage>("/api/bets?limit=50"),
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
  });
  const recentWins = (wins.data?.entries ?? [])
    .filter((bet) => bet.status === "won")
    .slice(0, 8);
  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        disconnectRealtime();
        qc.clear();
        qc.setQueryData(getGetMeQueryKey(), null);
        clearFilters();
        navigate(B2C_HOME);
      },
      onError: () => toast.error("Could not sign out. Please try again."),
    },
  });
  const order = (id: string) => {
    const i = B2C_GAME_ORDER.indexOf(id);
    return i < 0 ? 100 : i;
  };
  const games = resolveCatalog(registry.data).sort(
    (a, b) => order(a.id) - order(b.id),
  );
  const providers = [...new Set(games.map((game) => game.provider))];
  const trending = TRENDING.flatMap((id) => {
    const game = games.find((g) => g.id === id);
    return game ? [game] : [];
  });
  const filtered = games.filter(
    (game) =>
      (category === "all" || game.category === category) &&
      (!provider || game.provider === provider) &&
      (!tableFilter || game.name.toLowerCase().includes(tableFilter)) &&
      (!query.trim() ||
        `${game.name} ${game.provider}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const filtering =
    category !== "all" || !!provider || !!tableFilter || !!query.trim();
  const balance = user?.isDemo ? "∞ Demo coins" : wallet.data
    ? `₹${formatRupees(wallet.data.balances.lunar ?? "0")}`
    : "—";
  const activeBanner = B2C_BANNERS[slide];
  useEffect(() => {
    if (browse || authOpen || settings || menu) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (reducedMotion.matches || document.hidden || bannerRef.current?.matches(":hover, :focus-within")) return;
      setSlide(current => (current + 1) % B2C_BANNERS.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [browse, authOpen, settings, menu]);
  useEffect(() => applyB2CBranding(), []);
  useEffect(() => {
    if (user) setAuthOpen(false);
  }, [user]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  function clearFilters() {
    setCategory("all");
    setTableFilter("");
    setProvider("");
    setQuery("");
  }
  function chooseCategory(next: Category) {
    clearFilters();
    setCategory(next);
    setMenu(false);
    catalogRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function openLogin(next = B2C_HOME) {
    setDestination(next);
    setAuthOpen(true);
  }
  function play(game: LobbyGame) {
    if (!game.enabled) return;
    if (user) navigate(game.route);
    else openLogin(game.route);
  }
  function account(route: string) {
    if (user) navigate(route);
    else openLogin(route);
  }
  async function startDemo() {
    if (!canDemo) return;
    if (demoPending || isLoading) return;
    setDemoPending(true);
    try {
      await customFetch("/api/auth/demo-login", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      // Reload clears game stores, cached balances and old realtime connections.
      window.location.assign(authOpen ? destination : B2C_HOME);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start demo. Please retry.");
      setDemoPending(false);
    }
  }
  const tiles = (items: LobbyGame[]) =>
    items.map((game) => <GameTile key={game.id} game={game} onPlay={play} />);
  const settingsButton = (
    <button
      className="b2c-settings"
      aria-label="Website settings"
      onClick={() => setSettings(true)}
    >
      <Settings size={25} fill="currentColor" strokeWidth={1.5} />
    </button>
  );
  const brandIntro = (
    <div className="b2c-intro">
      <img src={B2C_ICON} width={48} height={48} alt="" />
      <div>
        <p className="b2c-intro-kicker">Live Casino · Crash · Instant</p>
        <h1>{B2C_HEADLINE}</h1>
      </div>
    </div>
  );
  const sidebar = (
    <div className="b2c-provider-grid">
      <button
        className={!provider && category === "all" ? "is-active" : ""}
        onClick={() => chooseCategory("all")}
      >
        <Crown />
        <span>OUR CASINO</span>
      </button>
      <button
        className={category === "racing" ? "is-active" : ""}
        onClick={() => chooseCategory("racing")}
      >
        <Flag />
        <span>OUR VIRTUAL</span>
      </button>
      {providers.map((name, i) => (
        <button
          key={name}
          className={provider === name ? "is-active" : ""}
          onClick={() => {
            clearFilters();
            setProvider(name);
            setMenu(false);
          }}
        >
          {i === 0 ? <Spade /> : i === 1 ? <Gamepad2 /> : <Rocket />}
          <span>{name.toUpperCase()}</span>
        </button>
      ))}
      {CATEGORIES.filter((item) => item.id !== "racing").map((item) => (
        <button
          key={item.id}
          className={category === item.id ? "is-active" : ""}
          onClick={() => chooseCategory(item.id)}
        >
          <item.icon />
          <span>{item.name.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div
      className={`b2c-site${browse ? " b2c-browsing" : ""}${comfortable ? " b2c-comfortable" : ""}`}
    >
      <a className="b2c-skip" href="#b2c-games">
        Skip to games
      </a>
      {user &&
        [...new Set((registry.data ?? []).map((entry) => entry.gameCode))].map(
          (code) => <RegistryListener key={code} code={code} />,
        )}
      {browse && (
        <div className="b2c-topbar">
          <nav aria-label="Browse games">
            {CATEGORIES.map((item) => (
              <button
                key={item.id}
                className={category === item.id ? "is-active" : ""}
                onClick={() => chooseCategory(item.id)}
              >
                {item.id === "crash" && <Rocket size={21} />}
                {item.name}
              </button>
            ))}
          </nav>
          {settingsButton}
        </div>
      )}
      <header className="b2c-header">
        <div className="b2c-brand-wrap">
          {browse && (
            <button
              className="b2c-menu-button"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
          )}
          <Link
            href={B2C_HOME}
            className="b2c-brand"
            aria-label={`${B2C_BRAND} home`}
            onClick={() => {
              clearFilters();
            }}
          >
            <img
              src={B2C_LOGO}
              alt={B2C_BRAND}
              width={1000}
              height={216}
              className="b2c-brand-logo"
              fetchPriority="high"
            />
          </Link>
        </div>
        {browse && (
          <div className="b2c-header-ticker">
            {brandIntro}
            <span className="b2c-notice">
              {user?.isDemo
                ? "Demo play · Unlimited coins · No withdrawals"
                : "Welcome to your casino. Discover your favourite games."}
              <Megaphone size={30} />
            </span>
          </div>
        )}
        <div className="b2c-header-actions">
          {!browse && settingsButton}
          {user ? (
            <>
              <button
                className="b2c-wallet"
                onClick={() => navigate("/wallet")}
                aria-label={`Wallet balance ${balance}`}
              >
                <Wallet />
                <span>
                  <small>Balance</small>
                  <strong>{balance}</strong>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="b2c-account">
                    <CircleUserRound />
                    <span>{user.displayName || "My account"}</span>
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="b2c-dropdown" align="end">
                  <DropdownMenuItem disabled={user.isDemo} onSelect={() => navigate("/profile")}>
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/wallet")}>
                    Wallet
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {ACCOUNT_OPTIONS.map(({ href, label, icon: Icon }) => <DropdownMenuItem key={href} disabled={user.isDemo && href.startsWith("/settings/")} onSelect={() => navigate(href)}><Icon size={16} />{label}</DropdownMenuItem>)}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={logout.isPending}
                    onSelect={() => logout.mutate(undefined)}
                  >
                    <LogOut size={15} />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <button
                className="b2c-button"
                disabled={isLoading}
                onClick={() => openLogin()}
              >
                Login
              </button>
              {canDemo && <button
                className="b2c-button"
                disabled={demoPending || isLoading}
                onClick={startDemo}
              >
                {demoPending ? "Starting…" : "Demo"}
              </button>}
            </>
          )}
        </div>
      </header>
      {!browse && brandIntro}
      <div className="b2c-layout">
        {browse && (
          <aside className="b2c-sidebar" aria-label="Game providers">
            {sidebar}
          </aside>
        )}
        <main className="b2c-main">
          {!browse && (
            <>
              <section
                className="b2c-hero"
                ref={bannerRef}
                aria-label="Featured games"
                aria-roledescription="carousel"
              >
                <img
                  src={activeBanner.src}
                  alt={activeBanner.alt}
                  style={{ objectPosition: activeBanner.position }}
                  fetchPriority="high"
                />
                <button
                  className="b2c-banner-prev"
                  aria-label="Previous banner"
                  onClick={() =>
                    setSlide(
                      (slide + B2C_BANNERS.length - 1) % B2C_BANNERS.length,
                    )
                  }
                >
                  <ChevronLeft />
                </button>
                <button
                  className="b2c-banner-next"
                  aria-label="Next banner"
                  onClick={() => setSlide((slide + 1) % B2C_BANNERS.length)}
                >
                  <ChevronRight />
                </button>
              </section>
              <section className="b2c-trending">
                <h2 className="b2c-section-title">NOW TRENDING</h2>
                <B2CSlider
                  items={trending}
                  label="Now trending"
                  variant="trending"
                  paused={authOpen || settings || menu}
                  renderItem={(game, _index, duplicate) => (
                    <GameTile game={game} onPlay={play} duplicate={duplicate} />
                  )}
                />
              </section>
            </>
          )}
          <section
            id="b2c-games"
            className="b2c-catalog"
            ref={catalogRef}
            aria-label="Game catalog"
          >
            {browse ? (
              <>
                <div className="b2c-category-bar">
                  <nav aria-label="Casino game types">
                    {TABLE_FILTERS.map((item) => (
                      <button
                        key={item.name}
                        className={
                          tableFilter === item.term &&
                          category === (item.category ?? "all")
                            ? "is-active"
                            : ""
                        }
                        onClick={() => {
                          clearFilters();
                          setTableFilter(item.term);
                          setCategory(item.category ?? "all");
                        }}
                      >
                        <item.icon size={21} />
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </nav>
                  <button
                    className="b2c-search-toggle"
                    aria-label="Search games"
                    aria-expanded={searchOpen}
                    onClick={() => setSearchOpen(!searchOpen)}
                  >
                    {searchOpen ? <X /> : <Search />}
                  </button>
                </div>
                {searchOpen && (
                  <div className="b2c-search">
                    <Search size={19} />
                    <input
                      ref={searchRef}
                      type="search"
                      aria-label="Search games"
                      placeholder="Search games..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
                {filtering && (
                  <div className="b2c-filter-summary">
                    <span>
                      {filtered.length} games{provider ? ` · ${provider}` : ""}
                    </span>
                    <button onClick={clearFilters}>
                      Clear filters <X size={14} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <h2 className="b2c-section-title">OUR LIVE CASINO</h2>
            )}
            {registry.isError && (
              <div className="b2c-status" role="status">
                Game availability could not be refreshed.
                <button onClick={() => void registry.refetch()}>Retry</button>
              </div>
            )}
            {filtered.length ? (
              <div className="b2c-game-grid">{tiles(filtered)}</div>
            ) : (
              <div className="b2c-empty">
                <Search size={30} />
                <h3>No games found</h3>
                <p>Try another name, provider or category.</p>
                <button className="b2c-button" onClick={clearFilters}>
                  Show all games
                </button>
              </div>
            )}
          </section>
          <section className="b2c-winners">
            <h2 className="b2c-section-title">TOP WINNERS</h2>
            <B2CSlider
              label="Top winners"
              variant="winners"
              paused={authOpen || settings || menu}
              items={
                recentWins.length
                  ? recentWins
                  : Array.from({ length: 9 }, () => null)
              }
              renderItem={(bet, index) => (
                <article
                  className="b2c-winner"
                  key={bet?.id ?? index}
                  aria-label={bet ? "Your winning round" : "Winner placeholder"}
                >
                  <img src={B2C_AVATAR} alt="" loading="lazy" />
                  <dl>
                    <div>
                      <dt>Player</dt>
                      <dd>
                        {bet
                          ? `${(user?.displayName || "Player").slice(0, 2)}****`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>
                        {bet ? (
                          <time dateTime={bet.settledAt ?? bet.placedAt}>
                            {new Date(bet.settledAt ?? bet.placedAt)
                              .toLocaleString("en-GB", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                              .replace(",", "")}
                          </time>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Win Amount</dt>
                      <dd>{bet ? formatRupees(bet.payoutAmount) : "—"}</dd>
                    </div>
                  </dl>
                </article>
              )}
            />
            <p className="b2c-winners-note">
              {user
                ? wins.isError
                  ? "Results are temporarily unavailable."
                  : recentWins.length
                    ? "Your latest settled wins"
                    : "Your settled winning rounds will appear here."
                : "Sign in to see your winning rounds."}
              <button
                onClick={() =>
                  wins.isError ? void wins.refetch() : account("/history")
                }
              >
                {wins.isError ? "Retry" : user ? "View history" : "Login"}
              </button>
            </p>
          </section>
        </main>
      </div>
      <button className="b2c-support-strip" onClick={() => account("/help")}>
        Support
      </button>
      <footer className="b2c-footer">
        <div className="b2c-footer-main">
          <div className="b2c-security">
            <ShieldCheck />
            <div>
              <strong>SECURE ACCOUNT</strong>
              <span>Protected access to your account and games</span>
            </div>
          </div>
          <div className="b2c-footer-badges">
            <span className="b2c-age">18+</span>
            <button aria-label="Help centre" onClick={() => account("/help")}>
              <Headphones size={18} />
            </button>
            <button
              aria-label="Game history"
              onClick={() => account("/history")}
            >
              <Trophy size={18} />
            </button>
          </div>
        </div>
        <p>© Copyright {new Date().getFullYear()}. All Rights Reserved.</p>
      </footer>
      <B2CAuthDialog
        open={authOpen && !user}
        onOpenChange={(value) => {
          setAuthOpen(value);
          if (!value && initialLogin) navigate(B2C_HOME);
        }}
        destination={destination}
        onBrowse={startDemo}
        demoPending={demoPending}
      />
      <Dialog open={menu} onOpenChange={setMenu}>
        <DialogContent className="b2c-modal b2c-menu-modal">
          <DialogTitle>Game providers</DialogTitle>
          <DialogDescription>Choose games and providers.</DialogDescription>
          {sidebar}
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="b2c-modal b2c-settings-modal">
          <DialogTitle>Website settings</DialogTitle>
          <DialogDescription>
            Choose how games appear in your lobby.
          </DialogDescription>
          <label className="b2c-setting-row">
            <span>Larger game tiles</span>
            <input
              type="checkbox"
              checked={comfortable}
              onChange={(event) => setComfortable(event.target.checked)}
            />
          </label>
        </DialogContent>
      </Dialog>
    </div>
  );
}
