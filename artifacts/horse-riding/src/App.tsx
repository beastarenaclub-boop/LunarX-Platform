import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { fitGameViewport } from '../../../lib/game-ui/fitViewport';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Game from '@/pages/Game';
import Race from '@/pages/Race';
import Login from '@/pages/Login';
import Derby from '@/pages/Derby';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  const game = ({ '/': 'horse-racing', '/ride': 'horse-riding', '/race': 'horse-racing', '/derby': 'horse-derby', '/jockey': 'horse-racing' } as Record<string, string>)[location];
  const routes = <Switch>
    <Route path="/" component={HorseGameRedirect} />
    <Route path="/ride" component={Game} />
    <Route path="/race" component={TurfRaceRoute} />
    <Route path="/derby" component={Derby} />
    <Route path="/jockey" component={Race} />
    <Route path="/login" component={Login} />
    <Route component={NotFound} />
  </Switch>;
  return (
    <RoutedErrorBoundary>
      {game ? <HorseViewport key={game} game={game}>{routes}</HorseViewport> : routes}
    </RoutedErrorBoundary>
  );
}

function HorseViewport({game, children}: {game: string; children: ReactNode}) {
  const host = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current || !surface.current) return;
    return fitGameViewport(host.current, surface.current);
  }, []);
  return <div ref={host} className="game-viewport" data-game-viewport={game}>
    <div ref={surface} className="game-fit-content">{children}</div>
  </div>;
}

// Keep existing server-settled Derby handoffs on their original visualisation.
function TurfRaceRoute() {
  return new URLSearchParams(window.location.search).get('from') === 'derby'
    ? <Race /> : <HorseGameRedirect />;
}
function HorseGameRedirect() {
  useEffect(()=>{window.location.replace('/horse-racing');},[]);
  return <div className="game-page p-6">Opening Horse Racing… <a href="/horse-racing">Continue</a></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
