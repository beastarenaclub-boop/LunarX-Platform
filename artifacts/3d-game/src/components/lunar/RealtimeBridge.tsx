import { useEffect } from "react";
import { useRealtimeTopic } from "@workspace/api-client-react";
import type {
  BetsGlobalEvent,
  RoundsLunarEvent,
  GameConfigUpdatedEvent,
  RainEventWire,
  FreeBetsChangedEvent,
} from "@workspace/api-zod";
import {
  store,
  useStore,
  type FakePlayerBet,
  type RoundResult,
} from "@/game/store";
import { applyLiveGameConfig } from "@/game/engine";
import { refreshFreeBets, refreshActiveRain } from "@/game/freeBets";
import { useAuth } from "@/lib/auth";

// Use the canonical, server-shared event union so any future change to the
// wire shape causes a typecheck error here rather than a silent runtime bug.
type BetEvent = BetsGlobalEvent;
type RoundEvent = RoundsLunarEvent;

const MAX_LIVE = 80;

function paiseToRupees(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function nameFor(displayName: string | null, userId: string): string {
  if (displayName && displayName.length > 0) return displayName;
  return `Player ${userId.slice(-4).toUpperCase()}`;
}

/**
 * Subscribes to the global bets stream and merges real placements/settlements
 * into the store's `liveBets` slice. The first time a real bet is observed,
 * the engine's fake-player simulator is suppressed for the rest of the
 * session (see store.realLiveBetsActive).
 */
export default function RealtimeBridge({ enabled = true }: { enabled?: boolean }) {
  // Which crash game the player currently has open. All crash rounds are
  // broadcast on the shared "rounds:lunar" topic with a per-event gameCode,
  // so we filter client-side to only mirror the active game's history.
  const activeGameCode = useStore((s) => s.activeGameCode);
  const { user } = useAuth();
  const active = enabled && !!user;

  // Initial pulls: free-bet summary + any rain drop already in progress.
  // Re-run when the player switches crash games (per-game grants) and when
  // the authenticated user hydrates (the very first fetch can otherwise race
  // auth and 401, leaving the summary stale until the next trigger).
  useEffect(() => {
    if (!active) return;
    void refreshFreeBets();
    void refreshActiveRain();
  }, [active, activeGameCode, user?.id]);

  useRealtimeTopic<BetEvent>(active ? "bets:global" : null, (ev) => {
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "placed") {
      // Only mirror bets for the crash game currently open — bets:global
      // carries every game's bets (mines/plinko/dice + all crash variants).
      if (ev.gameCode !== store.getState().activeGameCode) return;
      const newBet: FakePlayerBet = {
        id: ev.id,
        name: nameFor(ev.displayName, ev.userId),
        amount: paiseToRupees(ev.stakeAmount),
        cashedOutAt: null,
        payout: 0,
        roundId: store.getState().roundId,
      };
      store.setState((s) => ({
        liveBets: [newBet, ...s.liveBets].slice(0, MAX_LIVE),
        realLiveBetsActive: true,
        lastRealBetTs: Date.now(),
      }));
    } else if (ev.type === "settled") {
      if (!store.getState().liveBets.some(b => b.id === ev.id)) return;
      store.setState((s) => ({
        liveBets: s.liveBets.map((b: FakePlayerBet) =>
          b.id === ev.id
            ? {
                ...b,
                cashedOutAt: ev.status === "cashed_out" ? ev.multiplier : null,
                payout:
                  ev.status === "cashed_out"
                    ? paiseToRupees(ev.payoutAmount)
                    : 0,
              }
            : b,
        ),
        realLiveBetsActive: true,
        lastRealBetTs: Date.now(),
      }));
    }
  });

  // Authoritative round result push. The local engine still drives this
  // client's animation, but every persisted round is broadcast so we can
  // mirror the canonical recent-crash history across tabs/users.
  useRealtimeTopic<RoundEvent>(active ? "rounds:lunar" : null, (ev) => {
    if (!ev || ev.type !== "result") return;
    if (ev.gameCode && ev.gameCode !== store.getState().activeGameCode) return;
    const result: RoundResult = {
      id: ev.roundId,
      crashAt: ev.crashMultiplier,
      serverSeed: null,
      serverSeedHash: ev.serverSeedHash,
      clientSeed: ev.clientSeed,
      nonce: ev.nonce,
      ts: ev.ts,
    };
    store.setState((s) => {
      if (s.rounds.some((r) => r.id === result.id)) return s;
      return {
        rounds: [result, ...s.rounds].slice(0, 50),
        history: [ev.crashMultiplier, ...s.history].slice(0, 30),
      };
    });
  });

  // Live admin edits to game config (timings, RTP, enabled, auto-cash bounds).
  // Push the new values straight into the engine so the next round adopts
  // them without a refresh; the disabled overlay comes up within ~1s.
  useRealtimeTopic<GameConfigUpdatedEvent>(active ? `game-config:${activeGameCode}` : null, (ev) => {
    if (!ev || ev.type !== "updated") return;
    if (ev.gameCode && ev.gameCode !== store.getState().activeGameCode) return;
    applyLiveGameConfig(ev.config);
  });

  // Rain drops: show the claim card in chat and keep the claimed counter
  // live. Claims/expiry beyond maxClaims null the card via refresh.
  useRealtimeTopic<RainEventWire>(active ? "rain:lunar" : null, (ev) => {
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "drop") {
      if (ev.gameCode !== store.getState().activeGameCode) return;
      store.setState({
        activeRain: {
          id: ev.id,
          amountPaise: ev.amountPaise,
          maxClaims: ev.maxClaims,
          claimedCount: ev.claimedCount,
          message: ev.message,
          expiresAt: ev.expiresAt,
          claimedByMe: false,
        },
      });
    } else if (ev.type === "claimed") {
      store.setState((s) =>
        s.activeRain && s.activeRain.id === ev.id
          ? {
              activeRain: {
                ...s.activeRain,
                claimedCount: ev.claimedCount,
                maxClaims: ev.maxClaims,
              },
            }
          : s,
      );
    }
  });

  // Per-user free-bets change signal (admin grant, rain claim, consumption
  // in another tab) → re-pull the summary.
  useRealtimeTopic<FreeBetsChangedEvent>(
    active && user ? `free-bets:${user.id}` : null,
    () => {
      void refreshFreeBets();
    },
  );

  return null;
}
