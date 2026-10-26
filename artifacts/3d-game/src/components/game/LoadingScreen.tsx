import { Gamepad2, LoaderCircle } from "lucide-react";
import { useLocation } from "wouter";
import { LOBBY_GAMES } from "@/components/lobby/catalog";
import { B2C_LOTTERY, b2cArtwork } from "@/components/b2c/artwork";
import { B2C_STANDALONE } from "@/components/b2c/config";

const routeAliases: Record<string, string> = {
  "/wingo": "/lunar-colour-trading",
  "/fury-flight": "/fury",
  "/chicken-road-pirate-edition": "/chicken-road-pirate",
  "/wheel-2": "/wheel-2-live",
  "/wheel-2.0": "/wheel-2-live",
  "/virtual-sports": "/virtual-sports/football",
};

/** Keep the selected game's lobby icon visible while its code/session loads. */
export default function LoadingScreen() {
  const [location] = useLocation();
  const path = location.replace(/\/$/, "") || "/";
  const game = LOBBY_GAMES.find(entry => entry.route === (routeAliases[path] ?? path));
  const art = game ? b2cArtwork(game.id) : null;
  const image = game?.id === "lottery" ? B2C_LOTTERY : game?.artwork;
  const dark = !!game || B2C_STANDALONE || path === "/b2c";

  return (
    <div
      className={`min-h-[100dvh] flex items-center justify-center px-6 ${dark ? "bg-[#22292f] text-white" : "bg-white text-slate-900"}`}
      role="status"
      aria-live="polite"
      aria-label={game ? `Loading ${game.name}` : "Loading"}
      data-loading-game={game?.id}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        {game && (art || image) ? (
          <div className="w-52 max-w-full aspect-video overflow-hidden rounded-xl border border-white/15 shadow-2xl">
            {art ? (
              <svg className="block h-full w-full" viewBox={art.viewBox} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${game.name} icon`}>
                <image href={art.src} width={art.width} height={art.height} />
              </svg>
            ) : (
              <img src={image} alt={`${game.name} icon`} className="h-full w-full object-cover" fetchPriority="high" />
            )}
          </div>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#126e58] text-white">
            <Gamepad2 size={42} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          {game && <span className="text-lg font-semibold">{game.name}</span>}
          <span className={`flex items-center gap-2 text-sm ${dark ? "text-slate-300" : "text-slate-500"}`}>
            <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
            Loading…
          </span>
        </div>
      </div>
    </div>
  );
}
