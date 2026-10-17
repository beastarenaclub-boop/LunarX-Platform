// Run the real collection page and shared audio lifecycle independently of other game entries.
import { useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { collectionGame } from "@workspace/api-zod/instant-collection";
import { AuthProvider, useAuth } from "@/lib/auth";
import GameViewport from "@/components/GameViewport";
import InstantCollection from "@/pages/InstantCollection";
import { setAudioGame, unlockAudio } from "@/game/audio";
import { audioGameForRoute } from "@/game/gameSoundDesign";
import { setMusicRouteAllowed } from "@/game/engine";
import "@/index.css";
import "../../../../../lib/game-ui/controls.css";
import "../../../../../lib/game-ui/viewport.css";
import "../../../../../lib/game-ui/game-layouts.css";
import "@/mobile.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function Game() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const game = collectionGame(location.slice(1));
  useLayoutEffect(() => {
    setMusicRouteAllowed(false);
    setAudioGame(audioGameForRoute(location));
    setMusicRouteAllowed(Boolean(game));
    return () => { setAudioGame(null); setMusicRouteAllowed(false); };
  }, [location, game]);
  useEffect(() => {
    const unlock = () => { void unlockAudio(); };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
  if (isLoading) return <p>Connecting to your account...</p>;
  if (!user) return <p>Please sign in through the game lobby to play.</p>;
  if (!game) return <p>Game closed.</p>;
  return <GameViewport game={game.code}><InstantCollection key={game.code} gameCode={game.code} /></GameViewport>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><AuthProvider><Game /></AuthProvider></QueryClientProvider>);
