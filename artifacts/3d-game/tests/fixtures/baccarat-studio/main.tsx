import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { setAudioGame } from "@/game/audio";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import GameViewport from "@/components/GameViewport";
import Baccarat from "@/pages/Baccarat";
import { Toaster } from "@/components/ui/sonner";
import "./styles.css";
import "../../../../../lib/game-ui/controls.css";
import "../../../../../lib/game-ui/viewport.css";
import "../../../../../lib/game-ui/game-layouts.css";
import "../../../src/mobile.css";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
// Test driver invalidates the real round hook after a controlled server change.
Object.assign(window, {
  refreshBaccarat: () =>
    client.invalidateQueries({ queryKey: ["table-round", "baccarat"] }),
});
function Game() {
  useEffect(() => {
    setAudioGame("baccarat");
    return () => setAudioGame(null);
  }, []);
  const { user, isLoading } = useAuth();
  return isLoading ? (
    <p>Connecting…</p>
  ) : user ? (
    <GameViewport game="baccarat">
      <Baccarat />
      <Toaster />
    </GameViewport>
  ) : (
    <p>Sign in through the game lobby.</p>
  );
}
const root = createRoot(document.getElementById("root")!);
Object.assign(window, { unmountBaccarat: () => root.unmount() });
root.render(
  <QueryClientProvider client={client}>
    <AuthProvider>
      <Game />
    </AuthProvider>
  </QueryClientProvider>,
);
