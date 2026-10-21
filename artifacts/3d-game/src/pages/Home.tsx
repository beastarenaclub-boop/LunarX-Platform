import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronRight,
  CircleHelp,
  CircleUserRound,
  Club,
  Flag,
  Gamepad2,
  Gift,
  Grid2X2,
  History,
  LogOut,
  Menu,
  Plane,
  Play,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Star,
  Ticket,
  Wallet,
  X,
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
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useSiteChannel } from "@/lib/siteChannel";
import { useMasterWebsite } from "@/lib/masterWebsite";
import { formatRupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  resolveCatalog,
  type Category,
  type LobbyGame,
  type RegistryEntry,
} from "@/components/lobby/catalog";
import { PhotoBannerSlider } from "@/components/lobby/PhotoBannerSlider";
import { MobileNavigation } from "@/components/site/MobileNavigation";
import "@/components/lobby/lobby.css";
import "@/components/lobby/new-game.css";

const CATEGORIES: { id: Category; name: string; icon: typeof Rocket }[] = [
  { id: "all", name: "All Games", icon: Grid2X2 },
  { id: "instant", name: "Instant Games", icon: Rocket },
  { id: "crash", name: "Crash Games", icon: Plane },
  { id: "live", name: "Live Casino", icon: Play },
  { id: "table", name: "Live Table", icon: Club },
  { id: "racing", name: "Virtual Sport", icon: Flag },
  { id: "lottery", name: "Lottery", icon: Ticket },
];
const ACCOUNT_LINKS = [
  { name: "Wallet", href: "/wallet", icon: Wallet, id: "wallet" },
  { name: "Bet history", href: "/history", icon: History, id: "history" },
  {
    name: "Profile & KYC",
    href: "/profile",
    icon: CircleUserRound,
    id: "profile",
  },
  { name: "Promotions", href: "/promotions", icon: Gift, id: "promotions" },
  { name: "Help & support", href: "/help", icon: CircleHelp, id: "help" },
];

function RegistryListener({ code }: { code: string }) {
  const qc = useQueryClient();
  useRealtimeTopic<{ type: string }>(`game-config:${code}`, (event) => {
    if (event?.type === "updated")
      void qc.invalidateQueries({ queryKey: ["game.registry"] });
  });
  return null;
}

function useLobbyWallet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const balances = useGetWalletBalances({
    query: {
      queryKey: getGetWalletBalancesQueryKey(),
      enabled: !!user,
      refetchInterval: 300_000,
      retry: false,
    },
  });
  const refresh = () => {
    if (user)
      void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
  };
  useRealtimeTopic<{ type: string }>(
    user ? `wallet:${user.id}` : null,
    (event) => {
      if (event?.type === "balance") refresh();
    },
  );
  useRealtimeResync(refresh);
  // Compatibility balance aliases represent one wallet and must never be added.
  return balances.data
    ? `₹${formatRupees(balances.data.balances.lunar ?? "0")}`
    : balances.isError
      ? "Unavailable"
      : "…";
}

