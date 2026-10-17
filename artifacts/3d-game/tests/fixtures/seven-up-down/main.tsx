// A focused entry for testing the real game independently of other games in development.
import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import GameViewport from "@/components/GameViewport";
import SevenUpDown from "@/pages/SevenUpDown";
import { useStore } from "@/game/store";
import { setAudioGame, setVolumes, unlockAudio } from "@/game/audio";
import * as recordings from "@/game/publicDemoSounds";
import "@/index.css";
import "../../../../../lib/game-ui/viewport.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
(window as any).sevenTestRecordings = recordings;
function Game() {
  const { user, isLoading } = useAuth();
  const sound = useStore(s => s.settings.sound);
  useLayoutEffect(() => { setAudioGame("7up7down"); return () => setAudioGame(null); }, []);
  useLayoutEffect(() => { setVolumes(sound ? .7 : 0, sound ? .8 : 0, 0, sound ? .8 : 0); }, [sound]);
  useEffect(() => {
    const unlock = () => { void unlockAudio(); };
    window.addEventListener("pointerdown", unlock, true);
    return () => window.removeEventListener("pointerdown", unlock, true);
  }, []);
  if (isLoading) return <p>Connecting to your account…</p>;
  if (!user) return <p>Please sign in through the game lobby to play.</p>;
  return <GameViewport game="7up7down"><SevenUpDown /></GameViewport>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><AuthProvider><Game /></AuthProvider></QueryClientProvider>);
