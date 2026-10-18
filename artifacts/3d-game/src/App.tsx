import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
import { lazy, Suspense, useEffect, useLayoutEffect, type ReactNode } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Forgot from "@/pages/Forgot";
import Reset from "@/pages/Reset";
import Profile from "@/pages/Profile";
import WalletPage from "@/pages/Wallet";
import History from "@/pages/History";
import Promotions from "@/pages/Promotions";
import VerifyPage from "@/pages/Verify";
import Help from "@/pages/Help";
import NotFound from "@/pages/not-found";
import { useStore } from "@/game/store";
import { initEngine, setActiveCrashGame, setMusicRouteAllowed } from "@/game/engine";
import { AuthProvider, useAuth } from "@/lib/auth";
import { getLoginDestination } from "@/lib/loginDestination";
import { setQueryClient } from "@/game/serverBridge";
import RealtimeBridge from "@/components/lunar/RealtimeBridge";
import SharedWalletBridge from "@/components/SharedWalletBridge";
import GameViewport from "@/components/GameViewport";
import "@/components/site/site.css";
import LoadingScreen from "@/components/game/LoadingScreen";
import { CRASH_THEMES } from "@/game/crashThemes";
import { setAudioGame, unlockAudio } from "@/game/audio";
import { audioGameForRoute } from "@/game/gameSoundDesign";
import { installAudioAutostart } from "@/game/audioAutostart";
import { B2C_STANDALONE } from "@/components/b2c/config";
import { DemoSessionBanner, DemoWallet } from "@/components/b2c/DemoSession";

const B2C = lazy(() => import("@/pages/B2C"));
const Launcher = lazy(() => import("@/pages/Launcher"));
const Lunar = lazy(() => import("@/pages/Lunar"));
const Mines = lazy(() => import("@/pages/Mines"));
const Plinko = lazy(() => import("@/pages/Plinko"));
const Dice = lazy(() => import("@/pages/Dice"));
const Roulette = lazy(() => import("@/pages/Roulette"));
const Baccarat = lazy(() => import("@/pages/Baccarat"));
const TeenPatti = lazy(() => import("@/pages/TeenPatti"));
const TeenPattiLive = lazy(() => import("@/pages/TeenPattiLive"));
const Blackjack = lazy(() => import("@/pages/Blackjack"));
const AndarBahar = lazy(() => import("@/pages/AndarBahar"));
const Lucky7 = lazy(() => import("@/pages/Lucky7"));
const VegetableBowl = lazy(() => import("@/pages/VegetableBowl"));
const HorseRacing = lazy(() => import("@/pages/HorseRacing"));
const BikeRacing = lazy(() => import("@/pages/BikeRacing"));
const Rummy = lazy(() => import("@/pages/Rummy"));
const DragonTiger = lazy(() => import("@/pages/DragonTiger"));
const WinGo = lazy(() => import("@/pages/WinGo"));
const ForexTrading = lazy(() => import("@/pages/ForexTrading"));
const Lottery = lazy(() => import("@/pages/Lottery"));
const PrizeLotto = lazy(() => import("@/pages/PrizeLotto"));
const CrazyTime = lazy(() => import("@/pages/CrazyTime"));
const DragonTigerOneDay = lazy(() => import("@/pages/DragonTigerOneDay"));
const InstantCollection = lazy(() => import("@/pages/InstantCollection"));
const SevenUpDown = lazy(() => import("@/pages/SevenUpDown"));
const Wheel20Live = lazy(() => import("@/pages/Wheel20Live"));
const Lucky7Live = lazy(() => import("@/pages/Lucky7Live"));
const AndarBaharLive = lazy(() => import("@/pages/AndarBaharLive"));
const ChickenRoad = lazy(() => import("@/pages/ChickenRoad"));
const VirtualSports = lazy(() => import("@/pages/VirtualSports"));

// Routes where background music is allowed to play. Everything else (lobby,
// wallet, profile, history, etc.) stays silent on open.
const GAME_ROUTES = new Set([
  ...INSTANT_COLLECTION.map(g => `/${g.code}`),
  "/mines",
  "/chicken-road",
  "/plinko",
  "/dice",
  "/roulette",
  "/baccarat",
  "/blackjack",
  "/teen-patti",
  "/teen-patti-live",
  "/andar-bahar",
  "/andar-bahar-live",
  "/lucky-7",
  "/lucky-7-live",
  "/wheel-2-live",
  "/crazy-time",
  "/vegetable-bowl",
  "/horse-racing",
  "/bike-racing",
  "/dragon-tiger",
  "/dragon-tiger-one-day",
  "/rummy",
  "/wingo",
  "/lunar-colour-trading",
  "/forex-trading",
  ...Object.values(CRASH_THEMES).map((t) => t.route),
]);

