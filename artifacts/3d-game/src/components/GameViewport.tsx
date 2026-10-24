import { INSTANT_COLLECTION } from "@workspace/api-zod/instant-collection";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { fitGameViewport } from "../../../../lib/game-ui/fitViewport";
import { GameInformationProvider } from "./game/GameInformation";

const nativeInstant = (game?: string) => game?.startsWith("poker-") || INSTANT_COLLECTION.some(g => g.code === game);
const layouts: Record<string, string> = {
  "lucky-7": "dealer", "teen-patti-live": "dealer",
  "lucky-7-live": "lucky7-live", "wheel-2-live": "wheel20-live",
  "andar-bahar-live": "andar-bahar-live",
  "teen-patti-joker": "teenpatti-joker",
  "crazy-time": "crazy-time",
  roulette: "roulette", mines: "mines", plinko: "plinko", dice: "dice",
  baccarat: "baccarat-studio", "teen-patti": "cards", "andar-bahar": "cards", blackjack: "blackjack",
  "dragon-tiger": "dragon-tiger", rummy: "rummy", "vegetable-bowl": "vegetable",
  "horse-racing": "racing", "bike-racing": "racing",
  wingo: "wingo",
  "forex-trading": "forex",
  lunar: "crash", aviator: "crash", jetx: "crash",
  fury: "crash",
};

/** Reflow games at their native size; short screens can scroll to every control. */
export default function GameViewport({
  game,
  children,
}: {
  game?: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = frame.current,
      surface = content.current;
    if (!host || !surface || !game) return;
    host.scrollTop = 0;
    // Every framed game follows the visible viewport, including soft keyboards
    // and session banners. Colour Trading uses document scrolling instead.
    if (game === "wingo") return;
    return fitGameViewport(host, surface, game === "vegetable-bowl");
  }, [game]);
  if (!game) return <>{children}</>;
  return (
    <div ref={frame} className="game-viewport" data-game-viewport={game} data-game-layout={layouts[game] ?? "standard"}>
      <div
        ref={content}
        className={`game-fit-content${nativeInstant(game) || game === "vegetable-bowl" || game === "crazy-time" || game === "chicken-road" || game === "dragon-tiger-one-day" || game === "wheel-2-live" || game === "teen-patti-joker" || game === "lucky-7-live" || game === "andar-bahar-live" || game === "baccarat" ? " game-fit-native" : ""}`}
      >
        <GameInformationProvider key={game}>{children}</GameInformationProvider>
      </div>
    </div>
  );
}
