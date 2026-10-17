import { CircleUserRound, Gift, Grid2X2, Star, Wallet } from "lucide-react";
import { Link, useLocation } from "wouter";
import "./mobile-navigation.css";

/** The same thumb navigation follows players between lobby and account pages. */
export function MobileNavigation({ onGames, onFavourites }: { onGames?: () => void; onFavourites?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="mobile-navigation" aria-label="Mobile navigation">
      {onGames ? <button onClick={onGames} aria-current={location === "/" ? "page" : undefined}><Grid2X2 /><span>Games</span></button>
        : <Link href="/"><Grid2X2 /><span>Games</span></Link>}
      {onFavourites ? <button onClick={onFavourites}><Star /><span>Favourites</span></button>
        : <Link href="/?favourites=1"><Star /><span>Favourites</span></Link>}
      <Link href="/promotions" aria-current={location === "/promotions" ? "page" : undefined}><Gift /><span>Promotions</span></Link>
      <Link href="/wallet" data-testid="nav-wallet" aria-current={location === "/wallet" ? "page" : undefined}><Wallet /><span>Wallet</span></Link>
      <Link href="/profile" aria-current={location === "/profile" ? "page" : undefined}><CircleUserRound /><span>Account</span></Link>
    </nav>
  );
}
