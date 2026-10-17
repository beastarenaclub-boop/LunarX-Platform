import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import GameViewport from "@/components/GameViewport";
import Wheel20Live from "@/pages/Wheel20Live";
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
    <GameViewport game="wheel-2-live">
      <Wheel20Live />
    </GameViewport>
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