function GameCard({
  game,
  saved,
  onSave,
  eager,
}: {
  game: LobbyGame;
  saved: boolean;
  onSave: () => void;
  eager?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const isNew = game.enabled && game.label === "NEW";
  const content = (
    <>
      <div className="lobby-game-art">
        {game.artwork && !imageFailed && (
          <img
            src={game.artwork}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        )}
        {(!game.artwork || imageFailed) && (
          <Gamepad2 className="lobby-art-fallback" />
        )}
        {(!game.artworkHasTitle || imageFailed) && (
          <div className="lobby-game-lettering">
            <span>
              {game.provider === "Lunar Originals"
                ? "LUNAR ORIGINALS"
                : game.provider}
            </span>
            <strong>{game.name}</strong>
          </div>
        )}
        {game.label && game.enabled && !isNew && (
          <span
            className={cn(
              "lobby-game-badge",
              game.label === "LIVE" && "is-live",
            )}
          >
            {game.label === "LIVE" && <i />}
            {game.label}
          </span>
        )}
        {game.enabled ? (
          <span className="lobby-play-overlay">
            <span>
              <Play fill="currentColor" size={21} />
            </span>
          </span>
        ) : (
          <span className="lobby-unavailable">Unavailable</span>
        )}
      </div>
      <div className="lobby-game-caption">
        <span>{game.name}</span>
      </div>
      {isNew && <span className="game-new-badge">NEW</span>}
    </>
  );
  const titleScale = Math.min(
    game.name.split(" ").length > 3 ? 15 : 17,
    112 / Math.max(...game.name.split(" ").map((word) => word.length)),
  );
  return (
    <article
      className={cn(
        "lobby-game",
        isNew && "new-game-card",
        !game.enabled && "is-unavailable",
      )}
      style={
        {
          "--game-accent": game.accent,
          "--title-scale": `${titleScale}cqw`,
        } as CSSProperties
      }
      data-game-id={game.id}
    >
      {game.enabled ? (
        <Link
          href={game.route}
          aria-label={`Play ${game.name}`}
          aria-description={isNew ? "New game" : undefined}
          title={game.name}
          data-testid={`card-game-${game.id}`}
        >
          {content}
        </Link>
      ) : (
        <div
          aria-label={`${game.name} is currently unavailable`}
          aria-disabled="true"
          data-testid={`card-game-${game.id}`}
        >
          {content}
        </div>
      )}
      <button
        type="button"
        className={cn("lobby-save", saved && "is-saved")}
        aria-label={`${saved ? "Remove" : "Save"} ${game.name}${saved ? " from" : " to"} favourites`}
        aria-pressed={saved}
        onClick={onSave}
      >
        <Star size={13} fill={saved ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

function FavouritePanel({
  games,
  favourites,
  onRemove,
  onBrowse,
}: {
  games: LobbyGame[];
  favourites: string[];
  onRemove: (id: string) => void;
  onBrowse: () => void;
}) {
  const saved = games.filter((game) => favourites.includes(game.id));
  if (!saved.length)
    return (
      <div className="lobby-panel-empty">
        <Star size={39} strokeWidth={1.4} />
        <h3>Your favourites live here</h3>
        <p>Tap the star on a game to keep it close.</p>
        <button className="lobby-text-button" onClick={onBrowse}>
          Explore games <ArrowRight size={14} />
        </button>
      </div>
    );
  return (
    <div className="lobby-saved-list">
      {saved.map((game) => (
        <div className="lobby-saved-item" key={game.id}>
          {game.artwork && <img src={game.artwork} alt="" />}
          <div>
            {game.enabled ? (
              <Link href={game.route}>
                {game.name}
                <ChevronRight size={13} />
              </Link>
            ) : (
              <span>{game.name}</span>
            )}
            <small>
              {game.enabled ? game.provider : "Currently unavailable"}
            </small>
          </div>
          <button
            className="lobby-icon-button"
            aria-label={`Remove ${game.name} from favourites`}
            onClick={() => onRemove(game.id)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const site = useSiteChannel();
  const masterWebsite = useMasterWebsite();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const balance = useLobbyWallet();
  const [category, setCategory] = useState<Category>("all");
  const [provider, setProvider] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [panel, setPanel] = useState<"betslip" | "favourites">("betslip");
  const [allProviders, setAllProviders] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const favouriteKey = `lunar:lobby:favourites:${user?.id ?? "guest"}`;
  const [savedState, setSavedState] = useState<{ key: string; ids: string[] }>({
    key: "",
    ids: [],
  });
  const favourites = savedState.key === favouriteKey ? savedState.ids : [];
  const registry = useQuery({
    queryKey: ["game.registry"],
    queryFn: () => customFetch<RegistryEntry[]>("/api/game/registry"),
    staleTime: 60_000,
    retry: false,
  });
  const games = resolveCatalog(registry.data);
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["game.registry"] });
  });
  const logout = useLogout({
    mutation: {
      onSuccess: async () => {
        disconnectRealtime();
        qc.setQueryData(getGetMeQueryKey(), null);
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate("/login");
      },
      onError: () => toast.error("Could not sign out. Please try again."),
    },
  });

  useEffect(() => {
    document.title = `${masterWebsite?.name ?? 'Lunar'} — Instant Games & Live Casino`;
  }, [masterWebsite?.name]);
  useEffect(() => {
    const read = () => {
      let ids: string[] = [];
      try {
        const stored: unknown = JSON.parse(
          localStorage.getItem(favouriteKey) ?? "[]",
        );
        if (Array.isArray(stored))
          ids = [
            ...new Set(
              stored.filter((id): id is string => typeof id === "string"),
            ),
          ];
      } catch {
        /* Storage is optional. */
      }
      setSavedState({ key: favouriteKey, ids });
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === favouriteKey || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [favouriteKey]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("favourites") === "1") setSavedOpen(true);
  }, []);

  const toggleFavourite = (id: string) => {
    const ids = favourites.includes(id)
      ? favourites.filter((value) => value !== id)
      : [...favourites, id];
    setSavedState({ key: favouriteKey, ids });
    try {
      localStorage.setItem(favouriteKey, JSON.stringify(ids));
    } catch {
      /* Keep working in memory. */
    }
  };
  const scrollToGames = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const chooseCategory = (next: Category) => {
    setCategory(next);
    setProvider(null);
    setQuery("");
    setShowAll(next !== "all");
    setMenuOpen(false);
    scrollToGames();
  };
  const resetFilters = () => {
    setCategory("all");
    setProvider(null);
    setQuery("");
    setShowAll(false);
  };
  const search = query.trim().toLocaleLowerCase();
  const filtered = games.filter(
    (game) =>
      (category === "all" || game.category === category || (category === "instant" && game.tags?.includes("instant"))) &&
      (!provider || game.provider === provider) &&
      (!search ||
        `${game.name} ${game.provider}`.toLocaleLowerCase().includes(search)),
  );
  const filtering = category !== "all" || !!provider || !!search;
  const visibleGames = filtering || showAll ? filtered : filtered.slice(0, 20);
  const remainingGames = filtering || showAll ? [] : filtered.slice(20);
  const providers = [...new Set(games.map((game) => game.provider))];
  const heading = search
    ? `Search results for “${query.trim()}”`
    : provider
      ? provider
      : category !== "all"
        ? (CATEGORIES.find((item) => item.id === category)?.name ??
          "Quick Play")
        : showAll
          ? "All Games"
          : "TOP Games";
  const browseFromPanel = () => {
    setSavedOpen(false);
    resetFilters();
    scrollToGames();
  };
  const renderCards = (items: LobbyGame[]) =>
    items.map((game, index) => (
      <GameCard
        key={game.id}
        game={game}
        saved={favourites.includes(game.id)}
        onSave={() => toggleFavourite(game.id)}
        eager={index < 10}
      />
    ));

  return (
    <div className="casino-lobby">
      {user && [...new Set((registry.data ?? []).map((entry) => entry.gameCode))].map(
        (code) => (
          <RegistryListener key={code} code={code} />
        ),
      )}
      <a href="#lobby-games" className="lobby-skip-link">
        Skip to games
      </a>
      <header className="lobby-header">
        <div className="lobby-brand-group">
          <button
            className="lobby-icon-button"
            aria-label="Open menu"
            data-testid="btn-menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <Link
            href="/"
            className="lobby-brand"
            aria-label={masterWebsite ? `${masterWebsite.name} home` : "Lunar home"}
            data-testid="link-home"
            onClick={resetFilters}
          >
            {masterWebsite?.logoUrl ? <img src={masterWebsite.logoUrl} alt={masterWebsite.name} style={{maxWidth:160,maxHeight:44,objectFit:'contain'}}/> : masterWebsite ? <span className="max-w-[160px] truncate" title={masterWebsite.name}>{masterWebsite.name}</span> : <>LUNAR<span>PLAY</span></>}
          </Link>
        </div>
        <nav className="lobby-primary-nav" aria-label="Game categories">
          <Link href="/promotions" className="lobby-nav-item">
            <Gift size={17} />
            <span>Promotions</span>
          </Link>
          {CATEGORIES.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              onClick={() => chooseCategory(id)}
              className={cn(
                "lobby-nav-item",
                (id === "live" || id === "table") && "is-highlighted",
                category === id && "is-active",
              )}
              aria-pressed={category === id}
              data-testid={`btn-category-${id}`}
            >
              <Icon size={17} />
              <span>{name}</span>
              {(id === "live" || id === "table") && (
                <span className="lobby-nav-badge" aria-hidden="true">
                  <i /> LIVE
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="lobby-header-actions">
          <button
            className={cn("lobby-icon-button lobby-search-toggle", searchOpen && "is-active")}
            aria-label={searchOpen ? "Close search" : "Search games"}
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen) setQuery("");
              else scrollToGames();
            }}
          >
            <Search size={19} />
          </button>
          {user ? (
            <>
              <Link
                href="/wallet"
                className="lobby-balance"
                aria-label={`Wallet balance ${balance}`}
                data-testid="text-total-balance"
              >
                <Wallet size={16} />
                <span>{balance}</span>
              </Link>
              <Link
                href="/wallet"
                className="lobby-button lobby-button-primary lobby-deposit"
                data-testid="btn-deposit"
                aria-label="Deposit funds"
              >
                <Plus size={16} />
                <span>Deposit</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="lobby-icon-button lobby-account-button"
                    aria-label="Account"
                    data-testid="btn-user-menu"
                  >
                    <CircleUserRound size={21} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="lobby-account-dropdown"
                >
                  <DropdownMenuLabel>
                    {user.displayName || user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ACCOUNT_LINKS.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} data-testid={`menu-${item.id}`}>
                        <item.icon size={15} />
                        {item.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={logout.isPending}
                    onClick={() => logout.mutate(undefined)}
                    data-testid="menu-logout"
                  >
                    <LogOut size={15} />
                    {logout.isPending ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link href="/login" className="lobby-button">
                Log in
              </Link>
              {site.data?.signupEnabled && <Link href="/signup" className="lobby-button lobby-button-primary">
                Sign up
              </Link>}
            </>
          )}
        </div>
      </header>

      <div className="lobby-layout">
        <main className="lobby-main" id="lobby-main">
          <section
            className="lobby-section lobby-catalog"
            id="lobby-games"
            ref={topRef}
            data-testid="section-hot"
            aria-labelledby="lobby-games-heading"
          >
            <div className="lobby-section-heading">
              <h1 id="lobby-games-heading">
                {heading}
                {filtering && (
                  <span className="lobby-count">{filtered.length}</span>
                )}
              </h1>
              <button
                className="lobby-text-button"
                onClick={() => {
                  if (filtering) resetFilters();
                  else setShowAll(!showAll);
                }}
                aria-label={
                  filtering
                    ? "Clear all filters"
                    : showAll
                      ? "Show top games"
                      : "Show all games"
                }
              >
                {filtering ? "Clear filters" : showAll ? "Top games" : "All"}
                <ChevronRight size={17} />
              </button>
            </div>
              <div className={cn("lobby-search", !searchOpen && "lobby-search-collapsed")}>
                <Search size={19} />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search games or providers"
                  aria-label="Search games or providers"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchOpen(false);
                      setQuery("");
                    }
                  }}
                />
                <button
                  className="lobby-icon-button"
                  hidden={!query && !searchOpen}
                  aria-label="Clear and close search"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            {registry.isError && (
              <div className="lobby-status" role="status">
                Live game availability could not be refreshed.
                <button onClick={() => void registry.refetch()}>Retry</button>
              </div>
            )}
            {visibleGames.length ? (
              <div className="lobby-game-grid" aria-label="Games">
                {renderCards(visibleGames)}
              </div>
            ) : (
              <div className="lobby-no-results" role="status">
                <Search size={32} />
                <h2>No games found</h2>
                <p>Try another name, category or provider.</p>
                <button
                  className="lobby-button lobby-button-primary"
                  onClick={resetFilters}
                >
                  Show all games
                </button>
              </div>
            )}
          </section>

          <section
            className="lobby-section"
            aria-labelledby="lobby-events-heading"
          >
            <div className="lobby-section-heading">
              <h2 id="lobby-events-heading">Events</h2>
              <Link href="/promotions" className="lobby-text-button">
                View promotions
                <ChevronRight size={17} />
              </Link>
            </div>
            <PhotoBannerSlider games={games} />
          </section>

          <section
            className="lobby-section"
            aria-labelledby="lobby-providers-heading"
          >
            <div className="lobby-section-heading">
              <h2 id="lobby-providers-heading">Popular Providers</h2>
              <button
                className="lobby-text-button"
                onClick={() => setAllProviders(!allProviders)}
                aria-expanded={allProviders}
              >
                {allProviders ? "Less" : "All"}
                <ChevronRight size={17} />
              </button>
            </div>
            <div
              className={cn(
                "lobby-provider-list",
                allProviders && "is-expanded",
              )}
            >
              {providers.map((name, index) => (
                <button
                  key={name}
                  className={cn(
                    "lobby-provider",
                    provider === name && "is-active",
                  )}
                  aria-pressed={provider === name}
                  onClick={() => {
                    setProvider(provider === name ? null : name);
                    setCategory("all");
                    setQuery("");
                    setShowAll(true);
                    scrollToGames();
                  }}
                >
                  <span
                    className={`lobby-provider-symbol provider-colour-${index % 5}`}
                  >
                    {name === "Lunar Originals" ? (
                      <Rocket size={22} />
                    ) : name === "SmartSoft" ? (
                      "S"
                    ) : name.startsWith("Spribe") ? (
                      "SPR"
                    ) : (
                      name.charAt(0)
                    )}
                  </span>
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </section>

          {remainingGames.length > 0 && (
            <section
              className="lobby-section"
              aria-labelledby="lobby-more-heading"
            >
              <div className="lobby-section-heading">
                <h2 id="lobby-more-heading">
                  More to Explore
                  <span className="lobby-count">{remainingGames.length}</span>
                </h2>
                <button
                  className="lobby-text-button"
                  onClick={() => {
                    setShowAll(true);
                    scrollToGames();
                  }}
                >
                  All games
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="lobby-game-grid">
                {renderCards(remainingGames)}
              </div>
            </section>
          )}

          <div className="lobby-service-strip">
            <div>
              <ShieldCheck size={23} />
              <span>
                <strong>One account. Every game.</strong>
                <small>Your shared wallet stays with you.</small>
              </span>
            </div>
            <div className="lobby-wallet-actions">
              <Link
                href="/wallet"
                className="lobby-button lobby-button-primary"
                data-testid="btn-action-deposit"
              >
                <Plus size={15} />
                Deposit
              </Link>
              <Link
                href="/wallet?tab=withdraw"
                className="lobby-button"
                data-testid="btn-action-withdraw"
              >
                <ArrowDownToLine size={15} />
                Withdraw
              </Link>
            </div>
          </div>
          <footer className="lobby-footer">
            <div>
              <Link href="/" className="lobby-brand" onClick={resetFilters}>
                {masterWebsite?.name ?? <>LUNAR<span>PLAY</span></>}
              </Link>
              <p>Make time for a little extraordinary.</p>
            </div>
            <nav aria-label="Support">
              <Link href="/help">Help & support</Link>
              <Link href="/history">Bet history</Link>
              <Link href="/promotions">Promotions</Link>
            </nav>
            <span className="lobby-age">18+</span>
          </footer>
        </main>

        <aside
          className="lobby-right-panel"
          aria-label="Betslip and favourites"
        >
          <div
            className="lobby-panel-tabs"
            role="tablist"
            aria-label="Player panel"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "betslip"
                  : event.key === "End"
                    ? "favourites"
                    : panel === "betslip"
                      ? "favourites"
                      : "betslip";
              setPanel(next);
              document.getElementById(`${next}-tab`)?.focus();
            }}
          >
            <button
              role="tab"
              id="betslip-tab"
              aria-controls="betslip-panel"
              aria-selected={panel === "betslip"}
              tabIndex={panel === "betslip" ? 0 : -1}
              onClick={() => setPanel("betslip")}
            >
              Betslip
            </button>
            <button
              role="tab"
              id="favourites-tab"
              aria-controls="favourites-panel"
              aria-selected={panel === "favourites"}
              tabIndex={panel === "favourites" ? 0 : -1}
              onClick={() => setPanel("favourites")}
            >
              <Star size={15} />
              Favourites
              {favourites.length > 0 && <span>{favourites.length}</span>}
            </button>
          </div>
          {panel === "betslip" ? (
            <div
              role="tabpanel"
              id="betslip-panel"
              aria-labelledby="betslip-tab"
            >
              <div className="lobby-panel-empty">
                <Ticket size={43} strokeWidth={1.7} />
                <h3>Your betslip is empty</h3>
                <p>
                  Choose a game to place your bets.
                  <br />
                  Bets are managed inside each game.
                </p>
                <Link href="/history" className="lobby-text-button">
                  View bet history
                  <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          ) : (
            <div
              role="tabpanel"
              id="favourites-panel"
              aria-labelledby="favourites-tab"
            >
              <FavouritePanel
                games={games}
                favourites={favourites}
                onRemove={toggleFavourite}
                onBrowse={browseFromPanel}
              />
            </div>
          )}
          <div className="lobby-panel-bottom">
            <ShieldCheck size={15} />
            <span>Play at your pace.</span>
            <Link href="/help">Get support</Link>
          </div>
        </aside>
      </div>

      <MobileNavigation onGames={() => { resetFilters(); scrollToGames(); }} onFavourites={() => setSavedOpen(true)} />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="lobby-drawer">
          <SheetTitle className="lobby-drawer-title">{masterWebsite?.name ?? 'LUNAR PLAY'}</SheetTitle>
          <SheetDescription>Find your next favourite game.</SheetDescription>
          <nav aria-label="Browse games" className="lobby-drawer-links">
            {CATEGORIES.map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                className={cn(
                  (id === "live" || id === "table") && "is-highlighted",
                  category === id && "is-active",
                )}
                onClick={() => chooseCategory(id)}
              >
                <Icon size={19} />
                {name}
                <ChevronRight size={15} />
              </button>
            ))}
            <div className="lobby-drawer-divider" />
            <Link href="/b2c" onClick={() => setMenuOpen(false)}>
              <Grid2X2 size={19} />
              B2C Website
              <ChevronRight size={15} />
            </Link>
            {ACCOUNT_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
              >
                <item.icon size={19} />
                {item.name}
                <ChevronRight size={15} />
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      <Sheet open={savedOpen} onOpenChange={setSavedOpen}>
        <SheetContent side="right" className="lobby-drawer">
          <SheetTitle className="lobby-drawer-title">
            Your favourites
          </SheetTitle>
          <SheetDescription>Your collection, ready to play.</SheetDescription>
          <FavouritePanel
            games={games}
            favourites={favourites}
            onRemove={toggleFavourite}
            onBrowse={browseFromPanel}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