// Every crash-engine game is the same Lunar page themed per game; each route
// binds the page to its gameCode (wallet scope + server RTP config).
const CRASH_ROUTES = Object.values(CRASH_THEMES).map((t) => ({
  route: t.route,
  code: t.code,
}));

function AuthSplash() {
  return <LoadingScreen />;
}

// Browsing the lobby is public; playing and account pages require a session.
function Protected({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  if (isLoading) return <AuthSplash />;
  if (!user) return <Redirect to={`/login?next=${encodeURIComponent(location + window.location.search + window.location.hash)}`} />;
  if (user.isDemo && ["/wallet", "/profile", "/promotions", "/help"].includes(location)) return <DemoWallet />;
  return <>{children}</>;
}

// Auth screens (login/signup/forgot/reset) are only for logged-out users; an
// already-signed-in player resumes the requested page, or the lobby.
function GuestOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <AuthSplash />;
  if (user) return <Redirect to={getLoginDestination()} />;
  return <>{children}</>;
}

function EngineHost() {
  const qc = useQueryClient();
  const [location] = useLocation();
  const { user } = useAuth();
  const crashGame = CRASH_ROUTES.find(entry => entry.route === location)?.code;
  useEffect(() => {
    setQueryClient(qc);
  }, [qc]);
  useEffect(() => {
    // Only the visible crash game needs frame updates and round polling.
    // Accepted bets and auto-cashouts continue to settle on the server.
    if (!user || !crashGame) return;
    setActiveCrashGame(crashGame);
    return initEngine();
  }, [crashGame, user?.id]);
  useLayoutEffect(() => {
    setMusicRouteAllowed(false);
    const audioGame = user ? audioGameForRoute(location) : null;
    setAudioGame(audioGame);
    setMusicRouteAllowed(!!user && (GAME_ROUTES.has(location) || audioGame !== null));
    return () => { setAudioGame(null); setMusicRouteAllowed(false); };
  }, [location, user?.id]);
  useEffect(() => {
    return installAudioAutostart(unlockAudio);
  }, []);
  return null;
}

