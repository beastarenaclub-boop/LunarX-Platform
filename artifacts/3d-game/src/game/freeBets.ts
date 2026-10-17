import { getFreeBets, getActiveRain, claimRain } from "@workspace/api-client-react";
import { store, type ActiveRain } from "./store";

/**
 * Pull the player's free-bet summary for the currently open crash game and
 * mirror it into the store. Called on mount, after every bet placement that
 * consumed a free bet, and whenever the per-user `free-bets:{userId}` topic
 * signals a change (admin grant, rain claim, expiry).
 */
export async function refreshFreeBets(): Promise<void> {
  try {
    const summary = await getFreeBets({
      gameCode: store.getState().activeGameCode,
    });
    store.setState((s) => ({
      freeBetCount: summary.count,
      freeBetNextAmountPaise: summary.nextAmountPaise,
      // Auto-disarm the toggle when the player runs out of free bets so the
      // next bet doesn't fail with FREE_BET_NOT_AVAILABLE.
      useFreeBetForBets: summary.count > 0 ? s.useFreeBetForBets : false,
    }));
  } catch {
    // Non-fatal: summary stays stale until the next refresh trigger.
  }
}

/** Fetch the currently claimable rain drop (if any) into the store. */
export async function refreshActiveRain(): Promise<void> {
  try {
    const { rain } = await getActiveRain({
      gameCode: store.getState().activeGameCode,
    });
    store.setState((s) => {
      if (!rain) return { activeRain: null };
      const prev = s.activeRain;
      const next: ActiveRain = {
        id: rain.id,
        amountPaise: rain.amountPaise,
        maxClaims: rain.maxClaims,
        claimedCount: rain.claimedCount,
        message: rain.message ?? null,
        expiresAt: rain.expiresAt,
        claimedByMe: prev?.id === rain.id ? prev.claimedByMe : false,
      };
      return { activeRain: next };
    });
  } catch {
    // Non-fatal.
  }
}

/**
 * Claim the active rain drop. Returns an error message for the UI on
 * failure (already claimed / fully claimed / expired), null on success.
 */
export async function claimActiveRain(rainId: string): Promise<string | null> {
  try {
    const res = await claimRain(rainId);
    store.setState((s) => ({
      activeRain:
        s.activeRain && s.activeRain.id === rainId
          ? {
              ...s.activeRain,
              claimedByMe: true,
              claimedCount: res.rain.claimedCount,
            }
          : s.activeRain,
    }));
    void refreshFreeBets();
    return null;
  } catch (err) {
    return (err as Error).message || "Could not claim";
  }
}
