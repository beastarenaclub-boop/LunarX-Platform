import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import GameViewport from "@/components/GameViewport";
import Lucky7Live from "@/pages/Lucky7Live";
import { Route, Switch } from "wouter";
import "@/index.css";
import "../../../../../lib/game-ui/viewport.css";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
function Game() {
  const { user, isLoading } = useAuth();
  return isLoading ? (
    <p>Connecting…</p>
  ) : user ? (
    <Switch>
      <Route path="/lucky-7-live">
        <GameViewport game="lucky-7-live">
          <Lucky7Live />
        </GameViewport>
      </Route>
      <Route>
        <p>Game lobby</p>
      </Route>
    </Switch>
  ) : (
    <p>Sign in through the game lobby.</p>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <AuthProvider>
      <Game />
    </AuthProvider>
  </QueryClientProvider>,
);
