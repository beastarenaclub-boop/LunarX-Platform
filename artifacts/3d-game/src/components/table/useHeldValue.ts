import { useRef } from "react";

/**
 * Keep showing what was on screen before `holding` turned on, until it turns
 * off again.
 *
 * The server credits a win (and pushes the new wallet balance) at settlement,
 * which can arrive while a card flip, dice roll or wheel is still on its way to
 * the result. A balance or score read straight from the wallet would jump up
 * before the game has shown why. Pass the raw server value (before any `?? "0"`
 * fallback) and hold it for exactly the stretch the reveal is still ahead.
 *
 * A value that had not loaded yet when the hold began is taken as soon as it
 * arrives, so opening a page mid-reveal never pins a placeholder.
 */
export function useHeldValue<T>(value: T, holding: boolean): T {
  const shown = useRef(value);
  if (!holding || shown.current === undefined || shown.current === null) {
    shown.current = value;
  }
  return shown.current;
}
