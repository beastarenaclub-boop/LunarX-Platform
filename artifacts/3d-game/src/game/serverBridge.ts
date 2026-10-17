import {
  placeBet as apiPlaceBet,
  cashOutBet as apiCashOutBet,
  settleBetLoss as apiSettleBetLoss,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
  type Bet,
} from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";
import { store } from "./store";

let qc: QueryClient | null = null;
const observedSettlements = new Set<string>();

export function setQueryClient(client: QueryClient) {
  qc = client;
}

function invalidateWalletAndBets() {
  if (!qc) return;
  void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
  void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
  void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
}

/**
 * Places a server-side bet that debits the wallet immediately. Returns the
 * server bet id (used later for cashout / settle). Throws on insufficient
 * funds or any other API failure so the caller can surface a toast.
 */
export async function placeServerBet(
  stakeRupees: number,
  opts?: { useBonus?: boolean; useFreeBet?: boolean; panel?: number; autoCashOut?: number },
): Promise<Bet> {
  const stakePaise = Math.round(stakeRupees * 100).toString();
  const bet = await apiPlaceBet({
    // Bets always target whichever crash game the player currently has
    // open; the server settles into the shared wallet.
    gameCode: store.getState().activeGameCode,
    stakeAmount: stakePaise,
    // The current round id groups the bet on the server. Pari-mutuel
    // settlement pays winners per-round, so a bet stored without a round id
    // would NEVER be paid out — this field is critical.
    roundId: store.getState().roundId,
    panel: opts?.panel,
    autoCashOut: opts?.autoCashOut,
    // Free bet takes precedence: the server forces the stake to the grant
    // amount and skips the wallet debit entirely.
    ...(opts?.useFreeBet
      ? { useFreeBet: true }
      : opts?.useBonus
        ? { useBonus: true }
        : {}),
  } as Parameters<typeof apiPlaceBet>[0]);
  invalidateWalletAndBets();
  return bet;
}

export interface CrashSnapshot {
  id: string; gameCode: string; phase: "betting" | "flying" | "crashed";
  now: number; startsAt: number; bettingMs: number; multiplier: number;
  nextRoundAt: number | null; crashPoint: number | null; serverSeed: string | null;
  serverSeedHash: string; clientSeed: string; nonce: number; version: number;
  houseEdge?: number; maxMultiplier?: number;
  bets: { id: string; stakeAmount: string; status: string; payoutAmount: string; multiplier: number | null; panel: number; autoCashOut?: number | null }[];
}

export async function getCrashRound(gameCode: string, roundId?: string): Promise<CrashSnapshot> {
  const base = import.meta.env.VITE_API_URL || "/api";
  const query = new URLSearchParams({ clientSeed: store.getState().clientSeed || "player", turbo:String(store.getState().settings.turbo) });
  if (roundId) query.set("roundId", roundId);
  const response = await fetch(`${base}/crash/${encodeURIComponent(gameCode)}?${query}`, { credentials: "include" });
  if (!response.ok) throw new Error("Connecting to the game server");
  const data = await response.json() as CrashSnapshot;
  if (!data.id?.startsWith("crash-") || !Number.isFinite(data.now)) throw new Error("Invalid game round");
  const settled = data.bets.filter(b => b.status !== "placed" && !observedSettlements.has(b.id));
  if (settled.length) {
    settled.forEach(b => observedSettlements.add(b.id));
    while(observedSettlements.size > 1000) observedSettlements.delete(observedSettlements.values().next().value!);
    invalidateWalletAndBets();
  }
  return data;
}

export async function cashOutServerBet(
  betId: string,
  multiplier: number,
): Promise<Bet> {
  const bet = await apiCashOutBet(betId, { multiplier });
  invalidateWalletAndBets();
  return bet;
}

export async function settleServerLoss(
  betId: string,
  multiplier: number,
): Promise<Bet> {
  const bet = await apiSettleBetLoss(betId, { multiplier });
  invalidateWalletAndBets();
  return bet;
}

/**
 * Trigger pari-mutuel round settlement on the server. Called once per round
 * right after the local engine finishes a round. The server endpoint is
 * idempotent on (roundId, gameCode), so racing tabs / refresh / multiple
 * players all converge to the same single settlement; only the first call
 * actually credits wallets.
 *
 * Race protection: the engine fires per-bet `settleServerLoss` calls in
 * parallel with this round-level settle. The server requires every bet to
 * be terminal before it will settle a round, so the round-settle call may
 * lose the race and return 409 Conflict. We therefore retry on 409 with
 * exponential backoff (up to ~6 seconds total) so the trailing per-bet
 * settle promises have time to land before we give up. 4xx other than 409
 * and 5xx beyond the retry budget are silent — settlement is fully
 * deterministic, so any later tab/player triggering the same endpoint
 * will still commit the same split.
 */
export async function settleServerRound(roundId: string): Promise<void> {
  if (!roundId) return;
  const base = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "/api";
  const url = `${base}/lunar/round/${encodeURIComponent(roundId)}/settle`;
  // Backoff schedule (ms): ~0.2 + 0.4 + 0.8 + 1.6 + 3.2 ≈ 6.2s of total
  // wait — comfortably longer than the worst-case server settleBetLoss
  // round-trip we observe, so trailing per-bet settles can finish first.
  const delays = [200, 400, 800, 1600, 3200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        invalidateWalletAndBets();
        return;
      }
      // 409 = some bet is still 'placed' on the server. Almost always
      // because a per-bet settleServerLoss is still in flight. Retry.
      if (res.status === 409 && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      // 4xx (other than 409) means the request is permanently invalid —
      // no point retrying. Server logs detail; just refresh wallet view.
      invalidateWalletAndBets();
      return;
    } catch {
      // Network errors get one immediate retry through the backoff loop;
      // after the budget is exhausted we silently give up.
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return;
    }
  }
}