function App() {
  const theme = useStore((s) => s.settings.theme);
  const [location] = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  // Colour Trading supplies its own viewport around the embedded app.
  const game = location === "/wingo" || location === "/lunar-colour-trading" ? undefined : GAME_ROUTES.has(location)
    ? CRASH_ROUTES.find(entry => entry.route === location)?.code ?? location.slice(1)
    : undefined;

  useLayoutEffect(() => {
    const sitePage = !GAME_ROUTES.has(location) && !["/lottery", "/prize-lotto", "/launcher"].includes(location);
    if (sitePage) document.documentElement.dataset.siteTheme = "lunar";
    else delete document.documentElement.dataset.siteTheme;
  }, [location]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && /^[A-Za-z0-9_-]{1,32}$/.test(ref)) {
        sessionStorage.setItem("lunar:referral-code", ref.toUpperCase());
      }
    } catch {}
  }, []);

  return (
    <AuthProvider>
      <TooltipProvider>
        <DemoSessionBanner />
        <EngineHost />
        <RealtimeBridge enabled={CRASH_ROUTES.some(entry => entry.route === location)} />
        <SharedWalletBridge />
        <GameViewport game={game}>
        <Suspense fallback={<AuthSplash />}>
        <Switch>
          {/* Auth screens — logged-out only. */}
          <Route path="/login">
            <GuestOnly>
              {B2C_STANDALONE ? <B2C initialLogin /> : <Login />}
            </GuestOnly>
          </Route>
          <Route path="/signup">
            <GuestOnly>
              <Signup />
            </GuestOnly>
          </Route>
          <Route path="/forgot">
            <GuestOnly>
              <Forgot />
            </GuestOnly>
          </Route>
          <Route path="/reset">
            <GuestOnly>
              <Reset />
            </GuestOnly>
          </Route>

          {/* Email verification works regardless of session state. */}
          <Route path="/verify" component={VerifyPage} />

          {/* Partner B2B launcher does its own token→session exchange. */}
          <Route path="/launcher" component={Launcher} />

          {/* Everyone can browse the catalog before choosing a game. */}
          <Route path="/b2c"><B2C /></Route>
          <Route path="/">{B2C_STANDALONE ? <B2C /> : <Home />}</Route>
          {/* Playing and account access still require authentication. */}
          {INSTANT_COLLECTION.map(game => <Route key={game.code} path={'/' + game.code}><Protected><Suspense fallback={<AuthSplash />}>{game.code === "7up7down" ? <SevenUpDown /> : <InstantCollection key={game.code} gameCode={game.code} />}</Suspense></Protected></Route>)}
          <Route path="/fury-flight"><Redirect to="/fury" /></Route>
          <Route path="/chicken-road-2.0"><Redirect to="/chicken-road-2" /></Route>
          <Route path="/chicken-road-pirate-edition"><Redirect to="/chicken-road-pirate" /></Route>
          {CRASH_ROUTES.map(({ route, code }) => (
            <Route key={code} path={route}>
              <Protected>
                <Lunar gameCode={code} />
              </Protected>
            </Route>
          ))}
          <Route path="/mines">
            <Protected>
              <Mines />
            </Protected>
          </Route>
          <Route path="/dragon-tiger-one-day"><Protected><Suspense fallback={<AuthSplash />}><DragonTigerOneDay /></Suspense></Protected></Route>
          <Route path="/crazy-time">
            <Protected><Suspense fallback={<AuthSplash />}><CrazyTime /></Suspense></Protected>
          </Route>
          <Route path="/chicken-road">
            <Protected><Suspense fallback={<AuthSplash />}><ChickenRoad /></Suspense></Protected>
          </Route>
          <Route path="/plinko">
            <Protected>
              <Plinko />
            </Protected>
          </Route>
          <Route path="/dice">
            <Protected>
              <Dice />
            </Protected>
          </Route>
          <Route path="/roulette">
            <Protected>
              <Roulette />
            </Protected>
          </Route>
          <Route path="/baccarat">
            <Protected>
              <Baccarat />
            </Protected>
          </Route>
          <Route path="/blackjack">
            <Protected>
              <Blackjack />
            </Protected>
          </Route>
          <Route path="/teen-patti">
            <Protected>
              <TeenPatti />
            </Protected>
          </Route>
          <Route path="/teen-patti-live">
            <Protected>
              <TeenPattiLive />
            </Protected>
          </Route>
          <Route path="/andar-bahar">
            <Protected>
              <AndarBahar />
            </Protected>
          </Route>
          <Route path="/lucky-7">
            <Protected>
              <Lucky7 />
            </Protected>
          </Route>
          <Route path="/wheel-2-live"><Protected><Suspense fallback={<AuthSplash />}><Wheel20Live /></Suspense></Protected></Route>
          <Route path="/wheel-2"><Redirect to="/wheel-2-live" /></Route>
          <Route path="/wheel-2.0"><Redirect to="/wheel-2-live" /></Route>
          <Route path="/lucky-7-live"><Protected><Suspense fallback={<AuthSplash />}><Lucky7Live /></Suspense></Protected></Route>
          <Route path="/andar-bahar-live"><Protected><Suspense fallback={<AuthSplash />}><AndarBaharLive /></Suspense></Protected></Route>
          <Route path="/vegetable-bowl"><Protected><VegetableBowl /></Protected></Route>
          <Route path="/wingo"><Protected><Suspense fallback={<AuthSplash />}><WinGo /></Suspense></Protected></Route>
          <Route path="/lunar-colour-trading"><Protected><Suspense fallback={<AuthSplash />}><WinGo /></Suspense></Protected></Route>
          <Route path="/forex-trading"><Protected><Suspense fallback={<AuthSplash />}><ForexTrading /></Suspense></Protected></Route>
          <Route path="/lottery"><Protected><Suspense fallback={<AuthSplash />}><Lottery /></Suspense></Protected></Route>
          <Route path="/prize-lotto"><Protected><Suspense fallback={<AuthSplash />}><PrizeLotto /></Suspense></Protected></Route>
          <Route path="/rummy">
            <Protected>
              <Rummy />
            </Protected>
          </Route>
          <Route path="/bike-racing"><Protected><BikeRacing /></Protected></Route>
          <Route path="/horse-racing"><Protected><HorseRacing /></Protected></Route>
          <Route path="/virtual-sports/:sport">{params => <Protected><Suspense fallback={<AuthSplash />}><VirtualSports initialSport={params.sport} /></Suspense></Protected>}</Route>
          <Route path="/virtual-sports"><Protected><Suspense fallback={<AuthSplash />}><VirtualSports /></Suspense></Protected></Route>
          <Route path="/dragon-tiger">
            <Protected>
              <DragonTiger />
            </Protected>
          </Route>
          <Route path="/profile">
            <Protected>
              <Profile />
            </Protected>
          </Route>
          <Route path="/wallet">
            <Protected>
              <WalletPage />
            </Protected>
          </Route>
          <Route path="/history">
            <Protected>
              <History />
            </Protected>
          </Route>
          <Route path="/promotions">
            <Protected>
              <Promotions />
            </Protected>
          </Route>
          <Route path="/help">
            <Protected>
              <Help />
            </Protected>
          </Route>
          <Route component={NotFound} />
        </Switch>
        </Suspense>
        </GameViewport>
        <Toaster position="top-right" theme={!GAME_ROUTES.has(location) && !["/lottery", "/prize-lotto", "/launcher"].includes(location) ? "light" : "dark"} richColors />
      </TooltipProvider>
    </AuthProvider>
  );
}

export default App;
